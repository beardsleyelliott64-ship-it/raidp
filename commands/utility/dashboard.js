// language: JavaScript, file: commands/utility/dashboard.js
'use strict';

const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');

const { colours, emojis } = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Open the Lumen dashboard'),

    async execute(interaction) {
        const ownerId = process.env.JAILBREAK_OWNER_ID || '1363240484818128926';
        const isOwner = interaction.user.id === ownerId;

        // The dashboard is user-specific: an ephemeral reply ensures each person
        // sees their own owner/non-owner button state rather than sharing the
        // owner's enabled controls in a public channel message.
        const msg = await interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildMainPanel(isOwner)],
            fetchReply: true
        });

        const collector = msg.createMessageComponentCollector({ time: 3_600_000 });

        collector.on('collect', async (ci) => {
            try {
                if (ci.customId === 'lumen_request_jailbreak') {
                    // Never trust the disabled button as the permission check.
                    // The interaction's authenticated Discord user ID is authoritative.
                    if (ci.user.id !== ownerId) {
                        await ci.reply({ content: 'This feature is not available to your account yet.', flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await require('../../handlers/requestJailbreak.js').open(ci);
                    return;
                }
                await require('../../handlers/readerBookmarkletFlow.js').handleMainPanelClick(ci);
            } catch (err) {
                console.error('[dashboard]', err);
                try {
                    const p = { content: `Error: ${err.message}`, flags: MessageFlags.Ephemeral };
                    if (ci.replied || ci.deferred) await ci.followUp(p);
                    else await ci.reply(p);
                } catch {}
            }
        });
    }
};

function buildMainPanel(isOwner = false) {
    const hero = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '# Lumen\nPress **Start Task** to choose a platform and begin.\n\n' +
                '• Saved accounts to avoid hassle\n' +
                '• Real-time question & task progress\n' +
                '• Customizable speed settings'
            )
        )
        .setThumbnailAccessory(
            new ThumbnailBuilder({ media: { url: 'https://i.postimg.cc/Y9j7vShY/0H0TBp3.png' } })
        );

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('lumen_start_task')
            .setLabel('Start Task')
            .setEmoji(emojis.tick)
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('lumen_saved_accounts')
            .setLabel('Saved Accounts')
            .setEmoji(emojis.accounts)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('lumen_settings')
            .setLabel('Settings')
            .setEmoji(emojis.settings)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('lumen_check_account')
            .setLabel('Check Account')
            .setEmoji(emojis.key)
            .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('lumen_check_queue')
            .setLabel('Check Queue')
            .setEmoji(emojis.queue)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('lumen_help')
            .setLabel('Help')
            .setEmoji(emojis.explanation)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('lumen_request_jailbreak')
            .setLabel(isOwner ? 'Request Jailbreak' : 'Coming Soon')
            .setStyle(isOwner ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(!isOwner)
    );

    return new ContainerBuilder()
        .setAccentColor(colours.sparx_reader)
        .addSectionComponents(hero)
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        )
        .addActionRowComponents(row1)
        .addActionRowComponents(row2);
}
