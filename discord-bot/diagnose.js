// Inspect a transcript file the parser couldn't read.
//   npm run diagnose                       (uses data/sample-transcript.html)
//   npm run diagnose -- path\to\file.html
const fs = require('fs');
const path = require('path');
const { parseTranscript } = require('./lib/parser');

const target = process.argv[2] || path.join(__dirname, 'data', 'sample-transcript.html');

if (!fs.existsSync(target)) {
  console.error('No file at:', target);
  console.error('Either run the bot once (it saves a sample automatically), or pass a path:');
  console.error('  npm run diagnose -- "C:\\path\\to\\transcript.html"');
  process.exit(1);
}

const html = fs.readFileSync(target, 'utf8');
console.log('File:', target);
console.log('Size:', html.length.toLocaleString(), 'characters\n');

// tag census
const tags = {};
for (const m of html.matchAll(/<([a-zA-Z][\w-]*)/g)) {
  const t = m[1].toLowerCase();
  tags[t] = (tags[t] || 0) + 1;
}
console.log('Most common tags:');
Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([t, n]) => console.log(`   ${String(n).padStart(6)}  <${t}>`));

// class census
const classes = {};
for (const m of html.matchAll(/class="([^"]{1,200})"/g)) {
  for (const c of m[1].split(/\s+/)) if (c) classes[c] = (classes[c] || 0) + 1;
}
if (Object.keys(classes).length) {
  console.log('\nMost common classes:');
  Object.entries(classes).sort((a, b) => b[1] - a[1]).slice(0, 20)
    .forEach(([c, n]) => console.log(`   ${String(n).padStart(6)}  .${c}`));
}

// known-format probes
console.log('\nFormat probes:');
for (const probe of ['discord-message', 'discord-messages', 'chatlog__message-group', 'chatlog__content',
  'messageContent', 'data-author', 'tickettool', 'window.__data', 'application/json']) {
  console.log(`   ${html.includes(probe) ? 'FOUND   ' : 'absent  '} ${probe}`);
}

const msgs = parseTranscript(html);
console.log(`\nParser result: ${msgs.length} messages`);
if (msgs.length) {
  console.log('First few:');
  msgs.slice(0, 5).forEach((m) => console.log(`   [${m.author}] ${m.content.slice(0, 70)}`));
} else {
  console.log('\nFirst 1500 characters of the file:\n');
  console.log(html.slice(0, 1500));
}
