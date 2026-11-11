# Lumen repair notes

This archive contains a focused repair pass based on the supplied `lumen_fixed_final.zip`.

## Changes

- Reduced the generated progress PNG from 900x54 to 900x12 pixels so the visual track is a slim horizontal bar.
- Prevented progress-image URLs from using localhost. Discord is only given a progress image URL when `RENDER_EXTERNAL_URL` or `BOT_PUBLIC_URL` is configured with HTTPS; otherwise the progress card omits the image rather than showing an unreachable blank image placeholder.
- Hardened progress-image storage: validates PNG buffers and keys, resets the TTL on each update, and prevents an older expiry timer from deleting a newer update.
- Changed the account confirmation card to display the Sparx login identifier supplied during normal username/password login. Bookmarklet/cookie sessions use available username/email JWT claims when present. This is the authenticated login identifier, not an independently verified account handle returned by a dedicated Sparx username field.
- Corrected the Reader profile RPC request message name to `GetUserInfoRequest`.
- Added a bounded timeout to library loading and a native gRPC-Web fallback only when the established Python request bridge/network is unavailable. Explicit Sparx authentication/permission errors do not trigger the fallback.
- Improved request-bridge timeout/error diagnostics, including the underlying network error code when Node exposes one.
- Changed the Docker build from `npm ci` to `npm install` because this source archive does not contain a package-lock file; `npm ci` cannot run without one.

## Validation performed

- `node --check` passed for all JavaScript files in the project.
- Existing `npm test` passed: `Reader AI parser tests passed.`
- The progress renderer was exercised at 0, 10, 22, 50, 75, 85, 94 and 100 percent. Every output had a valid PNG signature and dimensions of 900x12.
- ZIP integrity is checked when the release archive is created.

## Not verified in this environment

- Live Sparx username/password authentication.
- Live Sparx JWT exchange and actual book-library retrieval.
- Discord's external image fetch/rendering against the deployed Render service.
- Full Docker image build/deployment and live Playwright browser launch.

For inline progress images, configure `RENDER_EXTERNAL_URL` or `BOT_PUBLIC_URL` as the publicly reachable HTTPS origin of the running web server. Do not put credentials in either variable.
