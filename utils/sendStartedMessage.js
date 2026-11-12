const { ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const webhookSend = require('./webhookSend');
const config = require('../config.json');
async function sendStartedMessage(client) {
    try {
        const container = new ContainerBuilder().setAccentColor(0x09FF00).addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`\n# Started the bot at <t:${Math.floor(Date.now()/1000)}:T>\nLogged in as **${client.user.tag}**!`)
        );
        await webhookSend(container);
    } catch (e) { console.error('[startup webhook] ignored:', e.message); }
    const id = process.env.STATUS_CHANNEL_ID || config.status_channel_id;
    if (!id) return;
    try { const channel = await client.channels.fetch(id); if (channel?.setName) await channel.setName('BOT IS UP 🟢'); }
    catch (e) { console.error('Failed to update status channel:', e?.message || e); }
}
module.exports = sendStartedMessage;
