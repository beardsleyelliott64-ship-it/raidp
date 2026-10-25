// language: Node.js, file: src/server.js
const express = require('express');
const cors    = require('cors');
const https   = require('https');
const http    = require('http');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()) }));
app.get('/', (_req, res) => res.status(200).send('OK'));

function startServer() {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`[server] :${port}`);
      // keep-alive self-ping every 4 min — prevents Render free-tier sleep
      const base = process.env.BASE_URL;
      if (base) {
        const ping = () => {
          const mod = base.startsWith('https') ? https : http;
          mod.get(`${base}/health`, r => console.log(`[ping] ${r.statusCode}`))
             .on('error', e => console.warn('[ping]', e.message));
        };
        setTimeout(() => { ping(); setInterval(ping, 4 * 60 * 1000); }, 60_000);
      }
      resolve(server);
    });
    server.on('error', reject);
  });
}

module.exports = { startServer };
