class base {
    constructor(platform, child) {
        if (!child) {
            this.requesticator = require(`../autocompleters/${platform}/requesticator.js`);
        } else {
            this.requesticator = require(`../autocompleters/${platform}/children/${child}/requesticator.js`);
        }
        this.sessions = {};
    }

    get(userId) {
        return this.sessions[userId];
    }
}

module.exports = base;