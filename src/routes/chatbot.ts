import express, { Response } from 'express';
import pool from '../config/database';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = express.Router();

const AI_SIDECAR_URL = process.env.AI_SIDECAR_URL || 'http://localhost:8000';

// ── AI sidecar call ───────────────────────────────────────────────────────────
async function askAI(message: string, history: unknown[] = [], doc_context: unknown[] = [], live_data: Record<string, unknown> = {}): Promise<{ response: string }> {
  const res = await fetch(`${AI_SIDECAR_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, doc_context, live_data }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail || `Sidecar HTTP ${res.status}`);
  }
  return res.json() as Promise<{ response: string }>;
}

// ── Module query detectors ────────────────────────────────────────────────────
const MODULE_RE: Record<string, RegExp> = {
  documents:     /\b(file|template|form|document|download|proposal|docx?|pdf|find.*file|find.*form|find.*template)\b/i,
  events:        /\b(event|calendar|activity|activities|seminar|workshop|symposium|competition|orientation|when is|upcoming|it week|intramurals)\b/i,
  announcements: /\b(announcement|news|update|notice|bulletin|latest|recent|what('s| is) (new|happening)|any news|memo)\b/i,
  lostfound:     /\b(lost (and|&) found|lost item|found item|missing item|report.*lost|search.*item|lost.*belong|looking for.*item|someone found|i found a|report a found)\b/i,
  faculty:       /\b(professor|prof\b|faculty|teacher|instructor|sir\b|ma'?am|where is.*prof|is.*available|in class|in office|locator|availability)\b/i,
};

// ── Helper: extract keywords from message ─────────────────────────────────────
function extractKeywords(message: string, stopWords: Set<string>): string[] {
  return message.replace(/[?!.,;:]/g, '').split(/\s+/)
    .filter(w => w.length >= 3 && !stopWords.has(w.toLowerCase()));
}

function formatTime(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

// ── Context fetchers (one per module) ─────────────────────────────────────────
async function fetchDocuments(message: string): Promise<unknown[]> {
  const sw = new Set(['where','find','this','file','form','that','what','which','from','have','with','about','how','can','template','document','download']);
  const kw = extractKeywords(message, sw);
  try {
    let rows: unknown[] = [];
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
  } catch (e) { console.error('[ctx:docs]', (e as Error).message); return []; }
}

async function fetchEvents(message: string): Promise<unknown[]> {
  const sw = new Set(['when','what','where','which','the','event','events','that','this','for','about','happening','upcoming','schedule','is','are','any']);
  const kw = extractKeywords(message, sw);
  try {
    let rows: unknown[] = [];
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
  } catch (e) { console.error('[ctx:events]', (e as Error).message); return []; }
}

async function fetchAnnouncements(): Promise<unknown[]> {
  try {
    const r = await pool.query(
      `SELECT title, content, department, created_at
       FROM announcements WHERE status = 'active'
       ORDER BY is_pinned DESC, created_at DESC LIMIT 5`
    );
    return r.rows;
  } catch (e) { console.error('[ctx:announcements]', (e as Error).message); return []; }
}

async function fetchLostFound(message: string): Promise<unknown[]> {
  const sw = new Set(['lost','found','missing','item','where','what','about','report','any','the','was','been','someone','looking','for']);
  const kw = extractKeywords(message, sw);
  try {
    let rows: unknown[] = [];
    if (kw.length > 0) {
      const cond = kw.map((_, i) => `(lf.item_name ILIKE $${i+1} OR lf.description ILIKE $${i+1} OR lf.category ILIKE $${i+1})`).join(' OR ');
      const r = await pool.query(
        `SELECT lf.type, lf.item_name, lf.description, lf.category, lf.location_found, lf.created_at, lf.contact_info
         FROM lost_found lf WHERE lf.status = 'open' AND (${cond})
         ORDER BY lf.created_at DESC LIMIT 5`,
        kw.map(w => `%${w}%`)
      );
      rows = r.rows;
    }
    if (rows.length === 0) {
      const r = await pool.query(
        `SELECT type, item_name, description, category, location_found, created_at
         FROM lost_found WHERE status = 'open' ORDER BY created_at DESC LIMIT 5`
      );
      rows = r.rows;
    }
    return rows;
  } catch (e) { console.error('[ctx:lostfound]', (e as Error).message); return []; }
}

async function fetchFaculty(message: string): Promise<unknown[]> {
  const sw = new Set(['where','what','who','when','professor','faculty','teacher','instructor','the','sir','maam','available','status','room','office','is','are']);
  const kw = extractKeywords(message, sw);
  try {
    let rows: unknown[] = [];
    if (kw.length > 0) {
      const cond = kw.map((_, i) => `(u.first_name ILIKE $${i+1} OR u.last_name ILIKE $${i+1})`).join(' OR ');
      const r = await pool.query(
        `SELECT u.first_name, u.last_name, u.department, u.position,
           u.faculty_status, u.faculty_status_room, u.faculty_status_note, u.faculty_status_updated_at
         FROM users u WHERE u.role = 'faculty' AND u.is_active = true AND (${cond})
         ORDER BY u.last_name ASC LIMIT 5`,
        kw.map(w => `%${w}%`)
      );
      rows = r.rows;
    }
    if (rows.length === 0) {
      const r = await pool.query(
        `SELECT first_name, last_name, department, position,
           faculty_status, faculty_status_room, faculty_status_note
         FROM users WHERE role = 'faculty' AND is_active = true ORDER BY last_name ASC LIMIT 10`
      );
      rows = r.rows;
    }
    return rows;
  } catch (e) { console.error('[ctx:faculty]', (e as Error).message); return []; }
}

// ── Unified context fetcher ───────────────────────────────────────────────────
async function getAllModuleContexts(message: string): Promise<{ doc_context: unknown[]; live_data: Record<string, unknown[]> }> {
  const tasks: [string, Promise<unknown[]>][] = [];
  if (MODULE_RE.documents.test(message))     tasks.push(['documents',     fetchDocuments(message)]);
  if (MODULE_RE.events.test(message))        tasks.push(['events',        fetchEvents(message)]);
  if (MODULE_RE.announcements.test(message)) tasks.push(['announcements', fetchAnnouncements()]);
  if (MODULE_RE.lostfound.test(message))     tasks.push(['lostfound',     fetchLostFound(message)]);
  if (MODULE_RE.faculty.test(message))       tasks.push(['faculty',       fetchFaculty(message)]);

  const settled = await Promise.all(tasks.map(([k, p]) => p.then(r => [k, r] as [string, unknown[]])));
  const doc_context: unknown[] = [], live_data: Record<string, unknown[]> = {};
  settled.forEach(([key, data]) => {
    if (!data.length) return;
    if (key === 'documents') doc_context.push(...data);
    else live_data[key] = data;
  });
  return { doc_context, live_data };
}

// ── Direct answer builder (bypasses AI for well-known lookups) ────────────────
function buildDirectAnswer(message: string, doc_context: unknown[], live_data: Record<string, unknown[]>): string | null {
  const msgUp = message.toUpperCase();
  const msgLo = message.toLowerCase();

  // 1. Exact document name match
  if (doc_context.length) {
    const hits = (doc_context as { title: string; file_name?: string; category?: string }[]).filter(d =>
      msgUp.includes(d.title.toUpperCase()) ||
      (d.file_name && msgUp.includes(d.file_name.replace(/\.[^.]+$/, '').toUpperCase()))
    );
    if (hits.length) {
      const cat = hits[0].category;
      const list = hits.map(d => `• **${d.title}**${d.category ? ` — ${d.category}` : ''}`).join('\n');
      return `You can find it in the **Document Templates** section.\n\nNavigation: sidebar ☰ → **"Document Templates"**${cat ? ` → **"${cat}"** category` : ''}.\n\n${list}\n\nClick the download (↓) button next to the file.`;
    }
  }

  // 2. Exact event name match
  if (live_data.events?.length) {
    const hit = (live_data.events as { title: string; event_date: string; start_time?: string; end_time?: string; location?: string; department?: string; description?: string }[]).find(e => msgLo.includes(e.title.toLowerCase()));
    if (hit) {
      const d = new Date(hit.event_date);
      const dateStr = d.toLocaleDateString('en-PH', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
      const timeStr = hit.start_time ? `${formatTime(hit.start_time)}${hit.end_time ? ' – ' + formatTime(hit.end_time) : ''}` : '';
      return `**${hit.title}**\n\n📅 ${dateStr}${timeStr ? '\n⏰ ' + timeStr : ''}${hit.location ? '\n📍 ' + hit.location : ''}${hit.department ? '\n🏫 ' + hit.department : ''}${hit.description ? '\n\n' + hit.description.slice(0, 200) : ''}\n\nFind it on **Event Calendar** (sidebar ☰ → Event Calendar).`;
    }
  }

  // 3. Specific lost/found item keyword match
  if (live_data.lostfound?.length) {
    const words = msgLo.split(/\s+/).filter(w => w.length > 3);
    const hits = (live_data.lostfound as { type: string; item_name: string; location_found?: string; description?: string }[]).filter(lf =>
      words.some(w => lf.item_name.toLowerCase().includes(w))
    );
    if (hits.length) {
      const list = hits.map(lf =>
        `• [**${lf.type.toUpperCase()}**] **${lf.item_name}**${lf.location_found ? ' — ' + lf.location_found : ''}${lf.description ? '\n  ' + lf.description.slice(0, 80) : ''}`
      ).join('\n');
      return `Matching reports in **Lost & Found**:\n\n${list}\n\nGo to sidebar ☰ → **"Lost & Found"** for full details and contact info.`;
    }
  }

  // 4. Faculty name or status query
  if (live_data.faculty?.length) {
    const hits = (live_data.faculty as { first_name: string; last_name: string; department?: string; faculty_status?: string; faculty_status_room?: string; faculty_status_note?: string }[]).filter(f =>
      msgLo.includes(f.first_name.toLowerCase()) || msgLo.includes(f.last_name.toLowerCase())
    );
    if (hits.length) {
      const list = hits.map(f => {
        const s = f.faculty_status;
        const icon = s === 'in_class' ? '🔴 In Class' : s === 'in_office' ? '🔵 In Office' : s === 'available' ? '🟢 Available' : '⚪ Unavailable';
        const room = f.faculty_status_room ? ` — Room ${f.faculty_status_room}` : '';
        const note = f.faculty_status_note ? ` (${f.faculty_status_note})` : '';
        return `• **${f.first_name} ${f.last_name}** (${f.department || 'Faculty'}) — ${icon}${room}${note}`;
      }).join('\n');
      return `Real-time status from the **Professor Locator**:\n\n${list}\n\nCheck the live locator on the **Announcements** page (sidebar ☰ → Announcements → Professor Locator widget at the top).`;
    }
  }

  return null; // No direct answer — let AI handle it
}

// ── Keyword fallback (used when AI sidecar is unavailable) ───────────────────
interface KnowledgeEntry {
  keywords: string[];
  response: string;
  dynamic?: string;
}

const knowledgeBase: KnowledgeEntry[] = [
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

function findBestMatch(message: string): KnowledgeEntry | null {
  const lower = message.toLowerCase();
  let bestMatch: KnowledgeEntry | null = null;
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

async function getDynamicContent(type: string): Promise<unknown[]> {
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

function _officeRedirect(message: string): string {
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

async function keywordFallback(message: string): Promise<{ text: string; images: string[] }> {
  const match = findBestMatch(message);
  let text = match
    ? match.response
    : `I don't have specific information about that in my handbook or system.\n\n${_officeRedirect(message)}`;

  const images: string[] = [];
  if (match?.dynamic) {
    const items = await getDynamicContent(match.dynamic) as { title?: string; department?: string; images?: { image_url?: string }[]; event_date?: string; location?: string; type?: string; item_name?: string; location_found?: string }[];
    if (items.length > 0) {
      if (match.dynamic === 'announcements') {
        text += '\n\nHere are the latest announcements:';
        items.forEach(a => { text += `\n- "${a.title}" (${a.department})`; });
        items.forEach(a => a.images?.forEach(img => { if (img.image_url) images.push(img.image_url); }));
      } else if (match.dynamic === 'events') {
        text += '\n\nUpcoming events:';
        items.forEach(e => {
          const d = new Date(e.event_date!).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
          text += `\n- "${e.title}" on ${d}${e.location ? ' at ' + e.location : ''}`;
        });
        items.forEach(e => e.images?.forEach(img => { if (img.image_url) images.push(img.image_url); }));
      } else if (match.dynamic === 'lostfound') {
        text += '\n\nRecent open reports:';
        items.forEach(lf => { text += `\n- [${lf.type!.toUpperCase()}] ${lf.item_name}${lf.location_found ? ' near ' + lf.location_found : ''}`; });
        items.forEach(lf => lf.images?.forEach(img => { if (img.image_url) images.push(img.image_url); }));
      }
    }
  }
  return { text, images };
}

// ── Layer 1: Jailbreak & off-topic pre-filter (runs before ANY AI call) ────────
const _JAILBREAK_RE: RegExp[] = [
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

const _OFF_TOPIC_RE: RegExp[] = [
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

function _isJailbreak(msg: string): boolean {
  return _JAILBREAK_RE.some(re => re.test(msg));
}
function _isOffTopic(msg: string): boolean {
  return _OFF_TOPIC_RE.some(re => re.test(msg));
}

// ── Chat endpoint ─────────────────────────────────────────────────────────────
router.post('/message', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { message, history = [] } = req.body;
    if (!message || !message.trim()) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    // ── Layer 1 gate: refuse jailbreak / off-topic before any AI work ──────
    if (_isJailbreak(message)) {
      await pool.query(
        'INSERT INTO chatbot_logs (user_id, user_message, bot_response) VALUES ($1, $2, $3)',
        [req.user!.id, message, _JAILBREAK_REPLY]
      );
      res.json({ response: _JAILBREAK_REPLY, images: [] });
      return;
    }
    if (_isOffTopic(message)) {
      await pool.query(
        'INSERT INTO chatbot_logs (user_id, user_message, bot_response) VALUES ($1, $2, $3)',
        [req.user!.id, message, _OFF_TOPIC_REPLY]
      );
      res.json({ response: _OFF_TOPIC_REPLY, images: [] });
      return;
    }

    let botResponse: string, images: string[] = [];

    // Fetch real DB context for all relevant modules in parallel
    const { doc_context, live_data } = await getAllModuleContexts(message);

    // Try deterministic direct answer first (exact name/keyword match → no AI needed)
    const directAnswer = buildDirectAnswer(message, doc_context, live_data);
    if (directAnswer) {
      botResponse = directAnswer;
    } else {
      try {
        const data = await askAI(message, history, doc_context, live_data);
        botResponse = data.response;
      } catch (aiErr) {
        console.warn('[Chatbot] AI sidecar unavailable, using keyword fallback:', (aiErr as Error).message);
        const fallback = await keywordFallback(message);
        botResponse = fallback.text;
        images = fallback.images;
      }
    }

    await pool.query(
      'INSERT INTO chatbot_logs (user_id, user_message, bot_response) VALUES ($1, $2, $3)',
      [req.user!.id, message, botResponse]
    );

    res.json({ response: botResponse, images });
  } catch (err) {
    console.error('Chatbot error:', err);
    res.status(500).json({ error: 'Chatbot failed to respond' });
  }
});

// ── Chat history ──────────────────────────────────────────────────────────────
router.get('/history', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT * FROM chatbot_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user!.id]
    );
    res.json(result.rows.reverse());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

export default router;
