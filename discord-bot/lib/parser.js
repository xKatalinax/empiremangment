// =====================================================
//  Transcript parser (Node) — mirrors parseTranscript()
//  in the web portal.
//
//  PRIMARY FORMAT: Ticket Tool.
//  Ticket Tool transcripts contain no readable HTML. The messages live in a
//  base64-encoded JSON array assigned to a `messages` variable inside a
//  <script> tag, which their viewer decodes in the browser:
//      let messages = "W3siZGlzY29yZERhdGEi...";
//  Each decoded entry looks like:
//      { user_id, bot, username, nick, content, embeds, created, ... }
//  Because every message carries user_id, staff can be matched by exact
//  Discord ID rather than by name.
//
//  FALLBACKS: discord-html-transcripts web components, and the legacy
//  DiscordChatExporter (chatlog__) template.
// =====================================================

const { parse } = require('node-html-parser');

function clean(t) {
  return String(t || '').replace(/\s+/g, ' ').trim();
}

// Strip things that aren't typed prose, so they don't inflate the length check:
// user/role/channel mentions, custom emoji, code fences, bare URLs.
function textOnly(raw) {
  return clean(
    String(raw || '')
      .replace(/<a?:\w+:\d+>/g, ' ')      // custom emoji
      .replace(/<@[!&]?\d+>/g, ' ')       // user and role mentions
      .replace(/<#\d+>/g, ' ')            // channel mentions
      .replace(/```[\s\S]*?```/g, ' ')    // fenced code blocks
      .replace(/`[^`]*`/g, ' ')           // inline code
      .replace(/https?:\/\/\S+/g, ' ')    // links
  );
}

function b64decode(s) {
  return Buffer.from(s, 'base64').toString('utf8');
}

// ---- Ticket Tool: base64 JSON payload ----
function parseTicketTool(html) {
  const m = html.match(/\bmessages\s*=\s*"([A-Za-z0-9+/=]{40,})"/);
  if (!m) return null;
  let arr;
  try {
    arr = JSON.parse(b64decode(m[1]));
  } catch (e) {
    return null;
  }
  if (!Array.isArray(arr)) return null;

  return arr.map((x) => ({
    author: x.nick || x.username || '',
    authorId: String(x.user_id || ''),
    bot: !!x.bot,
    content: textOnly(x.content),
    created: x.created || null,
  }));
}

// Pull the channel name out of the sibling `channel` variable, for nicer labels.
function ticketToolChannelName(html) {
  const m = html.match(/\bchannel\s*=\s*"([A-Za-z0-9+/=]{8,})"/);
  if (!m) return null;
  try {
    const o = JSON.parse(b64decode(m[1]));
    return o && o.name ? String(o.name) : null;
  } catch (e) {
    return null;
  }
}

function parseTranscript(html) {
  // Format A — Ticket Tool (what this project is built for)
  const tt = parseTicketTool(html);
  if (tt && tt.length) return tt;

  const root = parse(html, { blockTextElements: { script: true, style: true } });
  const out = [];

  // Format B — modern discord-html-transcripts web components
  const dmsgs = root.querySelectorAll('discord-message');
  if (dmsgs.length) {
    const profiles = {};
    root.querySelectorAll('discord-message[profile][author], [data-profile][author]').forEach((p) => {
      const key = p.getAttribute('profile') || p.getAttribute('data-profile');
      if (key) profiles[key] = p.getAttribute('author');
    });

    let last = '';
    for (const el of dmsgs) {
      let author = el.getAttribute('author') || el.getAttribute('data-author') || '';
      const pref = el.getAttribute('profile') || el.getAttribute('data-profile');
      if (!author && pref && profiles[pref]) author = profiles[pref];
      if (!author) author = last; else last = author;

      el.querySelectorAll(
        'discord-embed,discord-attachment,discord-reaction,discord-reactions,discord-attachments,discord-command,discord-system-message,discord-invite'
      ).forEach((n) => n.remove());

      out.push({ author: String(author).trim(), authorId: '', bot: false, content: textOnly(el.text) });
    }
    return out;
  }

  // Format C — legacy chatlog template
  const groups = root.querySelectorAll('.chatlog__message-group');
  if (groups.length) {
    for (const g of groups) {
      const aEl = g.querySelector('.chatlog__author-name, .chatlog__author, span[title]');
      const author = aEl ? (aEl.getAttribute('title') || aEl.text) : '';
      const contents = g.querySelectorAll('.chatlog__content, .chatlog__markdown');
      for (const c of contents) {
        const cls = c.getAttribute('class') || '';
        if (cls.includes('chatlog__markdown') && c.closest('.chatlog__content')) continue;
        out.push({ author: String(author).trim(), authorId: '', bot: false, content: textOnly(c.text) });
      }
    }
    if (out.length) return out;
  }

  return out; // empty => unrecognised format
}

module.exports = { parseTranscript, ticketToolChannelName, textOnly };
