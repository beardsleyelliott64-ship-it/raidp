// language: Node.js, file: src/utils/db.js
// lightweight JSON-file key-value store; each collection = one file under /data/
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function read(name) {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function write(name, data) {
  try {
    fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`[db] write ${name} failed:`, e.message);
  }
}

function get(name, key, fallback = null) {
  const store = read(name);
  return key in store ? store[key] : fallback;
}

function set(name, key, value) {
  const store = read(name);
  store[key] = value;
  write(name, store);
}

function del(name, key) {
  const store = read(name);
  delete store[key];
  write(name, store);
}

module.exports = { read, write, get, set, del };
