const bcrypt = require('bcryptjs');

async function hash(secret) {
    const saltRounds = 10;
    return bcrypt.hash(secret, saltRounds);
}

module.exports = hash;
