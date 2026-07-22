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
const TICKET_MIN_REPLIES = 3;

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
    messages.slice(0, 40).map((m) => m.author + m.content.slice(0, 24)).join('|');
  return hashSig(seed);
}

// does this author string belong to someone on the staff list?
function matchStaff(author, staffList) {
  const a = normName(author);
  if (!a) return null;
  for (const st of staffList) {
    const id = String(st.id || '').trim();
    if (id && String(author).includes(id)) return st;
    const n = normName(st.name);
    if (n && (a === n || (n.length >= 3 && a.includes(n)))) return st;
  }
  return null;
}

// count one parsed transcript -> { key: { name, replies } }
function countTranscript(messages, staffList) {
  const tally = {};
  for (const m of messages) {
    if (!m.content || m.content.length < QUALITY_MIN_CHARS) continue;
    const st = matchStaff(m.author, staffList);
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
  QUALITY_MIN_CHARS, TICKET_MIN_REPLIES,
  normName, hashSig, transcriptSig, matchStaff, countTranscript, creditedFrom,
};
