// language: JavaScript, file: commands/utility/dashboard.js
// Drop into commands/utility/ — registers /dashboard in the existing deployment flow.

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

const { colours } = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Open the Lumen autocompleter dashboard'),

    async execute(interaction) {
        const { handleDashboardInteraction } = require('../../handlers/readerBookmarkletFlow.js');

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

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('lumen_start_task')
                .setLabel('Start Task')
                .setStyle(ButtonStyle.Success)
        );

        const panel = new ContainerBuilder()
            .setAccentColor(colours.sparx_reader)
            .addSectionComponents(hero)
            .addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    '### Quick Start\n`START TASK`  Connect a platform and run homework automatically'
                )
            )
            .addActionRowComponents(row);

        const msg = await interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [panel],
            fetchReply: true
        });

        // Single collector handles all interactions on this message for 10 minutes
        const collector = msg.createMessageComponentCollector({ time: 600_000 });

        collector.on('collect', async (ci) => {
            try {
                await handleDashboardInteraction(ci, interaction);
            } catch (err) {
                console.error('[dashboard:collector]', err);
                try {
                    const p = { content: `Something went wrong: ${err.message}`, flags: MessageFlags.Ephemeral };
                    if (ci.replied || ci.deferred) await ci.followUp(p);
                    else await ci.reply(p);
                } catch {}
            }
        });

        collector.on('end', () => {
            // Silently expire — the message already has disabled components if
            // the autocompleter finished, otherwise Discord collapses the interaction.
        });
    }
};
