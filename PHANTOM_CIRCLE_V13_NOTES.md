# Phantom Circle v13 — UI and chatbot pass

## Included
- Added the supplied animated Phantom Circle logo to the web dashboard assets.
- Rebranded the web dashboard header and added a persistent top-right logo.
- Refreshed the web dashboard with a premium dark violet/white theme, clearer cards,
  navigation, status badges, progress bars, and responsive logo sizing.
- Hardened chatbot settings against malformed values and added bounded opt-out handling.
- Added one bounded retry for transient Gemini failures after the existing model fallback.
- Isolated image-solver errors so they do not prevent chatbot message handling.
- Added focused chatbot service tests.

## Important
- This pass does not claim every Discord interaction in the entire bot has been visually redesigned.
  Discord has many independent command/handler UIs; those require individual review.
- The logo is applied to the web dashboard's persistent top-right header. Discord dashboard
  message branding still uses its existing thumbnail and has not been globally rewritten.
- Gemini still requires a valid GEMINI_API_KEY and a model available to the Google project.
