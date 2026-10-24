// language: Node.js, file: src/utils/store.js
const store = {
  channelId: null,
  guildId:   null,
  // verifyCode -> { userId, guildId, username, createdAt }
  pending: new Map(),
};

module.exports = store;
