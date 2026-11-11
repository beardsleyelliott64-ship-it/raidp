# EAMAI — Render setup

## Put these in Render > Environment

### Required
- `DISCORD_TOKEN` = your Discord bot token.
- `CLIENT_ID` = your Discord application ID.
- `GUILD_ID` = your Discord server ID. This can contain multiple IDs separated by commas.

The bot registers slash commands to those guilds after Discord login. If `GUILD_ID` is blank, it attempts to register to every guild the bot is currently in.

### Required only if you use database/account features
- `SUPABASEURL` = your Supabase project URL, normally `https://YOUR_PROJECT_ID.supabase.co`.
- `SUPABASEKEY` = your Supabase API key.

The database modules are lazy now, so missing Supabase variables will no longer stop the bot from starting or registering commands. Database-dependent commands will require these variables when used.

### Optional
- `RESOURCE_WEBHOOK_URL`
- `ERROR_WEBHOOK_URL`
- `LOGS_WEBHOOK_URL`
- `STARTUP_WEBHOOK_URL`
- `STATUS_CHANNEL_ID`
- `DOWN_CHANNEL_ID`
- `IMAGE_SOLVER_CHANNEL_ID`
- `BASE_ROLE_ID`

Do not paste your Discord token or Supabase secret key into GitHub. Add them only to Render's environment variables.


## Sparx Maths / Reader panel channels
The bot creates/updates the Sparx panel embeds in the channel IDs configured below. On Render, add these environment variables:

- `SPARX_MATHS_CHANNEL_ID` = the Discord channel ID for the Sparx Maths panel
- `SPARX_READER_CHANNEL_ID` = the Discord channel ID for the Sparx Reader panel
- `SPARX_SCIENCE_CHANNEL_ID` = optional Science panel channel
- `SENECA_CHANNEL_ID` = optional Seneca panel channel

To copy a channel ID in Discord, enable **Developer Mode** in Discord Settings > Advanced, then right-click the channel and choose **Copy Channel ID**.

## Admin command permissions
Commands that are not marked public can be run by:
1. A member with the Discord **Administrator** permission;
2. A member whose role ID is listed in `ADMIN_ROLE_IDS`; or
3. A member whose role ID is listed in `config.json` under `admin_roles`.

`ADMIN_ROLE_IDS` accepts multiple role IDs separated by commas.


## EAM diagnostic mode
Reader and Maths answers are submitted to Sparx. Auth and a live task are required for a real run.


## Playwright browser installation on Render

Use the same browser path during build and runtime so Playwright looks in the directory where Chromium was installed.

**Build command**
```bash
npm install && PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium
```

**Start command**
```bash
node launcher.js
```

Set `PLAYWRIGHT_BROWSERS_PATH` to `0` in the Render service environment as well if your build/start configuration does not inherit the build variable. The launcher defaults the bot child process to this path when the variable is absent.
