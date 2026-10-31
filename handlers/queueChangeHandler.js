const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const fs = require('fs').promises; // Use the Promise-based fs API
const path = require('path');

// Resolve the path to config.json so we can read/write it safely
const configPath = path.join(__dirname, '../config.json');
const config = require(configPath);
const { colours } = config;
const Queues = require('../queues/queues');
const puppetQueue = require('../queues/puppeteerQueue');

const formatSubject = require('../utils/formatSubject');

async function handleQueueInput(interaction) {
    if (interaction.customId.startsWith('queues_changeSize')) {
        await interaction.deferUpdate({ flags: MessageFlags.Ephemeral });

        const size = Number(interaction.fields.getTextInputValue('size'));
        if (isNaN(size) || size < 0) {
            return;
        }

        const platform = interaction.customId
            .replace('queues_changeSize_', '') // (sparx_reader)
            .replace(/[()]/g, '');

        // 1. Check if the platform exists in config.queue_size
        if (platform !== 'puppeteer' && !(platform in config.queue_size)) {
            throw new Error(`Platform '${platform}' does not exist in the queue_size configuration.`);
        }

        if (platform === 'puppeteer') {
            puppetQueue.concurrency = size;
        } else {
            (Queues.get(platform)).queueMaxPerUse = size;
        }

        // 2. Update the value in memory
        if (platform === 'puppeteer') {
            config.browser_queue_size = size;
        } else {
            config.queue_size[platform] = size;
        }

        // 3. Write the updated config object back to config.json asynchronously
        try {
            await fs.writeFile(configPath, JSON.stringify(config, null, 4), 'utf8');
        } catch (error) {
            console.error('Error writing to config.json:', error);
            throw new Error('Failed to save the updated queue size to config.json.');
        }

        const container = new ContainerBuilder()
            .setAccentColor(colours.onyx)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## Queue Size Changed\nThe Queue Size has been successfully changed for **${formatSubject(platform)}** to **${size}**.`)
            );

        await interaction.followUp({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });
    }
}

module.exports = { handleQueueInput };