// =====================================================
//  Empire Roleplay — Ticket Counter bot
//  Auto-counts tickets from Ticket Tool transcripts using the
//  same rule as the web portal: a staff member with 3+ quality
//  replies (15+ char messages) in a transcript = 1 ticket handled.
// =====================================================

require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
} = require('discord.js');

const { parseTranscript } = require('./lib/parser');
const {
  countTranscript, creditedFrom, transcriptSig,
  QUALITY_MIN_CHARS, TICKET_MIN_REPLIES,
} = require('./lib/counter');
const store = require('./lib/store');

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
    .addUserOption((o) => o.setName('staff').setDescription('Show just this staff member').setRequired(false)),

  new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Process a Ticket Tool transcript (attach the .html file or paste its URL)')
    .addAttachmentOption((o) => o.setName('file').setDescription('The transcript .html file').setRequired(false))
    .addStringOption((o) => o.setName('url').setDescription('A transcript URL').setRequired(false)),

  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Read EVERY transcript in the watched channel(s) — no uploading one by one')
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
  store.addTranscript(sig, { label, date: new Date().toISOString().slice(0, 10), counts });
  return { ok: true, credited, counts };
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
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

// ---------- read every transcript in a channel's full history ----------
async function scanChannel(channel) {
  const r = { scanned: 0, counted: 0, credited: 0, dupes: 0, unreadable: 0 };
  let before;
  // guard against non-text channels
  if (!channel || typeof channel.messages?.fetch !== 'function') return r;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    for (const msg of batch.values()) {
      const att = msg.attachments.find((a) => /\.html?$/i.test(a.name || ''));
      if (!att) continue;
      r.scanned++;
      try {
        const html = await fetchText(att.url);
        const res = await processTranscript(html, att.name.replace(/\.html?$/i, ''));
        if (res.ok) { r.counted++; if (res.credited.length) r.credited++; }
        else if (res.reason === 'duplicate') r.dupes++;
        else r.unreadable++;
      } catch (e) { r.unreadable++; }
    }
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return r;
}

async function scanAll(guild) {
  const totals = { scanned: 0, counted: 0, credited: 0, dupes: 0, unreadable: 0 };
  for (const id of TRANSCRIPT_CHANNEL_IDS) {
    const ch = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
    if (!ch) continue;
    const r = await scanChannel(ch);
    for (const k in totals) totals[k] += r[k];
  }
  return totals;
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

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  if (TRANSCRIPT_CHANNEL_IDS.size) console.log('Watching transcript channels:', [...TRANSCRIPT_CHANNEL_IDS].join(', '));

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
      const r = await scanAll(guild).catch((e) => { console.warn('scan failed:', e.message); return null; });
      if (r) console.log(`[${guild.name}] scan done: ${r.counted} counted, ${r.dupes} already had, ${r.unreadable} unreadable`);
    }
  }
});

// auto-process transcripts posted in the log channel
client.on('messageCreate', async (msg) => {
  if (!TRANSCRIPT_CHANNEL_IDS.size || !TRANSCRIPT_CHANNEL_IDS.has(msg.channelId)) return;
  const htmlAtt = msg.attachments.find((a) => /\.html?$/i.test(a.name || ''));
  if (!htmlAtt) return;
  try {
    const html = await fetchText(htmlAtt.url);
    const r = await processTranscript(html, htmlAtt.name.replace(/\.html?$/i, ''));
    if (r.ok) {
      await msg.react('✅');
      if (r.credited.length) {
        await msg.reply({ embeds: [creditEmbed(htmlAtt.name, r.credited)] });
      }
    } else if (r.reason === 'duplicate') {
      await msg.react('♻️');
    } else {
      await msg.react('⚠️');
    }
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
    const totals = store.totals();
    if (user) {
      const key = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
      const row = Object.values(totals).find((r) => r.name.toLowerCase().replace(/[^a-z0-9]/g, '') === key)
        || Object.entries(totals).find(([k]) => k === key)?.[1];
      const t = row ? row.tickets : 0, q = row ? row.replies : 0;
      return i.reply(`**${user.username}** has handled **${t}** ticket${t !== 1 ? 's' : ''} (${q} quality replies).`);
    }
    const rows = Object.values(totals).sort((a, b) => b.tickets - a.tickets || b.replies - a.replies);
    if (!rows.length) return i.reply('No tickets counted yet. Add staff with `/staff add`, then `/sync` a transcript.');
    const embed = new EmbedBuilder()
      .setTitle('🎟️ Ticket Leaderboard')
      .setColor(0xe6b345)
      .setDescription(rows.map((r, n) =>
        `**${n + 1}.** ${n === 0 ? '👑 ' : ''}${r.name}${r.rank ? ` *(${r.rank})*` : ''} — **${r.tickets}** ticket${r.tickets !== 1 ? 's' : ''} · ${r.replies} replies`
      ).join('\n'))
      .setFooter({ text: `Rule: ${TICKET_MIN_REPLIES}+ quality replies (${QUALITY_MIN_CHARS}+ chars) = 1 ticket` });
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
      if (!r.credited.length) return i.editReply(`Processed **${label}** — nobody hit ${TICKET_MIN_REPLIES}+ quality replies, so no credit.`);
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
      const r = await scanAll(guild);
      return i.editReply(`📜 Scanned every transcript channel.\n• **${r.counted}** newly counted\n• ${r.dupes} already had\n• ${r.unreadable} unreadable\n\nRun \`/tickets\` to see the board.`);
    } catch (e) {
      const known = guildProblemMessage(e);
      if (known) return i.editReply(known);
      return i.editReply('⚠️ Scan failed: ' + e.message + ' — make sure I can View Channel + Read Message History there.');
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
        return ra - rb;
      });
      return i.reply('**Staff being counted:**\n' + ranked.map((x) => `• ${x.name}${x.rank ? ` — *${x.rank}*` : ''}${x.id ? ` (<@${x.id}>)` : ''}`).join('\n'));
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
