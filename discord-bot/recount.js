#!/usr/bin/env node
// =====================================================
//  Offline bulk recount.
//
//  Re-reads a folder of Ticket Tool transcript .html files and rebuilds every
//  ticket count from scratch under the CURRENT rule in lib/counter.js
//  (a quality reply = two or more words; 1+ quality reply = 1 ticket).
//
//  Why this exists: db.json stores only per-transcript reply *tallies*, not the
//  original message text, so a rule change cannot be applied to old rows in
//  place — the transcripts have to be read again. The live bot does this with
//  `/scan recount:True` against the Discord channel; this script does the same
//  thing offline against a folder of saved .html transcripts, which is handy for
//  a one-off bulk redo without needing the bot online.
//
//  Usage:
//    node recount.js [transcriptsDir]
//
//    transcriptsDir  folder containing the .html transcripts to count
//                    (searched recursively). Defaults to ./data/transcripts
//
//  It backs up the existing db.json first, wipes the stored tallies, re-reads
//  every transcript, then regenerates data/empire-tickets.json and copies it to
//  ../data/tickets.json (the file the website reads). The staff list is left
//  untouched.
// =====================================================

const fs = require('fs');
const path = require('path');

const { parseTranscript, ticketToolChannelName } = require('./lib/parser');
const {
  countTranscript, creditedFrom, transcriptSig,
  QUALITY_MIN_WORDS, TICKET_MIN_REPLIES,
  resetLabel, weekStart, weekEnd, weekLabel, nextReset, recentWeeks,
} = require('./lib/counter');
const store = require('./lib/store');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SITE_TICKETS = path.join(__dirname, '..', 'data', 'tickets.json');
const EXPORT_HISTORY_WEEKS = 26;

// ---- collect every .html transcript under a directory (recursively) ----
function collectHtml(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectHtml(full));
    else if (/\.html?$/i.test(ent.name)) out.push(full);
  }
  return out;
}

// ---- rebuild the website export from the current db (mirrors index.js) ----
function buildExport() {
  const mkRows = (since, until) => Object.entries(store.totals(since, until)).map(([key, r]) => ({
    key, name: r.name, rank: r.rank || '', tickets: r.tickets, replies: r.replies,
  })).sort((a, b) => b.tickets - a.tickets || b.replies - a.replies);

  const rows = mkRows(0);
  const ws = weekStart();
  const weekRows = mkRows(ws);

  const history = recentWeeks(EXPORT_HISTORY_WEEKS).map((w) => {
    const staff = mkRows(w.start, w.end);
    return {
      index: w.index,
      start: new Date(w.start).toISOString(),
      end: new Date(w.end).toISOString(),
      label: w.label,
      inProgress: w.index === 0,
      totalTickets: staff.reduce((s2, r) => s2 + r.tickets, 0),
      staff,
    };
  });

  return {
    source: 'empire-ticket-counter',
    version: 3,
    generated: new Date().toISOString(),
    rule: { qualityMinWords: QUALITY_MIN_WORDS, ticketMinReplies: TICKET_MIN_REPLIES, helpfulnessFilter: false },
    week: {
      startsOn: `Friday ${resetLabel()}`,
      start: new Date(ws).toISOString(),
      end: new Date(nextReset()).toISOString(),
      label: weekLabel(),
      totalTickets: weekRows.reduce((s, r) => s + r.tickets, 0),
      staff: weekRows,
    },
    history,
    transcriptCount: Object.keys(store.transcripts()).length,
    totalTickets: rows.reduce((s, r) => s + r.tickets, 0),
    staff: rows,
  };
}

function totalTicketsNow() {
  return Object.values(store.totals(0)).reduce((s, r) => s + r.tickets, 0);
}

function main() {
  const dir = process.argv[2] || path.join(DATA_DIR, 'transcripts');

  if (!store.staff().length) {
    console.error('No staff in db.json — nobody would be credited. Add staff first (/syncstaff or /staff add), then recount.');
    process.exit(1);
  }

  const files = collectHtml(dir);
  if (!files.length) {
    console.error(`No .html transcripts found in: ${dir}`);
    console.error('Point the script at your transcripts folder:  node recount.js /path/to/transcripts');
    process.exit(1);
  }

  console.log(`Recount rule: a reply = ${QUALITY_MIN_WORDS}+ words; ${TICKET_MIN_REPLIES}+ reply = 1 ticket.`);
  console.log(`Found ${files.length} transcript file(s) in ${dir}`);

  const ticketsBefore = totalTicketsNow();
  const transcriptsBefore = Object.keys(store.transcripts()).length;

  // Back up the current db before touching it.
  if (fs.existsSync(DB_FILE)) {
    const backup = path.join(DATA_DIR, `db.backup.${Date.now()}.json`);
    fs.copyFileSync(DB_FILE, backup);
    console.log(`Backed up existing db.json -> ${path.basename(backup)}`);
  }

  // Wipe stored tallies so every transcript is judged fresh under the new rule.
  const wiped = store.clearTranscripts();
  console.log(`Cleared ${wiped} stored transcript tall${wiped === 1 ? 'y' : 'ies'}. Re-reading...`);

  const staff = store.staff();
  let counted = 0, duplicate = 0, unreadable = 0, credits = 0;

  for (const file of files) {
    let html;
    try {
      html = fs.readFileSync(file, 'utf8');
    } catch (e) {
      unreadable++; continue;
    }
    const messages = parseTranscript(html);
    if (!messages.length) { unreadable++; continue; }

    const sig = transcriptSig(messages);
    if (store.hasTranscript(sig)) { duplicate++; continue; }

    const counts = countTranscript(messages, staff);
    const credited = creditedFrom(counts);
    credits += credited.length;

    let ts = 0;
    for (const m of messages) {
      const t = Number(m.created || 0);
      if (t > ts) ts = t;
    }
    if (!ts) {
      // Fall back to the file's modified time so it still lands in a week.
      try { ts = fs.statSync(file).mtimeMs; } catch (e) { ts = Date.now(); }
    }

    const label = ticketToolChannelName(html) || path.basename(file).replace(/\.html?$/i, '');
    store.addTranscript(sig, { label, date: new Date(ts).toISOString().slice(0, 10), ts, counts });
    counted++;
  }

  const ticketsAfter = totalTicketsNow();

  // Regenerate the website export files.
  const payload = buildExport();
  fs.writeFileSync(path.join(DATA_DIR, 'empire-tickets.json'), JSON.stringify(payload, null, 2));
  try {
    fs.mkdirSync(path.dirname(SITE_TICKETS), { recursive: true });
    fs.writeFileSync(SITE_TICKETS, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.warn('Could not write site tickets.json:', e.message);
  }

  console.log('');
  console.log('==================  Recount complete  ==================');
  console.log(`Transcripts read:     ${counted} counted, ${duplicate} duplicate, ${unreadable} unreadable`);
  console.log(`Ticket credits given: ${credits}`);
  console.log(`Total tickets:        ${ticketsBefore}  ->  ${ticketsAfter}`);
  console.log(`Stored transcripts:   ${transcriptsBefore}  ->  ${Object.keys(store.transcripts()).length}`);
  console.log('');
  console.log('Wrote data/empire-tickets.json and ../data/tickets.json (the site file).');
  console.log('Top staff now:');
  payload.staff.slice(0, 10).forEach((r, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${r.name} — ${r.tickets} tickets (${r.replies} replies)`);
  });
}

main();
