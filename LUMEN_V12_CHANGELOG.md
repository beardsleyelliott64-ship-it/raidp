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
