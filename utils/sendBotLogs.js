const { ContainerBuilder, TextDisplayBuilder, FileBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs/promises');
const { colours } = require('../config.json');
const webhookSend = require('./webhookSend');
const path = require('path');

async function sendBotLogs() {
    const crashLogPath = path.join(__dirname, '../crash.log');
    const logsPath = path.join(__dirname, '../logs.txt');

    const files = [];
    const fileComponents = [];

    // crash.log
    try {
        await fs.access(crashLogPath);

        files.push(
            new AttachmentBuilder(crashLogPath, { name: 'crash.log' })
        );

        fileComponents.push(
            new FileBuilder().setURL('attachment://crash.log')
        );
    } catch {}

    // logs.txt
    try {
        await fs.access(logsPath);

        files.push(
            new AttachmentBuilder(logsPath, { name: 'logs.txt' })
        );

        fileComponents.push(
            new FileBuilder().setURL('attachment://logs.txt')
        );
    } catch {}

    // Don't send anything if no files exist
    if (!files.length) return;

    const container = new ContainerBuilder()
        .setAccentColor(colours.onyx)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `\n# Previous Bot Logs\nBelow are the logs from the previous time the bot was run!`
            )
        )
        .addFileComponents(...fileComponents);

    try {
        await webhookSend(container, files);

        try {
            await fs.truncate(crashLogPath, 0);
        } catch {}
    } catch (e) {
        console.error('Failed to send logs', e);
    }
}

module.exports = sendBotLogs;