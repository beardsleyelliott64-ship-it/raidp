# Sparx Reader gRPC-Web fix

This build fixes the Reader account-panel error where Sparx returned an HTML
response and the gRPC parser interpreted `!DOC` as a huge frame length.

Changes:
- curl_cffi uses a supported Chrome 145 fingerprint.
- Reader requests use `https://reader.sparx-learning.com/` as origin/referer.
- Browser headers are kept consistent with the impersonated fingerprint.
- gRPC frame errors now identify HTML responses clearly.
