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
const GUILD_ID = process.env.GUILD_ID || '';
const TRANSCRIPT_CHANNEL_ID = process.env.TRANSCRIPT_CHANNEL_ID || '';

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env — see .env.example');
  process.exit(1);
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
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Registered guild commands for', GUILD_ID);
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

// ---------- client ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needed to read Ticket Tool's attachment in the log channel
  ],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  if (TRANSCRIPT_CHANNEL_ID) console.log('Watching transcript channel', TRANSCRIPT_CHANNEL_ID);
});

// auto-process transcripts posted in the log channel
client.on('messageCreate', async (msg) => {
  if (!TRANSCRIPT_CHANNEL_ID || msg.channelId !== TRANSCRIPT_CHANNEL_ID) return;
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
        `**${n + 1}.** ${n === 0 ? '👑 ' : ''}${r.name} — **${r.tickets}** ticket${r.tickets !== 1 ? 's' : ''} · ${r.replies} replies`
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
      if (!s.length) return i.reply('No staff added yet. Use `/staff add`.');
      return i.reply('**Staff being counted:**\n' + s.map((x) => `• ${x.name}${x.id ? ` (<@${x.id}>)` : ''}`).join('\n'));
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

register().then(() => client.login(TOKEN)).catch((e) => {
  console.error('Startup failed:', e);
  process.exit(1);
});
