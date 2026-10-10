const stringify = require('fast-json-stable-stringify');

function canonicalize(obj) {
  // Parse + re-stringify removes weird escapes like \u003e
  const normalized = JSON.parse(JSON.stringify(obj));

  // Stable key order + consistent serialization
  return JSON.parse(stringify(normalized));
}

module.exports = canonicalize;