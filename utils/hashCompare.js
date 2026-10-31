const bcrypt = require('bcryptjs');

async function hashCompare(plainValue, hashedValue) {
    return bcrypt.compare(plainValue, hashedValue);
}

module.exports = hashCompare;
