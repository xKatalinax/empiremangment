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
let tickets = store.get('tickets', []);
let roster  = store.get('roster', [{name:"Kat", rank:"Owner"}]);
let tebex   = store.get('tebex', []);
let apps    = store.get('apps', []);
let events  = store.get('events', []);

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const save = () => { store.set('boosts',boosts); store.set('tickets',tickets); store.set('roster',roster); store.set('tebex',tebex); store.set('apps',apps); store.set('events',events); store.set('users',users); };

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
  const cards = [
    {icon:'🔥', title:'Boost Tracker', desc:'Leaderboards & history', pill:'<span class="pill live"><span class="dot"></span>Boost live</span>', btn:'Open tracker', href:'boost.html'},
    {icon:'🎟️', title:'Ticket Tracker', desc:'Daily & weekly counts', pill:'<span class="pill none"><span class="dot"></span>—</span>', btn:'Open tracker', href:'tickets.html'},
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

/* ---------- ticket tracker ---------- */
function initTix(){
  if(!requireAuth()) return;
  $('tixDate').value = new Date().toISOString().slice(0,10);
  $('tixForm').addEventListener('submit', e=>{
    e.preventDefault();
    const staff = $('tixStaff').value.trim(); if(!staff) return;
    tickets.push({staff, count:parseInt($('tixCount').value)||1, date:$('tixDate').value});
    save(); $('tixStaff').value=''; $('tixCount').value=1; renderTix();
  });
  renderTix();
}
function renderTix(){
  const today = new Date().toISOString().slice(0,10);
  const weekAgo = new Date(Date.now()-6*864e5).toISOString().slice(0,10);
  $('tixToday').textContent = tickets.filter(t=>t.date===today).reduce((s,t)=>s+t.count,0);
  $('tixWeek').textContent  = tickets.filter(t=>t.date>=weekAgo).reduce((s,t)=>s+t.count,0);
  $('tixAll').textContent   = tickets.reduce((s,t)=>s+t.count,0);
  const per = {};
  tickets.forEach(t=>{ per[t.staff]=(per[t.staff]||0)+t.count; });
  const rows = Object.entries(per).sort((a,b)=>b[1]-a[1]);
  $('tixTable').innerHTML = rows.length ? `<table><tr><th>Staff</th><th>Tickets</th></tr>${
    rows.map(([n,c])=>`<tr><td>${esc(n)}</td><td class="num">${c}</td></tr>`).join('')
  }</table>` : `<div class="empty">No tickets logged yet.</div>`;
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
