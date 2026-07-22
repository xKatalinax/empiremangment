// =====================================================
//  Publish counts to the website.
//
//  The Empire portal is a static site served by GitHub Pages, so there is no
//  server to POST to. Instead the bot commits a small JSON file into the repo;
//  GitHub Pages then serves it and the Ticket Tracker page fetches it on load.
//  That makes the website update itself with no manual export/import.
//
//  Needs a GitHub token with "Contents: read and write" on the site repo.
// =====================================================

const API = 'https://api.github.com';

function cfg() {
  return {
    token: process.env.GITHUB_TOKEN || '',
    repo: process.env.GITHUB_REPO || '',            // e.g. xKatalinax/empiremangment
    branch: process.env.GITHUB_BRANCH || 'main',
    path: process.env.GITHUB_PATH || 'data/tickets.json',
  };
}

function isConfigured() {
  const c = cfg();
  return Boolean(c.token && c.repo);
}

async function gh(url, options = {}) {
  const c = cfg();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'EmpireTicketCounter/1.0',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body };
}

// Current file SHA is required by GitHub to update (rather than create) a file.
async function currentSha() {
  const c = cfg();
  const r = await gh(`${API}/repos/${c.repo}/contents/${encodeURI(c.path)}?ref=${encodeURIComponent(c.branch)}`);
  if (r.ok && r.body && r.body.sha) return r.body.sha;
  return null; // 404 => file doesn't exist yet, that's fine
}

/**
 * Commit the payload to the site repo.
 * Returns { ok, skipped, url, error }
 */
async function publish(payload) {
  const c = cfg();
  if (!isConfigured()) return { ok: false, skipped: true, error: 'GITHUB_TOKEN / GITHUB_REPO not set' };

  const content = Buffer.from(JSON.stringify(payload, null, 2), 'utf8').toString('base64');

  let sha;
  try {
    sha = await currentSha();
  } catch (e) {
    return { ok: false, error: 'Could not reach GitHub: ' + e.message };
  }

  const r = await gh(`${API}/repos/${c.repo}/contents/${encodeURI(c.path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Update ticket counts (${payload.totalTickets} tickets, ${payload.staff.length} staff)`,
      content,
      branch: c.branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (r.ok) {
    return { ok: true, url: `https://github.com/${c.repo}/blob/${c.branch}/${c.path}` };
  }

  // Translate the usual failures into something actionable.
  let error = (r.body && r.body.message) || `HTTP ${r.status}`;
  if (r.status === 401) error = 'GitHub rejected the token (401). Check GITHUB_TOKEN.';
  if (r.status === 403) error = 'Token lacks permission (403). It needs "Contents: read and write" on the repo.';
  if (r.status === 404) error = `Repo or branch not found (404). Check GITHUB_REPO="${c.repo}" and GITHUB_BRANCH="${c.branch}".`;
  if (r.status === 409) error = 'Conflict (409) — another commit landed first. It will retry on the next publish.';
  return { ok: false, status: r.status, error };
}

module.exports = { publish, isConfigured, cfg };
