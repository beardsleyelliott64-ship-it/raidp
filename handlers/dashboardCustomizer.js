'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ModalBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const OWNER_ID = process.env.JAILBREAK_OWNER_ID || '1363240484818128926';
const STORE_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(STORE_DIR, 'dashboard-customizations.json');
const GEMINI_MODELS = require('../gemini/modelDiscovery.js').REQUESTED_MODELS;
const dashboardMessages = new Map();
const DASHBOARD_FILE = path.join(STORE_DIR, 'dashboard-message.json');
const PUBLIC_SETTINGS_FILE = path.join(STORE_DIR, 'dashboard-settings.json');
function getPublicCustomization() { try { return JSON.parse(fs.readFileSync(PUBLIC_SETTINGS_FILE, 'utf8')).enabled === true; } catch { return false; } }
async function setPublicCustomization(client, enabled) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(PUBLIC_SETTINGS_FILE, JSON.stringify({ enabled: !!enabled, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    try {
        const saved = JSON.parse(fs.readFileSync(DASHBOARD_FILE, 'utf8'));
        const channel = await client.channels.fetch(saved.channelId);
        const msg = await channel.messages.fetch(saved.messageId);
        const { buildMainPanel } = require('../commands/utility/dashboard.js');
        await msg.edit({ components: [buildMainPanel(loadCustomizations())] });
        return true;
    } catch (e) { console.warn('[dashboard-customizer] saved dashboard refresh:', e.message); return false; }
}
function registerDashboardMessage(guildId, channelId, messageId) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(DASHBOARD_FILE, JSON.stringify({ guildId, channelId, messageId }, null, 2), { mode: 0o600 });
}
const COLOURS = {
    blue: { label: 'Blue', style: ButtonStyle.Primary },
    green: { label: 'Green', style: ButtonStyle.Success },
    red: { label: 'Red', style: ButtonStyle.Danger },
    purple: { label: 'Purple', style: ButtonStyle.Primary },
    pink: { label: 'Pink', style: ButtonStyle.Danger },
    orange: { label: 'Orange', style: ButtonStyle.Success },
    yellow: { label: 'Yellow', style: ButtonStyle.Secondary },
    teal: { label: 'Teal', style: ButtonStyle.Success },
    grey: { label: 'Grey', style: ButtonStyle.Secondary },
    dark: { label: 'Dark', style: ButtonStyle.Secondary }
};

function isOwner(interaction) {
    return interaction?.user?.id === OWNER_ID;
}

function loadCustomizations() {
    try {
        if (!fs.existsSync(STORE_FILE)) return [];
        const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
        return Array.isArray(parsed) ? parsed.filter(isValidStoredItem) : [];
    } catch (error) {
        console.error('[dashboard-customizer] Could not read saved components:', error.message);
        return [];
    }
}

function isValidStoredItem(item) {
    return item && typeof item.id === 'string' && /^[a-f0-9-]{16,40}$/i.test(item.id)
        && typeof item.label === 'string' && item.label.length > 0 && item.label.length <= 80
        && (typeof item.response === 'string' || (item.definition && typeof item.definition === 'object'))
        && Object.prototype.hasOwnProperty.call(COLOURS, item.colour);
}

function saveCustomizations(items) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    const tempFile = `${STORE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(items, null, 2), { mode: 0o600 });
    fs.renameSync(tempFile, STORE_FILE);
}

function buildCustomRows(items) {
    const rows = [];
    for (let index = 0; index < items.length; index += 5) {
        const row = new ActionRowBuilder();
        for (const item of items.slice(index, index + 5)) {
            row.addComponents(new ButtonBuilder()
                .setCustomId(`lumen_custom_ui_${item.id}`)
                .setLabel(item.label)
                .setStyle(COLOURS[item.colour].style));
        }
        rows.push(row);
    }
    return rows;
}

async function open(interaction) {
    if (!isOwner(interaction)) {
        await interaction.reply({ content: 'Dashboard customisation is not available to your account.', flags: MessageFlags.Ephemeral });
        return;
    }

    // The public dashboard reference is persisted by /dashboard, not inferred
    // from this private owner panel message.

    const select = new StringSelectMenuBuilder()
        .setCustomId('lumen_customize_colour')
        .setPlaceholder('Choose the new button colour')
        .addOptions(Object.entries(COLOURS).map(([value, colour]) => new StringSelectMenuOptionBuilder()
            .setLabel(colour.label).setValue(value)));

    const message = await interaction.reply({
        content: '**Customize Dashboard**\nChoose a colour for your new dashboard button. Next, you will enter its label and describe what it should do.',
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral,
        fetchReply: true
    });

    const collector = message.createMessageComponentCollector({ time: 5 * 60 * 1000, max: 1 });
    collector.on('collect', async component => {
        if (!isOwner(component)) {
            await component.reply({ content: 'Only the bot owner can customise this dashboard.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (component.customId !== 'lumen_customize_colour') return;
        const colour = component.values[0];
        if (!COLOURS[colour]) {
            await component.reply({ content: 'That colour is not supported.', flags: MessageFlags.Ephemeral });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId(`lumen_customize_submit_${colour}`)
            .setTitle('Add a dashboard button')
            .addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('label').setLabel('Button name').setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. Server Information').setMaxLength(80).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('behaviour').setLabel('What should clicking it do?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Describe the feature, information or workflow you want...')
                    .setMaxLength(2500).setRequired(true))
            );
        await component.showModal(modal);
    });
}

function extractJson(text) {
    const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(cleaned); } catch {}
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('Gemini returned an invalid component definition.');
}

async function generateComponent(label, behaviour) {
    if (!process.env.GEMINI_API_KEY) throw new Error('Gemini API key is not configured. Add GEMINI_API_KEY to the bot environment.');
    const { GoogleGenAI } = require('@google/genai');
    const runtime = require('./dashboardFeatureRuntime.js');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `You are Lumen's generic Discord dashboard feature compiler. Convert the owner's request into a genuinely interactive feature, NOT a text description. Return ONLY JSON: {"description":"short instructions","initialState":{},"view":[{"type":"text","text":"..."}],"actions":[{"id":"unique_id","label":"Button label","style":"primary|secondary|success|danger","steps":[{"op":"set|increment|decrement|toggle|random_int|append|remove_last|create_deck|shuffle|draw|push|clear|sum|if","key":"state key","value":0,"min":1,"max":10,"to":"destination state key"}]}]}. This is a declarative runtime: do not output code. View supports {{stateKey}} and {{sum:arrayKey}}. Ops: set assigns value; increment/decrement numeric state; toggle boolean; random_int min/max; append pushes value into array; remove_last removes last array item; create_deck makes a standard 52-card deck with rank/suit/value; shuffle randomizes an array; draw removes last item from key and stores it in to; push adds value to array; clear empties array/string or resets number; sum stores the numeric sum of array from (or key); if tests key using operator eq/neq/gt/gte/lt/lte/truthy/falsy and runs nested then/else steps. Buttons execute steps and update the live Discord feature. Use state and actions to implement the requested behaviour, including game rules, scoring, turn progression, win/loss states, reset/replay where relevant. Do not merely explain a game. No external APIs, arbitrary code, shell commands, secrets or unsupported operations. Maximum 20 view rows, 20 actions, 15 top-level steps/action, 30 initial state keys, 80-char labels and 1500-char view text. Do not include slash commands; this release only supports dashboard-button interactions. Ensure JSON is valid and internally consistent. If a request cannot be fully implemented with these primitives, provide the closest useful interactive version and disclose its limitation in description.
Button label: ${label}
Owner request: ${behaviour}`;
    const failures = [];
    let modelsToTry = GEMINI_MODELS;
    try {
        const discovery = await require('../gemini/modelDiscovery.js').discoverModels(process.env.GEMINI_API_KEY);
        modelsToTry = discovery.available;
        if (!modelsToTry.length) throw new Error('None of the 13 configured Gemini model IDs are currently available for generateContent.');
    } catch (error) {
        if (/None of the 13/.test(error.message)) throw error;
        console.warn('[dashboard-customizer] Model discovery unavailable; probing configured IDs directly:', error.message);
    }
    for (const model of modelsToTry) {
        let timeout;
        try {
            const result = await Promise.race([ai.models.generateContent({ model, contents: prompt }), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Request timed out')), 35000); })]).finally(() => clearTimeout(timeout));
            const text = String(result?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
            let definition; try { definition = JSON.parse(text); } catch { const a=text.indexOf('{'), b=text.lastIndexOf('}'); if(a<0||b<=a) throw new Error('Invalid JSON'); definition=JSON.parse(text.slice(a,b+1)); }
            runtime.validate(definition);
            return { definition, model };
        } catch (error) {
            const status = Number(error.status || error.code || error.response?.status || 0);
            failures.push(`${model}: ${(error.message || 'generation failed').slice(0, 140)}`);
            console.warn(`[dashboard-customizer] ${model} failed:`, error.message);
            // A project-wide exhausted quota is not fixed by changing model IDs.
            if (status === 429 && /quota|resource.?exhausted|billing/i.test(String(error.message || error))) break;
        }
    }
    throw new Error(`Gemini could not generate a valid interactive feature. ${failures.slice(-3).join(' | ')}`);
}

async function handleModalSubmit(interaction) {
    if (!interaction.customId.startsWith('lumen_customize_submit_')) return false;
    if (!isOwner(interaction)) {
        await interaction.reply({ content: 'Only the bot owner can add dashboard components.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const colour = interaction.customId.slice('lumen_customize_submit_'.length);
    if (!COLOURS[colour]) {
        await interaction.reply({ content: 'Invalid button colour. Please start again.', flags: MessageFlags.Ephemeral });
        return true;
    }
    const label = interaction.fields.getTextInputValue('label').trim();
    const behaviour = interaction.fields.getTextInputValue('behaviour').trim();
    if (!label || !behaviour) {
        await interaction.reply({ content: 'Please provide both a button name and a description.', flags: MessageFlags.Ephemeral });
        return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const generated = await generateComponent(label, behaviour);
        const item = {
            id: crypto.randomUUID(),
            label,
            colour,
            definition: generated.definition,
            createdAt: new Date().toISOString(),
            generatedBy: generated.model
        };
        const items = loadCustomizations();
        if (items.length >= 10) throw new Error('The dashboard has reached the current limit of 10 custom buttons (Discord action-row limits).');
        const preview = await interaction.editReply({
            content: `## Feature preview: ${label}\n${generated.definition.description || 'Interactive custom feature'}\n\n**Button colour:** ${COLOURS[colour].label}\n**Gemini model:** \`${generated.model}\`\n**Interactions:** ${generated.definition.actions.length}\n\nReview the feature before publishing.`,
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('lumen_publish_feature').setLabel('Publish Feature').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('lumen_cancel_feature').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            )]
        });
        const collector = preview.createMessageComponentCollector({ time: 5 * 60 * 1000, max: 1 });
        collector.on('collect', async decision => {
            if (!isOwner(decision)) { await decision.reply({ content: 'Only the bot owner can publish features.', flags: MessageFlags.Ephemeral }); return; }
            if (decision.customId === 'lumen_cancel_feature') { await decision.update({ content: 'Feature generation cancelled. Nothing was published.', components: [] }); return; }
            let createdCommand = null;
            let publishGuild = null;
            try {
                const current = loadCustomizations();
                if (current.length >= 10) throw new Error('The dashboard has reached the current limit of 10 custom buttons (Discord action-row limits).');
                const slug = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 18) || 'feature';
                item.commandName = `lumen-${slug}-${item.id.slice(0, 6)}`.slice(0, 32);
                const dashboardConfig = fs.existsSync(DASHBOARD_FILE) ? JSON.parse(fs.readFileSync(DASHBOARD_FILE, 'utf8')) : null;
                const guildId = dashboardConfig?.guildId || interaction.guildId || process.env.GUILD_ID || '1568044419351978107';
                publishGuild = await interaction.client.guilds.fetch(guildId);
                createdCommand = await publishGuild.commands.create({ name: item.commandName, description: String(item.definition.description || `Open ${label}`).slice(0, 100) || 'Open this custom Lumen feature' });
                item.guildId = guildId;
                current.push(item);
                saveCustomizations(current);
                let updated = false;
                let dashboardWarning = '';
                try {
                    const saved = fs.existsSync(DASHBOARD_FILE) ? JSON.parse(fs.readFileSync(DASHBOARD_FILE, 'utf8')) : null;
                    if (saved?.channelId && saved?.messageId) {
                        const channel = await interaction.client.channels.fetch(saved.channelId);
                        const dashboardMessage = await channel?.messages.fetch(saved.messageId);
                        if (dashboardMessage) {
                            const { buildMainPanel } = require('../commands/utility/dashboard.js');
                            await dashboardMessage.edit({ components: [buildMainPanel(current)] });
                            updated = true;
                        }
                    }
                } catch (dashboardError) { dashboardWarning = ` Dashboard refresh failed (${dashboardError.message}); run /dashboard to recreate it.`; }
                await decision.update({ content: `✅ Published **${label}**.\nSlash command: \`/${item.commandName}\`\nGemini model: \`${generated.model}\`.\n${updated ? 'The original dashboard has been updated.' : 'Saved; it will appear on the next /dashboard.'}${dashboardWarning}`, components: [] });
            } catch (publishError) {
                if (createdCommand && publishGuild) { try { await publishGuild.commands.delete(createdCommand.id); } catch (cleanupError) { console.error('[dashboard-customizer] Could not roll back an uncommitted slash command:', cleanupError.message); } }
                await decision.update({ content: `❌ Publication failed: ${String(publishError.message || 'Unknown error').slice(0, 500)}`, components: [] });
            }
        });
        collector.on('end', async (_collected, reason) => {
            if (reason === 'time') interaction.editReply({ content: 'Feature preview expired. Nothing was published.', components: [] }).catch(() => {});
        });
    } catch (error) {
        console.error('[dashboard-customizer] Feature generation failed:', error);
        await interaction.editReply({ content: `❌ Could not add that dashboard button. ${String(error.message || 'Unknown error').slice(0, 700)}` });
    }
    return true;
}

async function handleComponent(interaction) {
    if (interaction.customId.startsWith('lumen_feature_action_')) return require('./dashboardFeatureRuntime.js').handle(interaction, loadCustomizations());
    if (!interaction.customId.startsWith('lumen_custom_ui_')) return false;
    const id = interaction.customId.slice('lumen_custom_ui_'.length);
    const item = loadCustomizations().find(entry => entry.id === id);
    if (!item) {
        await interaction.reply({ content: 'This dashboard button no longer exists. Please reopen /dashboard.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (item.definition) return require('./dashboardFeatureRuntime.js').handle(interaction, loadCustomizations());
    await interaction.reply({ content: item.response || 'This saved feature needs to be recreated with the interactive customizer.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
}



async function handleSlashCommand(interaction) {
    const item = loadCustomizations().find(entry => entry.commandName === interaction.commandName && entry.definition);
    if (!item) return false;
    return require('./dashboardFeatureRuntime.js').launch(interaction, item);
}

const REQUEST_FILE = path.join(STORE_DIR, 'dashboard-feature-requests.json');
function loadRequests() {
    try { const value = JSON.parse(fs.readFileSync(REQUEST_FILE, 'utf8')); return Array.isArray(value) ? value : []; }
    catch { return []; }
}
function saveRequests(items) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    const tmp = `${REQUEST_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, REQUEST_FILE);
}
async function openRequest(interaction) {
    const modal = new ModalBuilder().setCustomId('lumen_request_submit').setTitle('Suggest a Lumen feature')
        .addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('request_name').setLabel('Feature idea').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('request_details').setLabel('What should it do?').setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(true))
        );
    await interaction.showModal(modal);
}
async function handleRequestModal(interaction) {
    if (interaction.customId !== 'lumen_request_submit') return false;
    const name = interaction.fields.getTextInputValue('request_name').trim();
    const details = interaction.fields.getTextInputValue('request_details').trim();
    if (!name || !details) { await interaction.reply({ content: 'Please complete both fields.', flags: MessageFlags.Ephemeral }); return true; }
    const requests = loadRequests();
    const recent = requests.filter(r => r.userId === interaction.user.id && Date.now() - Date.parse(r.createdAt) < 60 * 60 * 1000);
    if (recent.length >= 3) { await interaction.reply({ content: 'You can submit up to three feature requests per hour.', flags: MessageFlags.Ephemeral }); return true; }
    if (requests.some(r => r.status === 'Pending' && r.userId === interaction.user.id && r.name.toLowerCase() === name.toLowerCase())) {
        await interaction.reply({ content: 'You already have a pending request with that name.', flags: MessageFlags.Ephemeral }); return true;
    }
    const request = { id: crypto.randomUUID(), name, details, userId: interaction.user.id, username: interaction.user.username, status: 'Pending', createdAt: new Date().toISOString() };
    requests.push(request);
    saveRequests(requests);
    try { const owner = await interaction.client.users.fetch(OWNER_ID); await owner.send(`New Lumen dashboard suggestion from ${interaction.user.tag || interaction.user.username}: **${name}**\n${details}\nRequest ID: ${request.id}`); } catch (e) { console.warn('[dashboard-customizer] Owner DM notification unavailable:', e.message); }
    await interaction.reply({ content: 'Your feature suggestion has been sent to the Lumen owner for review. It has not been published.', flags: MessageFlags.Ephemeral });
    return true;
}
async function manageRequests(interaction) {
    if (!isOwner(interaction)) { await interaction.reply({ content: 'Only the bot owner can manage requests.', flags: MessageFlags.Ephemeral }); return; }
    const pending = loadRequests().filter(r => r.status === 'Pending').slice(-25);
    if (!pending.length) { await interaction.reply({ content: 'There are no pending feature requests.', flags: MessageFlags.Ephemeral }); return; }
    const select = new StringSelectMenuBuilder().setCustomId('lumen_request_select').setPlaceholder('Choose a feature request').addOptions(pending.map(r => new StringSelectMenuOptionBuilder().setLabel(r.name.slice(0, 100)).setDescription(`${r.username || r.userId} · ${r.status}`.slice(0, 100)).setValue(r.id)));
    const message = await interaction.reply({ content: '**Feature requests**\nSelect a request to review.', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral, fetchReply: true });
    const collector = message.createMessageComponentCollector({ time: 5 * 60 * 1000, max: 1 });
    collector.on('collect', async choice => {
        if (!isOwner(choice)) { await choice.reply({ content: 'Owner only.', flags: MessageFlags.Ephemeral }); return; }
        const request = loadRequests().find(r => r.id === choice.values?.[0] && r.status === 'Pending');
        if (!request) { await choice.update({ content: 'That request is no longer pending.', components: [] }); return; }
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`lumen_request_approve_${request.id}`).setLabel('Approve for development').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`lumen_request_reject_${request.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
        );
        await choice.update({ content: `## ${request.name}\n${request.details}\n\nRequested by: <@${request.userId}>\nStatus: Pending`, components: [row], allowedMentions: { users: [] } });
    });
}
async function handleRequestDecision(interaction) {
    const match = interaction.customId.match(/^lumen_request_(approve|reject)_([a-f0-9-]{36})$/i);
    if (!match) return false;
    if (!isOwner(interaction)) { await interaction.reply({ content: 'Only the bot owner can review requests.', flags: MessageFlags.Ephemeral }); return true; }
    const requests = loadRequests();
    const request = requests.find(r => r.id === match[2]);
    if (!request || request.status !== 'Pending') { await interaction.reply({ content: 'This request has already been reviewed.', flags: MessageFlags.Ephemeral }); return true; }
    request.status = match[1] === 'approve' ? 'Approved' : 'Rejected';
    request.reviewedAt = new Date().toISOString();
    saveRequests(requests);
    await interaction.update({ content: `${match[1] === 'approve' ? '✅ Approved for development' : '❌ Rejected'}: **${request.name}**. ${match[1] === 'approve' ? 'Use Customize Dashboard to generate and preview the implementation.' : ''}`, components: [] });
    return true;
}

module.exports = { OWNER_ID, open, handleModalSubmit, handleComponent, loadCustomizations, buildCustomRows, registerDashboardMessage, openRequest, handleRequestModal, manageRequests, handleRequestDecision, handleSlashCommand, getPublicCustomization, setPublicCustomization, loadRequests };
