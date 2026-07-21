# Empire Roleplay — Ticket Counter (Discord bot)

Auto-counts staff tickets from **Ticket Tool** transcripts, using the exact same
rule as the web portal:

> A **quality reply** is a staff message with **15+ characters** of real text.
> A staff member with **3+ quality replies** in one transcript is credited with **1 ticket handled**.

Two ways to feed it transcripts:

- **Automatic** — point it at the channel where Ticket Tool posts transcripts. Every
  `.html` transcript that lands there is counted automatically (bot reacts ✅).
- **Manual** — run `/sync` and attach a transcript `.html` file (or paste its URL).

---

## Commands

| Command | What it does |
| --- | --- |
| `/tickets` | Show the ticket leaderboard |
| `/tickets staff:@user` | Show one person's count |
| `/sync file:` *(or)* `url:` | Count a single transcript |
| `/staff add name: [user:]` | Add someone to the counted staff list |
| `/staff remove name:` | Remove someone |
| `/staff list` | Show who's being counted |

`/staff` requires the **Manage Server** permission.

---

## Setup

**1. Create the application + bot**
1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Open the **Bot** tab → **Reset Token** → copy the token.
3. On the same Bot tab, turn **ON** the **Message Content Intent** (required so the
   bot can read the transcript attachment Ticket Tool posts).
4. From **General Information**, copy the **Application ID**.

**2. Invite the bot to your server**
Under **OAuth2 → URL Generator**, tick `bot` and `applications.commands`, plus these
bot permissions: *Read Messages/View Channels, Send Messages, Add Reactions, Read
Message History*. Open the generated URL and add it to your server.

**3. Configure**
```bash
cp .env.example .env
```
Fill in `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, and (for automatic mode)
`TRANSCRIPT_CHANNEL_ID`. See the comments in `.env.example`.

**4. Install + run** (Node.js 18 or newer)
```bash
npm install
npm start
```
You should see `Logged in as ...` and `Registered guild commands`.

**5. Add your staff and go**
In Discord: `/staff add name: Ace` for each staff member (names as they appear in the
transcript). Then either post a transcript in the watched channel, or run `/sync`.

---

## Hosting it 24/7

This is a normal Node process, so any of these work:

- **Railway / Render / Fly.io** — connect the repo, set the `.env` values as
  environment variables, start command `npm start`.
- **A VPS** — run under `pm2`: `npm i -g pm2 && pm2 start index.js --name ticket-counter`.
- **Replit** — import, add the env vars as Secrets, run.

Data (staff list + processed transcripts) is stored in `data/db.json`. On hosts with
ephemeral disks, attach a volume or the counts reset on redeploy.

---

## Notes

- **De-duplication:** each transcript is fingerprinted, so re-posting or re-syncing the
  same one won't double-count. (Bot reacts ♻️ if it's already been counted.)
- **Hosted transcript links** (`tickettool.xyz/...`) are rendered with JavaScript, so
  fetching the URL may not return the messages. Attaching the `.html` file to `/sync`,
  or letting the bot read the file Ticket Tool posts, is the reliable path.
- The parser handles both Ticket Tool export formats (modern `discord-html-transcripts`
  web components and the legacy `chatlog__` template). If a transcript reads as
  "unreadable" (⚠️), send a sample so the selectors in `lib/parser.js` can be tuned.
- The counting rule lives in `lib/counter.js` (`QUALITY_MIN_CHARS`, `TICKET_MIN_REPLIES`)
  and is identical to the web portal, so both always agree.
