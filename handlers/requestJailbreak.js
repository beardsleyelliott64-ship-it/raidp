'use strict';

const {
    ActionRowBuilder,
    AttachmentBuilder,
    ContainerBuilder,
    MessageFlags,
    ModalBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const OWNER_ID = process.env.JAILBREAK_OWNER_ID || '1363240484818128926';
const COLOUR = 0x5865F2;
const PROVIDERS = [
    { label: 'Google Gemini', value: 'Gemini' },
    { label: 'xAI Grok', value: 'Grok' },
    { label: 'Anthropic Claude', value: 'Claude' }
];

function isOwner(interaction) {
    return interaction?.user?.id === OWNER_ID;
}

function panel(content) {
    return new ContainerBuilder()
        .setAccentColor(COLOUR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

async function open(interaction) {
    if (!isOwner(interaction)) {
        await interaction.reply({ content: 'This feature is not available to your account yet.', flags: MessageFlags.Ephemeral });
        return;
    }

    const providerSelect = new StringSelectMenuBuilder()
        .setCustomId('lumen_jailbreak_provider')
        .setPlaceholder('Choose the AI provider you are targeting')
        .addOptions(PROVIDERS.map(provider => new StringSelectMenuOptionBuilder()
            .setLabel(provider.label)
            .setValue(provider.value)));

    const container = panel('## Request Jailbreak\nChoose the target AI provider. You will then enter its model ID and describe the task you want a strong, tailored prompt for.\n\n**Note:** Phantom creates task-focused prompts for legitimate use; it does not generate instructions to bypass another model’s safety controls.')
        .addActionRowComponents(new ActionRowBuilder().addComponents(providerSelect));
    const message = await interaction.reply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container],
        fetchReply: true
    });

    const collector = message.createMessageComponentCollector({ time: 10 * 60 * 1000, max: 1 });
    collector.on('collect', async component => {
        if (!isOwner(component)) {
            await component.reply({ content: 'Only the bot owner can use this feature.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (component.customId !== 'lumen_jailbreak_provider') return;

        const provider = component.values[0];
        if (!PROVIDERS.some(item => item.value === provider)) {
            await component.reply({ content: 'Invalid provider selection.', flags: MessageFlags.Ephemeral });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId(`lumen_jailbreak_submit_${provider.toLowerCase()}`)
            .setTitle(`Prompt for ${provider}`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('model')
                    .setLabel('Target model ID or name')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(provider === 'Gemini' ? 'e.g. gemini-2.5-pro' : provider === 'Grok' ? 'e.g. grok model ID' : 'e.g. Claude model ID')
                    .setMaxLength(100)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('task')
                    .setLabel('What should the prompt help you accomplish?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Describe the goal, context, constraints and desired output...')
                    .setMaxLength(3000)
                    .setRequired(true)
            )
        );
        await component.showModal(modal);
    });
}

async function handleModalSubmit(interaction) {
    if (!interaction.customId.startsWith('lumen_jailbreak_submit_')) return false;
    if (!isOwner(interaction)) {
        await interaction.reply({ content: 'Only the bot owner can use this feature.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const providerKey = interaction.customId.slice('lumen_jailbreak_submit_'.length);
    const provider = PROVIDERS.find(item => item.value.toLowerCase() === providerKey);
    if (!provider) {
        await interaction.reply({ content: 'Invalid provider. Please reopen Request Jailbreak.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const model = interaction.fields.getTextInputValue('model').trim();
    const task = interaction.fields.getTextInputValue('task').trim();
    if (!model || !task) {
        await interaction.reply({ content: 'Please provide both a model and a task description.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (!process.env.GEMINI_API_KEY) {
        await interaction.reply({ content: 'Gemini API key is not configured. Add `GEMINI_API_KEY` to the bot environment.', flags: MessageFlags.Ephemeral });
        return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const { generateContentWithFallback } = require('../gemini/generate');
        const generationRequest = [
            'You are Phantom, a specialist prompt engineer.',
            'Write one polished, detailed prompt tailored to the selected target AI model.',
            'The prompt must help with the user’s stated legitimate task and should specify role, context, objective, constraints, process, and output format where useful.',
            'Do not tell the target model to ignore, override, disable, or bypass its policies, safeguards, system instructions, or developer instructions. Do not seek prohibited content.',
            'Do not invent capabilities or model-specific syntax. Return only the finished prompt, with clear headings where useful.',
            `Target provider: ${provider.label}`,
            `Target model: ${model}`,
            `User task and context:\n${task}`
        ].join('\n\n');

        const result = await generateContentWithFallback({ model: process.env.GEMINI_MODEL || 'gemini-3.8-flash', contents: generationRequest });
        const generated = String(result.response?.text || '').trim();
        if (!generated) throw new Error('Gemini returned an empty prompt. Please try again.');

        const safeModel = model.replace(/[\r\n`]/g, '').slice(0, 100);
        const output = `LUMEN GENERATED PROMPT\nTarget: ${provider.label} — ${safeModel}\nGenerated: ${new Date().toISOString()}\n\n${generated}\n`;
        const attachment = new AttachmentBuilder(Buffer.from(output, 'utf8'), { name: 'lumen-generated-prompt.txt' });
        const preview = generated.length > 2800 ? `${generated.slice(0, 2700)}\n\n…Full prompt is attached as a text file.` : generated;
        await interaction.editReply({
            content: `**Prompt generated for ${provider.label} · ${safeModel}**\n\n${preview}`,
            files: [attachment]
        });
    } catch (error) {
        const status = Number(error?.status ?? error?.code);
        let message = error?.message || 'Unknown generation error.';
        if (status === 429) message = 'Gemini rate limit reached. Wait a moment and try again.';
        else if (status === 401 || status === 403) message = 'Gemini rejected the API key. Check `GEMINI_API_KEY`.';
        else if (/timed out/i.test(message)) message = 'Prompt generation timed out. Please try again.';
        else message = message.slice(0, 500);
        await interaction.editReply({ content: `❌ Could not generate the prompt: ${message}` });
    }
    return true;
}

module.exports = { open, handleModalSubmit };
