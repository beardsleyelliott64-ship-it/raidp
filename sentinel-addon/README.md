# Sentinel AI — Railway-ready Discord security bot

A modular Discord.js v14 starter with anti-raid detection, anti-spam, moderation commands, security logs, a protection panel, moderator applications, and optional Gemini incident analysis.

**This is a starter implementation, not a guarantee of complete protection.** Test it in a private server first. Keep automatic lockdown disabled until you have checked channel permissions and behaviour.

## Included
- Anti-raid join-rate detection with optional lockdown
- Basic anti-spam and configurable timeout
- Slash commands for ban, kick, timeout, warn, purge, lock/unlock, protection status/panel
- Persistent settings, warnings, incidents, and applications in PostgreSQL
- Moderator application panel using a button and modal, with staff review buttons
- Optional Gemini analysis of selected security incidents
- Environment variables for all secrets and deployment-specific configuration
- Railway deployment configuration

## Railway setup
1. Create a new Railway project and deploy this repository/ZIP contents.
2. Add a **PostgreSQL** service to the Railway project.
3. In the bot service Variables, set:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DATABASE_URL` to the PostgreSQL service's connection string, usually via `${{Postgres.DATABASE_URL}}`
   - `GEMINI_API_KEY` (optional)
   - `GEMINI_MODEL` (optional; defaults to `gemini-2.5-flash`)
4. Add the remaining variables from `.env.example` as needed.
5. In the Discord Developer Portal, enable **Server Members Intent** and **Message Content Intent** under Bot → Privileged Gateway Intents. Invite the bot with `bot` and `applications.commands` scopes and the needed permissions.
6. Set `DISCORD_CLIENT_ID` to the application ID. For initial testing, set `DISCORD_GUILD_ID` to your test server ID. Run `npm run register` once (Railway service shell or locally with variables set) to register commands. Remove `DISCORD_GUILD_ID` for global commands after testing.
7. Deploy using `npm start`.

Railway runs `npm start` automatically. Never commit `.env`, tokens, or API keys.

## Important Discord permissions
Grant only what you use: View Channels, Send Messages, Embed Links, Read Message History, Moderate Members, Kick Members, Ban Members, Manage Messages, Manage Channels, and View Audit Log if needed. The bot's highest role must be above roles it moderates. Do not grant Administrator by default.

## Commands
- `/protect status`
- `/protect panel`
- `/protect configure` (set join threshold and optional auto-lockdown)
- `/protect lockdown`
- `/protect unlock`
- `/mod-papps panel`
- `/mod-papps open`
- `/mod-papps close`
- `/mod-papps pending`
- `/mod-papps review`
- `/moderation ban`
- `/moderation kick`
- `/moderation timeout`
- `/moderation warn`
- `/moderation warnings`
- `/moderation purge`
- `/moderation lock`
- `/moderation unlock`
- `/security incident`

## Environment variables
See `.env.example`. All credentials are environment variables. Optional IDs can be left blank. `AUTO_LOCKDOWN=false` by default; enable only after testing.

## How the AI works
Gemini is used for **analysis and recommendations**, not as the authority that directly executes arbitrary actions. Rule-based checks detect join spikes and spam; the bot can send a compact incident summary to Gemini. API errors do not disable rule-based protection. Message contents are not sent to Gemini by default; `AI_MESSAGE_REVIEW` is reserved for future extension and defaults to false.

## Limitations / next steps
- Anti-nuke detection is not fully implemented in this starter; audit-log correlation needs careful testing and safeguards.
- Lockdown locks text channels by denying `SendMessages` to `@everyone`; it stores previous permission state for the current process only. For production, persist every overwrite before applying lockdown and verify permissions for every channel.
- Discord interactions and permissions can change; review the current Discord API docs before public launch.
- Do not auto-ban users solely from an AI score. Use evidence, deterministic thresholds, and staff review.
