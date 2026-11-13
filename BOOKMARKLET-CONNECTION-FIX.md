# Bookmarklet connection fix

## Root cause

The bookmarklet URL used `javascript:import(...)` to load an ES module from the Render host. That module then called `https://api.sparx-learning.com/token`. Because the request was initiated by a module hosted on Render, the browser treated it as a cross-origin request from the Render origin, not as a request initiated by the Sparx Reader page. Sparx may reject that CORS origin, so the module silently swallowed the fetch error, posted an empty token, and showed only a generic connection failure.

The old script also sent `document.cookie` to the bot as a fallback. That is not a reliable way to obtain Sparx's session: cookies may be HttpOnly, scoped to another host, or otherwise unavailable to page JavaScript.

## Fix

- The bookmarklet now injects `/bm/:token` as a classic script element into the current Sparx page instead of using dynamic `import()`.
- The classic script requests the Sparx token with `credentials: 'include'`, so the browser can attach the existing Sparx session cookies under the page's same-site context.
- It validates that Sparx returned a three-segment JWT before handing it to the Render endpoint.
- It sends only the JWT needed by the bot; it no longer reads or forwards `document.cookie`.
- It reports the actual HTTP/token failure in the on-page message rather than silently swallowing it.
- The generated script is no longer an ES module and no longer contains `export {}`.

## Validation

- `node --check` passed for every JavaScript file in the archive.
- Existing `node test/reader_ai.test.js` passed.
- The live dashboard route returned HTTP 200 and the generated bookmarklet JavaScript passed `node --check`.

The Sparx token endpoint's live CORS behavior cannot be confirmed without a real signed-in browser session. After redeploying, if the page reports a CORS/network error, inspect the browser console for the exact response from `api.sparx-learning.com/token`.

## Follow-up fix: native HTTP 403 and missing account name

The previous build attempted profile and library calls with a separate Node `fetch`
implementation. That transport was returning HTTP 403. The flow now uses the
Reader requesticator already used by the application for both `GetUserInfo` and
`ListLibraryBooks`, preserving its existing gRPC-Web framing, generated protobuf
code, authorization header and Reader-origin headers. The old error handler also
masked the fallback error; it now reports the actual requesticator failure.

The JWT claim values remain a fallback for display-name fields only. No token,
cookie, or profile data is logged.
