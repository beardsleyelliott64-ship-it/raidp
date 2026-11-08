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
        const msg = await interaction.reply({
            flags: MessageFlags.IsComponentsV2,
            components: [buildMainPanel()],
            fetchReply: true
        });

        const collector = msg.createMessageComponentCollector({ time: 3_600_000 });

        collector.on('collect', async (ci) => {
            try {
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

function buildMainPanel() {
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
            .setStyle(ButtonStyle.Secondary)
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
