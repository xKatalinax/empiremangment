// =====================================================
//  Shared counting rules — identical to the web portal
//  (assets/app.js in the Empire management portal).
//
//  quality reply  = a staff message that is at least
//                   QUALITY_MIN_WORDS words long AND looks like
//                   actual help rather than filler
//  1 ticket handled = >= TICKET_MIN_REPLIES quality replies from
//                   the same staff member inside one transcript
// =====================================================

const QUALITY_MIN_WORDS = 3;    // a reply must be at least this many words
const TICKET_MIN_REPLIES = 2;   // 2+ lines on the ticket = 1 ticket
const HELPFUL_MIN_CONTENT_WORDS = 2;   // meaningful words a normal reply needs
const QUESTION_MIN_CONTENT_WORDS = 4;  // questions need more — "is this gtc?" isn't help
const SHORT_REPLY_MAX_WORDS = 8;       // above this, a reply can't lean on the help-verb shortcut

// Common words that carry no support value by themselves. A message made
// entirely of these is padding, however long it is.
const STOPWORDS = new Set(`
a an the and or but if so then than that this these those there here
i me my mine we us our you your yours he she it they them his her its their
is am are was were be been being do does did done doesn't have has had having
of in on at to from for with by about as into over after before up down out off
not no yes ok okay sure just really very too also only even still much many lot
will would can could shall should may might must gonna wanna gotta
what when where who whom which why how
im ive ill id youre youve dont doesnt didnt cant cannot wont isnt arent thats
u ur r ye yea yeah yep nope nah lol lmao lmfao xd haha hahaha bruh
one two three like get got go going know think want need see look make made
now today tomorrow yesterday time day back again well good great nice cool
right left down someone somebody something anything everything nothing
thing things stuff bit while chance ticket tickets issue matter case
`.trim().split(/\s+/));

// Greetings, thanks and other pleasantries — polite, but not the help itself.
const PLEASANTRIES = new Set(`
hi hey hello yo hiya greetings morning afternoon evening night welcome
thanks thank thankyou ty tysm thx tks cheers appreciate appreciated
please pls plz sorry apologies apologise apologize
bye goodbye later cya seeya np problem worries anytime
sir maam ma'am mate bro brother buddy friend king queen boss chief guys everyone
`.trim().split(/\s+/));

// Conversational verbs and hedges. With only a 3-word floor these have to be
// listed explicitly, otherwise "hope you are doing well" reads as substance.
const CHITCHAT = new Set(`
doing hope hoping wondering thinking thought feel feeling felt guess suppose
sure alright cool awesome perfect fine okay great lovely brilliant amazing
wait waiting hold holding moment minute sec second soon shortly
hows how's whats what's hey'a sup
makes make made sense seems seem means mean understood understand
gotcha exactly indeed correct agree agreed noted alright
`.trim().split(/\s+/));

// Words that signal the staffer actually did something or gave an instruction.
// A short reply with one of these counts even if it's only got one content word
// ("i refunded it"), which a pure density test would otherwise throw away.
const HELP_VERBS = new Set(`
refund refunded refunding ban banned unban unbanned kick kicked mute muted
warn warned approve approved deny denied accept accepted reject rejected
transfer transferred move moved fix fixed fixing repair repaired
restart relog rejoin reconnect reinstall install download update updated
verify verified clear cleared delete deleted remove removed add added
send sent give gave given grant granted issue issued deliver delivered
open press click type enter rebind rebound reset resolve resolved
whitelist whitelisted appeal appealed unlock unlocked enable disable
check checked try tried head join go navigate scroll select choose
`.trim().split(/\s+/));

// Stock filler phrases. Stripped wherever they appear, not just at the start,
// so "give me one moment" can't donate 'give' as if it were real content.
const FILLER_PHRASES = [
  /\bgive me (a|one) (moment|minute|sec|second)\b/g,
  /\b(one|a) (moment|minute|sec|second)( please)?\b/g,
  /\blet me (check|look|see|have a look)\b/g,
  /\bbear with me\b/g,
  /\bi'?ll be right (with|back)\b/g,
  /\breaching out\b/g,
  /\bget back to you\b/g,
  /\bthanks? (again|so much|for (waiting|your patience))\b/g,
  /\btake a look\b/g,
];

// Question openers — a short interrogative is the staffer asking for something,
// not providing help, so it has to clear a higher bar to count.
const QUESTION_OPENERS = new Set(`
is are was were am do does did can could will would shall should
have has had may might must
what when where who whom which why how whats what's whos who's
any anyone anybody
`.trim().split(/\s+/));

// Formula openers — "bump", "on it", "closing this", "thanks" and friends.
// These aren't rejected outright: the opener is stripped and whatever follows
// has to stand on its own. So "closing this — I refunded the car, relog and
// it'll be there" still counts, while a bare "closing this, thanks again" doesn't.
const FORMULA_OPENERS = [
  /^(bump|bumping|up|anyone|any (updates?|news))\b/,
  /^(still (waiting|here|need|needs))\b/,
  /^(on it|i'?ll take (this|it)|taking (this|it)|got it|handled|mine)\b/,
  /^(closing|closed|close|marking|resolving|resolved) (this|the|it|as|out)\b/,
  /^(thanks?|thank you|ty|tysm|no problem|you'?re welcome|yw|anytime)\b/,
  /^(hi|hey|hello|yo|hiya|greetings|good (morning|afternoon|evening))\b/,
];

// Split into comparable words: drop punctuation, keep apostrophes.
function wordsOf(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Does this message count as a quality reply?
 *
 * With the floor at 3 words, length barely filters anything, so the decision is
 * about what the message is *doing*:
 *
 *   1. At least QUALITY_MIN_WORDS words.
 *   2. Formula openers are peeled off ("hey", "thanks", "bump", "on it").
 *   3. Stopwords, pleasantries and chitchat are removed; what survives is the
 *      message's actual content.
 *   4. A question has to clear QUESTION_MIN_CONTENT_WORDS — asking for
 *      information isn't giving help, so "is this gtc?" is out while
 *      "can you send your steam hex and a screenshot of the error" is in.
 *   5. Anything else needs HELPFUL_MIN_CONTENT_WORDS content words, OR one
 *      content word plus a help verb, so terse-but-real replies like
 *      "i refunded it" still count.
 *
 * It's a heuristic, not comprehension. See the README for the tuning knobs.
 */
function isQualityReply(text) {
  const words = wordsOf(text);
  if (words.length < QUALITY_MIN_WORDS) return false;

  // Peel off leading filler formulas — repeatedly, since they stack
  // ("hey there, thanks for waiting, bumping this...").
  let rest = words.join(' ');
  for (const re of FILLER_PHRASES) rest = rest.replace(re, ' ');
  rest = rest.replace(/\s+/g, ' ').trim();
  for (let pass = 0; pass < 4; pass++) {
    const before = rest;
    for (const re of FORMULA_OPENERS) rest = rest.replace(re, '').trim();
    if (rest === before) break;
  }
  if (!rest) return false;

  const restWords = rest.split(/\s+/);
  const content = new Set(
    restWords.filter((w) => w.length > 2
      && !STOPWORDS.has(w) && !PLEASANTRIES.has(w) && !CHITCHAT.has(w))
  );

  // Is the staffer asking rather than answering?
  const asks = String(text || '').includes('?') || QUESTION_OPENERS.has(restWords[0]);
  if (asks) return content.size >= QUESTION_MIN_CONTENT_WORDS;

  if (content.size >= HELPFUL_MIN_CONTENT_WORDS) return true;

  // Terse-but-real replies ("i refunded it") get through on a help verb. Long
  // messages don't — if 20 words boil down to one content word, it's padding.
  return words.length <= SHORT_REPLY_MAX_WORDS
    && content.size >= 1
    && restWords.some((w) => HELP_VERBS.has(w));
}

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
    if (!isQualityReply(m.content)) continue;               // 10+ words and actually helpful
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

// ---- weekly periods: a week runs Friday 12:00 AM -> next Friday 12:00 AM ----
// Anchored to Friday midnight exactly. Uses the machine's local time unless
// WEEK_TZ_OFFSET is set (hours from UTC, e.g. -5 for US Eastern standard time).
//
// To move the rollover somewhere else, change RESET_HOUR (0 = midnight,
// 12 = noon) or set WEEK_RESET_HOUR in the environment. The web portal has the
// same constant at the top of assets/app.js — keep the two in sync.
const RESET_HOUR = process.env.WEEK_RESET_HOUR === undefined || process.env.WEEK_RESET_HOUR === ''
  ? 0
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

// Label like "Fri 18 Jul 12:00 AM – Fri 25 Jul 12:00 AM"
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
  QUALITY_MIN_WORDS, TICKET_MIN_REPLIES, HELPFUL_MIN_CONTENT_WORDS, QUESTION_MIN_CONTENT_WORDS,
  RESET_HOUR, resetLabel, isQualityReply, wordsOf,
  normName, hashSig, transcriptSig, matchStaff, countTranscript, creditedFrom,
  weekStart, weekEnd, weekLabel, nextReset,
};
