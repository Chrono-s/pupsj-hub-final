/**
 * PUPSJ HUB - CSV Parsing & Schedule Normalization Utilities
 */

const DAY_ALIASES = {
  mon: 'Monday', monday: 'Monday',
  tue: 'Tuesday', tues: 'Tuesday', tuesday: 'Tuesday',
  wed: 'Wednesday', weds: 'Wednesday', wednesday: 'Wednesday',
  thu: 'Thursday', thur: 'Thursday', thurs: 'Thursday', thursday: 'Thursday',
  fri: 'Friday', friday: 'Friday',
  sat: 'Saturday', saturday: 'Saturday',
  sun: 'Sunday', sunday: 'Sunday',
};

const VALID_YEAR_LEVELS = ['1st', '2nd', '3rd', '4th'];
const VALID_SECTIONS = ['1-1','1-2','1-3','2-1','2-2','2-3','3-1','3-2','3-3','4-1','4-2','4-3'];

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') { inQuotes = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseCsv(text) {
  if (!text) return [];
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = clean.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[\s-]/g, '_'));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = fields[idx] ?? ''; });
    rows.push(obj);
  }
  return rows;
}

function normalizeDay(raw) {
  if (!raw) return null;
  return DAY_ALIASES[String(raw).trim().toLowerCase()] || null;
}

function normalizeTime(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  const m = s.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  const period = m[3];
  if (isNaN(hours) || isNaN(mins) || mins > 59 || hours > 23) return null;
  if (period) {
    if (hours < 1 || hours > 12) return null;
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
  }
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

function parseAmPmTime(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (isNaN(hours) || isNaN(mins) || mins > 59) return null;
  if (hours < 1 || hours > 12) return null;
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

function normalizeSection(raw) {
  const val = String(raw || '').trim();
  if (!val) return null;
  if (VALID_SECTIONS.includes(val)) return val;
  const compact = val.replace(/\s+/g, '');
  const match = compact.match(/([1-4])[-_]?([1-3])/);
  if (match) {
    const normalized = `${match[1]}-${match[2]}`;
    if (VALID_SECTIONS.includes(normalized)) return normalized;
  }
  return val;
}

function normalizeYearLevel(raw) {
  const year = String(raw || '').trim();
  return VALID_YEAR_LEVELS.includes(year) ? year : null;
}

module.exports = {
  DAY_ALIASES,
  VALID_YEAR_LEVELS,
  VALID_SECTIONS,
  parseCsvLine,
  parseCsv,
  normalizeDay,
  normalizeTime,
  parseAmPmTime,
  normalizeSection,
  normalizeYearLevel,
};
