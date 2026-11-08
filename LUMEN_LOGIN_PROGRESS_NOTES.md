# Lumen login and progress update

## Included
- Normal Sparx login modal (school, username/email, password) using the project's existing `autocompleters/sparx/login.js` Playwright login implementation.
- Discord progress display with a 0–100% bar and changing connection stages. The progress is an animated estimate during the existing login operation, not a server-reported percentage.
- Existing bookmarklet and cookie login routes remain available.
- Existing dashboard, saved-account handler, queue, settings, and Reader book selection code are preserved.
- `database/saved_accounts.js` now handles missing rows safely, uses valid Supabase update payloads, checks affected rows, and retains the existing AES-256-GCM format for compatibility.

## Notes
- This normal login path uses the repository's current generic Sparx login routine and then builds the Reader requesticator. The existing dashboard's book-loading and task execution remain Reader-oriented.
- The password is not logged or saved by this new modal flow. Do not add credential logging.
- Run `npm install` and deploy with the same environment variables and Supabase schema as the existing bot.
