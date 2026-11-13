# Lumen V12 dashboard customizer — change log

## Updated
- Kept the existing Discord `/dashboard` implementation and web dashboard separate.
- Added a private owner control panel after the public dashboard is opened by the configured owner.
- Replaced the public customizer control with a disabled `Coming Soon` button.
- Added separate Custom Features and Custom People Requests sections.
- Added member feature-request submission, persistence, basic duplicate/rate limiting, and owner approve/reject controls.
- Changed generated feature publication to require an explicit owner Publish/Cancel decision.
- Added guild slash-command creation for published custom features and persisted command reconstruction at startup.
- Changed custom feature runtime sessions to be available to members, with each session bound to the member who opened it.
- Added persisted dashboard message coordinates and in-place dashboard refresh after publication.
- Expanded colour choices while mapping them honestly to Discord's four supported button styles.
- Reworked the shared progress bar to use the existing named Discord emoji IDs with a Unicode fallback.
- Aligned the Docker Playwright browser install path with runtime using `PLAYWRIGHT_BROWSERS_PATH=0`.
- Documented the supported declarative runtime and its current limitations.

## Explicitly not added
- Blackjack, Blackjack commands, Blackjack game logic, or Blackjack economy integration.
- Bookmarklet login remains a disabled “soon” option; existing login methods are retained.

## Important remaining work
- Full staged generation progress and estimated time remaining.
- A fully rendered interactive preview before publish.
- Automatic generation/preview from approved member requests.
- Live Sparx HTTP 403 verification with a real account/session.
- Live Discord command registration and end-to-end interaction testing with production credentials.

## 2026-11-13 — Dashboard controls and Gemini chatbot foundation
- Added owner-checked `/lumen-owner`, `/add-cdashboard`, and `/remove-cdashboard` commands.
- Added persisted public dashboard customisation state and refresh-in-place behaviour for the stored dashboard message.
- Public Customize Dashboard clicks now open the member suggestion modal; suggestions are stored and an owner DM notification is attempted.
- Added `/chatbot` chat/status/enable/disable/clear subcommands and a bounded, per-guild/channel/user automatic conversation handler with cooldowns and inactivity timeout.
- Added configurable Gemini model selection for chatbot, and a model discovery helper that checks Google's `generateContent` support against all 13 requested model IDs.
- Updated feature generation to use discovered model availability when the discovery endpoint is reachable and to stop fallback attempts on an explicit exhausted-quota response.
- Added regression coverage for the 13-model configuration.

Limitations: Gemini calls, Discord command registration, private owner DMs, live Sparx authentication/library access, and Render's installed Chromium could not be live-verified in this offline workspace. The owner panel is a working starter control surface, not yet the full feature lifecycle/model diagnostics console specified in the master brief.
