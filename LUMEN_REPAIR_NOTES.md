# Phantom repair notes — follow-up fixes

## Changes in this build

### Sparx Reader library request
- Corrected the protobuf request type used for `GetUserInfo` to `GetUserInfoRequest`.
- Registered the generated `GetUserInfoRequest` and `ListLibraryBooksRequest` message classes in the Reader codec map.
- Corrected `ListLibraryBooks` calls to encode `ListLibraryBooksRequest` with the authenticated Sparx `userId` instead of encoding an unrelated user-display-data request.
- Populate the Reader `studentUserId` from the authenticated JWT `sub` claim when it is in the canonical `users/<id>` form, and refresh it from the profile response when available.
- Pass the same user ID to the native gRPC-Web fallback.
- Treat HTTP 403 as a permanent permission/request failure instead of wasting retries; the error now explains that Sparx denied the Reader resource request.

### Login identity
- The normal login modal continues to submit the Sparx username entered by the user. It does not substitute the Discord username.
- The Reader requesticator receives the normal login context for its existing re-authentication path.
- The confirmed Sparx username is displayed from the profile/JWT where available, with the submitted Sparx login identifier as a fallback. Passwords and tokens are not displayed.

### Progress display
- Replaced the remotely hosted PNG/MediaGallery progress image with a compact text-only bar made from Unicode blocks.
- Removed the repeated cache-busted image URL updates that caused visible image reloads and oversized blank MediaGallery placeholders.
- Progress updates now come from actual login milestones reported by the Playwright login routine rather than a timer that artificially advanced percentages.
- Cookie login uses the same compact text-only progress display.

## Validation performed
- JavaScript syntax checks passed for all modified files.
- Reader codec test confirmed `GetUserInfoRequest` encodes as an empty protobuf request and `ListLibraryBooksRequest` encodes the `user_id` field correctly.
- Existing `npm test` passed (`Reader AI parser tests passed`).

## Not verified here
- Live Sparx username/password authentication.
- Whether the Sparx account is entitled to the Reader library endpoint.
- Live `ListLibraryBooks` response and actual book parsing.
- Discord rendering on the user's VR client.
- Render deployment/runtime behaviour.

A real Sparx account test is still required to confirm that the corrected request identity resolves the reported HTTP 403. If Sparx continues returning 403, inspect the sanitized HTTP/gRPC response and account entitlement; do not suppress the error or treat it as an empty library.
