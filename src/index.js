// language: Node.js, file: src/index.js
// server binds first — Railway needs the port up before marking healthy
require('dotenv').config();
const { startServer } = require('./server');
const { startBot }   = require('./bot');
const https = require('https');
const http  = require('http');

(async () => {
  await startServer();  // port open → Railway / Render health check passes
  await startBot();     // bot connects after server is healthy

  // ── keep-alive self-ping ──────────────────────────────────────────────────
  // Render free tier sleeps after ~15 min of no requests.
  // Railway doesn't sleep, but this is harmless there too.
  // Pings /health every 4 minutes to keep the process warm.
  const BASE_URL = process.env.BASE_URL;
  if (BASE_URL) {
    const ping = () => {
      const url = `${BASE_URL}/health`;
      const mod = url.startsWith('https') ? https : http;
      mod.get(url, res => {
        console.log(`[keepalive] ping ${url} → ${res.statusCode}`);
      }).on('error', e => {
        console.warn('[keepalive] ping failed:', e.message);
      });
    };
    // first ping after 1 min, then every 4 min
    setTimeout(() => {
      ping();
      setInterval(ping, 4 * 60 * 1000);
    }, 60 * 1000);
    console.log('[keepalive] self-ping active (every 4 min)');
  } else {
    console.warn('[keepalive] BASE_URL not set — self-ping disabled');
  }

})().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
