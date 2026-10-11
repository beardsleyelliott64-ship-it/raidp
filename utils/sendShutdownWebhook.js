const { ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const webhookSend = require('./webhookSend');
async function sendShutdownWebhook(reason, pingAll) {
    try {
        const container = new ContainerBuilder().setAccentColor(0xFF0000).addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`\n# Bot stopped/crashed at <t:${Math.floor(Date.now()/1000)}:T>\n> Message: ${reason}${pingAll ? '\n@everyone' : ''}`)
        );
        await webhookSend(container);
    } catch (e) { console.error('[shutdown webhook] ignored:', e.message); }
}
module.exports = sendShutdownWebhook;
