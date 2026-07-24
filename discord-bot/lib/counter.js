// =====================================================
//  Shared counting rules — identical to the web portal
//  (assets/app.js in the Empire management portal).
//
//  quality reply  = a staff message with >= QUALITY_MIN_WORDS words
//                   of real text that actually helps the player.
//                   Filler that doesn't help (e.g. "is this good to
//                   close") is stripped out before the words are
//                   counted, so a message that is only filler fails.
//  1 ticket handled = >= TICKET_MIN_REPLIES quality replies from
//                   the same staff member inside one transcript
// =====================================================

const QUALITY_MIN_WORDS = 10;
const TICKET_MIN_REPLIES = 1;

// Phrases that are staff chatter / admin, not help for the player.
// These are REMOVED from a message before its words are counted, so a
// long genuine answer that happens to end with "good to close?" still
// counts, while a message that is only this filler does not.
// Add new phrases here — the web portal keeps the same list.
const NON_HELPFUL_PATTERNS = [
  /\b(is|are|this|that|it|they|these)?\s*(ticket|one)?\s*(good|ok|okay|fine|safe|alright|clear)\s+to\s+(close|closing|be closed)\b/g,
  /\b(can|could|should|shall|may|do)\s+(i|we|you)\s+close\b[^.?!]*/g,
  /\bclos(e|ing)\s+(this|it|the ticket|now|out)\b[^.?!]*/g,
  /\b(i'?ll|i will|let me|imma|ill)\s+(take|grab|claim|handle|get)\s+(this|it|that)(\s+one)?\b/g,
  /\bclaim(ing|ed)?\s+(this|it)\b/g,
  /\bany\s+updates?\s+(on\s+)?(this|it)\b/g,
  /\b(bump|bumping)\b/g,
  /\b(thanks|thank you|ty|tysm|np|no problem|no worries|got it|gotcha|sounds good|will do|okay|alright)\b/g,
  /\b(hi|hey|hello|yo|hiya)\s+(there|again)?\b/g,
];

// The ticket week runs Thursday -> Wednesday. Each week is keyed by the
// date of its Thursday, so counts roll over on Thursday morning.
const WEEK_RESET_DAY = 4; // 0 Sun, 1 Mon ... 4 Thu

const normName = (s) => {
  const raw = String(s || '');
  // Discord names are full of stylised Unicode — "𝕭𝕰𝕬𝕹", "Ｎｏｖａ", accents.
  // NFKC folds those look-alikes back to plain letters, then NFD + strip marks
  // removes accents. Without this a fully stylised name reduces to an empty
  // key and that person silently never gets credited for a single ticket.
  const folded = raw
    .normalize('NFKC')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (folded) return folded;
  // Still nothing (e.g. a name that is only emoji)? Fall back to a stable
  // key derived from the raw codepoints so they stay distinct from everyone
  // else instead of all collapsing onto the same empty key.
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return raw.trim() ? 'u' + h.toString(36) : '';
};

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function toDate(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (typeof v === 'number') return new Date(v);
  const s = String(v || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00') : new Date(s);
}
// the Thursday that starts this date's week
function weekStart(v) {
  const d = toDate(v);
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - WEEK_RESET_DAY + 7) % 7));
  return d;
}
function weekKey(v) { const d = weekStart(v); return d ? ymd(d) : ''; }
function currentWeekKey() { return weekKey(new Date()); }
function weekLabel(key) {
  const a = toDate(key), b = toDate(key);
  b.setDate(b.getDate() + 6);
  const f = (d) => d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  return f(a) + ' – ' + f(b);
}

// When was the ticket actually handled? Ticket Tool stamps every message with
// `created` (epoch ms) — use the newest so it lands in the week it was closed.
function transcriptDate(messages) {
  let newest = 0;
  for (const m of messages || []) {
    const t = typeof m.created === 'number' ? m.created : Date.parse(m.created || '');
    if (t && !isNaN(t) && t > newest) newest = t;
  }
  return newest ? ymd(new Date(newest)) : ymd(new Date());
}

// lower-case, strip punctuation/emoji, collapse whitespace
function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// how many words are left once the non-helpful filler is removed
function helpfulWordCount(s) {
  let t = normalizeText(s);
  if (!t) return 0;
  for (const re of NON_HELPFUL_PATTERNS) t = t.replace(re, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t ? t.split(' ').length : 0;
}

// a message counts as a quality reply if enough helpful words remain
function isQualityReply(s) {
  return helpfulWordCount(s) >= QUALITY_MIN_WORDS;
}

// tiny stable hash used to de-duplicate transcripts
function hashSig(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(16);
}

// signature from parsed messages, so the same transcript never counts twice
function transcriptSig(messages) {
  const seed = messages.length + ':' +
    messages.slice(0, 40).map((m) => (m.authorId || m.author) + ':' + (m.content || '').slice(0, 24)).join('|');
  return hashSig(seed);
}

// does this message's author belong to someone on the staff list?
// Ticket Tool transcripts carry the real Discord user_id, so prefer an exact
// ID match and fall back to name matching only for other transcript formats.
function matchStaff(msg, staffList) {
  const authorId = typeof msg === 'object' ? String(msg.authorId || '') : '';
  const author = typeof msg === 'object' ? String(msg.author || '') : String(msg || '');

  // Prefer an exact Discord ID match — Ticket Tool transcripts always carry one.
  if (authorId) {
    for (const st of staffList) {
      if (st.id && String(st.id) === authorId) return st;
    }
  }
  // Fall back to the display name (needed when staff were added without an ID).
  const a = normName(author);
  if (!a) return null;
  for (const st of staffList) {
    const id = String(st.id || '').trim();
    if (id && author.includes(id)) return st;
    const n = normName(st.name);
    if (n && (a === n || (n.length >= 3 && a.includes(n)))) return st;
  }
  return null;
}

// Counts stored before a naming-rule change can sit under a stale key — most
// often "id<discordid>", which is what a fully stylised name used to fall back
// to. The person's display name is stored alongside the count, so re-deriving
// the key from that name folds the old and new records onto one row. Falls back
// to the stored key when there's no usable name.
function canonKey(storedKey, name) {
  return normName(name) || String(storedKey || '');
}

// count one parsed transcript -> { key: { name, replies } }
function countTranscript(messages, staffList) {
  const tally = {};
  for (const m of messages) {
    if (m.bot) continue;                                   // never count bot posts
    if (!isQualityReply(m.content)) continue;              // 10+ helpful words rule
    const st = matchStaff(m, staffList);
    if (!st) continue;
    const key = normName(st.name) || ('id' + st.id);
    (tally[key] || (tally[key] = { name: st.name, replies: 0 })).replies++;
  }
  return tally;
}

// who in this transcript earned a ticket credit
function creditedFrom(counts) {
  return Object.values(counts).filter((v) => v.replies >= TICKET_MIN_REPLIES);
}

module.exports = {
  QUALITY_MIN_WORDS, TICKET_MIN_REPLIES, NON_HELPFUL_PATTERNS, WEEK_RESET_DAY,
  normName, normalizeText, helpfulWordCount, isQualityReply,
  ymd, toDate, weekStart, weekKey, currentWeekKey, weekLabel, transcriptDate, canonKey,
  hashSig, transcriptSig, matchStaff, countTranscript, creditedFrom,
};
