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
| `/scan` | **Read every transcript in the watched channels** — full history, no uploading |
| `/syncstaff` | **Rebuild the staff list from Discord roles**, tagged with each highest rank |
| `/sync file:` *(or)* `url:` | Count a single transcript |
| `/staff add name: [user:]` | Manually add someone to the counted staff list |
| `/staff remove name:` | Remove someone |
| `/staff list` | Show who's being counted, sorted by rank |

`/staff` requires the **Manage Server** permission.

---

## Fully automatic mode

With `TRANSCRIPT_CHANNEL_ID` and `STAFF_ROLES` filled in, you never touch a file:

1. **Staff build themselves.** On every startup (and on `/syncstaff`), the bot reads
   your server's members, finds everyone holding a role listed in `STAFF_ROLES`, and
   adds them with their **highest** rank. Someone with both `Admin` and `Senior Admin`
   is recorded as *Senior Admin*, because it comes first in the list. Promote someone
   in Discord and their rank updates on the next sync — no manual editing.
2. **Every transcript gets read.** Set `SCAN_ON_STARTUP=true` and the bot sweeps the
   entire history of every watched channel when it boots, counting everything that's
   ever been posted. You can also trigger this any time with `/scan`.
3. **New tickets count live.** Any transcript posted from then on is counted the moment
   it lands (the bot reacts ✅).

Transcripts are fingerprinted, so scanning repeatedly never double-counts.

---

## Setup

**1. Create the application + bot**
1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Open the **Bot** tab → **Reset Token** → copy the token.
3. On the same Bot tab, under **Privileged Gateway Intents**, turn **ON** both:
   - **Message Content Intent** — so the bot can read the transcripts Ticket Tool posts.
   - **Server Members Intent** — so it can read members' roles to build the staff list.
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
`TRANSCRIPT_CHANNEL_ID`. To watch **several** transcript channels, list their IDs
separated by commas (e.g. `TRANSCRIPT_CHANNEL_ID=111...,222...,333...`). See the
comments in `.env.example`.

**4. Install + run** (Node.js 18 or newer)
```bash
npm install
npm start
```
You should see `Logged in as ...` and `Registered guild commands`.

**5. Go**
Nothing to add by hand. On startup the bot builds the staff list from your roles and
(with `SCAN_ON_STARTUP=true`) reads every transcript already in the channels. Check the
result with `/staff list` and `/tickets`.

If a rank looks wrong or someone's missing, your role names probably differ from the
defaults — set `STAFF_ROLES` in `.env` to your exact role names (highest first) and run
`/syncstaff`. Use `/staff add` only for people who have no Discord role.

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
