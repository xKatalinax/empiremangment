# Empire Roleplay — Ticket Counter (Discord bot)

Auto-counts staff tickets from **Ticket Tool** transcripts, using the exact same
rule as the web portal:

> A **quality reply** is a staff message of **two or more words** (mentions,
> emoji, links and code blocks are stripped first, and at least one word must
> contain a letter).
> A staff member with **1+ quality reply** in one transcript is credited with
> **1 ticket handled** — so every ticket a staffer says two or more words in
> counts once for them. This is a pure word-count rule: no helpfulness or
> filler filtering.

Two ways to feed it transcripts:

- **Automatic** — point it at the channel where Ticket Tool posts transcripts. Every
  `.html` transcript that lands there is counted automatically (bot reacts ✅).
- **Manual** — run `/sync` and attach a transcript `.html` file (or paste its URL).

---

## Commands

| Command | What it does |
| --- | --- |
| `/tickets` | Leaderboard — every staff member with their weekly count and all-time count listed separately |
| `/tickets weeksago:3` | The same board for a past week |
| `/weeks` | Week-by-week history — what every week counted |
| `/weeks staff:@user` | One person's week-by-week counts |
| `/tickets period:All time` | Every ticket ever counted |
| `/tickets staff:@user` | Show one person's week + all-time count |
| `/scan` | **Read every transcript in the watched channels** — full history, no uploading |
| `/syncstaff` | **Rebuild the staff list from Discord roles**, tagged with each highest rank |
| `/sync file:` *(or)* `url:` | Count a single transcript |
| `/staff add name: [user:]` | Manually add someone to the counted staff list |
| `/staff remove name:` | Remove someone |
| `/staff list` | Show who's being counted, sorted by rank |
| `/publish` | Push counts to the website right now |
| `/export` | Download counts as a file (backup if auto-publish is off) |
| `/diagnose` | Inspect one transcript if something can't be read |

`/staff` requires the **Manage Server** permission.

---

## Weekly counts

The week runs **Friday 12:00 AM (midnight) to the following Friday 12:00 AM**, on the dot.
A ticket is filed by the time of the last message in its transcript, so a ticket closed at
11:59 PM Thursday belongs to the outgoing week and one at 12:00 AM Friday starts the new one.

Every staff member carries **two separate counts**: how many tickets they handled this
week, and how many they have handled in total. Both are always shown together — the
`period` option on `/tickets` and the **This week / All time** toggle on the website only
change which column the list is *sorted* by, never which numbers appear.

Because the two are merged rather than filtered, someone who handled nothing this week
still appears with their all-time total instead of dropping off the board. Nothing is
deleted at rollover — the weekly column resets, the all-time column keeps growing.

`/tickets staff:@someone` gives one person's two numbers on their own.

### Going back to a past week

Nothing is thrown away at rollover. Every transcript keeps the timestamp of its
last message, so any past week can be re-tallied over its own Friday-to-Friday
window — which means a closed week always reports the same figure, whenever you
ask for it.

* `/weeks` lists recent weeks with the total and the top handler for each.
* `/weeks count:26` goes back further (up to 52).
* `/weeks staff:@someone` shows one person's count for each week.
* `/tickets weeksago:1` opens last week's full leaderboard, `weeksago:2` the one
  before, and so on.

On the website, the Ticket Tracker has a **Weekly history** panel listing every
archived week with its total, how many staff were credited and who topped it.
**Open** on any row loads that week into the main table, and the `‹ ›` arrows next
to the period buttons step between weeks. Closed weeks are marked as such, and the
current one is tagged *in progress*.

The bot publishes the last `EXPORT_HISTORY_WEEKS` weeks (26 by default, set near
the top of the export section in `index.js`) into `empire-tickets.json`, so the
site can show history without the bot being reachable.

Timing uses the clock of the machine running the bot. If you host it in another timezone,
set `WEEK_TZ_OFFSET` in `.env` to the hours from UTC you want the reset judged in
(US Eastern is `-5` in winter, `-4` in summer). To move the rollover off midnight, set
`WEEK_RESET_HOUR` (`0` = midnight, `12` = midday).

`assets/app.js` has matching `WEEK_RESET_HOUR` and `WEEK_TZ_OFFSET` constants at the top.
**Keep them in step with the bot.** The website falls back to the viewer's own browser
clock when `WEEK_TZ_OFFSET` is `null`, so if the bot is hosted in UTC and your staff are in
Eastern, the two will disagree about where the week ends by several hours. Setting the same
fixed offset on both sides removes the ambiguity entirely.

---

## Syncing to the Empire website

The portal is a static GitHub Pages site, so there's no server to POST to. Instead the
bot **commits the counts into the site's repo**; GitHub Pages serves that file and the
Ticket Tracker page fetches it on load. Once set up, the website updates itself.

### One-time setup

1. Create a token at <https://github.com/settings/personal-access-tokens/new>
   - **Repository access:** Only select repositories -> your website repo
   - **Permissions:** Repository permissions -> **Contents** -> **Read and write**
2. Put it in `.env`:
   ```
   GITHUB_TOKEN=github_pat_...
   GITHUB_REPO=xKatalinax/empiremangment
   GITHUB_BRANCH=main
   GITHUB_PATH=data/tickets.json
   ```
3. Restart the bot, then run `/publish` once to confirm. It should say the website was
   updated; give GitHub Pages a minute to rebuild, then load the Ticket Tracker page.

### When it publishes

- after the startup history scan
- after `/scan` and `/syncstaff`
- about 20 seconds after a new ticket is counted (batched, so a busy hour is one commit)
- any time you run `/publish`

Keep the token secret — `.gitignore` already excludes `.env`. If it ever leaks, delete it
on GitHub and generate a new one.

### If you'd rather not use a token

Auto-publish is optional. Without it, use `/export` in Discord and drop the file into
**Ticket Tracker -> Manual import** on the website.

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

> **Updating the bot later?** Your `.env` is not included in the download. Copy your
> existing `.env` somewhere safe before replacing the `discord-bot` folder, then put it
> back — otherwise you'll have to re-enter your token and IDs.

**Check your settings** (catches typos without printing your secrets):
```bash
npm run checkenv
```

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

- **Transcript format.** Ticket Tool transcripts contain no readable HTML — the messages
  are a base64-encoded JSON array inside a `messages` variable, which their web viewer
  decodes in the browser. The parser in `lib/parser.js` decodes that same payload, so it
  reads the file directly without needing a browser. Older `discord-html-transcripts` and
  `chatlog__` exports are still handled as fallbacks.
- **Staff matching is by Discord user ID.** Every message in a Ticket Tool transcript
  carries `user_id`, so `/syncstaff` (which stores each member's ID) gives exact matching —
  nicknames, renames and display-name changes don't break it. If a staff member was added
  by name only, it falls back to name matching.
- **Bot messages never count.** Ticket Tool's own posts are flagged `bot: true` and are
  skipped, so its welcome and closing messages can't earn credit.
- **Word rule ignores noise.** Mentions, custom emoji, code blocks and links are stripped
  before the two-word check, so "<@123> ok" is one word after stripping and doesn't count as a quality reply.
- **De-duplication:** each transcript is fingerprinted, so re-posting or re-scanning the
  same one won't double-count. (Bot reacts ♻️ if it's already been counted.)
- **Links as well as files.** A `tickettool.xyz/transcript/v1/...` link is just a viewer
  around the file Discord stores; the bot converts it to the underlying CDN URL, so
  transcripts posted as links are counted too. (`/v2/` Google-Drive links are not supported.)
- **Diagnostics.** If anything can't be read, run `/diagnose` in Discord, or
  `npm run diagnose` locally against `data/sample-transcript.html`.
- The counting rule lives in `lib/counter.js` (`QUALITY_MIN_WORDS`, `TICKET_MIN_REPLIES`)
  and is identical to the web portal, so both always agree.

---

## What counts as a reply

A staff message counts as a **quality reply** when it is **two or more words**
long. That is the whole rule.

* Mentions, custom emoji, links and code blocks are stripped out first
  (see `textOnly()` in `lib/parser.js`), so they can't pad the count — `<@123> ok`
  is one word after stripping and does **not** count.
* At least one of the surviving words has to contain a letter, so pure symbols
  or numbers like `?? !!` or `123 456` don't slip through as speech.
* There is **no** helpfulness, filler or question filtering. If two or more real
  words were said, the reply counts.

A staffer credited with **1+ quality reply** in a transcript earns **1 ticket**
for it, so every ticket they say two or more words in counts once.

These count:

> i refunded it · press F to interact · your whitelist is approved · is this gtc?

These do not (fewer than two words, or no letters):

> ok · ty · 👍 · `<@123>` · 45min · ??

Tuning knobs, all at the top of `discord-bot/lib/counter.js` (mirror any change
in `assets/app.js`):

| Constant | Default | Effect |
| --- | --- | --- |
| `QUALITY_MIN_WORDS` | `2` | Minimum words a reply must have (two words or more said) |
| `TICKET_MIN_REPLIES` | `1` | Quality replies needed in one transcript for 1 ticket |

The `HELPFUL_MIN_CONTENT_WORDS`, `QUESTION_MIN_CONTENT_WORDS`,
`SHORT_REPLY_MAX_WORDS`, `STOPWORDS`, `PLEASANTRIES`, `CHITCHAT`, `HELP_VERBS`,
`FORMULA_OPENERS` and `FILLER_PHRASES` values are left in the file for reference
but are **no longer used** by the current rule.

**After changing the rule, redo the counts** (see *Redoing all the ticket
counts* below). Stored records keep only reply tallies, not the original message
text, so old transcripts cannot be re-judged in place — they have to be read
again from the transcripts.

---

## Redoing all the ticket counts

A rule change only affects new transcripts until the old ones are read again,
because `db.json` stores per-transcript reply *tallies*, not the original text.
There are two ways to redo every count under the current rule:

- **From Discord (live bot):** run `/scan recount:True`. This wipes the stored
  tallies and re-reads every transcript channel from scratch. Use this if the
  bot is running and still has access to the transcript channels.

- **Offline, from a folder of saved transcripts:** run

  ```bash
  cd discord-bot
  node recount.js /path/to/your/transcripts
  ```

  It backs up `data/db.json`, wipes the tallies, re-reads every `.html`
  transcript in that folder (recursively), then regenerates
  `data/empire-tickets.json` and the website's `data/tickets.json`. The staff
  list is left untouched. If you omit the path it looks in
  `discord-bot/data/transcripts`.

Both paths use the exact same rule as the website, so the two never disagree.


---

## Deploying website changes

`assets/app.js` is cached hard by browsers and by the GitHub Pages CDN. If the site
still shows old columns or old numbers after an update, you are almost certainly
looking at a cached copy rather than a broken build.

Every page loads the script with a version string:

```html
<script src="assets/app.js?v=2026-07-24-5"></script>
```

**When you change `assets/app.js`, bump that `?v=` in every `.html` file and the
`APP_BUILD` constant at the top of `app.js` to the same value.** The new URL is
treated as a different file, so browsers fetch it instead of reusing the old one.

To check which build is live: open the site, press F12, and look at the Console tab.
It prints `Empire portal build <version>` on load. If that version is older than the
one in your files, the upload did not land or the cache has not cleared — hard-refresh
with Ctrl+Shift+R, and confirm `assets/app.js` itself was committed, not just the HTML.


---

## The leaderboard on the website

The per-staff board is built for one question: who handled what, and is that
going up or down.

* **Two figures per person** — the selected week and the all-time total, always
  side by side. The week figure carries a share bar so the spread is readable at
  a glance without reading every number.
* **Trend arrow** against the week before, e.g. `▲12` or `▼40`. Hover it for the
  previous week's actual count. It's hidden on the oldest week held, where
  there's nothing to compare against.
* **Search** filters by name or rank as you type.
* **Sortable columns** — click any header (or tab to it and press Enter) to sort
  by that column; click again to flip the direction. Sorting defaults to
  whichever period is selected.
* **Your own row is highlighted** and tagged *You*, so you don't have to hunt for
  yourself in a list of fifty.
* **Top three get position medals.** They're hidden while searching or custom
  sorting, since "3rd alphabetically" isn't a podium.
* **On phones the table becomes one card per person**, with each figure labelled,
  rather than a six-column table squeezed into 380px.
