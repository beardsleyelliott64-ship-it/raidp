const { queue_ranks } = require('../config.json');
const ALLOWED_ROLES = Object.values(queue_ranks);

function hasRequiredRole(member) {
    return ALLOWED_ROLES.some(roleId => member.roles.cache.has(roleId));
}

module.exports = hasRequiredRole;