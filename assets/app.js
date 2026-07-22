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

/* ---- shared counting rules (must match the Discord bot in /discord-bot) ---- */
const QUALITY_MIN_CHARS = 15;   // a "quality reply" = staff message with >= this many chars of real text
const TICKET_MIN_REPLIES = 3;   // >= this many quality replies in one transcript = 1 ticket handled

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
  const tixHandled = Object.values(aggregateTix()).reduce((s,r)=>s+r.tickets,0);
  const cards = [
    {icon:'🔥', title:'Boost Tracker', desc:'Leaderboards & history', pill:'<span class="pill live"><span class="dot"></span>Boost live</span>', btn:'Open tracker', href:'boost.html'},
    {icon:'🎟️', title:'Ticket Tracker', desc:'Auto-counted from transcripts', pill:tixHandled?`<span class="pill pending"><span class="dot"></span>${tixHandled} handled</span>`:'<span class="pill none"><span class="dot"></span>—</span>', btn:'Open tracker', href:'tickets.html'},
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
   Rule: a "quality reply" is a message from someone on the
   staff list containing >= QUALITY_MIN_CHARS characters of real
   text. A staff member who posts >= TICKET_MIN_REPLIES quality
   replies inside one transcript is credited with 1 ticket handled.
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
    if(!m.content || m.content.length < QUALITY_MIN_CHARS) continue;   // quality-reply length rule
    const st = matchStaff(m); if(!st) continue;                        // must be staff
    const key = normName(st.name) || 'id'+st.id;
    (tally[key] || (tally[key] = {name:st.name, replies:0})).replies++;
  }
  return tally;
}

/* ---- roll every source into per-staff totals ---- */
function aggregateTix(){
  const per = {};

  // 1. counts imported from the Discord bot (/export)
  if(botData && Array.isArray(botData.staff)){
    botData.staff.forEach(r=>{
      const k = r.key || normName(r.name);
      const row = per[k] || (per[k]={name:r.name, rank:r.rank||'', tickets:0, replies:0, manual:0, fromBot:0});
      row.name = r.name; row.rank = r.rank || row.rank;
      row.tickets += (r.tickets||0);
      row.replies += (r.replies||0);
      row.fromBot += (r.tickets||0);
    });
  }

  // 2. transcripts imported here in the browser
  transcripts.forEach(t=>{
    Object.entries(t.counts).forEach(([k,v])=>{
      const row = per[k] || (per[k]={name:v.name, rank:'', tickets:0, replies:0, manual:0, fromBot:0});
      row.name = v.name;
      row.replies += v.replies;
      if(v.replies >= TICKET_MIN_REPLIES) row.tickets += 1;            // 3+ quality replies = 1 ticket
    });
  });

  // 3. manual corrections
  tickets.forEach(t=>{
    const k = normName(t.staff);
    const row = per[k] || (per[k]={name:t.staff, rank:'', tickets:0, replies:0, manual:0, fromBot:0});
    row.tickets += (t.count||0); row.manual += (t.count||0);
  });
  return per;
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
          transcripts.push({ sig, label:f.name.replace(/\.html?$/i,''), date:new Date().toISOString().slice(0,10), counts });
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
  const per = aggregateTix();
  const rows = Object.values(per).sort((a,b)=> b.tickets-a.tickets || b.replies-a.replies);
  const totalTickets = rows.reduce((s,r)=>s+r.tickets,0);
  const credited = rows.filter(r=>r.tickets>0).length;

  $('tixHandled').textContent = totalTickets;
  $('tixStaffN').textContent  = credited;
  $('tixTransN').textContent  = (botData ? (botData.transcriptCount||0) : 0) + transcripts.length;

  const bs = $('botStatus');
  if(bs){
    bs.innerHTML = botData
      ? `<span class="tag ok">Synced</span> ${botData.staff.length} staff · ${botData.totalTickets} tickets · ${botData.transcriptCount||0} transcripts
         <button class="btn small ghost" style="margin-left:10px" onclick="clearBotData()">Clear</button>`
      : `<span class="tag grey">Not synced</span> Run <code>/export</code> in Discord, then import the file above.`;
  }

  // per-staff leaderboard (the automatic ticket count)
  $('tixTable').innerHTML = rows.length ? `<table>
    <tr><th>#</th><th>Staff</th><th>Rank</th><th>Tickets handled</th><th>Quality replies</th></tr>${
    rows.map((r,i)=>`<tr>
      <td class="num">${i+1}</td>
      <td>${i===0&&r.tickets>0?'👑 ':''}${esc(r.name)}</td>
      <td style="color:var(--muted);font-size:13px">${r.rank?esc(r.rank):'—'}</td>
      <td class="num">${r.tickets}${r.manual?` <span class="tag grey" title="includes ${r.manual} manual">+${r.manual}</span>`:''}</td>
      <td class="num" style="color:var(--muted)">${r.replies}</td>
    </tr>`).join('')
  }</table>` : `<div class="empty">No tickets counted yet. Import the bot's export above, or add staff and import transcripts.</div>`;

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
