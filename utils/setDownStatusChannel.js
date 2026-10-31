const { ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const webhookSend = require('./webhookSend');
const  { status_channel_id } = require('../config.json');

async function setDownStatusChannel(client) {
    try {
        const channel = await client.channels.fetch(status_channel_id);
        await channel.setName('BOT IS DOWN 🔴');
    } catch (e) {
        console.error('Failed to update status channel:', e);
    }
}

module.exports = setDownStatusChannel;