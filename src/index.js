// language: Node.js, file: src/index.js
require('dotenv').config();
const { startServer } = require('./server');
const { startBot }   = require('./bot');

(async () => {
  await startServer();   // port up → health check passes → Railway marks healthy
  await startBot();      // bot connects after server is stable
})().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
