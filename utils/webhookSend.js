require('dotenv').config();
const { MessageFlags } = require('discord.js');
const fs = require('fs');
const FormData = require('form-data');

async function webhookSend(container, files = []) {
    const webhook = process.env.STARTUP_WEBHOOK_URL;
    if (!webhook) {
        console.log('[webhook] STARTUP_WEBHOOK_URL not configured; skipping webhook.');
        return false;
    }

    try {
        const form = new FormData();
        form.append('payload_json', JSON.stringify({
            flags: MessageFlags.IsComponentsV2,
            components: [container]
        }));

        for (const [index, file] of files.entries()) {
            if (!file?.attachment) continue;
            const stream = fs.createReadStream(file.attachment);
            form.append(`files[${index}]`, stream, file.name || `file-${index}`);
        }

        const url = new URL(webhook);
        url.searchParams.set('with_components', 'true');
        const res = await fetch(url, {
            method: 'POST',
            body: form,
            headers: form.getHeaders()
        });
        if (!res.ok) console.error('[webhook] Discord returned', res.status, await res.text());
        return res.ok;
    } catch (error) {
        console.error('[webhook] Failed:', error.message);
        return false;
    }
}
module.exports = webhookSend;
