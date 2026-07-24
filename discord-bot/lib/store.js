// Simple JSON persistence. No external DB needed — good enough for
// a single-server ticket tracker. Stored at discord-bot/data/db.json.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'db.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    return { staff: [], transcripts: {} }; // transcripts keyed by signature
  }
}

let db = load();

function persist() {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

// When did this ticket happen? Prefer the real message time captured at parse
// time; fall back to the stored date for records saved before that existed.
function recordTime(rec) {
  if (rec && rec.ts) return Number(rec.ts);
  if (rec && rec.date) {
    const t = Date.parse(rec.date + 'T12:00:00');
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

module.exports = {
  staff: () => db.staff,
  addStaff(name, id = '', rank = '') {
    const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (db.staff.some((s) => s.name.toLowerCase().replace(/[^a-z0-9]/g, '') === norm)) return false;
    db.staff.push({ name, id, rank }); persist(); return true;
  },
  // add-or-update, used by role sync (matches on Discord id first, then name)
  upsertStaff(name, id = '', rank = '') {
    const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    let row = (id && db.staff.find((s) => s.id === id)) ||
              db.staff.find((s) => s.name.toLowerCase().replace(/[^a-z0-9]/g, '') === norm);
    if (row) {
      const changed = row.name !== name || row.id !== id || row.rank !== rank;
      row.name = name; row.id = id || row.id; row.rank = rank;
      persist(); return changed ? 'updated' : 'unchanged';
    }
    db.staff.push({ name, id, rank }); persist(); return 'added';
  },
  removeStaff(name) {
    const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const before = db.staff.length;
    db.staff = db.staff.filter((s) => s.name.toLowerCase().replace(/[^a-z0-9]/g, '') !== norm);
    persist(); return db.staff.length < before;
  },

  hasTranscript: (sig) => Object.prototype.hasOwnProperty.call(db.transcripts, sig),
  addTranscript(sig, rec) { db.transcripts[sig] = rec; persist(); },
  transcripts: () => db.transcripts,

  // Wipe the stored tallies so every transcript gets read again. Needed after a
  // counting-rule change: records keep only reply counts, not the original text,
  // so old rows can't be re-judged in place. Staff list is left alone.
  clearTranscripts() {
    const n = Object.keys(db.transcripts).length;
    db.transcripts = {};
    persist();
    return n;
  },

  // roll everything up into per-staff totals { key: {name, rank, tickets, replies} }
  // sinceTs / untilTs bound the window in milliseconds: [since, until). Leave
  // untilTs off for "everything from then on"; pass both to isolate one week.
  totals(sinceTs = 0, untilTs = Infinity) {
    const { TICKET_MIN_REPLIES } = require('./counter');
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const rankOf = (key, name) => {
      const m = db.staff.find((s) => norm(s.name) === key || norm(s.name) === norm(name));
      return m ? (m.rank || '') : '';
    };
    const per = {};
    for (const rec of Object.values(db.transcripts)) {
      if (sinceTs || untilTs !== Infinity) {
        const ts = recordTime(rec);
        if (!ts || ts < sinceTs || ts >= untilTs) continue;
      }
      for (const [k, v] of Object.entries(rec.counts)) {
        const row = per[k] || (per[k] = { name: v.name, rank: rankOf(k, v.name), tickets: 0, replies: 0 });
        row.name = v.name;
        row.replies += v.replies;
        if (v.replies >= TICKET_MIN_REPLIES) row.tickets += 1;
      }
    }
    return per;
  },

  recordTime,
};
