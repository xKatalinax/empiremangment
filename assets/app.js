/* =====================================================
   Empire Roleplay Management Portal — shared app logic
   =====================================================
   Default accounts (kat is the admin). These seed on
   first load; after that, kat manages users from the
   User Management page. To reset everything to defaults,
   run  localStorage.clear()  in the browser console.
===================================================== */
const DEFAULT_USERS = [
  { name:"kat",   pw:"Crown-Kat-9482",  role:"admin" },
  { name:"ace",   pw:"Empire-7Qm3-Ax",  role:"staff" },
  { name:"blaze", pw:"Empire-X4dR-Bz",  role:"staff" },
  { name:"nova",  pw:"Empire-K8pW-Nv",  role:"staff" },
  { name:"ghost", pw:"Empire-M2vT-Gh",  role:"staff" }
];

/* ---------- safe storage ---------- */
const store = (() => {
  let mem = {}, ok = false;
  try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); ok = true; } catch(e){}
  return {
    get(k, fallback){
      try{
        const v = ok ? localStorage.getItem('emp_'+k) : (mem[k] ?? null);
        return v == null ? fallback : (ok ? JSON.parse(v) : v);
      }catch(e){ return fallback; }
    },
    set(k, v){
      try{ ok ? localStorage.setItem('emp_'+k, JSON.stringify(v)) : (mem[k]=v); }catch(e){ mem[k]=v; }
    }
  };
})();

/* ---------- state ---------- */
let users = store.get('users', null);
if(!users || !users.length){ users = DEFAULT_USERS.slice(); store.set('users', users); }
let boosts  = store.get('boosts', []);
let tickets = store.get('tickets', []);            // manual adjustments {staff,count,date}
let staffList   = store.get('staffList', []);      // who counts as staff: [{name,id}]
let transcripts = store.get('transcripts', []);    // parsed tickets: [{sig,label,date,counts:{key:{name,replies}}}]
let botData     = store.get('botData', null);      // counts imported from the Discord bot's /export file
let roster  = store.get('roster', [{name:"Kat", rank:"Owner"}]);
let tebex   = store.get('tebex', []);
let apps    = store.get('apps', []);
let events  = store.get('events', []);

/* ---- shared counting rules (must match the Discord bot in /discord-bot) ----
   This block is a straight copy of the top of discord-bot/lib/counter.js.
   If you change one, change the other or the website and Discord will disagree. */
const QUALITY_MIN_WORDS = 10;   // a reply must be at least this many words
const TICKET_MIN_REPLIES = 2;   // 2+ lines on the ticket = 1 ticket
const HELPFUL_MIN_CONTENT_WORDS = 4;  // distinct meaningful words needed on top of the length

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
`.trim().split(/\s+/));

// Greetings, thanks and other pleasantries — polite, but not the help itself.
const PLEASANTRIES = new Set(`
hi hey hello yo hiya greetings morning afternoon evening night welcome
thanks thank thankyou ty tysm thx tks cheers appreciate appreciated
please pls plz sorry apologies apologise apologize
bye goodbye later cya seeya np problem worries anytime
sir maam ma'am mate bro brother buddy friend king queen boss chief guys everyone
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
 * Two tests: it has to be long enough, and it has to say something.
 *
 * The second test is a heuristic, not real comprehension — it strips formula
 * openers, then stopwords and pleasantries, and requires what's left to hold at
 * least HELPFUL_MIN_CONTENT_WORDS distinct meaningful words. That clears out
 * "hey there, sorry for the wait, hope you're having a good day" style padding
 * while keeping anything that actually explains, instructs or answers.
 */
function isQualityReply(text) {
  const words = wordsOf(text);
  if (words.length < QUALITY_MIN_WORDS) return false;   // the 10-word floor

  // Peel off leading filler formulas — repeatedly, since they stack
  // ("hey there, thanks for waiting, bumping this...").
  let rest = words.join(' ');
  for (let pass = 0; pass < 4; pass++) {
    const before = rest;
    for (const re of FORMULA_OPENERS) rest = rest.replace(re, '').trim();
    if (rest === before) break;
  }

  const content = new Set(
    rest.split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w) && !PLEASANTRIES.has(w))
  );
  return content.size >= HELPFUL_MIN_CONTENT_WORDS;
}

/* ---- weekly period: Friday 12:00 AM -> next Friday 12:00 AM (matches the bot) ----
   WEEK_RESET_HOUR is the hour the week rolls over: 0 = midnight, 12 = midday.
   WEEK_TZ_OFFSET pins the boundary to a fixed zone (hours from UTC, e.g. -5 for
   US Eastern standard time); null means "use whatever clock the viewer's browser
   is on". Both have twins in discord-bot/lib/counter.js (RESET_HOUR and the
   WEEK_TZ_OFFSET env var) — set them the same on both sides, or a UTC-hosted bot
   and an Eastern-based staff member will disagree about where the week ends. */
const WEEK_RESET_HOUR = 0;
const WEEK_TZ_OFFSET = null;
let tixView = store.get('tixView', 'week');   // 'week' or 'all'
function resetLabel(){
  const h = ((WEEK_RESET_HOUR % 24) + 24) % 24;
  return (h % 12 === 0 ? 12 : h % 12) + ':00 ' + (h < 12 ? 'AM' : 'PM');
}
function weekStart(when){
  // Shift back by the reset hour so the anchor is a plain midnight, floor to the
  // most recent Friday, then put the hour back on.
  const ms = (when===undefined?Date.now():when) - WEEK_RESET_HOUR*36e5;
  if(WEEK_TZ_OFFSET === null){
    const t = new Date(ms);
    const d = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0,0,0,0);
    d.setDate(d.getDate() - ((d.getDay() - 5 + 7) % 7));   // Fri=5
    d.setHours(WEEK_RESET_HOUR, 0, 0, 0);                  // after the date math, so DST is handled
    return d.getTime();
  }
  // fixed offset: shift into that zone, floor to Friday, shift back
  const sh = new Date(ms + WEEK_TZ_OFFSET*36e5);
  const back = (sh.getUTCDay() - 5 + 7) % 7;
  return Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate() - back, WEEK_RESET_HOUR, 0, 0, 0)
    - WEEK_TZ_OFFSET*36e5;
}
/* Step into the middle of the next week and re-floor, so a DST change can't
   drift the rollover by an hour. */
function weekEnd(when){ return weekStart(weekStart(when) + 7*864e5 + 12*36e5); }
function weekLabel(when){
  const f = d => d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
  return f(new Date(weekStart(when))) + ' ' + resetLabel() + ' – ' + f(new Date(weekEnd(when))) + ' ' + resetLabel();
}

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const save = () => { store.set('boosts',boosts); store.set('tickets',tickets); store.set('staffList',staffList); store.set('transcripts',transcripts); store.set('botData',botData); store.set('roster',roster); store.set('tebex',tebex); store.set('apps',apps); store.set('events',events); store.set('users',users); };

/* ---------- auth (session survives page changes, ends when tab closes) ---------- */
function sessionGet(){ try{ return JSON.parse(sessionStorage.getItem('emp_session')||'null'); }catch(e){ return null; } }
function sessionSet(u){ try{ sessionStorage.setItem('emp_session', JSON.stringify(u)); }catch(e){} }
function sessionClear(){ try{ sessionStorage.removeItem('emp_session'); }catch(e){} }

function currentUser(){
  const s = sessionGet();
  if(!s) return null;
  return users.find(u => u.name === s.name) || null;
}
function requireAuth(adminOnly){
  const u = currentUser();
  if(!u){ location.href = 'index.html'; return null; }
  if(adminOnly && u.role !== 'admin'){ location.href = 'index.html'; return null; }
  return u;
}
function logout(){ sessionClear(); location.href = 'index.html'; }

/* ---------- ambient starfield ---------- */
(function(){
  const sky = document.querySelector('.sky');
  if(!sky) return;
  for(let i=0;i<100;i++){
    const s=document.createElement('span');
    s.className='star';
    const size=Math.random()*2+1;
    s.style.cssText=`width:${size}px;height:${size}px;left:${Math.random()*100}%;top:${Math.random()*100}%;animation-delay:${Math.random()*4}s;`;
    sky.appendChild(s);
  }
})();

/* =====================================================
   PAGE ROUTER — runs the init for whichever page loaded
===================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  const inits = {
    login: initLogin, dash: initDash, boost: initBoost, tickets: initTix,
    roster: initRoster, tebex: initTebex, apps: initApps, cal: initCal, users: initUsers
  };
  if(inits[page]) inits[page]();
});

/* ---------- index: login + dashboard ---------- */
function initLogin(){
  // Already signed in? Skip the gate.
  if(currentUser()){ showDash(); } else { showLogin(); }

  $('gateForm').addEventListener('submit', e=>{
    e.preventDefault();
    const u = $('loginUser').value.trim().toLowerCase();
    const p = $('loginPw').value;
    const match = users.find(x => x.name.toLowerCase()===u && x.pw===p);
    if(match){
      sessionSet({name:match.name});
      $('loginErr').textContent='';
      $('loginUser').value=''; $('loginPw').value='';
      showDash();
    }else{
      $('loginErr').textContent='Wrong username or password.';
      $('loginPw').select();
    }
  });
}
function showLogin(){
  $('scr-login').classList.add('active');
  $('scr-dash').classList.remove('active');
  window.scrollTo(0,0);
}
function showDash(){
  const u = currentUser(); if(!u){ showLogin(); return; }
  $('scr-login').classList.remove('active');
  $('scr-dash').classList.add('active');
  $('whoami').textContent = u.name + (u.role==='admin' ? ' (admin)' : '');
  renderDashCards(u);
  window.scrollTo(0,0);
}
function initDash(){ /* dashboard lives inside index.html */ }
function renderDashCards(u){
  const pend = tebex.filter(t=>t.status==='pending').length;
  const appPend = apps.filter(a=>a.status==='pending').length;
  const upcoming = nextEvent();
  const tixWeek    = Object.values(aggregateTix('week')).reduce((s,r)=>s+r.tickets,0);
  const tixHandled = Object.values(aggregateTix('all')).reduce((s,r)=>s+r.tickets,0);
  const cards = [
    {icon:'🔥', title:'Boost Tracker', desc:'Leaderboards & history', pill:'<span class="pill live"><span class="dot"></span>Boost live</span>', btn:'Open tracker', href:'boost.html'},
    {icon:'🎟️', title:'Ticket Tracker', desc:'Auto-counted from transcripts', pill:tixHandled?`<span class="pill pending"><span class="dot"></span>${tixWeek} this week · ${tixHandled} all time</span>`:'<span class="pill none"><span class="dot"></span>—</span>', btn:'Open tracker', href:'tickets.html'},
    {icon:'👥', title:'Staff Roster', desc:'Manage & track staff', pill:'<span class="pill none"><span class="dot"></span>—</span>', btn:'Open roster', href:'roster.html'},
    {icon:'💳', title:'Tebex Logs', desc:'Purchase log & confirmations', pill:pend?`<span class="pill pending"><span class="dot"></span>${pend} pending</span>`:'<span class="pill none"><span class="dot"></span>—</span>', btn:'View logs', href:'tebex.html'},
    {icon:'📋', title:'Applications', desc:'Staff application review', pill:appPend?`<span class="pill pending"><span class="dot"></span>${appPend} pending</span>`:'<span class="pill none"><span class="dot"></span>—</span>', btn:'View applications', href:'applications.html'},
    {icon:'📅', title:'Calendar', desc:'Events & birthdays', pill:upcoming?`<span class="pill info"><span class="dot"></span>${esc(upcoming)}</span>`:'<span class="pill none"><span class="dot"></span>—</span>', btn:'Open calendar', href:'calendar.html'}
  ];
  if(u.role==='admin'){
    cards.push({icon:'👑', title:'User Management', desc:'Add & remove portal users', pill:`<span class="pill pending"><span class="dot"></span>${users.length} users</span>`, btn:'Manage users', href:'users.html'});
  }
  $('dashCards').innerHTML = cards.map(c=>`
    <section class="card">
      <div class="icon">${c.icon}</div>
      <h3>${c.title}</h3>
      <p>${c.desc}</p>
      ${c.pill}
      <a class="btn" href="${c.href}">${c.btn}</a>
    </section>`).join('');
}
function nextEvent(){
  const today = new Date(); today.setHours(0,0,0,0);
  const up = events.filter(e=>new Date(e.date+'T00:00')>=today).sort((a,b)=>a.date.localeCompare(b.date))[0];
  if(!up) return null;
  const d = new Date(up.date+'T00:00');
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' — '+up.title.slice(0,18);
}

/* ---------- boost tracker ---------- */
function initBoost(){
  if(!requireAuth()) return;
  $('boostForm').addEventListener('submit', e=>{
    e.preventDefault();
    const name = $('boostName').value.trim();
    const n = parseInt($('boostCount').value)||1;
    if(!name) return;
    const ex = boosts.find(b=>b.name.toLowerCase()===name.toLowerCase());
    if(ex) ex.count += n; else boosts.push({name, count:n});
    save(); $('boostName').value=''; $('boostCount').value=1; renderBoost();
  });
  renderBoost();
}
function delBoost(i){ boosts.splice(i,1); save(); renderBoost(); }
function renderBoost(){
  boosts.sort((a,b)=>b.count-a.count);
  $('boostTotal').textContent = boosts.reduce((s,b)=>s+b.count,0);
  $('boostPeople').textContent = boosts.length;
  $('boostTop').textContent = boosts[0] ? boosts[0].name : '—';
  $('boostTable').innerHTML = boosts.length ? `<table><tr><th>#</th><th>Booster</th><th>Boosts</th><th></th></tr>${
    boosts.map((b,i)=>`<tr><td class="num">${i+1}</td><td>${i===0?'👑 ':''}${esc(b.name)}</td><td class="num">${b.count}</td>
    <td style="text-align:right"><button class="btn small danger" onclick="delBoost(${i})">Remove</button></td></tr>`).join('')
  }</table>` : `<div class="empty">No boosts logged yet. Add the first one above.</div>`;
}

/* =====================================================
   TICKET TRACKER — auto-counts from Ticket Tool transcripts
   -----------------------------------------------------
   Rule: a "quality reply" is a message from someone on the staff
   list that is >= QUALITY_MIN_WORDS words long and passes the
   helpfulness check (see isQualityReply). A staff member who posts
   >= TICKET_MIN_REPLIES quality replies inside one transcript is
   credited with 1 ticket handled.
   The SAME logic runs in the Discord bot under /discord-bot.
===================================================== */

/* ---- helpers shared by matching & counting ---- */
function normName(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function hashSig(str){                       // tiny stable hash for de-duping transcripts
  let h = 5381; for(let i=0;i<str.length;i++){ h = ((h<<5)+h + str.charCodeAt(i))>>>0; }
  return 'h'+h.toString(16);
}
function matchStaff(msg){                    // returns the staff entry this message's author belongs to, or null
  const authorId = (msg && typeof msg==='object') ? String(msg.authorId||'') : '';
  const author   = (msg && typeof msg==='object') ? String(msg.author||'')   : String(msg||'');
  if(authorId){                              // Ticket Tool gives us the real Discord ID — prefer it
    for(const st of staffList){ if(st.id && String(st.id)===authorId) return st; }
  }
  const a = normName(author);                // fall back to name (staff added without an ID)
  if(!a) return null;
  for(const st of staffList){
    const id = String(st.id||'').trim();
    if(id && author.includes(id)) return st;
    const n = normName(st.name);
    if(n && (a===n || (n.length>=3 && a.includes(n)))) return st;
  }
  return null;
}

/* strip mentions/emoji/code/links so they don't inflate the length check */
function textOnly(raw){
  return String(raw||'')
    .replace(/<a?:\w+:\d+>/g,' ')
    .replace(/<@[!&]?\d+>/g,' ')
    .replace(/<#\d+>/g,' ')
    .replace(/```[\s\S]*?```/g,' ')
    .replace(/`[^`]*`/g,' ')
    .replace(/https?:\/\/\S+/g,' ')
    .replace(/\s+/g,' ').trim();
}

/* ---- transcript parser ----
   Ticket Tool stores nothing readable in the HTML: the messages are a base64
   JSON array in a `messages` variable that their viewer decodes in-browser.
   We decode the same blob. Older/other exports fall back to HTML scraping. */
function parseTranscript(html){
  // Format A — Ticket Tool base64 payload
  const b64 = html.match(/\bmessages\s*=\s*"([A-Za-z0-9+/=]{40,})"/);
  if(b64){
    try{
      const arr = JSON.parse(decodeURIComponent(escape(atob(b64[1]))));
      if(Array.isArray(arr) && arr.length){
        return arr.map(x=>({
          author: x.nick || x.username || '',
          authorId: String(x.user_id||''),
          bot: !!x.bot,
          content: textOnly(x.content),
          created: x.created || null
        }));
      }
    }catch(e){ /* fall through to HTML parsing */ }
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];

  // Format B — discord-html-transcripts web components
  const dmsgs = doc.querySelectorAll('discord-message');
  if(dmsgs.length){
    const profiles = {};
    doc.querySelectorAll('discord-message[profile][author], [data-profile][author]').forEach(p=>{
      profiles[p.getAttribute('profile')||p.getAttribute('data-profile')] = p.getAttribute('author');
    });
    let last = '';
    dmsgs.forEach(el=>{
      let author = el.getAttribute('author') || el.getAttribute('data-author') || '';
      const pref = el.getAttribute('profile') || el.getAttribute('data-profile');
      if(!author && pref && profiles[pref]) author = profiles[pref];
      if(!author) author = last; else last = author;
      const clone = el.cloneNode(true);
      clone.querySelectorAll('discord-embed,discord-attachment,discord-reaction,discord-reactions,discord-attachments,discord-command,discord-system-message,discord-invite').forEach(n=>n.remove());
      out.push({ author:String(author).trim(), authorId:'', bot:false, content:textOnly(clone.textContent) });
    });
    return out;
  }

  // Format C — legacy DiscordChatExporter template
  const groups = doc.querySelectorAll('.chatlog__message-group');
  if(groups.length){
    groups.forEach(g=>{
      const aEl = g.querySelector('.chatlog__author-name, .chatlog__author, span[title]');
      const author = aEl ? (aEl.getAttribute('title') || aEl.textContent) : '';
      g.querySelectorAll('.chatlog__content, .chatlog__markdown').forEach(c=>{
        if(c.classList.contains('chatlog__markdown') && c.closest('.chatlog__content')) return;
        out.push({ author:String(author).trim(), authorId:'', bot:false, content:textOnly(c.textContent) });
      });
    });
    if(out.length) return out;
  }
  return out; // empty => unrecognised format
}

/* ---- count one parsed transcript into {key:{name,replies}} ---- */
function countTranscript(messages){
  const tally = {};
  for(const m of messages){
    if(m.bot) continue;                                                // never count bot posts
    if(!isQualityReply(m.content)) continue;                           // 10+ words and actually helpful
    const st = matchStaff(m); if(!st) continue;                        // must be staff
    const key = normName(st.name) || 'id'+st.id;
    (tally[key] || (tally[key] = {name:st.name, replies:0})).replies++;
  }
  return tally;
}

/* ---- roll every source into per-staff totals for the selected period ---- */
function aggregateTix(view){
  const per = {};
  const weekly = (view || tixView) === 'week';
  const since = weekly ? weekStart() : 0;

  // 1. counts published by the Discord bot (weekly board comes pre-computed)
  if(botData){
    const list = weekly
      ? (botData.week && Array.isArray(botData.week.staff) ? botData.week.staff : null)
      : (Array.isArray(botData.staff) ? botData.staff : null);
    if(list){
      list.forEach(r=>{
        const k = r.key || normName(r.name);
        const row = per[k] || (per[k]={name:r.name, rank:r.rank||'', tickets:0, replies:0, manual:0, fromBot:0});
        row.name = r.name; row.rank = r.rank || row.rank;
        row.tickets += (r.tickets||0);
        row.replies += (r.replies||0);
        row.fromBot += (r.tickets||0);
      });
    }
  }

  // 2. transcripts imported here in the browser
  transcripts.forEach(t=>{
    if(weekly){
      const ts = t.ts || (t.date ? Date.parse(t.date+'T12:00:00') : 0);
      if(!ts || ts < since) return;
    }
    Object.entries(t.counts).forEach(([k,v])=>{
      const row = per[k] || (per[k]={name:v.name, rank:'', tickets:0, replies:0, manual:0, fromBot:0});
      row.name = v.name;
      row.replies += v.replies;
      if(v.replies >= TICKET_MIN_REPLIES) row.tickets += 1;            // 2+ quality replies = 1 ticket
    });
  });

  // 3. manual corrections
  tickets.forEach(t=>{
    if(weekly){
      const ts = t.date ? Date.parse(t.date+'T12:00:00') : 0;
      if(!ts || ts < since) return;
    }
    const k = normName(t.staff);
    const row = per[k] || (per[k]={name:t.staff, rank:'', tickets:0, replies:0, manual:0, fromBot:0});
    row.tickets += (t.count||0); row.manual += (t.count||0);
  });
  return per;
}

function setTixView(v){ tixView = v; store.set('tixView', v); renderTix(); }

/* ---- one row per staff member, carrying BOTH counts side by side ----
   Merges the weekly and all-time aggregates on the staff key, so someone who
   handled nothing this week still shows up with their all-time total (and vice
   versa, for a manual adjustment dated inside this week). */
function tixRows(){
  const wk  = aggregateTix('week');
  const all = aggregateTix('all');
  const keys = new Set([...Object.keys(wk), ...Object.keys(all)]);
  return [...keys].map(k=>{
    const w = wk[k] || {}, a = all[k] || {};
    return {
      key: k,
      name: a.name || w.name || k,
      rank: a.rank || w.rank || '',
      week: w.tickets || 0,
      all:  a.tickets || 0,
      weekReplies: w.replies || 0,
      allReplies:  a.replies || 0,
      weekManual:  w.manual  || 0,
      allManual:   a.manual  || 0
    };
  }).sort((x,y)=> tixView==='week'
    ? (y.week - x.week) || (y.all - x.all) || (y.weekReplies - x.weekReplies)
    : (y.all - x.all)   || (y.week - x.week) || (y.allReplies - x.allReplies));
}

function initTix(){
  if(!requireAuth()) return;

  // seed the staff list from the roster the first time, so counting works out of the box
  if(!staffList.length && roster.length){
    staffList = roster.map(r=>({name:r.name, id:''}));
    save();
  }

  // transcript import (file picker + drag & drop)
  const drop = $('tixDrop'), file = $('tixFile');
  if(file) file.addEventListener('change', e=> importFiles(e.target.files));
  if(drop){
    drop.addEventListener('click', ()=> file && file.click());
    ['dragenter','dragover'].forEach(ev=> drop.addEventListener(ev, e=>{ e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave','drop'].forEach(ev=> drop.addEventListener(ev, e=>{ e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', e=> importFiles(e.dataTransfer.files));
  }

  // Pull the counts the bot publishes into this repo (data/tickets.json).
  // This is what makes the page update itself with no manual import.
  fetchPublishedCounts();

  // bot export import (empire-tickets.json from /export)
  const botFile = $('botFile'), botDrop = $('botDrop');
  if(botFile) botFile.addEventListener('change', e=> importBotFile(e.target.files[0]));
  if(botDrop){
    botDrop.addEventListener('click', ()=> botFile && botFile.click());
    ['dragenter','dragover'].forEach(ev=> botDrop.addEventListener(ev, e=>{ e.preventDefault(); botDrop.classList.add('drag'); }));
    ['dragleave','drop'].forEach(ev=> botDrop.addEventListener(ev, e=>{ e.preventDefault(); botDrop.classList.remove('drag'); }));
    botDrop.addEventListener('drop', e=>{ if(e.dataTransfer.files[0]) importBotFile(e.dataTransfer.files[0]); });
  }

  // staff-list manager
  $('staffForm').addEventListener('submit', e=>{
    e.preventDefault();
    const name = $('staffName').value.trim(); if(!name) return;
    const id = $('staffId').value.trim();
    if(staffList.some(s=>normName(s.name)===normName(name))){ $('staffName').value=''; $('staffId').value=''; return; }
    staffList.push({name, id});
    save(); $('staffName').value=''; $('staffId').value=''; renderTix();
  });

  // manual adjustment (kept as a fallback / correction)
  $('tixForm').addEventListener('submit', e=>{
    e.preventDefault();
    const staff = $('tixStaff').value.trim(); if(!staff) return;
    tickets.push({staff, count:parseInt($('tixCount').value)||1, date:$('tixDate').value||new Date().toISOString().slice(0,10)});
    save(); $('tixStaff').value=''; $('tixCount').value=1; renderTix();
  });
  if($('tixDate')) $('tixDate').value = new Date().toISOString().slice(0,10);

  renderTix();
}

function importFiles(fileList){
  const files = [...(fileList||[])].filter(f=>/\.html?$/i.test(f.name) || f.type==='text/html');
  if(!files.length){ flashImport('Please drop Ticket Tool <b>.html</b> transcript files.', true); return; }
  if(!staffList.length){ flashImport('Add at least one staff member below first — that\'s who gets counted.', true); return; }
  let done=0, added=0, skipped=0, unread=0, summaries=[];
  files.forEach(f=>{
    const reader = new FileReader();
    reader.onload = () => {
      const html = reader.result;
      const msgs = parseTranscript(html);
      if(!msgs.length){ unread++; }
      else {
        const sig = hashSig(msgs.length + ':' + msgs.slice(0,40).map(m=>(m.authorId||m.author)+':'+(m.content||'').slice(0,24)).join('|'));
        if(transcripts.some(t=>t.sig===sig)){ skipped++; }
        else {
          const counts = countTranscript(msgs);
          const credited = Object.values(counts).filter(v=>v.replies>=TICKET_MIN_REPLIES).map(v=>v.name);
          let ts=0; msgs.forEach(m=>{ const t=Number(m.created||0); if(t>ts) ts=t; });
          if(!ts) ts = Date.now();
          transcripts.push({ sig, label:f.name.replace(/\.html?$/i,''), date:new Date(ts).toISOString().slice(0,10), ts, counts });
          added++;
          summaries.push(`<b>${esc(f.name)}</b> → ${credited.length? credited.map(esc).join(', ')+' credited' : 'no one hit '+TICKET_MIN_REPLIES+'+ replies'}`);
        }
      }
      if(++done===files.length){
        save(); renderTix();
        let msg = `Imported ${added} transcript${added!==1?'s':''}.`;
        if(skipped) msg += ` ${skipped} already imported.`;
        if(unread)  msg += ` ${unread} couldn't be read (unrecognised format — send Kat a sample).`;
        flashImport(msg + (summaries.length? '<br><span class="imp-detail">'+summaries.join('<br>')+'</span>' : ''), unread>0 && added===0);
      }
    };
    reader.onerror = () => { if(++done===files.length){ save(); renderTix(); } };
    reader.readAsText(f);
  });
}
function flashImport(html, isErr){
  const el = $('tixImportMsg'); if(!el) return;
  el.className = 'imp-msg' + (isErr?' err':'');
  el.innerHTML = html;
}

/* Fetch the counts the Discord bot commits to this repo. Runs on every page load,
   so the tracker stays current without anyone importing anything by hand. */
function fetchPublishedCounts(){
  const el = $('botStatus');
  if(el) el.innerHTML = '<span class="tag grey">Checking…</span> looking for published counts';
  fetch('data/tickets.json?t=' + Date.now(), {cache:'no-store'})
    .then(r => { if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(data => {
      if(data.source !== 'empire-ticket-counter' || !Array.isArray(data.staff)) throw new Error('bad format');
      // Only replace if it's newer than what we already have.
      const haveTime = botData && botData.generated ? Date.parse(botData.generated) : 0;
      const newTime  = data.generated ? Date.parse(data.generated) : Date.now();
      if(newTime >= haveTime){ botData = data; save(); }
      renderTix();
    })
    .catch(() => {
      // No published file yet (or offline) — fall back to whatever was imported before.
      renderTix();
    });
}

function importBotFile(f){
  if(!f) return;
  const el = $('botMsg');
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      if(data.source !== 'empire-ticket-counter' || !Array.isArray(data.staff)){
        throw new Error('That doesn\'t look like an export from the bot.');
      }
      botData = data; save(); renderTix();
      const when = data.generated ? new Date(data.generated).toLocaleString() : 'just now';
      if(el){ el.className='imp-msg'; el.innerHTML =
        `Imported <b>${data.staff.length}</b> staff and <b>${data.totalTickets}</b> tickets from the bot.<br>` +
        `<span class="imp-detail">Generated ${esc(when)} · ${data.transcriptCount||0} transcripts</span>`; }
    }catch(err){
      if(el){ el.className='imp-msg err'; el.textContent = 'Could not read that file: ' + err.message; }
    }
  };
  reader.onerror = () => { if(el){ el.className='imp-msg err'; el.textContent='Could not read that file.'; } };
  reader.readAsText(f);
}
function clearBotData(){ botData = null; save(); renderTix(); }

function delStaff(i){ staffList.splice(i,1); save(); renderTix(); }
function delTranscript(i){ transcripts.splice(i,1); save(); renderTix(); }
function delManual(){ tickets = []; save(); renderTix(); }

function renderTix(){
  const rows = tixRows();
  const weekTotal = rows.reduce((s,r)=>s+r.week,0);
  const allTimeTotal = rows.reduce((s,r)=>s+r.all,0);
  const totalTickets = tixView==='week' ? weekTotal : allTimeTotal;
  const credited = rows.filter(r=> (tixView==='week' ? r.week : r.all) > 0).length;

  $('tixHandled').textContent = totalTickets;
  $('tixAllTime') && ($('tixAllTime').textContent = allTimeTotal);
  $('tixStaffN').textContent  = credited;
  $('tixTransN').textContent  = (botData ? (botData.transcriptCount||0) : 0) + transcripts.length;

  // period toggle + current week label
  const pv = $('tixPeriod');
  if(pv){
    const ms = weekEnd() - Date.now();
    const hrs = Math.floor(ms/36e5);
    const left = hrs < 24 ? hrs + 'h' : Math.floor(hrs/24) + 'd ' + (hrs%24) + 'h';
    pv.innerHTML =
      `<button class="btn small ${tixView==='week'?'':'ghost'}" onclick="setTixView('week')">This week</button>
       <button class="btn small ${tixView==='all'?'':'ghost'}" onclick="setTixView('all')">All time</button>
       <span class="period-note">${tixView==='week'
         ? `${esc(weekLabel())} · resets Friday ${resetLabel()} (in ${left}) · both counts always shown, sorted by this week`
         : 'Every ticket ever counted · both counts always shown, sorted by all time'}</span>`;
  }
  const lbl = $('tixStatLabel');
  if(lbl) lbl.textContent = tixView==='week' ? 'Tickets this week' : 'Tickets handled';

  const bs = $('botStatus');
  if(bs){
    if(botData){
      const when = botData.generated ? new Date(botData.generated) : null;
      const mins = when ? Math.round((Date.now()-when.getTime())/60000) : null;
      const ago = mins===null ? '' : mins<1 ? 'just now' : mins<60 ? mins+' min ago' : mins<1440 ? Math.round(mins/60)+' h ago' : Math.round(mins/1440)+' d ago';
      bs.innerHTML = `<span class="tag ok">Synced</span> ${botData.staff.length} staff · ${botData.totalTickets} tickets · ${botData.transcriptCount||0} transcripts`
        + (ago ? ` <span style="opacity:.75">· updated ${esc(ago)}</span>` : '')
        + ` <button class="btn small ghost" style="margin-left:10px" onclick="fetchPublishedCounts()">Refresh</button>`;
    } else {
      bs.innerHTML = `<span class="tag grey">Not synced</span> No published counts found. Run <code>/publish</code> in Discord, or drop an export file above.`;
    }
  }

  // per-staff leaderboard (the automatic ticket count)
  // per-staff leaderboard — the two ticket counts are always shown side by side
  const mTag = n => n ? ` <span class="tag grey" title="includes ${n} manual">+${n}</span>` : '';
  $('tixTable').innerHTML = rows.length ? `<table>
    <tr>
      <th>#</th><th>Staff</th><th>Rank</th>
      <th>This week</th><th>All time</th><th>Replies (week / all)</th>
    </tr>${
    rows.map((r,i)=>`<tr>
      <td class="num">${i+1}</td>
      <td>${i===0&&(tixView==='week'?r.week:r.all)>0?'👑 ':''}${esc(r.name)}</td>
      <td style="color:var(--muted);font-size:13px">${r.rank?esc(r.rank):'—'}</td>
      <td class="num"${tixView==='week'?' style="font-weight:800"':''}>${r.week}${mTag(r.weekManual)}</td>
      <td class="num"${tixView==='all'?' style="font-weight:800"':''}>${r.all}${mTag(r.allManual)}</td>
      <td class="num" style="color:var(--muted)">${r.weekReplies} / ${r.allReplies}</td>
    </tr>`).join('')
  }<tr>
      <td></td><td><b>Total</b></td><td></td>
      <td class="num"><b>${weekTotal}</b></td>
      <td class="num"><b>${allTimeTotal}</b></td>
      <td></td>
    </tr></table>` : `<div class="empty">No tickets counted yet. Import the bot's export above, or add staff and import transcripts.</div>`;

  // staff list
  $('staffTable').innerHTML = staffList.length ? `<table><tr><th>Staff member</th><th>Discord ID (optional)</th><th></th></tr>${
    staffList.map((s,i)=>`<tr>
      <td>${esc(s.name)}</td>
      <td style="font-family:monospace;font-size:13px;color:var(--muted)">${s.id?esc(s.id):'—'}</td>
      <td style="text-align:right"><button class="btn small danger" onclick="delStaff(${i})">Remove</button></td>
    </tr>`).join('')
  }</table>` : `<div class="empty">No staff yet. Add the people whose replies should be counted.</div>`;

  // imported transcripts
  $('tixTransList').innerHTML = transcripts.length ? `<table><tr><th>Transcript</th><th>Credited</th><th></th></tr>${
    transcripts.slice().reverse().map((t)=>{
      const real = transcripts.indexOf(t);
      const cred = Object.values(t.counts).filter(v=>v.replies>=TICKET_MIN_REPLIES).map(v=>`${esc(v.name)} (${v.replies})`);
      return `<tr>
        <td>${esc(t.label)}</td>
        <td>${cred.length? cred.join(', ') : '<span style="color:var(--muted)">—</span>'}</td>
        <td style="text-align:right"><button class="btn small danger" onclick="delTranscript(${real})">✕</button></td>
      </tr>`;
    }).join('')
  }</table>` : `<div class="empty">No transcripts imported yet.</div>`;
}

/* ---------- staff roster ---------- */
function initRoster(){
  if(!requireAuth()) return;
  $('rosterForm').addEventListener('submit', e=>{
    e.preventDefault();
    const name = $('rosterName').value.trim(); if(!name) return;
    roster.push({name, rank:$('rosterRank').value});
    save(); $('rosterName').value=''; renderRoster();
  });
  renderRoster();
}
function delRoster(i){ roster.splice(i,1); save(); renderRoster(); }
function renderRoster(){
  const order = ["Owner","Co-Owner","Head Admin","Admin","Moderator","Trial Mod","Support"];
  roster.sort((a,b)=>order.indexOf(a.rank)-order.indexOf(b.rank));
  $('rosterTable').innerHTML = roster.length ? `<table><tr><th>Name</th><th>Rank</th><th></th></tr>${
    roster.map((r,i)=>`<tr><td>${esc(r.name)}</td><td><span class="tag gold">${esc(r.rank)}</span></td>
    <td style="text-align:right"><button class="btn small danger" onclick="delRoster(${i})">Remove</button></td></tr>`).join('')
  }</table>` : `<div class="empty">Roster is empty. Add your first staff member above.</div>`;
}

/* ---------- tebex logs ---------- */
function initTebex(){
  if(!requireAuth()) return;
  $('tebexForm').addEventListener('submit', e=>{
    e.preventDefault();
    const buyer=$('tebexBuyer').value.trim(), item=$('tebexItem').value.trim();
    if(!buyer||!item) return;
    tebex.unshift({buyer, item, amt:parseFloat($('tebexAmt').value)||0, status:'pending'});
    save(); $('tebexBuyer').value=''; $('tebexItem').value=''; $('tebexAmt').value=''; renderTebex();
  });
  renderTebex();
}
function tebexToggle(i){ tebex[i].status = tebex[i].status==='pending'?'confirmed':'pending'; save(); renderTebex(); }
function tebexDel(i){ tebex.splice(i,1); save(); renderTebex(); }
function renderTebex(){
  const pend = tebex.filter(t=>t.status==='pending').length;
  $('tebexPending').textContent = pend;
  $('tebexDone').textContent = tebex.length - pend;
  $('tebexRev').textContent = '$' + tebex.reduce((s,t)=>s+t.amt,0).toFixed(2);
  $('tebexTable').innerHTML = tebex.length ? `<table><tr><th>Buyer</th><th>Item</th><th>Amount</th><th>Status</th><th></th></tr>${
    tebex.map((t,i)=>`<tr>
      <td>${esc(t.buyer)}</td><td>${esc(t.item)}</td><td class="num">$${t.amt.toFixed(2)}</td>
      <td><span class="tag ${t.status==='pending'?'gold':'green'}">${t.status}</span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn small ${t.status==='pending'?'confirm':'ghost'}" onclick="tebexToggle(${i})">${t.status==='pending'?'Confirm':'Undo'}</button>
        <button class="btn small danger" onclick="tebexDel(${i})">✕</button>
      </td></tr>`).join('')
  }</table>` : `<div class="empty">No purchases logged yet.</div>`;
}

/* ---------- applications ---------- */
function initApps(){
  if(!requireAuth()) return;
  $('appsForm').addEventListener('submit', e=>{
    e.preventDefault();
    const name=$('appName').value.trim(); if(!name) return;
    apps.unshift({name, pos:$('appPos').value, status:'pending'});
    save(); $('appName').value=''; renderApps();
  });
  renderApps();
}
function appSet(i,s){ apps[i].status=s; save(); renderApps(); }
function appDel(i){ apps.splice(i,1); save(); renderApps(); }
function renderApps(){
  $('appsTable').innerHTML = apps.length ? `<table><tr><th>Applicant</th><th>Position</th><th>Status</th><th></th></tr>${
    apps.map((a,i)=>`<tr>
      <td>${esc(a.name)}</td><td>${esc(a.pos)}</td>
      <td><span class="tag ${a.status==='pending'?'gold':a.status==='approved'?'green':'red'}">${a.status}</span></td>
      <td style="text-align:right;white-space:nowrap">
        ${a.status==='pending'?`<button class="btn small confirm" onclick="appSet(${i},'approved')">Approve</button>
        <button class="btn small danger" onclick="appSet(${i},'denied')">Deny</button>`:
        `<button class="btn small ghost" onclick="appSet(${i},'pending')">Reopen</button>
        <button class="btn small danger" onclick="appDel(${i})">✕</button>`}
      </td></tr>`).join('')
  }</table>` : `<div class="empty">No applications in the queue.</div>`;
}

/* ---------- calendar ---------- */
let calCursor = new Date();
function initCal(){
  if(!requireAuth()) return;
  $('calDate').value = new Date().toISOString().slice(0,10);
  $('calForm').addEventListener('submit', e=>{
    e.preventDefault();
    const d=$('calDate').value, t=$('calTitle').value.trim();
    if(!d||!t) return;
    events.push({date:d, title:t, type:$('calType').value});
    save(); $('calTitle').value=''; renderCal();
  });
  renderCal();
}
function calMove(n){ calCursor.setMonth(calCursor.getMonth()+n); renderCal(); }
function calDel(idx){
  if(confirm('Delete "'+events[idx].title+'"?')){ events.splice(idx,1); save(); renderCal(); }
}
function renderCal(){
  const y=calCursor.getFullYear(), m=calCursor.getMonth();
  $('calMonth').textContent = calCursor.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const first = new Date(y,m,1).getDay();
  const days = new Date(y,m+1,0).getDate();
  const todayStr = new Date().toISOString().slice(0,10);
  let html = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="cal-dow">${d}</div>`).join('');
  for(let i=0;i<first;i++) html += `<div class="cal-day blank"></div>`;
  for(let d=1;d<=days;d++){
    const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const evs = events.map((e,i)=>({...e,i})).filter(e=>e.date===ds);
    html += `<div class="cal-day${ds===todayStr?' today':''}"><span class="d">${d}</span>${
      evs.map(e=>`<div class="cal-ev${e.type==='bd'?' bd':''}" onclick="calDel(${e.i})" title="Tap to delete">${e.type==='bd'?'🎂 ':''}${esc(e.title)}</div>`).join('')
    }</div>`;
  }
  $('calGrid').innerHTML = html;
}

/* ---------- user management (admin only) ---------- */
function initUsers(){
  const me = requireAuth(true); if(!me) return;
  $('usersForm').addEventListener('submit', e=>{
    e.preventDefault();
    const name=$('newUser').value.trim().toLowerCase(), pw=$('newPw').value.trim();
    const errEl=$('usersErr'); errEl.textContent='';
    if(!name||!pw){ errEl.textContent='Username and password required.'; return; }
    if(users.some(u=>u.name.toLowerCase()===name)){ errEl.textContent='That username already exists.'; return; }
    users.push({name, pw, role:$('newRole').value});
    save(); $('newUser').value=''; $('newPw').value=''; renderUsers();
  });
  renderUsers();
}
function delUser(i){
  const me = currentUser();
  if(!me || me.role!=='admin') return;
  if(users[i].name===me.name){ $('usersErr').textContent="You can't remove your own account."; return; }
  if(confirm('Remove user "'+users[i].name+'"?')){ users.splice(i,1); save(); renderUsers(); }
}
function genPw(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let p='Empire-';
  for(let i=0;i<4;i++) p+=chars[Math.floor(Math.random()*chars.length)];
  p+='-';
  for(let i=0;i<2;i++) p+=chars[Math.floor(Math.random()*chars.length)];
  $('newPw').value=p;
}
function renderUsers(){
  const me = currentUser(); if(!me) return;
  $('usersErr').textContent='';
  $('usersTable').innerHTML = `<table><tr><th>User</th><th>Password</th><th>Role</th><th></th></tr>${
    users.map((u,i)=>`<tr>
      <td><b>${esc(u.name)}</b>${u.name===me.name?' <span class="tag grey">you</span>':''}</td>
      <td style="font-family:monospace;font-size:13px">${esc(u.pw)}</td>
      <td><span class="tag ${u.role==='admin'?'gold':'grey'}">${u.role}</span></td>
      <td style="text-align:right">${u.name!==me.name?`<button class="btn small danger" onclick="delUser(${i})">Remove</button>`:''}</td>
    </tr>`).join('')
  }</table>
  <div style="margin-top:14px"><button class="btn small ghost" onclick="genPw()">🎲 Generate a password into the form</button></div>`;
}
