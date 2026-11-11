const { useUpSlot } = require('../handlers/accountHandler');
const { updateStats } = require('../database/accounts.js');
const seperateParentChild = require('./seperateParentChild');

async function autocompleteWrapper(interaction, platform, userSession, autocomplete) {
    const platValue = seperateParentChild(platform);
    if (await useUpSlot(interaction, platValue.parent, await userSession.requesticator.getAccountId(), platValue.child)) return;
    const timeSaved = await autocomplete();
    if (timeSaved) {
        await updateStats(interaction.user.id, platValue.child ?? platValue.parent, timeSaved);
    }
}

module.exports = autocompleteWrapper;