# Maths + Login fix (2026-10-11)

Reader was already working. Maths and the shared login path were broken.

## Root causes

1. **Cookies never reached the HTTP client**  
   `requesticatorBasic.js` did `super(authToken)`. The parent `curlRequesticator` expects a **cookie string**, so the auth token was parsed as cookies and the real `spxlrn_session` / `live_ssoprovider_session` jar was empty. Maths endpoints require those cookies; Reader happened to tolerate token-only on more of its routes.

2. **Login cookie capture was fragile**  
   After submit it waited 1.5s, only kept two cookie names, and force-killed the browser at 40s. SSO flows often need longer and more cookies before `/token` will exchange.

3. **Token exchange was single-path**  
   One URL, one header set, weak parsing when the body was JSON.

4. **Maths session header**  
   After `ClientSession`, if `x-session-id` had been filtered out, it was never re-added (only mapped). Empty session → trailer-only PackageData responses.

## Fixes

| File | Change |
|------|--------|
| `autocompleters/sparx/requesticatorBasic.js` | Constructor now takes `(authToken, cookies)`. Adds `setAuthToken` / `setCookies`. |
| `autocompleters/sparx/requesticator.js` | Passes cookies into the requesticator; reauth updates token **and** cookies on the client. |
| `autocompleters/sparx/login.js` | Wait for landing URL (up to 28s), 90s force-kill, full Sparx cookie jar, multi-selector normal login, retry token exchange. |
| `autocompleters/sparx/getTokenRequest.js` | Tries `/token` and `/oauth2/token` with app + maths origins; normalises JSON/string bodies. |
| `autocompleters/sparx/children/maths/requesticator.js` | Forces maths origin/referer + cookie sync; always writes `x-session-id` after ClientSession; `ListStudentPackages` fallback if legacy `GetPackageData` fails. |

## Deploy

1. Replace the project with this zip (or pull these files).
2. Restart the Python curl_cffi microservice and the Node bot.
3. Re-login once (old sessions may lack cookies on the client side).
4. Run Maths compulsory as usual.

Reader paths were not changed beyond sharing the fixed base requesticator.
