const curlRequesticator = require('../../utils/curlRequesticator');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Exchange Sparx session cookies for an API auth token.
 * Tries the current /token endpoint and a couple of legacy shapes.
 */
async function getTokenRequest(cookies, attempts = 3) {
  const requesticator = new curlRequesticator(cookies);

  const headerSets = [
    [
      'accept: */*',
      'accept-language: en-GB,en;q=0.9',
      'content-type: application/json',
      'origin: https://app.sparx-learning.com',
      'referer: https://app.sparx-learning.com/'
    ],
    [
      'accept: */*',
      'accept-language: en-GB,en;q=0.9',
      'content-type: application/json',
      'origin: https://maths.sparx-learning.com',
      'referer: https://maths.sparx-learning.com/'
    ]
  ];

  const urls = [
    'https://api.sparx-learning.com/token',
    'https://api.sparx-learning.com/oauth2/token'
  ];

  let lastErr = null;

  for (const url of urls) {
    for (const headers of headerSets) {
      try {
        const response = await requesticator._executeCurl(url, headers);

        // Normalise whatever shape comes back into a bare token string
        if (response == null) continue;

        if (typeof response === 'string') {
          const trimmed = response.trim();
          // Sometimes the body is a JSON string
          if (trimmed.startsWith('{')) {
            try {
              const j = JSON.parse(trimmed);
              const t = j.access_token || j.token || j.authToken || j.id_token;
              if (t) return String(t).trim();
            } catch { /* fall through */ }
          }
          // Strip surrounding quotes if present
          return trimmed.replace(/^["']|["']$/g, '');
        }

        if (typeof response === 'object') {
          const t = response.access_token || response.token || response.authToken || response.id_token;
          if (t) return String(t).trim();
          // Some proxies wrap body
          if (response.body) {
            const inner = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
            return inner.trim().replace(/^["']|["']$/g, '');
          }
        }
      } catch (err) {
        lastErr = err;
      }
    }
  }

  if (attempts > 1) {
    await delay(1500);
    return getTokenRequest(cookies, attempts - 1);
  }

  if (lastErr) {
    return `Unauthorized: ${lastErr.message || lastErr}`;
  }
  return null;
}

module.exports = getTokenRequest;
