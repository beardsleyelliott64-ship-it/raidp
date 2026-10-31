const {
    ContainerBuilder,
    TextDisplayBuilder,
    FileBuilder,
    MessageFlags
} = require('discord.js');

const fs = require('fs/promises');
const { colours } = require('../config.json');
const withRetry = require('./withRetry');

async function fileExists(path) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

async function logError(error, userId, tool, platformLogs) {
    const unixTimestamp = Math.floor(Date.now() / 1000);

    const errorMessage = error.message || 'Unknown error';
    const errorStack = error.stack || 'No stack trace available';

    const form = new FormData();
    const files = [];
    const fileComponents = [];

    // --- stack trace (always)
    files.push(
        new Blob([errorStack], { type: 'text/plain' })
    );

    fileComponents.push(
        new FileBuilder().setURL('attachment://stackTrace.txt')
    );

    // --- optional platform logs
    if (platformLogs && await fileExists(platformLogs)) {
        const buffer = await fs.readFile(platformLogs);
        const blob = new Blob([buffer], { type: 'text/plain' });

        form.append('files[1]', blob, 'logs.txt');

        fileComponents.push(
            new FileBuilder().setURL('attachment://logs.txt')
        );
    }

    const container = new ContainerBuilder()
        .setAccentColor(colours.light_red)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `\n# Error\n**Platform:** ${tool}\n**User ID:** <@${userId}>\n**Timestamp:** <t:${unixTimestamp}:f>\n## Error Info\n**Error Message**: \`\`\`${errorMessage}\`\`\``
            )
        )
        .addFileComponents(...fileComponents);


    form.append(
        'payload_json',
        JSON.stringify({
            flags: MessageFlags.IsComponentsV2,
            components: [container]
        })
    );

    // stack trace
    form.append('files[0]', files[0], 'stackTrace.txt');

    // optional logs
    if (files[1]) {
        form.append('files[1]', files[1], 'logs.txt');
    }

    if (!process.env.ERROR_WEBHOOK_URL) {
        console.error('[errorLogger] ERROR_WEBHOOK_URL is not configured; skipping remote error log.');
        return;
    }

    const errorWebhook = new URL(process.env.ERROR_WEBHOOK_URL);
    errorWebhook.searchParams.set('with_components', 'true');
    const res = await fetch(errorWebhook, {
        method: 'POST',
        body: form
    });

    if (!res.ok) {
        console.error(await res.text());
    }
}

module.exports = { logError: withRetry(logError) };