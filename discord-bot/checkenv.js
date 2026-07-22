// Check .env for the usual mistakes without ever printing your secrets.
//   npm run checkenv
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
let ok = true;
const problem = (m) => { ok = false; console.log('  ✖ ' + m); };
const good = (m) => console.log('  ✓ ' + m);
const note = (m) => console.log('    ' + m);

console.log('\nChecking', envPath, '\n');

if (!fs.existsSync(envPath)) {
  console.log('✖ No .env file here.');
  console.log('  Copy .env.example to .env and fill it in.');
  console.log('  On Windows make sure it is named ".env" and not ".env.txt".\n');
  process.exit(1);
}

const raw = fs.readFileSync(envPath, 'utf8');

// --- file-level checks ---
if (raw.charCodeAt(0) === 0xFEFF) {
  problem('The file starts with a hidden BOM character. Re-save it as UTF-8 without BOM.');
}
raw.split(/\r?\n/).forEach((line, n) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  if (!t.includes('=')) problem(`Line ${n + 1} has no "=" sign: "${t.slice(0, 30)}..."`);
  const [k, ...rest] = t.split('=');
  const v = rest.join('=');
  if (k !== k.trim()) problem(`Line ${n + 1}: remove the space before "=" in ${k.trim()}`);
  if (/^\s/.test(v) && v.trim()) problem(`Line ${n + 1}: remove the space after "=" in ${k.trim()}`);
  if (/^["']|["']$/.test(v.trim()) && v.trim()) {
    problem(`Line ${n + 1}: remove the quotes around the value of ${k.trim()}`);
  }
});

const shape = (s) => `${s.length} chars`;

// --- DISCORD_TOKEN ---
console.log('DISCORD_TOKEN');
const dt = process.env.DISCORD_TOKEN || '';
if (!dt) problem('Missing.');
else if (/your-bot-token|paste|xxx/i.test(dt)) problem('Still the placeholder text.');
else if (dt.startsWith('github_pat_') || dt.startsWith('ghp_')) {
  problem('This is a GitHub token, not a Discord one. It belongs in GITHUB_TOKEN.');
} else if (dt.split('.').length !== 3) {
  problem(`Doesn't look like a bot token (${shape(dt)}). A real one has three parts separated by dots.`);
  note('Developer portal -> your app -> Bot -> Reset Token -> Copy.');
} else if (dt.length < 55) {
  problem(`Too short (${shape(dt)}) — it may have been cut off when pasting.`);
} else {
  good(`Looks like a bot token (${shape(dt)}, 3 parts).`);
  note('If login still says "invalid token", it was reset or revoked — generate a new one.');
}

// --- CLIENT_ID ---
console.log('\nCLIENT_ID');
const cid = process.env.CLIENT_ID || '';
if (!cid) problem('Missing.');
else if (!/^\d{17,20}$/.test(cid)) problem(`Should be 17-20 digits, got "${cid.slice(0, 12)}..." (${shape(cid)}).`);
else good('Valid shape.');

// --- GUILD_ID ---
console.log('\nGUILD_ID');
const gid = (process.env.GUILD_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!gid.length) note('Empty — commands will register globally (can take up to an hour).');
else {
  const bad = gid.filter((g) => !/^\d{17,20}$/.test(g));
  if (bad.length) problem(`Not a Discord ID: ${bad.join(', ')}`);
  else if (gid.length > 1) {
    problem(`${gid.length} IDs listed. GUILD_ID takes ONE server ID.`);
    note('If those are channel IDs, move them to TRANSCRIPT_CHANNEL_ID.');
  } else good('One valid server ID.');
}

// --- TRANSCRIPT_CHANNEL_ID ---
console.log('\nTRANSCRIPT_CHANNEL_ID');
const chans = (process.env.TRANSCRIPT_CHANNEL_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!chans.length) note('Empty — auto-counting is off; you would have to use /sync manually.');
else {
  const bad = chans.filter((c) => !/^\d{17,20}$/.test(c));
  if (bad.length) problem(`Not a Discord ID: ${bad.join(', ')}`);
  else good(`${chans.length} channel${chans.length > 1 ? 's' : ''} being watched.`);
  if (gid.length === 1 && chans.includes(gid[0])) {
    problem('Your server ID is also listed as a transcript channel. That is probably a mistake.');
  }
}

// --- STAFF_ROLES ---
console.log('\nSTAFF_ROLES');
const roles = (process.env.STAFF_ROLES || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!roles.length) note('Empty — the built-in default rank list will be used.');
else good(`${roles.length} ranks, highest first: ${roles.slice(0, 4).join(', ')}${roles.length > 4 ? ', …' : ''}`);

// --- GitHub publishing (optional) ---
console.log('\nGITHUB_TOKEN (optional, for website auto-publish)');
const gt = process.env.GITHUB_TOKEN || '';
const grepo = process.env.GITHUB_REPO || '';
if (!gt && !grepo) note('Not set — website auto-publish is off. Use /export instead.');
else {
  if (!gt) problem('GITHUB_REPO is set but GITHUB_TOKEN is empty.');
  else if (gt.split('.').length === 3) problem('This looks like a Discord token, not a GitHub one.');
  else if (!/^(github_pat_|ghp_|gho_)/.test(gt)) {
    problem('GitHub tokens start with "github_pat_" (fine-grained) or "ghp_" (classic).');
  } else good(`Token shape looks right (${shape(gt)}).`);

  if (!grepo) problem('GITHUB_REPO is empty. It should look like owner/repo.');
  else if (!/^[\w.-]+\/[\w.-]+$/.test(grepo)) problem(`GITHUB_REPO should be "owner/repo", got "${grepo}".`);
  else good(`Repo: ${grepo}`);

  const br = process.env.GITHUB_BRANCH || 'main';
  note(`Branch: ${br} (if your repo's default branch is "master", change this or you'll get a 404)`);
}

console.log('\n' + (ok
  ? '✓ No problems found. Run "npm start".'
  : '✖ Fix the items marked ✖ above, then run this again.') + '\n');
