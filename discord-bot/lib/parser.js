// =====================================================
//  Transcript parser (Node) — mirrors parseTranscript()
//  in the web portal. Handles the two Ticket Tool export
//  formats: modern discord-html-transcripts web components,
//  and the legacy DiscordChatExporter (chatlog__) template.
// =====================================================

const { parse } = require('node-html-parser');

function clean(t) {
  return String(t || '').replace(/\s+/g, ' ').trim();
}

function parseTranscript(html) {
  const root = parse(html, { blockTextElements: { script: true, style: true } });
  const out = [];

  // ---- Format A: modern web components ----
  const dmsgs = root.querySelectorAll('discord-message');
  if (dmsgs.length) {
    const profiles = {};
    root.querySelectorAll('discord-message[profile][author], [data-profile][author]').forEach((p) => {
      const key = p.getAttribute('profile') || p.getAttribute('data-profile');
      if (key) profiles[key] = p.getAttribute('author');
    });
    root.querySelectorAll('script').forEach((s) => {
      const m = (s.text || '').match(/"profiles"\s*:\s*(\{[\s\S]*?\})\s*[,}]/);
      if (m) {
        try {
          const obj = JSON.parse(m[1]);
          for (const k in obj) if (obj[k] && obj[k].author) profiles[k] = obj[k].author;
        } catch (e) { /* ignore */ }
      }
    });

    let last = '';
    for (const el of dmsgs) {
      let author = el.getAttribute('author') || el.getAttribute('data-author') || '';
      const pref = el.getAttribute('profile') || el.getAttribute('data-profile');
      if (!author && pref && profiles[pref]) author = profiles[pref];
      if (!author) author = last; else last = author;

      // drop non-text children so only typed text counts toward the quality rule
      el.querySelectorAll(
        'discord-embed,discord-attachment,discord-reaction,discord-reactions,discord-attachments,discord-command,discord-system-message,discord-invite'
      ).forEach((n) => n.remove());

      out.push({ author: String(author).trim(), content: clean(el.text) });
    }
    return out;
  }

  // ---- Format B: legacy chatlog ----
  const groups = root.querySelectorAll('.chatlog__message-group');
  if (groups.length) {
    for (const g of groups) {
      const aEl = g.querySelector('.chatlog__author-name, .chatlog__author, span[title]');
      const author = aEl ? (aEl.getAttribute('title') || aEl.text) : '';
      const contents = g.querySelectorAll('.chatlog__content, .chatlog__markdown');
      for (const c of contents) {
        const cls = c.getAttribute('class') || '';
        if (cls.includes('chatlog__markdown') && c.closest('.chatlog__content')) continue;
        out.push({ author: String(author).trim(), content: clean(c.text) });
      }
    }
    if (out.length) return out;
  }

  return out; // empty => unrecognised format
}

module.exports = { parseTranscript };
