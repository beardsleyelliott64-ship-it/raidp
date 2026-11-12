const fs = require('fs').promises;
const path = require('path');

async function addApiKeyExhausted(apikey) {
  const filePath = path.join(__dirname, '..', 'apikeys_exhausted.txt');

  try {
    // Ensure file exists
    await fs.access(filePath);
  } catch {
    // Create the file if it doesn't exist
    await fs.writeFile(filePath, '');
  }

  // Read existing keys
  const text = await fs.readFile(filePath, 'utf8');
  const keys = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  // Add only if not already present
  if (!keys.includes(apikey)) {
    const prefix = text.trim().length > 0 ? '\n' : '';
    await fs.appendFile(filePath, `${prefix}${apikey}`);
  }
}

module.exports = addApiKeyExhausted;