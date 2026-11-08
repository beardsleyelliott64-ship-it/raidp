const fs = require('fs').promises;
const path = require('path');

async function getApiKeys(apikeys = []) {
  const envKeys = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEYS]
    .filter(Boolean)
    .flatMap(value => String(value).split(/[,\n]/));

  let fileKeys = [];
  const keysPath = path.join(__dirname, '..', 'apikeys.txt');
  try {
    const keysText = await fs.readFile(keysPath, 'utf8');
    fileKeys = keysText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  let exhaustedSet = new Set();
  const exhaustedPath = path.join(__dirname, '..', 'apikeys_exhausted.txt');
  try {
    const exhaustedText = await fs.readFile(exhaustedPath, 'utf8');
    exhaustedSet = new Set(exhaustedText.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const combined = [...apikeys, ...envKeys, ...fileKeys]
    .map(k => String(k).trim()).filter(Boolean);
  const available = combined.filter(k => !exhaustedSet.has(k));
  return [...new Set(available.length ? available : combined)];
}

module.exports = getApiKeys;
