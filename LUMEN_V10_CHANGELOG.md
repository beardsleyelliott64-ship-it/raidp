# Lumen v10 development handoff

## Changes in this archive

- Added a Request Jailbreak entry to the existing Discord `/dashboard` Components V2 panel.
- The owner sees an enabled blue button; other users see a disabled grey `Coming Soon` button.
- Server-side checks use the authenticated Discord interaction user ID and the configured owner ID (default `1363240484818128926`).
- Added provider and target-model selection for Gemini, Grok, and Claude. Gemini is the generation engine; the selected target provider/model is supplied as generation context.
- Added a task modal, input validation, a 15-second generation throttle, a 45-second API timeout, bounded output, and a private text attachment that is deleted after the configured TTL.
- Added `JAILBREAK_OWNER_ID`, `JAILBREAK_GENERATOR_MODEL`, and `JAILBREAK_DOWNLOAD_TTL_SECONDS` to `.env.example`.
- Updated the shared progress-bar utility to render the nine named progress emojis loaded by the existing login flow, falling back to Unicode if any named emoji is unavailable.
- Preserved the existing disabled `Bookmarklet (Soon)` login option.

## Important limitations / not verified

- The target-model catalogue is a curated list of current text models, not a live exhaustive catalogue. Provider API availability and account entitlements are not queried. The catalogue should be refreshed against the providers' model APIs/docs before claiming complete coverage.
- Provider logos have not been added to the Discord selection UI. No substitute emoji artwork is used.
- Gemini generation requires `GEMINI_API_KEY` (or a key in `GEMINI_API_KEYS`) and has not been exercised with a real key in this environment.
- No live Discord interaction test was possible because this environment has no configured bot token or Discord connection.
- No live Sparx login/library test was performed. Existing Sparx code and its explicit HTTP 403 reporting were preserved; this archive does not claim to have resolved a live Sparx entitlement or access denial.
- The existing Playwright install step in the Dockerfile was inspected and retained. A production Render deployment was not run.

## Validation performed

- `node --check` passed for every JavaScript file in the project.
- `npm test` passed (`Reader AI parser tests passed`).
- The named progress-bar renderer was exercised at 0%, 1%, 10%, 25%, 49%, 50%, 51%, 75%, 90%, 99%, and 100%; each produced exactly 10 named emoji segments with synthetic IDs.
- The source archive passed `unzip -t` before editing. The generated v10 archive is separately checked during packaging.

## Model catalogue provenance

The initial model shortlist was checked against the published provider model references available during this build: Google Gemini API models, xAI model documentation, and Anthropic model documentation. IDs can change and availability varies by account.

## Gemini timeout fix
- Replaced the hard-coded 45-second `Promise.race` timeout with the `@google/genai` SDK's native HTTP timeout, which aborts the underlying request rather than leaving it running in the background.
- Default timeout is now 120 seconds and can be configured with `JAILBREAK_GEMINI_TIMEOUT_MS` (bounded to 60–240 seconds).
- Timeout errors now report the configured deadline and suggest checking API latency/model availability.
- Discord generation continues to defer its ephemeral reply before the API call, so the bot can wait for the longer generation window.
