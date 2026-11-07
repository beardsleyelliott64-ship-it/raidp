const { MessageFlags, AttachmentBuilder, ContainerBuilder, FileBuilder, TextDisplayBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const util = require('util');
const FormData = require('form-data');

const WEBHOOK_URL = process.env.LOGS_WEBHOOK_URL;
const { colours } = require('../config.json');

class logger {
    constructor(userId, platform) {
        this.filepath = `sessionLogs/${platform}_${userId}.txt`;
        this.isSending = false;
        this.init();
    }

    /**
     * Returns ISO timestamp (YYYY-MM-DD HH:MM:SS)
     */
    getCurrentTime() {
        return new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    }

    /**
     * Append log line to file safely (no streams)
     */
    async logToFile(...args) {
        const message = util.format(...args);
        const logLine = `[${this.getCurrentTime()}] ${message}\n`;

        try {
            await fs.promises.appendFile(this.filepath, logLine, 'utf8');
        } catch (err) {
            console.error('[Logger] Failed to write log:', err.message);
        }
    }

    async send(user) {
        if (this.isSending) return;
        this.isSending = true;

        try {
            await this.sendToWebhook();

            const filePath = path.resolve(this.filepath);
            const attachment = new AttachmentBuilder(filePath, { name: 'logs.txt' });

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('# Session Logs!')
                )
                .addFileComponents(
                    new FileBuilder().setURL('attachment://logs.txt')
                );

            await user.send({
                files: [attachment],
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

            // Delete file after sending
            try {
                await fs.promises.unlink(filePath);
            } catch (unlinkErr) {
                console.error(`[Logger] Failed to delete file ${filePath}:`, unlinkErr.message);
            }

        } catch (error) {
            console.error(`[Logger] Failed to send log to user ${user.id}:`, error.message);
        }

        this.isSending = false;
    }

    async sendToWebhook() {
        const filePath = path.resolve(this.filepath);

        const form = new FormData();

        const embed = {
            title: 'Session Logs',
            description: `Logs uploaded at **${this.getCurrentTime()}**`,
            color: colours.onyx,
            fields: [
                { name: 'File Path', value: this.filepath ?? 'null' }
            ]
        };

        try {
            const stats = await fs.promises.stat(filePath);

            if (stats.size > 0) {
                // small delay ensures last appendFile writes finish
                await new Promise(r => setTimeout(r, 100));

                form.append(
                    'file',
                    fs.createReadStream(filePath),
                    { filename: 'log.txt' }
                );
            } else {
                embed.description += "\n\n*Log file was empty.*";
            }

        } catch (err) {
            if (err.code === 'ENOENT') {
                embed.description += "\n\n*Log file not found.*";
            } else {
                console.error("[Logger] Error accessing log file:", err.message);
            }
        }

        form.append('payload_json', JSON.stringify({ embeds: [embed] }));

        if (!WEBHOOK_URL) return;

        try {
            await axios.post(WEBHOOK_URL, form, {
                headers: form.getHeaders(),
                maxBodyLength: Infinity,
                maxContentLength: Infinity
            });
        } catch (error) {
            console.error(
                "Webhook failed:",
                error.response ? error.response.data : error.message
            );
        }
    }

    async init() {
        try {
            const dir = path.dirname(this.filepath);
            await fs.promises.mkdir(dir, { recursive: true });
        } catch (err) {
            console.error("[Logger] Failed to initialize logger:", err.message);
        }
    }
}

module.exports = logger;