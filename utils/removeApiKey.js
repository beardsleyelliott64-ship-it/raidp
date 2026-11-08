const fs = require('fs').promises;
const path = require('path');

async function removeApiKey(apikey) {
  const keysPath = path.join(__dirname, '..', 'apikeys.txt');

  try {
    // 1. Read the current keys from the file
    const keysText = await fs.readFile(keysPath, 'utf8');
    
    // 2. Parse the keys into an array, removing empty lines and the specific apikey
    const updatedKeys = keysText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean) // Removes empty lines
      .filter(key => key !== apikey); // Removes the targeted API key

    // 3. Join the remaining keys back into a string with newline breaks
    const updatedText = updatedKeys.join('\n');

    // 4. Write the updated string back to the file
    await fs.writeFile(keysPath, updatedText, 'utf8');
    
  } catch (err) {
    // If the file doesn't exist, there's nothing to remove, so we can ignore ENOENT.
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

module.exports = removeApiKey;