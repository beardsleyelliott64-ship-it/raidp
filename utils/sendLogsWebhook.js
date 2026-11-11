const fs = require('fs/promises');
const fsSync = require('fs');
const axios = require('axios');
const FormData = require('form-data');

async function sendLog(filePath, name, embed, retries = 3) {
    const webhook = process.env.LOGS_WEBHOOK_URL;
    if (!webhook) return false;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const form = new FormData();
            form.append('file', fsSync.createReadStream(filePath), { filename: name });
            form.append('payload_json', JSON.stringify({ embeds: [embed] }));
            await axios.post(webhook, form, { headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 15000 });
            await fs.rm(filePath, { force: true });
            console.log(`Sent log ${name}`);
            return true;
        } catch (error) {
            if (attempt === retries) console.error(`Failed to send log ${name}:`, error.message);
            else await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    return false;
}
module.exports = sendLog;
