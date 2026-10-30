# PredBot Setup

## 1 — Install
```
npm install
```

## 2 — Config
Copy `.env.example` → `.env` and fill in:

| Key | Where to get it |
|-----|----------------|
| `DISCORD_TOKEN` | discord.com/developers → your app → Bot → Token |
| `DISCORD_CLIENT_ID` | discord.com/developers → your app → General Info → Application ID |
| `GEMINI_API_KEY` | aistudio.google.com → Get API Key |

Load env before running:
```
# Windows
set DISCORD_TOKEN=xxx && set DISCORD_CLIENT_ID=xxx && set GEMINI_API_KEY=xxx && node bot.js

# Linux/Mac
DISCORD_TOKEN=xxx DISCORD_CLIENT_ID=xxx GEMINI_API_KEY=xxx node bot.js
```
Or use a `.env` loader — add `require('dotenv').config()` top of bot.js + `npm install dotenv`.

## 3 — Bot permissions needed
In Discord Developer Portal → OAuth2 → URL Generator:
- Scopes: `bot`, `applications.commands`
- Permissions: `Send Messages`, `Read Message History`, `Read Messages/View Channels`
- Also enable **Message Content Intent** and **Server Members Intent** under Bot → Privileged Gateway Intents

## 4 — Run
```
node bot.js
```

## 5 — Use
1. Invite bot to your server
2. In any channel: `/pred` — bot posts the bait message
3. When someone DMs the bot, session starts automatically
4. After 10–15 min, session closes — full transcript sent to report channel + appears in panel
5. Panel: `http://localhost:3000` — click **Reveal** on any report to see all messages + user ID

## Notes
- Slash commands register globally on first boot — can take up to 1hr to propagate (usually instant)
- pfps folder has 100 images — bot picks one randomly per session
- Panel auto-refreshes every 20 seconds
- Report channel ID is hardcoded: `1363240484818128926`
