const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// PUPBot knowledge base (based on PUPSJ Student Handbook)
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
      if (lower.includes(keyword)) {
        score += keyword.split(' ').length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

async function getDynamicContent(type) {
  try {
    if (type === 'announcements') {
      const result = await pool.query(`
        SELECT a.title, a.content, a.department, a.created_at,
          COALESCE(
            json_agg(json_build_object('image_url', ai.image_url)) FILTER (WHERE ai.id IS NOT NULL), '[]'
          ) as images
        FROM announcements a
        LEFT JOIN announcement_images ai ON ai.announcement_id = a.id
        WHERE a.status = 'active'
        GROUP BY a.id
        ORDER BY a.created_at DESC LIMIT 2
      `);
      return result.rows;
    } else if (type === 'events') {
      const result = await pool.query(`
        SELECT e.title, e.description, e.event_date, e.location,
          COALESCE(
            json_agg(json_build_object('image_url', ei.image_url)) FILTER (WHERE ei.id IS NOT NULL), '[]'
          ) as images
        FROM events e
        LEFT JOIN event_images ei ON ei.event_id = e.id
        WHERE e.status != 'deleted' AND e.event_date >= CURRENT_DATE
        GROUP BY e.id
        ORDER BY e.event_date ASC LIMIT 2
      `);
      return result.rows;
    } else if (type === 'lostfound') {
      const result = await pool.query(`
        SELECT lf.item_name, lf.type, lf.description, lf.location_found,
          COALESCE(
            json_agg(json_build_object('image_url', lfi.image_url)) FILTER (WHERE lfi.id IS NOT NULL), '[]'
          ) as images
        FROM lost_found lf
        LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
        WHERE lf.status = 'open'
        GROUP BY lf.id
        ORDER BY lf.created_at DESC LIMIT 2
      `);
      return result.rows;
    }
  } catch (err) {
    console.error('Dynamic content error:', err);
  }
  return [];
}

// Chat endpoint
router.post('/message', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const match = findBestMatch(message);
    let botResponse = match
      ? match.response
      : "I'm not sure about that yet. I'm currently trained on basic campus information from the PUPSJ Student Handbook. Try asking about enrollment, schedules, events, lost & found, or campus policies. You can also visit the Office of Student Affairs for more assistance.";

    let images = [];

    // Fetch dynamic content with images if applicable
    if (match && match.dynamic) {
      const items = await getDynamicContent(match.dynamic);
      if (items.length > 0) {
        if (match.dynamic === 'announcements') {
          botResponse += '\n\nHere are the latest announcements:';
          items.forEach(a => {
            botResponse += `\n- "${a.title}" (${a.department})`;
          });
          items.forEach(a => {
            if (a.images) a.images.forEach(img => { if (img.image_url) images.push(img.image_url); });
          });
        } else if (match.dynamic === 'events') {
          botResponse += '\n\nUpcoming events:';
          items.forEach(e => {
            const d = new Date(e.event_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
            botResponse += `\n- "${e.title}" on ${d}${e.location ? ' at ' + e.location : ''}`;
          });
          items.forEach(e => {
            if (e.images) e.images.forEach(img => { if (img.image_url) images.push(img.image_url); });
          });
        } else if (match.dynamic === 'lostfound') {
          botResponse += '\n\nRecent open reports:';
          items.forEach(lf => {
            botResponse += `\n- [${lf.type.toUpperCase()}] ${lf.item_name}${lf.location_found ? ' near ' + lf.location_found : ''}`;
          });
          items.forEach(lf => {
            if (lf.images) lf.images.forEach(img => { if (img.image_url) images.push(img.image_url); });
          });
        }
      }
    }

    // Log conversation
    await pool.query(
      `INSERT INTO chatbot_logs (user_id, user_message, bot_response) VALUES ($1, $2, $3)`,
      [req.user.id, message, botResponse]
    );

    res.json({ response: botResponse, images });
  } catch (err) {
    console.error('Chatbot error:', err);
    res.status(500).json({ error: 'Chatbot failed to respond' });
  }
});

// Get chat history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM chatbot_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows.reverse());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
