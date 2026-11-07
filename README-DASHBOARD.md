# Lumen Dashboard — `/dashboard` command

Adds a Lumen-style Reader bookmarklet login + autocomplete flow to the bot.

## Files

| File | Action |
|---|---|
| `commands/utility/dashboard.js` | Drop in — registers `/dashboard` |
| `handlers/readerBookmarkletFlow.js` | Drop in — all interaction + session logic |
| `web/dashboard.js` | **Replace** existing `web/dashboard.js` |
| `INDEX_JS_PATCH.md` | 2-line edit to `index.js` |

## Setup

1. Copy the three `.js` files into the right directories.
2. Apply the two-line patch from `INDEX_JS_PATCH.md` to `index.js`.
3. Set `BOT_PUBLIC_URL=https://YOUR-BOT.onrender.com` in your env  
   (Render sets `RENDER_EXTERNAL_URL` automatically — either works).
4. Run `node deployment.js` to register `/dashboard`.
5. Restart the bot.

## Flow

```
/dashboard
  └─ Start Task
       └─ Platform dropdown (Reader / Maths / Science)
            └─ Login method (Bookmarklet / Cookie)
                 ├─ Bookmarklet
                 │    ├─ Tutorial embed with  xjavascript:import('https://…/bm/{token}')
                 │    ├─ User saves bookmark, opens Sparx Reader, clicks it
                 │    ├─ Green "✓ Connected" appears on page
                 │    ├─ User presses Refresh in Discord
                 │    └─ Step 1 · Account verify → Library → Start → DM progress
                 └─ Cookie
                      └─ Paste cookie string → verify → Library → Start → DM progress
```

## Notes

- The bookmarklet token expires after **10 minutes**. If the user is slow, they hit
  Reset link to get a fresh one — it generates a new token without leaving the UI.
- The bookmarklet endpoint (`/bm/:token`) serves a cross-origin ES module with
  full CORS headers. The module runs in Sparx's page context, reads `document.cookie`,
  and POSTs it back. HttpOnly cookies are invisible by design — the two Sparx session
  cookies (`live_ssoprovider_session`, `spxlrn_session`) are **not** HttpOnly so this
  works without an extension.
- Settings (SRP, WPM, question time) are loaded from the existing Supabase `accounts`
  table on login and can be changed via the existing `/account` Settings menu.
- The autocomplete itself is wired directly to the existing
  `autocompleters/sparx/children/reader/autocomplete.js` — no duplication.
