# Lumen v10 implementation notes

## Implemented
- Added owner-only Request Jailbreak dashboard page and home/sidebar entry.
- Backend checks Discord OAuth session user ID against `JAILBREAK_OWNER_ID` (default `1363240484818128926`).
- Added model catalogue for Gemini, Grok and Claude; it discovers account-visible models through provider model-list APIs when provider keys are configured, and uses a curated fallback catalogue otherwise.
- Gemini generates a target-model-specific prompt; API key remains server-side.
- Added copy action and temporary in-memory `.txt` downloads with random tokens, owner scoping, expiry and cleanup.
- Added input validation, per-owner rate limiting, timeout handling and clear API-key errors.
- Added disabled Bookmarklet (Soon) placeholder.
- Reworked the shared Discord progress bar to use the nine exact named emoji IDs loaded by the existing login flow, with a Unicode fallback until all emoji IDs are available.
- Added progress-bar boundary tests for 0%, 1%, 49%, 50%, 51%, 99%, 100%, and out-of-range inputs.
- Fixed Discord OAuth state handling: the generated state is now included in the authorization URL.

## Important limits / not claimed as verified
- Sparx Reader live authentication and the reported HTTP 403 cannot be confirmed without a real Sparx account/session and deployed environment. The existing Reader requesticator already sets the Reader origin/referer and forwards the supplied cookie string; this archive does not claim that the live 403 is resolved.
- Render deployment and a real Playwright browser launch were not run from this packaging environment. The existing Dockerfile installs Chromium and the Render README documents the matching `PLAYWRIGHT_BROWSERS_PATH=0` setting.
- Gemini API generation requires a valid `GEMINI_API_KEY` at runtime.
- Provider model catalogues change. Gemini discovery uses the configured Gemini key; optional `XAI_API_KEY` and `ANTHROPIC_API_KEY` enable account-specific Grok and Claude discovery. Without those keys, the picker uses curated fallbacks.

## Model catalogue reference pages checked during implementation
- Google Gemini API model list: https://ai.google.dev/gemini-api/docs/models
- Anthropic Claude model deprecations/current model status: https://docs.anthropic.com/en/docs/about-claude/model-deprecations
- xAI model list and Grok 4.7 API identifier: https://docs.x.ai/developers/models
