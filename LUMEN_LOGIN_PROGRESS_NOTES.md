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

## Follow-up hardening (2026-11-11)
- Imported the Discord.js `FileBuilder` used by the Components V2 progress card.
- Restored real line breaks in the progress card text.
- Fixed normal-login field selection so the legacy two-field `.sm-input` form maps username to the first field and password to the second; it no longer risks filling both credentials into one field.
- Updated Playwright selector handling to choose visible matching fields/buttons instead of blindly choosing the first DOM match.
- Increased the browser safety timeout to 90 seconds to allow redirects and session-cookie creation to complete.
- Explicitly removes the temporary progress PNG attachment when the login flow finishes or fails.
- Verified JavaScript syntax across the project, ran `npm test` successfully, and decoded generated progress PNGs at 0%, 1%, 35%, 70%, and 100% (900×54).
- A live Sparx sign-in was not performed in this environment; verify with a real school/account after deployment. MFA/CAPTCHA challenges are reported rather than bypassed.
