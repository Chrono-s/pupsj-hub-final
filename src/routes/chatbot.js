const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const AI_SIDECAR_URL = process.env.AI_SIDECAR_URL || 'http://localhost:8000';

// ── AI sidecar call ───────────────────────────────────────────────────────────
async function askAI(message, history = [], doc_context = [], live_data = {}) {
  const res = await fetch(`${AI_SIDECAR_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, doc_context, live_data }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Sidecar HTTP ${res.status}`);
  }
  return res.json();
}

// ── Module query detectors ────────────────────────────────────────────────────
const MODULE_RE = {
  documents:     /\b(file|template|form|document|download|proposal|docx?|pdf|find.*file|find.*form|find.*template)\b/i,
  events:        /\b(event|calendar|activity|activities|seminar|workshop|symposium|competition|orientation|when is|upcoming|it week|intramurals)\b/i,
  announcements: /\b(announcement|news|update|notice|bulletin|latest|recent|what('s| is) (new|happening)|any news|memo)\b/i,
  lostfound:     /\b(lost (and|&) found|lost item|found item|missing item|report.*lost|search.*item|lost.*belong|looking for.*item|someone found|i found a|report a found)\b/i,
  faculty:       /\b(professor|prof\b|faculty|teacher|instructor|sir\b|ma'?am|where is.*prof|is.*available|in class|in office|locator|availability)\b/i,
};
const FOLLOW_UP_RE = /\b(it|that|this|they|them|those|these|there|here|what about|how about|and for|and what|what else|how so|why|when|where|who|which one|same one)\b/i;

// ── Helper: extract keywords from message ─────────────────────────────────────
function extractKeywords(message, stopWords) {
  return message.replace(/[?!.,;:]/g, '').split(/\s+/)
    .filter(w => w.length >= 3 && !stopWords.has(w.toLowerCase()));
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function detectFacultyStatusFilter(message) {
  const msg = String(message || '').toLowerCase();
  if (/\bin office\b/.test(msg)) return 'in_office';
  if (/\bin class\b/.test(msg)) return 'in_class';
  if (/\b(unavailable|not available|absent)\b/.test(msg)) return 'unavailable';
  if (/\bavailable\b/.test(msg)) return 'available';
  return null;
}

const MATCH_STOP_WORDS = new Set([
  'a','an','and','any','app','are','at','about','available','can','campus','check','do','download',
  'event','events','file','find','for','form','from','get','have','how','hub','i','in','is','it',
  'latest','list','looking','lost','me','my','new','of','on','open','recent','report','schedule',
  'see','show','template','that','the','this','to','upcoming','view','what','when','where','which'
]);

function normalizeMatchWord(word) {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('s') && word.length > 3 && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function tokenizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(normalizeMatchWord)
    .filter(w => w.length >= 2 && !MATCH_STOP_WORDS.has(w));
}

function computeTokenMatchScore(queryText, candidateText) {
  const queryTokens = tokenizeForMatch(queryText);
  const candidateTokens = tokenizeForMatch(candidateText);
  if (!queryTokens.length || !candidateTokens.length) return 0;

  const candidateSet = new Set(candidateTokens);
  const common = [...new Set(queryTokens.filter(token => candidateSet.has(token)))];
  if (!common.length) return 0;

  const coverage = common.length / queryTokens.length;
  const density = common.length / candidateSet.size;
  let score = (coverage * 0.8) + (density * 0.2);

  const q = String(queryText || '').toLowerCase();
  const c = String(candidateText || '').toLowerCase();
  if (q && c && (q.includes(c) || c.includes(q))) score += 0.15;
  return Math.min(score, 1);
}

function pickBestTokenMatch(message, items, toText, minScore = 0.55) {
  let best = null;
  let bestScore = 0;

  for (const item of items || []) {
    const score = computeTokenMatchScore(message, toText(item));
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return best && bestScore >= minScore ? { item: best, score: bestScore } : null;
}

function isLikelyFollowUp(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  const tokenCount = text.split(/\s+/).filter(Boolean).length;
  return tokenCount <= 8 || FOLLOW_UP_RE.test(text);
}

function buildContextualQuery(message, history = []) {
  const current = String(message || '').trim();
  if (!current || !Array.isArray(history) || !history.length || !isLikelyFollowUp(current)) {
    return current;
  }

  const lastTurn = [...history].reverse().find(turn =>
    String(turn?.user || '').trim() || String(turn?.bot || '').trim()
  );
  if (!lastTurn) return current;

  const lastUser = String(lastTurn.user || '').trim();
  const lastBot = String(lastTurn.bot || '').trim().replace(/\s+/g, ' ');
  const botSnippet = lastBot ? lastBot.slice(0, 180) : '';
  const parts = [current];

  if (lastUser && !current.toLowerCase().includes(lastUser.toLowerCase())) {
    parts.push(`Context: ${lastUser}`);
  }
  if (botSnippet) {
    parts.push(`Previous answer: ${botSnippet}`);
  }

  return parts.join(' | ');
}

// ── Context fetchers (one per module) ─────────────────────────────────────────
async function fetchDocuments(message) {
  const sw = new Set(['where','find','this','file','form','that','what','which','from','have','with','about','how','can','template','document','download']);
  const kw = extractKeywords(message, sw);
  try {
    let rows = [];
    if (kw.length > 0) {
      const cond = kw.map((_, i) => `(dt.title ILIKE $${i+1} OR dt.file_name ILIKE $${i+1})`).join(' OR ');
      const r = await pool.query(
        `SELECT dt.title, dt.file_name, dc.name as category
         FROM document_templates dt
         LEFT JOIN document_categories dc ON dc.id = dt.category_id
         WHERE dt.status = 'active' AND (${cond}) ORDER BY dt.title ASC LIMIT 5`,
        kw.map(w => `%${w}%`)
      );
      rows = r.rows;
    }
    if (rows.length === 0) {
      const r = await pool.query(
        `SELECT dt.title, dt.file_name, dc.name as category
         FROM document_templates dt
         LEFT JOIN document_categories dc ON dc.id = dt.category_id
         WHERE dt.status = 'active' ORDER BY dc.name ASC, dt.title ASC`
      );
      rows = r.rows;
    }
    return rows;
  } catch (e) { console.error('[ctx:docs]', e.message); return []; }
}

async function fetchEvents(message) {
  const sw = new Set(['when','what','where','which','the','event','events','that','this','for','about','happening','upcoming','schedule','is','are','any']);
  const kw = extractKeywords(message, sw);
  try {
    let rows = [];
    if (kw.length > 0) {
      const cond = kw.map((_, i) => `(e.title ILIKE $${i+1} OR e.description ILIKE $${i+1} OR e.location ILIKE $${i+1})`).join(' OR ');
      const r = await pool.query(
        `SELECT e.title, e.description, e.location, e.event_date, e.start_time, e.end_time, e.department
         FROM events e WHERE e.status != 'deleted' AND (${cond})
         ORDER BY ABS(EXTRACT(EPOCH FROM (e.event_date - CURRENT_DATE))) ASC LIMIT 5`,
        kw.map(w => `%${w}%`)
      );
      rows = r.rows;
    }
    if (rows.length === 0) {
      const r = await pool.query(
        `SELECT title, description, location, event_date, start_time, end_time, department
         FROM events WHERE status != 'deleted' AND event_date >= CURRENT_DATE
         ORDER BY event_date ASC LIMIT 5`
      );
      rows = r.rows;
    }
    return rows;
  } catch (e) { console.error('[ctx:events]', e.message); return []; }
}

async function fetchAnnouncements(message) {
  const sw = new Set(['announcement','announcements','any','bulletin','from','latest','list','memo','new','news','notice','recent','show','tell','the','update','updates','what','which']);
  const kw = extractKeywords(message, sw);
  try {
    let rows = [];
    if (kw.length > 0) {
      const params = kw.map(w => `%${w}%`);
      const cond = kw
        .map((_, i) => `(a.title ILIKE $${i + 1} OR a.content ILIKE $${i + 1} OR a.department ILIKE $${i + 1})`)
        .join(' OR ');
      const score = kw
        .map((_, i) => `
          CASE
            WHEN a.title ILIKE $${i + 1} THEN 4
            WHEN a.department ILIKE $${i + 1} THEN 3
            WHEN a.content ILIKE $${i + 1} THEN 1
            ELSE 0
          END
        `)
        .join(' + ');

      const r = await pool.query(
        `SELECT a.title, a.content, a.department, a.created_at, (${score}) AS relevance
         FROM announcements a
         WHERE a.status = 'active' AND (${cond})
         ORDER BY relevance DESC, a.is_pinned DESC, a.created_at DESC
         LIMIT 5`,
        params
      );
      rows = r.rows;
    }

    if (rows.length === 0) {
      const r = await pool.query(
        `SELECT title, content, department, created_at
         FROM announcements
         WHERE status = 'active'
         ORDER BY is_pinned DESC, created_at DESC
         LIMIT 5`
      );
      rows = r.rows;
    }
    return rows;
  } catch (e) { console.error('[ctx:announcements]', e.message); return []; }
}

async function fetchLostFound(message) {
  const sw = new Set(['lost','found','missing','item','where','what','about','report','any','the','was','been','someone','looking','for']);
  const kw = extractKeywords(message, sw);
  try {
    let rows = [];
    if (kw.length > 0) {
      const cond = kw.map((_, i) => `(lf.item_name ILIKE $${i+1} OR lf.description ILIKE $${i+1} OR lf.category ILIKE $${i+1})`).join(' OR ');
      const r = await pool.query(
        `SELECT lf.type, lf.item_name, lf.description, lf.category, lf.location_found, lf.date_reported, lf.contact_info
         FROM lost_found lf WHERE lf.status = 'open' AND (${cond})
         ORDER BY lf.date_reported DESC LIMIT 5`,
        kw.map(w => `%${w}%`)
      );
      rows = r.rows;
    }
    if (rows.length === 0) {
      const r = await pool.query(
        `SELECT type, item_name, description, category, location_found, date_reported
         FROM lost_found WHERE status = 'open' ORDER BY date_reported DESC LIMIT 5`
      );
      rows = r.rows;
    }
    return rows;
  } catch (e) { console.error('[ctx:lostfound]', e.message); return []; }
}

async function fetchFaculty(message) {
  const sw = new Set(['where','what','who','when','professor','faculty','teacher','instructor','the','sir','maam','available','status','room','office','is','are']);
  const kw = extractKeywords(message, sw);
  const statusFilter = detectFacultyStatusFilter(message);
  try {
    let rows = [];
    if (kw.length > 0 || statusFilter) {
      const params = [];
      const keywordConds = [];
      const scoreParts = [];

      for (const word of kw) {
        const pattern = `%${word}%`;
        params.push(pattern);
        const p = `$${params.length}`;
        keywordConds.push(
          `(u.first_name ILIKE ${p}
            OR u.last_name ILIKE ${p}
            OR COALESCE(u.department, '') ILIKE ${p}
            OR COALESCE(u.position, '') ILIKE ${p}
            OR COALESCE(u.faculty_status_note, '') ILIKE ${p}
            OR COALESCE(u.faculty_status_room::text, '') ILIKE ${p})`
        );
        scoreParts.push(`CASE WHEN u.last_name ILIKE ${p} THEN 4 ELSE 0 END`);
        scoreParts.push(`CASE WHEN u.first_name ILIKE ${p} THEN 4 ELSE 0 END`);
        scoreParts.push(`CASE WHEN COALESCE(u.department, '') ILIKE ${p} THEN 3 ELSE 0 END`);
        scoreParts.push(`CASE WHEN COALESCE(u.position, '') ILIKE ${p} THEN 2 ELSE 0 END`);
        scoreParts.push(`CASE WHEN COALESCE(u.faculty_status_room::text, '') ILIKE ${p} THEN 2 ELSE 0 END`);
        scoreParts.push(`CASE WHEN COALESCE(u.faculty_status_note, '') ILIKE ${p} THEN 1 ELSE 0 END`);
      }

      let statusClause = '';
      if (statusFilter) {
        params.push(statusFilter);
        const p = `$${params.length}`;
        statusClause = ` AND u.faculty_status = ${p}`;
        scoreParts.push(`CASE WHEN u.faculty_status = ${p} THEN 3 ELSE 0 END`);
      }

      const keywordWhere = keywordConds.length ? ` AND (${keywordConds.join(' OR ')})` : '';
      const relevance = scoreParts.length ? scoreParts.join(' + ') : '0';
      const r = await pool.query(
        `SELECT u.first_name, u.last_name, u.department, u.position,
           u.faculty_status, u.faculty_status_room, u.faculty_status_note, u.faculty_status_updated_at,
           (${relevance}) AS relevance
         FROM users u
         WHERE u.role = 'faculty'
           AND u.is_active = true${keywordWhere}${statusClause}
         ORDER BY relevance DESC, u.last_name ASC
         LIMIT 8`,
        params
      );
      rows = r.rows;
    }
    if (rows.length === 0) {
      const params = [];
      let where = `role = 'faculty' AND is_active = true`;
      if (statusFilter) {
        params.push(statusFilter);
        where += ` AND faculty_status = $1`;
      }
      const r = await pool.query(
        `SELECT first_name, last_name, department, position,
           faculty_status, faculty_status_room, faculty_status_note
         FROM users
         WHERE ${where}
         ORDER BY last_name ASC
         LIMIT 10`,
        params
      );
      rows = r.rows;
    }
    return rows;
  } catch (e) { console.error('[ctx:faculty]', e.message); return []; }
}

// ── Unified context fetcher ───────────────────────────────────────────────────
async function getAllModuleContexts(message) {
  const tasks = [];
  if (MODULE_RE.documents.test(message))     tasks.push(['documents',     fetchDocuments(message)]);
  if (MODULE_RE.events.test(message))        tasks.push(['events',        fetchEvents(message)]);
  if (MODULE_RE.announcements.test(message)) tasks.push(['announcements', fetchAnnouncements(message)]);
  if (MODULE_RE.lostfound.test(message))     tasks.push(['lostfound',     fetchLostFound(message)]);
  if (MODULE_RE.faculty.test(message))       tasks.push(['faculty',       fetchFaculty(message)]);

  const settled = await Promise.all(tasks.map(([k, p]) => p.then(r => [k, r])));
  const doc_context = [], live_data = {};
  settled.forEach(([key, data]) => {
    if (!data.length) return;
    if (key === 'documents') doc_context.push(...data);
    else live_data[key] = data;
  });
  return { doc_context, live_data };
}

// ── Direct answer builder (bypasses AI for well-known lookups) ────────────────
function buildDirectAnswer(message, doc_context, live_data) {
  const msgUp = message.toUpperCase();
  const msgLo = message.toLowerCase();
  const queryTokens = tokenizeForMatch(message);
  const isLatestAnnouncementQuery = /\b(latest|recent|new|announcement|announcements|news|update|updates)\b/i.test(message);
  const isLatestEventQuery = /\b(upcoming|next|latest|recent|event|events|calendar|activity|activities)\b/i.test(message);
  const isDocumentListQuery = /\b(list|show|find|available|what|which)\b.*\b(file|files|form|forms|template|templates|document|documents)\b/i.test(message);
  const isFacultyStatusQuery = /\b(available|availability|in office|in class|unavailable|professor locator|faculty status)\b/i.test(message);

  if (doc_context.length) {
    const hits = doc_context.filter(d =>
      msgUp.includes(d.title.toUpperCase()) ||
      (d.file_name && msgUp.includes(d.file_name.replace(/\.[^.]+$/, '').toUpperCase()))
    );
    if (hits.length) {
      const cat = hits[0].category;
      const list = hits.map(d => `- **${d.title}**${d.category ? ` - ${d.category}` : ''}`).join('\n');
      return `You can find it in the **Document Templates** section.\n\nNavigation: sidebar menu -> **Document Templates**${cat ? ` -> **${cat}** category` : ''}.\n\n${list}\n\nClick the download button next to the file.`;
    }

    const bestDoc = pickBestTokenMatch(
      message,
      doc_context,
      d => `${d.title || ''} ${d.file_name || ''} ${d.category || ''}`,
      0.5
    );
    if (bestDoc) {
      const doc = bestDoc.item;
      const cat = doc.category;
      return `You can find **${doc.title}** in the **Document Templates** section.\n\nNavigation: sidebar menu -> **Document Templates**${cat ? ` -> **${cat}** category` : ''}.\n\nClick the download button next to the file.`;
    }

    if (isDocumentListQuery) {
      const list = doc_context
        .slice(0, 5)
        .map(d => `- **${d.title}**${d.category ? ` - ${d.category}` : ''}`)
        .join('\n');
      return `These files are available in **Document Templates**:\n\n${list}\n\nOpen the sidebar menu -> **Document Templates** and click the download button next to the file you need.`;
    }
  }

  if (live_data.events?.length) {
    const hit = live_data.events.find(e => msgLo.includes(e.title.toLowerCase()));
    const bestEvent = pickBestTokenMatch(
      message,
      live_data.events,
      e => `${e.title || ''} ${e.description || ''} ${e.location || ''} ${e.department || ''}`,
      0.5
    );
    const event = hit || bestEvent?.item;
    if (event && !/\b(upcoming|latest|recent|next)\b/.test(msgLo)) {
      const d = new Date(event.event_date);
      const dateStr = d.toLocaleDateString('en-PH', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
      const timeStr = event.start_time ? `${formatTime(event.start_time)}${event.end_time ? ' - ' + formatTime(event.end_time) : ''}` : '';
      return `**${event.title}**\n\nDate: ${dateStr}${timeStr ? `\nTime: ${timeStr}` : ''}${event.location ? `\nLocation: ${event.location}` : ''}${event.department ? `\nDepartment: ${event.department}` : ''}${event.description ? `\n\n${event.description.slice(0, 200)}${event.description.length > 200 ? '...' : ''}` : ''}\n\nFind it on **Event Calendar** from the sidebar menu.`;
    }

    if (isLatestEventQuery) {
      const list = live_data.events.slice(0, 3).map(e => {
        const dateStr = new Date(e.event_date).toLocaleDateString('en-PH', {
          weekday: 'short',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        });
        const timeStr = e.start_time ? ` at ${formatTime(e.start_time)}` : '';
        const locStr = e.location ? `, ${e.location}` : '';
        return `- **${e.title}** - ${dateStr}${timeStr}${locStr}`;
      }).join('\n');
      return `Here are the upcoming events I found:\n\n${list}\n\nOpen **Event Calendar** from the sidebar menu to see the full list.`;
    }
  }

  if (live_data.announcements?.length) {
    const bestAnnouncement = pickBestTokenMatch(
      message,
      live_data.announcements,
      a => `${a.title || ''} ${a.content || ''} ${a.department || ''}`,
      0.5
    );

    if (bestAnnouncement && !/\b(latest|recent|new)\b/.test(msgLo)) {
      const ann = bestAnnouncement.item;
      const createdAt = ann.created_at
        ? new Date(ann.created_at).toLocaleDateString('en-PH', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })
        : null;
      return `**${ann.title}**${ann.department ? `\nDepartment: ${ann.department}` : ''}${createdAt ? `\nPosted: ${createdAt}` : ''}${ann.content ? `\n\n${ann.content.slice(0, 240)}${ann.content.length > 240 ? '...' : ''}` : ''}\n\nYou can view it on **Announcements** from the sidebar menu.`;
    }

    if (isLatestAnnouncementQuery) {
      const list = live_data.announcements.slice(0, 3).map(a => {
        const createdAt = a.created_at
          ? new Date(a.created_at).toLocaleDateString('en-PH', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
          : '';
        const dept = a.department ? ` [${a.department}]` : '';
        return `- **${a.title}**${dept}${createdAt ? ` - ${createdAt}` : ''}`;
      }).join('\n');
      return `Here are the latest announcements I found:\n\n${list}\n\nOpen **Announcements** from the sidebar menu for the full posts.`;
    }
  }

  if (live_data.lostfound?.length) {
    const hits = live_data.lostfound
      .map(lf => ({
        ...lf,
        _score: computeTokenMatchScore(
          message,
          `${lf.item_name || ''} ${lf.description || ''} ${lf.category || ''} ${lf.location_found || ''}`
        ),
      }))
      .filter(lf => lf._score >= 0.45)
      .sort((a, b) => b._score - a._score)
      .slice(0, 3);

    if (hits.length) {
      const list = hits.map(lf =>
        `- [**${lf.type.toUpperCase()}**] **${lf.item_name}**${lf.location_found ? ' - ' + lf.location_found : ''}${lf.description ? '\n  ' + lf.description.slice(0, 80) : ''}`
      ).join('\n');
      return `Matching reports in **Lost & Found**:\n\n${list}\n\nGo to sidebar menu -> **Lost & Found** for full details and contact info.`;
    }
  }

  if (live_data.faculty?.length) {
    const hits = live_data.faculty.filter(f =>
      msgLo.includes((f.first_name || '').toLowerCase()) ||
      msgLo.includes((f.last_name || '').toLowerCase()) ||
      computeTokenMatchScore(message, `${f.first_name || ''} ${f.last_name || ''}`) >= 0.7
    );
    if (hits.length) {
      const list = hits.map(f => {
        const s = f.faculty_status;
        const label = s === 'in_class' ? 'In Class' : s === 'in_office' ? 'In Office' : s === 'available' ? 'Available' : 'Unavailable';
        const room = f.faculty_status_room ? ` - Room ${f.faculty_status_room}` : '';
        const note = f.faculty_status_note ? ` (${f.faculty_status_note})` : '';
        return `- **${f.first_name} ${f.last_name}** (${f.department || 'Faculty'}) - ${label}${room}${note}`;
      }).join('\n');
      return `Real-time status from the **Professor Locator**:\n\n${list}\n\nCheck the live locator on the **Announcements** page from the sidebar menu.`;
    }

    if (isFacultyStatusQuery) {
      let rows = live_data.faculty;
      if (/\bin office\b/.test(msgLo)) rows = rows.filter(f => f.faculty_status === 'in_office');
      else if (/\bin class\b/.test(msgLo)) rows = rows.filter(f => f.faculty_status === 'in_class');
      else if (/\bunavailable\b/.test(msgLo)) rows = rows.filter(f => f.faculty_status === 'unavailable');
      else if (/\bavailable\b/.test(msgLo)) rows = rows.filter(f => f.faculty_status === 'available');

      const deptTokens = queryTokens.filter(token =>
        live_data.faculty.some(f => String(f.department || '').toLowerCase().includes(token))
      );
      if (deptTokens.length) {
        rows = rows.filter(f =>
          deptTokens.some(token => String(f.department || '').toLowerCase().includes(token))
        );
      }

      if (rows.length) {
        const list = rows.slice(0, 6).map(f => {
          const label = f.faculty_status === 'in_class'
            ? 'In Class'
            : f.faculty_status === 'in_office'
              ? 'In Office'
              : f.faculty_status === 'available'
                ? 'Available'
                : 'Unavailable';
          const room = f.faculty_status_room ? ` - Room ${f.faculty_status_room}` : '';
          return `- **${f.first_name} ${f.last_name}** (${f.department || 'Faculty'}) - ${label}${room}`;
        }).join('\n');
        return `Here is the current faculty status I found:\n\n${list}\n\nYou can also open the **Professor Locator** on the **Announcements** page from the sidebar menu.`;
      }
    }
  }

  return null; // No direct answer - let AI handle it
}

// ── Keyword fallback (used when AI sidecar is unavailable) ───────────────────
const knowledgeBase = [
  {
    keywords: ['enroll', 'enrollment', 'register', 'registration', 'how to enroll'],
    response: 'To enroll at PUP San Juan, you need to: 1) Secure an admission slot through PUPCET or equivalent. 2) Complete your enrollment form online. 3) Submit required documents to the Registrar. 4) Pay tuition fees at the cashier. Visit the Registrar\'s office for specific requirements per program.'
  },
  {
    keywords: ['tuition', 'fee', 'payment', 'how much', 'cost'],
    response: 'PUP is a state university with subsidized tuition. Tuition fees vary per program but are significantly lower than private institutions. You can pay at the cashier\'s office. For specific fee schedules, please visit the Accounting Office or check the PUP Student Portal.'
  },
  {
    keywords: ['schedule', 'class', 'time', 'room'],
    response: 'You can view your class schedule through the PUPSJ HUB Class Schedule module. Simply go to the Schedule section in the sidebar to add and manage your classes. For official class schedules, coordinate with your department or check the Student Information System (SIS).'
  },
  {
    keywords: ['lost', 'found', 'missing', 'item'],
    response: 'If you lost an item, you can report it through the PUPSJ HUB Lost & Found section. Fill in the details about your lost item including description, location, and photos. The system will try to match your report with found items. You can also check existing found item reports.',
    dynamic: 'lostfound'
  },
  {
    keywords: ['event', 'calendar', 'activity', 'happening'],
    response: 'Campus events are posted on the PUPSJ HUB Event Calendar. Faculty and admin can post events. You can view upcoming activities, their dates, times, and venues. After attending an event, you can also submit feedback through the system.',
    dynamic: 'events'
  },
  {
    keywords: ['announcement', 'news', 'update', 'notice'],
    response: 'Campus announcements are posted on the PUPSJ HUB Announcements section. You can filter announcements by department to see only those relevant to you. Both faculty and admin can post announcements for the campus community.',
    dynamic: 'announcements'
  },
  {
    keywords: ['uniform', 'dress code', 'attire'],
    response: 'PUP San Juan follows the university dress code policy. Students are required to wear the prescribed uniform during class days. On PE days, the appropriate PE uniform should be worn. Specific guidelines can be found in the Student Handbook.'
  },
  {
    keywords: ['id', 'identification', 'student id'],
    response: 'Student IDs are issued by the Office of Student Affairs. You must wear your ID inside the campus at all times. For ID-related concerns (new, replacement, validation), visit the OSA office during office hours.'
  },
  {
    keywords: ['grade', 'grades', 'gwa', 'academic'],
    response: 'You can view your grades through the PUP Student Information System (SIS). For grade-related concerns or requests for grade reports, visit the Registrar\'s Office. The grading system follows the standard PUP grading scale.'
  },
  {
    keywords: ['library', 'book', 'borrow'],
    response: 'The PUP San Juan campus library is open during school days. You can borrow books with your valid student ID. Borrowed books must be returned within the specified period. Late returns may incur penalties.'
  },
  {
    keywords: ['org', 'organization', 'club', 'join'],
    response: 'Student organizations at PUP San Juan are managed through the Office of Student Affairs. You can join accredited organizations during the enrollment period or membership drives. Each organization has its own requirements and activities.'
  },
  {
    keywords: ['wifi', 'internet', 'network', 'connection'],
    response: 'PUP San Juan provides campus Wi-Fi for students, faculty, and staff. You can connect using your student credentials. The Wi-Fi is available in most areas of the campus. Report connectivity issues to the IT Department.'
  },
  {
    keywords: ['feedback', 'rate', 'review', 'comment on event'],
    response: 'You can leave feedback on campus events! Go to the Event Calendar, click on any event, and you\'ll find a feedback section where you can rate the event (1-5 stars), leave a comment, and even upload photos from the event.'
  },
  {
    keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon'],
    response: 'Hello! I\'m PUPBot, your virtual assistant for PUPSJ HUB. I can help you with information about enrollment, schedules, campus events, lost and found, and other campus services. What would you like to know?'
  },
  {
    keywords: ['thank', 'thanks', 'salamat'],
    response: 'You\'re welcome! If you have more questions about PUP San Juan or the PUPSJ HUB, feel free to ask anytime. I\'m here to help!'
  },
  {
    keywords: ['help', 'assist', 'what can you do'],
    response: 'I can help you with: Announcements info, Event details & feedback, Lost & Found guidance, Class schedule tips, Enrollment & academic info, Campus policies, and more! Just type your question.'
  }
];

function findBestMatch(message) {
  const lower = message.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  for (const entry of knowledgeBase) {
    let score = 0;
    for (const keyword of entry.keywords) {
      if (lower.includes(keyword)) score += keyword.split(' ').length;
    }
    if (score > bestScore) { bestScore = score; bestMatch = entry; }
  }
  return bestScore > 0 ? bestMatch : null;
}

async function getDynamicContent(type) {
  try {
    if (type === 'announcements') {
      const result = await pool.query(`
        SELECT a.title, a.content, a.department, a.created_at,
          COALESCE(json_agg(json_build_object('image_url', ai.image_url)) FILTER (WHERE ai.id IS NOT NULL), '[]') as images
        FROM announcements a
        LEFT JOIN announcement_images ai ON ai.announcement_id = a.id
        WHERE a.status = 'active'
        GROUP BY a.id ORDER BY a.created_at DESC LIMIT 2
      `);
      return result.rows;
    } else if (type === 'events') {
      const result = await pool.query(`
        SELECT e.title, e.description, e.event_date, e.location,
          COALESCE(json_agg(json_build_object('image_url', ei.image_url)) FILTER (WHERE ei.id IS NOT NULL), '[]') as images
        FROM events e
        LEFT JOIN event_images ei ON ei.event_id = e.id
        WHERE e.status != 'deleted' AND e.event_date >= CURRENT_DATE
        GROUP BY e.id ORDER BY e.event_date ASC LIMIT 2
      `);
      return result.rows;
    } else if (type === 'lostfound') {
      const result = await pool.query(`
        SELECT lf.item_name, lf.type, lf.description, lf.location_found,
          COALESCE(json_agg(json_build_object('image_url', lfi.image_url)) FILTER (WHERE lfi.id IS NOT NULL), '[]') as images
        FROM lost_found lf
        LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
        WHERE lf.status = 'open'
        GROUP BY lf.id ORDER BY lf.created_at DESC LIMIT 2
      `);
      return result.rows;
    }
  } catch (err) {
    console.error('Dynamic content error:', err);
  }
  return [];
}

function _officeRedirect(message) {
  const m = message.toLowerCase();
  if (/\b(id|identification|student id|replace|lost id)\b/.test(m))
    return "**Office of Student Affairs (OSA)** — for student ID concerns (new ID, replacement, lost ID).";
  if (/\b(enroll|enrollment|register|registration|tor|transcript|certificate|clearance|grade|transfer)\b/.test(m))
    return "**Registrar's Office** — for enrollment, grades, TOR, certificates, and clearance.";
  if (/\b(tuition|fee|payment|bayad|cashier|refund|receipt)\b/.test(m))
    return "**Accounting / Cashier's Office** — for tuition fees, payments, and receipts.";
  if (/\b(wifi|internet|network|computer lab|technical|system access)\b/.test(m))
    return "**IT Department** — for Wi-Fi, computer lab, and technical issues.";
  if (/\b(book|borrow|library|fine|overdue)\b/.test(m))
    return "**Library** — for borrowing books, library cards, and research resources.";
  if (/\b(counsel|mental health|guidance|personal concern|career)\b/.test(m))
    return "**Guidance Office** — for counseling, mental health support, and career guidance.";
  if (/\b(nstp|cwts|lts|national service)\b/.test(m))
    return "**NSTP / CWTS Office** — for NSTP enrollment, requirements, and clearance.";
  if (/\b(overload|petition|dean|academic concern|program)\b/.test(m))
    return "**Dean's Office** — for academic concerns, overload, and petition letters.";
  if (/\b(medical|health|certificate|first aid|sick)\b/.test(m))
    return "**Health Services** — for medical certificates, first aid, and health concerns.";
  return (
    "This specific information isn't in my handbook. Please visit the relevant campus office:\n\n" +
    "• **Registrar's Office** — enrollment, grades, TOR, certificates, clearance\n" +
    "• **OSA** — student ID, organizations, scholarships, discipline\n" +
    "• **Accounting** — tuition fees, payments\n" +
    "• **IT Department** — Wi-Fi, computer lab, technical issues\n" +
    "• **Guidance Office** — counseling, personal concerns\n" +
    "• **Dean's Office** — academic concerns, overload, petitions"
  );
}

async function keywordFallback(message) {
  const match = findBestMatch(message);
  let text = match
    ? match.response
    : `I don't have specific information about that in my handbook or system.\n\n${_officeRedirect(message)}`;

  let images = [];
  if (match?.dynamic) {
    const items = await getDynamicContent(match.dynamic);
    if (items.length > 0) {
      if (match.dynamic === 'announcements') {
        text += '\n\nHere are the latest announcements:';
        items.forEach(a => { text += `\n- "${a.title}" (${a.department})`; });
        items.forEach(a => a.images?.forEach(img => { if (img.image_url) images.push(img.image_url); }));
      } else if (match.dynamic === 'events') {
        text += '\n\nUpcoming events:';
        items.forEach(e => {
          const d = new Date(e.event_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
          text += `\n- "${e.title}" on ${d}${e.location ? ' at ' + e.location : ''}`;
        });
        items.forEach(e => e.images?.forEach(img => { if (img.image_url) images.push(img.image_url); }));
      } else if (match.dynamic === 'lostfound') {
        text += '\n\nRecent open reports:';
        items.forEach(lf => { text += `\n- [${lf.type.toUpperCase()}] ${lf.item_name}${lf.location_found ? ' near ' + lf.location_found : ''}`; });
        items.forEach(lf => lf.images?.forEach(img => { if (img.image_url) images.push(img.image_url); }));
      }
    }
  }
  return { text, images };
}

// ── Layer 1: Jailbreak & off-topic pre-filter (runs before ANY AI call) ────────
const _JAILBREAK_RE = [
  /remove\s+(your\s+)?restrictions?/i,
  /ignore\s+(your\s+)?(instructions?|rules?|guidelines?|system\s*(prompt)?)/i,
  /pretend\s+(you\s+are|to\s+be)\s+(?!a?\s*(student|faculty|admin|pupbot))/i,
  /act\s+as\s+(if\s+(you\s+were?\s+)?)?(?!pupbot|a\s*(helpful|campus|pup))/i,
  /forget\s+(you\s+are|that\s+you\s+(are|were?))/i,
  /you\s+are\s+now\s+(?!(pup|the))/i,
  /override\s+(your\s+)?(system|instructions?|prompt|rules?|filter)/i,
  /bypass\s+(your\s+)?(restrictions?|filters?|rules?|guidelines?)/i,
  /jailbreak/i,
  /\bDAN\b/,
  /do\s+anything\s+now/i,
  /no\s+(restrictions?|limits?|rules?|guidelines?)\s+anymore/i,
  /roleplay\s+as\s+(?!a\s*(student|teacher|faculty))/i,
  /you\s+have\s+no\s+(restrictions?|limits?|rules?)/i,
  /disregard\s+(all\s+)?(previous\s+)?(instructions?|rules?)/i,
  /new\s+persona/i,
  /evil\s+(mode|bot|ai)/i,
];

const _OFF_TOPIC_RE = [
  /\b(recipe|how\s+to\s+(cook|bake|fry|boil|grill|roast|steam)|ingredients?\s+for|cooking\s+(time|method|tip))\b/i,
  /\b(chocolate\s+cake|pasta\s+recipe|fried\s+chicken\s+recipe|pizza\s+recipe|dessert\s+recipe)\b/i,
  /\b(netflix|spotify|tiktok\s+trend|viral\s+video|youtube\s+channel)\b/i,
  /\b(stock\s+market|crypto|bitcoin|investment\s+tip|forex)\b/i,
  /write\s+(me\s+)?(a\s+)?(love\s+(poem|letter|story)|fiction|novel|screenplay)/i,
  /\b(sports?\s+score|basketball\s+game|football\s+match|nba|pba\s+score)\b/i,
  /\b(horoscope|zodiac|fortune\s+tell|tarot)\b/i,
  /\b(weather\s+forecast|will\s+it\s+rain)\b/i,
  /\b(hack|hacking|cracking\s+password|sql\s+injection\s+tutorial|malware)\b/i,
];

const _JAILBREAK_REPLY =
  "I'm PUPBot — I only answer questions about PUP San Juan campus, the student handbook, and the PUPSJ HUB app. I cannot change my role or override my guidelines.";

const _OFF_TOPIC_REPLY =
  "I can only answer questions about PUP San Juan campus, the student handbook, and the PUPSJ HUB app. For other topics, please use a general search engine.";

function _isJailbreak(msg) {
  return _JAILBREAK_RE.some(re => re.test(msg));
}
function _isOffTopic(msg) {
  return _OFF_TOPIC_RE.some(re => re.test(msg));
}

// ── Chat endpoint ─────────────────────────────────────────────────────────────
router.post('/message', authenticateToken, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // ── Layer 1 gate: refuse jailbreak / off-topic before any AI work ──────
    if (_isJailbreak(message)) {
      await pool.query(
        'INSERT INTO chatbot_logs (user_id, user_message, bot_response) VALUES ($1, $2, $3)',
        [req.user.id, message, _JAILBREAK_REPLY]
      );
      return res.json({ response: _JAILBREAK_REPLY, images: [] });
    }
    if (_isOffTopic(message)) {
      await pool.query(
        'INSERT INTO chatbot_logs (user_id, user_message, bot_response) VALUES ($1, $2, $3)',
        [req.user.id, message, _OFF_TOPIC_REPLY]
      );
      return res.json({ response: _OFF_TOPIC_REPLY, images: [] });
    }

    let botResponse, images = [];
    const effectiveMessage = buildContextualQuery(message, history);

    // Fetch real DB context for all relevant modules in parallel
    const { doc_context, live_data } = await getAllModuleContexts(effectiveMessage);

    // Try deterministic direct answer first (exact name/keyword match → no AI needed)
    const directAnswer = buildDirectAnswer(effectiveMessage, doc_context, live_data);
    if (directAnswer) {
      botResponse = directAnswer;
    } else {
      try {
        const data = await askAI(message, history, doc_context, live_data);
        botResponse = data.response;
      } catch (aiErr) {
        console.warn('[Chatbot] AI sidecar unavailable, using keyword fallback:', aiErr.message);
        const fallback = await keywordFallback(effectiveMessage);
        botResponse = fallback.text;
        images = fallback.images;
      }
    }

    await pool.query(
      'INSERT INTO chatbot_logs (user_id, user_message, bot_response) VALUES ($1, $2, $3)',
      [req.user.id, message, botResponse]
    );

    res.json({ response: botResponse, images });
  } catch (err) {
    console.error('Chatbot error:', err);
    res.status(500).json({ error: 'Chatbot failed to respond' });
  }
});

// ── Chat history ──────────────────────────────────────────────────────────────
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM chatbot_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json(result.rows.reverse());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;

