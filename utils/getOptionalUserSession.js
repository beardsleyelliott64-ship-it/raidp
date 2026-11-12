const { checkAccount } = require('../database/accounts');

async function getOptionalUserSession(userSession, userId, parent, child) {
    if (userSession) return userSession;
    const account = await checkAccount(userId);
    let data = {};
    if (!child) {
        data.settings = account[`${parent}_settings`] || { settings: {}};
    } else {
        data.settings = account[`${parent}_${child}_settings`];
    }
    data.updateEmbed = () => {};
    // console.log('Data after it is opt', data);
    return data;
}

module.exports = getOptionalUserSession;