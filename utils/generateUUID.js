const crypto = require('crypto');

function generateUUID() {
    return crypto.randomUUID();
}

module.exports = generateUUID;