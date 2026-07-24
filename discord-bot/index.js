// =====================================================
//  Empire Roleplay — Ticket Counter bot
//  Auto-counts tickets from Ticket Tool transcripts using the
//  same rule as the web portal: a staff member with 2+ quality
//  replies (10+ words, filler filtered out) in a transcript = 1 ticket.
// =====================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, Partials, REST, Routes, Events,
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
} = require('discord.js');

const { parseTranscript } = require('./lib/parser');
const {
  countTranscript, creditedFrom, transcriptSig,
  weekStart, weekLabel, nextReset, resetLabel,
  QUALITY_MIN_WORDS, TICKET_MIN_REPLIES,
} = require('./lib/counter');
const store = require('./lib/store');
const publisher = require('./lib/publish');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
// One server ID normally, but a comma-separated list is accepted if you run several servers.
const GUILD_IDS = (process.env.GUILD_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
const TRANSCRIPT_CHANNEL_IDS = new Set(
  (process.env.TRANSCRIPT_CHANNEL_ID || '').split(',').map((s) => s.trim()).filter(Boolean)
);
// Staff ranks in order, HIGHEST first. Must match your server's Discord role names.
const STAFF_ROLES = (process.env.STAFF_ROLES ||
  'Owner,Co-Owner,Head Admin,Senior Admin,Admin,Senior Moderator,Moderator,Trial Mod,Support')
  .split(',').map((s) => s.trim()).filter(Boolean);
const SCAN_ON_STARTUP = /^(1|true|yes)$/i.test(process.env.SCAN_ON_STARTUP || '');

// rank name -> seniority index (0 = highest). Lower index wins.
const rankIndex = new Map(STAFF_ROLES.map((r, n) => [r.toLowerCase(), n]));
function highestRank(roleNames) {
  let best = null, bestIdx = Infinity;
  for (const rn of roleNames) {
    const idx = rankIndex.get(String(rn).toLowerCase());
    if (idx !== undefined && idx < bestIdx) { bestIdx = idx; best = rn; }
  }
  return best; // the actual role name, or null if none matched
}

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env — see .env.example');
  process.exit(1);
}

// A Discord ID ("snowflake") is 17-20 digits, nothing else.
const isSnowflake = (s) => /^\d{17,20}$/.test(s);
const badIds = (list) => list.filter((s) => !isSnowflake(s));

for (const [label, list] of [['GUILD_ID', GUILD_IDS], ['TRANSCRIPT_CHANNEL_ID', [...TRANSCRIPT_CHANNEL_IDS]]]) {
  const bad = badIds(list);
  if (bad.length) {
    console.error(`\n✖ ${label} in your .env contains something that isn't a Discord ID:`);
    bad.forEach((b) => console.error(`    "${b}"`));
    console.error('  A Discord ID is 17-20 digits with no quotes, spaces or extra text.');
    console.error('  Enable Developer Mode in Discord, then right-click to Copy Server/Channel ID.\n');
    process.exit(1);
  }
}
if (GUILD_IDS.length > 1) {
  console.warn(`⚠ GUILD_ID lists ${GUILD_IDS.length} IDs. That's only correct if you run ${GUILD_IDS.length} separate servers.`);
  console.warn('  If those are CHANNEL ids, move them to TRANSCRIPT_CHANNEL_ID and put your one server ID here.\n');
}

// ---------- slash command definitions ----------
const commands = [
  new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Show the ticket leaderboard, or one staff member\'s count')
    .addStringOption((o) => o.setName('period').setDescription('Sort by this week (default) or all time — both counts always shown').setRequired(false)
      .addChoices({ name: 'This week', value: 'week' }, { name: 'All time', value: 'all' }))
    .addUserOption((o) => o.setName('staff').setDescription('Show just this staff member').setRequired(false)),

  new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Process a Ticket Tool transcript (attach the .html file or paste its URL)')
    .addAttachmentOption((o) => o.setName('file').setDescription('The transcript .html file').setRequired(false))
    .addStringOption((o) => o.setName('url').setDescription('A transcript URL').setRequired(false)),

  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Read EVERY transcript in the watched channel(s) — no uploading one by one')
    .addBooleanOption((o) => o.setName('recount')
      .setDescription('Wipe stored counts and re-judge every transcript under the current rules')
      .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('publish')
    .setDescription('Push the current counts to the Empire website now')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('export')
    .setDescription('Export the counts as a file you can import into the Empire website')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('diagnose')
    .setDescription('Inspect one real transcript and report why it can\'t be read')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('syncstaff')
    .setDescription('Rebuild the staff list from Discord roles, tagged with each highest rank')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Manage who counts as staff')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('add').setDescription('Add a staff member')
      .addStringOption((o) => o.setName('name').setDescription('Name exactly as it shows in Discord').setRequired(true))
      .addUserOption((o) => o.setName('user').setDescription('Optional: link their account for exact matching')))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a staff member')
      .addStringOption((o) => o.setName('name').setDescription('Name to remove').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List the staff being counted')),
].map((c) => c.toJSON());

// ---------- register commands on startup ----------
async function register() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  if (GUILD_IDS.length) {
    for (const gid of GUILD_IDS) {
      try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, gid), { body: commands });
        console.log('Registered commands for server', gid);
      } catch (e) {
        if (e.code === 10004) {
          console.error(`✖ Server ${gid} not found. Either that ID is wrong (is it a CHANNEL id by mistake?),`);
          console.error('  or the bot has not been invited to that server yet.');
        } else if (e.code === 50001) {
          console.error(`✖ Missing access to server ${gid}. Re-invite the bot with the applications.commands scope.`);
        } else {
          console.error(`✖ Could not register commands for ${gid}:`, e.rawError?.message || e.message);
        }
      }
    }
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Registered global commands (may take up to 1h to appear)');
  }
}

// ---------- core: fetch + count a transcript ----------
async function processTranscript(html, label) {
  const messages = parseTranscript(html);
  if (!messages.length) return { ok: false, reason: 'unreadable' };

  const sig = transcriptSig(messages);
  if (store.hasTranscript(sig)) return { ok: false, reason: 'duplicate' };

  const counts = countTranscript(messages, store.staff());
  const credited = creditedFrom(counts).map((v) => ({ name: v.name, replies: v.replies }));
  // Use the last real message time so the ticket lands in the right week.
  let ts = 0;
  for (const m of messages) {
    const t = Number(m.created || 0);
    if (t > ts) ts = t;
  }
  if (!ts) ts = Date.now();
  store.addTranscript(sig, { label, date: new Date(ts).toISOString().slice(0, 10), ts, counts });
  return { ok: true, credited, counts };
}

// A Ticket Tool link is just a viewer wrapped around the file Discord stores.
//   https://tickettool.xyz/transcript/v1/<channel>/<attachment>/<name>.html/<ex>/<is>/<hm>
// maps to
//   https://cdn.discordapp.com/attachments/<channel>/<attachment>/<name>.html?ex=..&is=..&hm=..
function tickettoolToCdn(url) {
  const m = String(url).match(
    /tickettool\.xyz\/transcript\/v\d+\/(\d+)\/(\d+)\/([^/\s]+?\.html?)\/([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i
  );
  if (!m) return null;
  const [, channelId, attId, name, ex, is, hm] = m;
  return `https://cdn.discordapp.com/attachments/${channelId}/${attId}/${name}?ex=${ex}&is=${is}&hm=${hm}&`;
}

// Find every transcript source in a message: real attachments first, then
// Ticket Tool links in the body or in embeds.
function transcriptSources(msg) {
  const out = [];
  for (const a of msg.attachments.values()) {
    if (/\.html?$/i.test(a.name || '')) out.push({ name: a.name, url: a.url });
  }
  if (out.length) return out;

  const texts = [msg.content || ''];
  for (const e of msg.embeds || []) {
    texts.push(e.description || '', e.url || '', e.title || '');
    for (const f of e.fields || []) texts.push(f.value || '');
  }
  const seen = new Set();
  for (const t of texts) {
    for (const m of String(t).matchAll(/https?:\/\/tickettool\.xyz\/transcript\/\S+/gi)) {
      const link = m[0].replace(/[)>\]]+$/, '');
      const cdn = tickettoolToCdn(link);
      const url = cdn || link;
      if (seen.has(url)) continue;
      seen.add(url);
      const nameMatch = link.match(/\/([^/\s]+?\.html?)\//i);
      out.push({ name: nameMatch ? nameMatch[1] : 'transcript', url, viaLink: true });
    }
  }
  return out;
}

async function fetchText(url) {
  // Discord's CDN can reject requests with no User-Agent, so always send one.
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'EmpireTicketCounter/1.0 (+https://empirerp.net)',
      'Accept': 'text/html,application/xhtml+xml,*/*',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
  return res.text();
}

// Resolve the server an interaction came from. i.guild can be null if the guild
// isn't cached, or if the app was added as a "user app" rather than invited as a bot.
async function resolveGuild(i) {
  if (i.guild) return i.guild;
  if (!i.guildId) {
    throw new Error('NOT_IN_SERVER');
  }
  try {
    return await client.guilds.fetch(i.guildId);
  } catch (e) {
    throw new Error('NOT_A_MEMBER');
  }
}

function guildProblemMessage(err) {
  if (err.message === 'NOT_IN_SERVER') {
    return '⚠️ Run this inside your server, not in a DM.';
  }
  if (err.message === 'NOT_A_MEMBER') {
    return [
      '⚠️ I can see this command but I\'m not actually a member of this server,',
      'so I can\'t read its roles or channels.',
      '',
      'This happens when the app was added as a **user app** instead of invited as a bot.',
      'Fix: developer portal → **OAuth2 → URL Generator** → tick **`bot`** *and* **`applications.commands`**,',
      'tick View Channels / Send Messages / Add Reactions / Read Message History,',
      'then open the generated link and add me to the server.',
    ].join('\n');
  }
  return null;
}

// ---------- build the staff list from Discord roles ----------
async function syncStaffFromRoles(guild) {
  const members = await guild.members.fetch();       // needs Guild Members intent
  let added = 0, updated = 0, total = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const roleNames = member.roles.cache.map((r) => r.name);
    const rank = highestRank(roleNames);             // null if they hold no staff role
    if (!rank) continue;
    total++;
    const res = store.upsertStaff(member.displayName, member.id, rank);
    if (res === 'added') added++; else if (res === 'updated') updated++;
  }
  return { total, added, updated };
}

// ---------- export for the website ----------
// The website is a static site with no backend, so the bridge is a file:
// the bot writes this JSON, the Ticket Tracker page imports it.
function buildExport() {
  const mkRows = (since) => Object.entries(store.totals(since)).map(([key, r]) => ({
    key, name: r.name, rank: r.rank || '', tickets: r.tickets, replies: r.replies,
  })).sort((a, b) => b.tickets - a.tickets || b.replies - a.replies);

  const rows = mkRows(0);
  const ws = weekStart();
  const weekRows = mkRows(ws);

  return {
    source: 'empire-ticket-counter',
    version: 2,
    generated: new Date().toISOString(),
    rule: { qualityMinWords: QUALITY_MIN_WORDS, ticketMinReplies: TICKET_MIN_REPLIES, helpfulnessFilter: true },
    week: {
      startsOn: `Friday ${resetLabel()}`,
      start: new Date(ws).toISOString(),
      end: new Date(nextReset()).toISOString(),
      label: weekLabel(),
      totalTickets: weekRows.reduce((s, r) => s + r.tickets, 0),
      staff: weekRows,
    },
    transcriptCount: Object.keys(store.transcripts()).length,
    totalTickets: rows.reduce((s, r) => s + r.tickets, 0),
    staff: rows,
  };
}

function writeExportFile() {
  try {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    const p = path.join(__dirname, 'data', 'empire-tickets.json');
    fs.writeFileSync(p, JSON.stringify(buildExport(), null, 2));
    return p;
  } catch (e) {
    return null;
  }
}

// Push counts to the website repo. Debounced so a burst of tickets makes one commit.
let publishTimer = null;
let publishing = false;
async function publishNow(reason = '') {
  if (!publisher.isConfigured()) return { ok: false, skipped: true };
  if (publishing) return { ok: false, skipped: true };
  publishing = true;
  try {
    const r = await publisher.publish(buildExport());
    if (r.ok) console.log(`published counts to website${reason ? ' (' + reason + ')' : ''}`);
    else if (!r.skipped) console.warn('publish failed:', r.error);
    return r;
  } catch (e) {
    console.warn('publish failed:', e.message);
    return { ok: false, error: e.message };
  } finally {
    publishing = false;
  }
}
function schedulePublish(reason) {
  if (!publisher.isConfigured()) return;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => publishNow(reason), 20_000); // batch rapid changes
}

// Fire exactly at the Friday 12:00 PM rollover so the website's weekly board
// resets on time even if no new ticket comes in.
let rolloverTimer = null;
function scheduleWeeklyRollover() {
  clearTimeout(rolloverTimer);
  const ms = Math.max(1000, nextReset() - Date.now() + 2000); // +2s to land just past the cut-off
  // setTimeout caps out around 24.8 days; our max is 7, so this is safe.
  rolloverTimer = setTimeout(async () => {
    console.log('weekly rollover — new week starts', weekLabel());
    await publishNow('weekly reset');
    scheduleWeeklyRollover();
  }, ms);
  const hrs = Math.round(ms / 3600_000);
  console.log(`next weekly reset: ${new Date(nextReset()).toLocaleString()} (in ~${hrs}h)`);
}

// ---------- read every transcript in a channel's full history ----------
async function scanChannel(channel, samples) {
  const r = { scanned: 0, counted: 0, credited: 0, dupes: 0, unreadable: 0, fetchFailed: 0 };
  let before;
  // guard against non-text channels
  if (!channel || typeof channel.messages?.fetch !== 'function') return r;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    for (const msg of batch.values()) {
      const sources = transcriptSources(msg);
      if (!sources.length) continue;
      for (const src of sources) {
        r.scanned++;
        try {
          const html = await fetchText(src.url);
          const res = await processTranscript(html, src.name.replace(/\.html?$/i, ''));
          if (res.ok) { r.counted++; if (res.credited.length) r.credited++; }
          else if (res.reason === 'duplicate') r.dupes++;
          else {
            r.unreadable++;
            if (samples && !samples.some((s) => s.html)) samples.push({ name: src.name, html });
          }
        } catch (e) {
          r.fetchFailed++;
          if (samples && !samples.some((s) => s.error)) samples.push({ name: src.name, error: e.message, url: src.url });
        }
      }
    }
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return r;
}

async function scanAll(guild, samples) {
  const totals = { scanned: 0, counted: 0, credited: 0, dupes: 0, unreadable: 0, fetchFailed: 0 };
  for (const id of TRANSCRIPT_CHANNEL_IDS) {
    const ch = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
    if (!ch) continue;
    const r = await scanChannel(ch, samples);
    for (const k in totals) totals[k] += r[k];
  }
  return totals;
}

// ---------- describe an unparseable transcript so the parser can be fixed ----------
function describeHtml(html) {
  const lines = [];
  lines.push(`size: ${html.length.toLocaleString()} characters`);
  const tagCounts = {};
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)/g)) {
    const t = m[1].toLowerCase();
    tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
  const top = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  lines.push('most common tags: ' + top.map(([t, n]) => `${t}(${n})`).join(', '));
  const classes = {};
  for (const m of html.matchAll(/class="([^"]{1,120})"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) classes[c] = (classes[c] || 0) + 1;
  }
  const topC = Object.entries(classes).sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (topC.length) lines.push('most common classes: ' + topC.map(([c, n]) => `${c}(${n})`).join(', '));
  for (const probe of ['discord-message', 'chatlog__message-group', 'chatlog__', 'messageContent', 'data-author', 'tickettool']) {
    if (html.includes(probe)) lines.push(`contains "${probe}": yes`);
  }
  return lines.join('\n');
}

// ---------- client ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needed to read Ticket Tool's attachment in the log channel
    GatewayIntentBits.GuildMembers,   // needed to read members' roles for /syncstaff
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  if (TRANSCRIPT_CHANNEL_IDS.size) console.log('Watching transcript channels:', [...TRANSCRIPT_CHANNEL_IDS].join(', '));

  scheduleWeeklyRollover();

  if (!client.guilds.cache.size) {
    console.warn('\n⚠ I am not a member of any server.');
    console.warn('  Slash commands may still appear if the app was added as a "user app",');
    console.warn('  but I cannot read roles or channels until I am invited as a BOT.');
    console.warn('  Developer portal → OAuth2 → URL Generator → scopes: bot + applications.commands\n');
  } else {
    console.log('In', client.guilds.cache.size, 'server(s):', client.guilds.cache.map((g) => g.name).join(', '));
  }

  for (const guild of client.guilds.cache.values()) {
    // build the staff list from roles every boot, so new hires/promotions are picked up
    try {
      const s = await syncStaffFromRoles(guild);
      console.log(`[${guild.name}] staff from roles: ${s.total} matched (${s.added} new, ${s.updated} updated)`);
    } catch (e) {
      console.warn(`[${guild.name}] staff sync failed — enable the Server Members Intent? (${e.message})`);
    }
    // optional: read the entire transcript-channel history on boot
    if (SCAN_ON_STARTUP && TRANSCRIPT_CHANNEL_IDS.size) {
      console.log(`[${guild.name}] scanning transcript history…`);
      const samples = [];
      const r = await scanAll(guild, samples).catch((e) => { console.warn('scan failed:', e.message); return null; });
      if (r) {
        console.log(`[${guild.name}] scan done: ${r.counted} counted, ${r.dupes} already had, ${r.unreadable} unparseable, ${r.fetchFailed} download-failed`);
        const p = writeExportFile();
        if (p) console.log(`[${guild.name}] website export written to:\n    ${p}`);
        const pub = await publishNow('startup scan');
        if (pub && pub.skipped && !publisher.isConfigured()) {
          console.log('  (website auto-publish is off — set GITHUB_TOKEN and GITHUB_REPO in .env to turn it on)');
        }
        const s = samples[0];
        if (s && s.html) {
          try {
            fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
            const p = path.join(__dirname, 'data', 'sample-transcript.html');
            fs.writeFileSync(p, s.html);
            console.log(`\n  A transcript I could not parse was saved to:\n    ${p}`);
            console.log('  Run "npm run diagnose" to inspect it, or send that file to be tuned against.\n');
            console.log(describeHtml(s.html).split('\n').map((l) => '    ' + l).join('\n'), '\n');
          } catch (e) { /* ignore */ }
        } else if (s && s.error) {
          console.log(`  Download failure example (${s.name}): ${s.error}`);
        }
      }
    }
  }
});

// auto-process transcripts posted in the log channel
client.on('messageCreate', async (msg) => {
  if (!TRANSCRIPT_CHANNEL_IDS.size || !TRANSCRIPT_CHANNEL_IDS.has(msg.channelId)) return;
  const sources = transcriptSources(msg);
  if (!sources.length) return;
  try {
    let anyOk = false, anyDupe = false;
    for (const src of sources) {
      const html = await fetchText(src.url);
      const r = await processTranscript(html, src.name.replace(/\.html?$/i, ''));
      if (r.ok) {
        anyOk = true;
        if (r.credited.length) await msg.reply({ embeds: [creditEmbed(src.name, r.credited)] });
      } else if (r.reason === 'duplicate') anyDupe = true;
    }
    await msg.react(anyOk ? '✅' : anyDupe ? '♻️' : '⚠️');
    if (anyOk) schedulePublish('new ticket');
  } catch (e) {
    console.error('auto-process failed:', e.message);
    await msg.react('⚠️').catch(() => {});
  }
});

// ---------- slash command handling ----------
client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === 'tickets') {
    const user = i.options.getUser('staff');
    const period = i.options.getString('period') || 'week';
    const scope = period === 'all' ? 'All time' : `Week of ${weekLabel()}`;

    // Both periods are always computed, then merged on the staff key, so every
    // staff member carries a separate weekly total and all-time total.
    const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const weekTotals = store.totals(weekStart());
    const allTotals = store.totals(0);
    const merged = {};
    for (const [k, r] of Object.entries(allTotals)) {
      merged[k] = { key: k, name: r.name, rank: r.rank || '', week: 0, all: r.tickets, weekReplies: 0, allReplies: r.replies };
    }
    for (const [k, r] of Object.entries(weekTotals)) {
      const row = merged[k] || (merged[k] = { key: k, name: r.name, rank: r.rank || '', week: 0, all: 0, weekReplies: 0, allReplies: 0 });
      row.week = r.tickets;
      row.weekReplies = r.replies;
      row.rank = row.rank || r.rank || '';
    }

    if (user) {
      const key = norm(user.username);
      const row = merged[key] || Object.values(merged).find((r) => norm(r.name) === key);
      const wk = row ? row.week : 0;
      const at = row ? row.all : 0;
      return i.reply(
        `**${user.username}**\n`
        + `• This week (${weekLabel()}): **${wk}** ticket${wk !== 1 ? 's' : ''}${row ? ` · ${row.weekReplies} replies` : ''}\n`
        + `• All time: **${at}** ticket${at !== 1 ? 's' : ''}${row ? ` · ${row.allReplies} replies` : ''}`
      );
    }

    const rows = Object.values(merged).sort((a, b) => period === 'all'
      ? (b.all - a.all) || (b.week - a.week)
      : (b.week - a.week) || (b.all - a.all));

    if (!rows.length) {
      return i.reply('No tickets counted yet. Add staff with `/syncstaff`, then `/scan`.');
    }

    const shown = rows.slice(0, 40);
    let desc = shown.map((r, n) =>
      `**${n + 1}.** ${n === 0 ? '👑 ' : ''}${r.name}${r.rank ? ` *(${r.rank})*` : ''}\n`
      + `\u2003└ **${r.week}** this week · **${r.all}** all time`
    ).join('\n');
    if (rows.length > shown.length) desc += `\n\n…and ${rows.length - shown.length} more.`;

    const weekSum = rows.reduce((s, r) => s + r.week, 0);
    const allSum = rows.reduce((s, r) => s + r.all, 0);
    desc += `\n\n**Team total —** ${weekSum} this week · ${allSum} all time`;
    if (desc.length > 4000) desc = desc.slice(0, 3990) + '\n…';

    const hrs = Math.floor((nextReset() - Date.now()) / 3600_000);
    const embed = new EmbedBuilder()
      .setTitle(`\u{1F39F}\uFE0F Ticket Leaderboard — sorted by ${period === 'all' ? 'all time' : 'this week'}`)
      .setColor(0xe6b345)
      .setDescription(desc)
      .setFooter({ text: `${scope} · resets Friday ${resetLabel()} in ${hrs < 24 ? `${hrs}h` : `${Math.floor(hrs / 24)}d ${hrs % 24}h`} · ${TICKET_MIN_REPLIES}+ helpful replies (${QUALITY_MIN_WORDS}+ words) = 1 ticket` });
    return i.reply({ embeds: [embed] });
  }

  if (i.commandName === 'sync') {
    const file = i.options.getAttachment('file');
    const url = i.options.getString('url');
    if (!file && !url) return i.reply({ content: 'Attach a `.html` transcript or paste a `url`.', ephemeral: true });
    if (!store.staff().length) return i.reply({ content: 'Add staff first with `/staff add` — that\'s who gets counted.', ephemeral: true });
    await i.deferReply();
    try {
      const src = file ? file.url : url;
      const label = file ? (file.name || 'transcript').replace(/\.html?$/i, '') : 'transcript';
      const html = await fetchText(src);
      const r = await processTranscript(html, label);
      if (!r.ok && r.reason === 'duplicate') return i.editReply('♻️ That transcript was already counted.');
      if (!r.ok) return i.editReply('⚠️ Couldn\'t read that transcript. Send Kat a sample so the parser can be tuned.');
      if (!r.credited.length) return i.editReply(`Processed **${label}** — nobody hit ${TICKET_MIN_REPLIES}+ helpful replies of ${QUALITY_MIN_WORDS}+ words, so no credit.`);
      return i.editReply({ embeds: [creditEmbed(label, r.credited)] });
    } catch (e) {
      return i.editReply('⚠️ Fetch failed: ' + e.message + (url ? ' — hosted transcript links can be JS-rendered; try attaching the `.html` file instead.' : ''));
    }
  }

  if (i.commandName === 'scan') {
    if (!TRANSCRIPT_CHANNEL_IDS.size) return i.reply({ content: 'No transcript channels set. Add channel IDs to `TRANSCRIPT_CHANNEL_ID` in `.env` first.', ephemeral: true });
    if (!store.staff().length) return i.reply({ content: 'Add staff first (`/syncstaff` or `/staff add`) — that\'s who gets counted.', ephemeral: true });
    await i.deferReply();
    try {
      const guild = await resolveGuild(i);
      // A rule change can't be applied to stored rows — they only hold reply
      // tallies, not the original text — so recount clears them and re-reads.
      const recount = i.options.getBoolean('recount') || false;
      const wiped = recount ? store.clearTranscripts() : 0;
      const samples = [];
      const r = await scanAll(guild, samples);
      const lines = [
        recount
          ? `📜 Recounted from scratch — cleared **${wiped}** stored transcript${wiped !== 1 ? 's' : ''} and re-read the channels.`
          : '📜 Scanned every transcript channel.',
        `• **${r.counted}** newly counted`,
        `• ${r.dupes} already had`,
        `• ${r.scanned} transcript files seen`,
      ];
      if (r.unreadable) lines.push(`• ⚠️ ${r.unreadable} downloaded but couldn't be parsed`);
      if (r.fetchFailed) lines.push(`• ⚠️ ${r.fetchFailed} couldn't be downloaded`);
      if (r.unreadable || r.fetchFailed) {
        lines.push('', 'Run `/diagnose` to see what these files actually contain.');
        const s = samples[0];
        if (s && s.html) {
          try {
            fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
            fs.writeFileSync(path.join(__dirname, 'data', 'sample-transcript.html'), s.html);
            lines.push('A copy was saved to `discord-bot/data/sample-transcript.html` for inspection.');
          } catch (e) { /* ignore */ }
        }
      } else {
        lines.push('', 'Run `/tickets` to see the board.');
      }
      const pub = await publishNow('scan command');
      if (pub && pub.ok) lines.push('', '🌐 Website updated automatically.');
      else if (pub && !pub.skipped) lines.push('', '⚠️ Website publish failed: ' + pub.error);
      return i.editReply(lines.join('\n').slice(0, 1900));
    } catch (e) {
      const known = guildProblemMessage(e);
      if (known) return i.editReply(known);
      return i.editReply('⚠️ Scan failed: ' + e.message + ' — make sure I can View Channel + Read Message History there.');
    }
  }

  if (i.commandName === 'publish') {
    await i.deferReply();
    if (!publisher.isConfigured()) {
      return i.editReply([
        '⚠️ Website auto-publish isn\'t set up yet.',
        '',
        'Add these to `.env`, then restart me:',
        '```',
        'GITHUB_TOKEN=github_pat_...',
        'GITHUB_REPO=xKatalinax/empiremangment',
        'GITHUB_BRANCH=main',
        '```',
        'The token needs **Contents: read and write** on that repo.',
      ].join('\n'));
    }
    const r = await publishNow('publish command');
    if (r.ok) {
      const p = buildExport();
      return i.editReply(`🌐 Website updated — **${p.totalTickets}** tickets across **${p.staff.length}** staff.\nIt may take a minute for GitHub Pages to rebuild.`);
    }
    return i.editReply('⚠️ Publish failed: ' + (r.error || 'unknown error'));
  }

  if (i.commandName === 'export') {
    await i.deferReply();
    try {
      const payload = buildExport();
      const buf = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
      const rows = payload.staff.length;
      return i.editReply({
        content: [
          `📤 **Export ready** — ${rows} staff, ${payload.totalTickets} tickets, ${payload.transcriptCount} transcripts.`,
          '',
          'On the website: **Ticket Tracker → Import from bot**, then pick this file.',
        ].join('\n'),
        files: [{ attachment: buf, name: 'empire-tickets.json' }],
      });
    } catch (e) {
      return i.editReply('Export failed: ' + e.message);
    }
  }

  if (i.commandName === 'diagnose') {
    if (!TRANSCRIPT_CHANNEL_IDS.size) return i.reply({ content: 'No transcript channels set in `.env`.', ephemeral: true });
    await i.deferReply();
    try {
      const guild = await resolveGuild(i);
      // grab the newest .html attachment from any watched channel
      let found = null;
      for (const id of TRANSCRIPT_CHANNEL_IDS) {
        const ch = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
        if (!ch || typeof ch.messages?.fetch !== 'function') continue;
        const batch = await ch.messages.fetch({ limit: 50 }).catch(() => null);
        if (!batch) continue;
        for (const msg of batch.values()) {
          const s = transcriptSources(msg);
          if (s.length) { found = { src: s[0], channel: ch.name }; break; }
        }
        if (found) break;
      }
      if (!found) return i.editReply('No transcripts (attachments or Ticket Tool links) found in the watched channels. Are the channel IDs right?');

      let html;
      try {
        html = await fetchText(found.src.url);
      } catch (e) {
        return i.editReply([
          `Found **${found.src.name}** in #${found.channel} but could not download it.`,
          `Error: \`${e.message}\``,
          found.src.viaLink ? 'This came from a Ticket Tool link.' : 'This came from a file attachment.',
          '',
          'If this says HTTP 403/404, the transcript link has expired on Discord\'s side.',
        ].join('\n'));
      }

      const msgs = parseTranscript(html);
      const report = describeHtml(html);
      const head = html.slice(0, 600).replace(/```/g, '`­``');

      const out = [
        `**Diagnosing \`${found.src.name}\`** (from #${found.channel})`,
        '',
        `Parser found **${msgs.length}** messages.`,
        '',
        '**Structure:**',
        '```',
        report,
        '```',
        '**First 600 characters:**',
        '```html',
        head,
        '```',
      ].join('\n');

      return i.editReply(out.slice(0, 1900));
    } catch (e) {
      const known = guildProblemMessage(e);
      if (known) return i.editReply(known);
      return i.editReply('Diagnose failed: ' + e.message);
    }
  }

  if (i.commandName === 'syncstaff') {
    await i.deferReply();
    try {
      const guild = await resolveGuild(i);
      const s = await syncStaffFromRoles(guild);
      if (!s.total) {
        return i.editReply([
          'No members matched any staff role.',
          `I looked for: ${STAFF_ROLES.join(', ')}`,
          '',
          'Set `STAFF_ROLES` in `.env` to your server\'s exact role names (highest rank first), then run this again.',
        ].join('\n'));
      }
      schedulePublish('staff sync');
      return i.editReply(`👥 Staff list rebuilt from roles: **${s.total}** staff (${s.added} new, ${s.updated} updated). Run \`/staff list\` to see them.`);
    } catch (e) {
      const known = guildProblemMessage(e);
      if (known) return i.editReply(known);
      if (/disallowed intents|Missing Access|GuildMembers/i.test(e.message)) {
        return i.editReply('⚠️ I can\'t read members. Switch **ON** the **Server Members Intent** on the Bot page in the developer portal, save, then restart me.');
      }
      return i.editReply('⚠️ Couldn\'t read roles: ' + e.message);
    }
  }

  if (i.commandName === 'staff') {
    const sub = i.options.getSubcommand();
    if (sub === 'add') {
      const name = i.options.getString('name');
      const user = i.options.getUser('user');
      const ok = store.addStaff(name, user ? user.id : '');
      return i.reply(ok ? `Added **${name}** to the staff list.${user ? ` (linked to <@${user.id}>)` : ''}` : `**${name}** is already on the list.`);
    }
    if (sub === 'remove') {
      const name = i.options.getString('name');
      return i.reply(store.removeStaff(name) ? `Removed **${name}**.` : `**${name}** wasn't on the list.`);
    }
    if (sub === 'list') {
      const s = store.staff();
      if (!s.length) return i.reply('No staff added yet. Use `/syncstaff` (from roles) or `/staff add`.');
      const ranked = s.slice().sort((a, b) => {
        const ra = rankIndex.has((a.rank || '').toLowerCase()) ? rankIndex.get((a.rank || '').toLowerCase()) : 999;
        const rb = rankIndex.has((b.rank || '').toLowerCase()) ? rankIndex.get((b.rank || '').toLowerCase()) : 999;
        return ra - rb || a.name.localeCompare(b.name);
      });
      // Group by rank and keep every embed under Discord's 4096-char description cap.
      const lines = ranked.map((x) => `• ${x.name}${x.rank ? ` — *${x.rank}*` : ''}`);
      const embeds = [];
      let buf = [];
      for (const line of lines) {
        if (buf.length && buf.join('\n').length + line.length + 1 > 3900) {
          embeds.push(buf.join('\n')); buf = [];
        }
        buf.push(line);
      }
      if (buf.length) embeds.push(buf.join('\n'));

      const first = new EmbedBuilder()
        .setTitle(`👥 Staff being counted (${ranked.length})`)
        .setColor(0xe6b345)
        .setDescription(embeds[0]);
      const rest = embeds.slice(1, 10).map((d) => new EmbedBuilder().setColor(0xe6b345).setDescription(d));
      return i.reply({ embeds: [first, ...rest] });
    }
  }
});

function creditEmbed(label, credited) {
  return new EmbedBuilder()
    .setTitle('✅ Ticket counted')
    .setColor(0x4cd97a)
    .setDescription(`**${label}**\n` + credited.map((c) => `• **${c.name}** +1 ticket (${c.replies} quality replies)`).join('\n'))
    .setTimestamp();
}

// Never let a single API hiccup take the whole bot down.
client.on('error', (e) => console.error('client error:', e.message));
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e?.message || e));
process.on('uncaughtException', (e) => console.error('uncaught exception:', e?.message || e));

// Register commands, but never let that stop the bot from logging in —
// counting still works even if a slash command fails to register.
(async () => {
  try {
    await register();
  } catch (e) {
    console.error('Command registration problem:', e.rawError?.message || e.message);
  }
  try {
    await client.login(TOKEN);
  } catch (e) {
    console.error('\n✖ Login failed:', e.message);
    console.error('  Check DISCORD_TOKEN in .env. If it was reset or leaked, generate a new one.');
    console.error('  If it mentions "disallowed intents", switch ON the Server Members and');
    console.error('  Message Content intents on the Bot page in the developer portal.\n');
    process.exitCode = 1;
  }
})();
