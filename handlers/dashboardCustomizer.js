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
const GEMINI_MODELS = [
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-3.1-pro-preview'
];
const dashboardMessages = new Map();
const COLOURS = {
    blue: { label: 'Blue', style: ButtonStyle.Primary },
    grey: { label: 'Grey', style: ButtonStyle.Secondary },
    green: { label: 'Green', style: ButtonStyle.Success },
    red: { label: 'Red', style: ButtonStyle.Danger }
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

    if (interaction.message) dashboardMessages.set(interaction.user.id, interaction.message);

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
    const prompt = `You are Lumen's generic Discord dashboard feature compiler. Convert the owner's request into a genuinely interactive feature, NOT a text description. Return ONLY JSON: {"description":"short instructions","initialState":{},"view":[{"type":"text","text":"..."}],"actions":[{"id":"unique_id","label":"Button label","style":"primary|secondary|success|danger","steps":[{"op":"set|increment|decrement|toggle|random_int|append|remove_last|create_deck|shuffle|draw|push|clear|sum|if","key":"state key","value":0,"min":1,"max":10,"to":"destination state key"}]}]}. This is a declarative runtime: do not output code. View supports {{stateKey}} and {{sum:arrayKey}}. Ops: set assigns value; increment/decrement numeric state; toggle boolean; random_int min/max; append pushes value into array; remove_last removes last array item; create_deck makes a standard 52-card deck with rank/suit/value; shuffle randomizes an array; draw removes last item from key and stores it in to; push adds value to array; clear empties array/string or resets number; sum stores the numeric sum of array from (or key); if tests key using operator eq/neq/gt/gte/lt/lte/truthy/falsy and runs nested then/else steps. Buttons execute steps and update the live Discord feature. Use state and actions to implement the requested behaviour, including game rules, scoring, turn progression, win/loss states, reset/replay where relevant. Do not merely explain a game. No external APIs, arbitrary code, shell commands, secrets or unsupported operations. Maximum 20 view rows, 20 actions, 15 top-level steps/action, 30 initial state keys, 80-char labels and 1500-char view text. Ensure JSON is valid and internally consistent. If a request cannot be fully implemented with these primitives, provide the closest useful interactive version and disclose its limitation in description.
Button label: ${label}
Owner request: ${behaviour}`;
    const failures = [];
    for (const model of GEMINI_MODELS) {
        let timeout;
        try {
            const result = await Promise.race([ai.models.generateContent({ model, contents: prompt }), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Request timed out')), 35000); })]).finally(() => clearTimeout(timeout));
            const text = String(result?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
            let definition; try { definition = JSON.parse(text); } catch { const a=text.indexOf('{'), b=text.lastIndexOf('}'); if(a<0||b<=a) throw new Error('Invalid JSON'); definition=JSON.parse(text.slice(a,b+1)); }
            runtime.validate(definition);
            return { definition, model };
        } catch (error) { failures.push(`${model}: ${(error.message || 'generation failed').slice(0, 140)}`); console.warn(`[dashboard-customizer] ${model} failed:`, error.message); }
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
        if (items.length >= 25) throw new Error('The dashboard has reached the current limit of 25 custom buttons. Remove an existing component before adding another.');
        items.push(item);
        saveCustomizations(items);

        // Edit the exact dashboard message from which the owner opened this flow.
        // This makes the new button appear immediately without running /dashboard again.
        const dashboardMessage = dashboardMessages.get(interaction.user.id);
        dashboardMessages.delete(interaction.user.id);
        let updated = false;
        if (dashboardMessage?.editable) {
            const { buildMainPanel } = require('../commands/utility/dashboard.js');
            await dashboardMessage.edit({ components: [buildMainPanel(items)] });
            updated = true;
        }

        await interaction.editReply({
            content: `✅ Added **${label}** to the dashboard in **${COLOURS[colour].label}**.\n\nGemini model used: \`${generated.model}\`.\n${updated ? 'The existing dashboard message has been updated.' : 'Saved successfully; it will appear the next time the dashboard is opened.'}`
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
    if (!isOwner(interaction)) {
        await interaction.reply({ content: 'This dashboard action is reserved for the bot owner.', flags: MessageFlags.Ephemeral });
        return true;
    }
    const id = interaction.customId.slice('lumen_custom_ui_'.length);
    const item = loadCustomizations().find(entry => entry.id === id);
    if (!item) {
        await interaction.reply({ content: 'This dashboard button no longer exists. Reopen /dashboard to refresh it.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (item.definition) return require('./dashboardFeatureRuntime.js').handle(interaction, loadCustomizations());
    await interaction.reply({ content: item.response || 'This saved feature needs to be recreated with the interactive customizer.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
}

module.exports = { open, handleModalSubmit, handleComponent, loadCustomizations, buildCustomRows };
