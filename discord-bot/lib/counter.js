// =====================================================
//  Shared counting rules — identical to the web portal
//  (assets/app.js in the Empire management portal).
//
//  quality reply  = a staff message with >= QUALITY_MIN_CHARS
//                   characters of real text
//  1 ticket handled = >= TICKET_MIN_REPLIES quality replies from
//                   the same staff member inside one transcript
// =====================================================

const QUALITY_MIN_CHARS = 15;
const TICKET_MIN_REPLIES = 2;   // 2+ lines on the ticket = 1 ticket

const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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

// count one parsed transcript -> { key: { name, replies } }
function countTranscript(messages, staffList) {
  const tally = {};
  for (const m of messages) {
    if (m.bot) continue;                                   // never count bot posts
    if (!m.content || m.content.length < QUALITY_MIN_CHARS) continue;
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

// ---- weekly periods: a week runs Friday 12:00 PM -> next Friday 12:00 PM ----
// Anchored to Friday midday exactly. Uses the machine's local time unless
// WEEK_TZ_OFFSET is set (hours from UTC, e.g. -5 for US Eastern standard time).
//
// To move the rollover somewhere else, change RESET_HOUR (0 = midnight,
// 12 = noon) or set WEEK_RESET_HOUR in the environment. The web portal has the
// same constant at the top of assets/app.js — keep the two in sync.
const RESET_HOUR = process.env.WEEK_RESET_HOUR === undefined || process.env.WEEK_RESET_HOUR === ''
  ? 12
  : Number(process.env.WEEK_RESET_HOUR);

const TZ_OFFSET = process.env.WEEK_TZ_OFFSET === undefined || process.env.WEEK_TZ_OFFSET === ''
  ? null
  : Number(process.env.WEEK_TZ_OFFSET);

// "12:00 PM" / "12:00 AM" — used in labels so the cut-off is never ambiguous.
function resetLabel() {
  const h = ((RESET_HOUR % 24) + 24) % 24;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${ampm}`;
}

// Start of the Friday-week containing `when` (ms since epoch).
function weekStart(when = Date.now()) {
  // Shift back by the reset hour so the anchor lands on a plain midnight,
  // floor to the most recent Friday, then put the hour back on.
  const t = new Date(Number(when) - RESET_HOUR * 3600_000);
  if (TZ_OFFSET === null) {
    // local time
    const d = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, 0, 0, 0);
    // getDay(): Sun=0 ... Fri=5. Days since the most recent Friday.
    const back = (d.getDay() - 5 + 7) % 7;
    d.setDate(d.getDate() - back);
    d.setHours(RESET_HOUR, 0, 0, 0);   // set after the date math so DST is handled
    return d.getTime();
  }
  // fixed offset: shift into that zone, floor to Friday, shift back
  const shifted = new Date(t.getTime() + TZ_OFFSET * 3600_000);
  const back = (shifted.getUTCDay() - 5 + 7) % 7;
  const floored = Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - back, RESET_HOUR, 0, 0, 0
  );
  return floored - TZ_OFFSET * 3600_000;
}

function weekEnd(when = Date.now()) {
  // Don't just add 7 days of milliseconds — a DST change would drift the
  // rollover by an hour. Step into the middle of the next week and re-floor.
  return weekStart(weekStart(when) + 7 * 86_400_000 + 12 * 3600_000);
}

// Label like "Fri 18 Jul 12:00 PM – Fri 25 Jul 12:00 PM"
function weekLabel(when = Date.now()) {
  const s = new Date(weekStart(when));
  const e = new Date(weekEnd(when));
  const fmt = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${fmt(s)} ${resetLabel()} – ${fmt(e)} ${resetLabel()}`;
}

// When does the current week roll over?
function nextReset(when = Date.now()) {
  return weekEnd(when);
}

module.exports = {
  QUALITY_MIN_CHARS, TICKET_MIN_REPLIES, RESET_HOUR, resetLabel,
  normName, hashSig, transcriptSig, matchStaff, countTranscript, creditedFrom,
  weekStart, weekEnd, weekLabel, nextReset,
};
