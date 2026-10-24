// language: Node.js, file: src/index.js
// server binds first — Render needs the port up before marking the service healthy
require('dotenv').config();
const { startServer } = require('./server');
const { startBot }   = require('./bot');

(async () => {
  await startServer();
  await startBot();
})().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
