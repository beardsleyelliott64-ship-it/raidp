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
        .setDescription('Open the Phantom dashboard'),

    async execute(interaction) {
        const customizer = require('../../handlers/dashboardCustomizer.js');
        const savedComponents = customizer.loadCustomizations();

        // Keep the dashboard public and editable in place. Discord messages are
        // shared, so per-viewer disabled states are not possible on one public message;
        // every owner-only action is therefore protected again in its interaction handler.
        let msg = null;
        // Reuse the persisted public dashboard message rather than creating duplicates.
        try {
            const fs = require('node:fs');
            const path = require('node:path');
            const savedPath = path.join(__dirname, '..', '..', 'data', 'dashboard-message.json');
            if (fs.existsSync(savedPath)) {
                const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
                if (saved.guildId === interaction.guildId && saved.channelId) {
                    const channel = await interaction.client.channels.fetch(saved.channelId);
                    const existing = await channel.messages.fetch(saved.messageId);
                    if (existing) msg = await existing.edit({ flags: MessageFlags.IsComponentsV2, components: [buildMainPanel(savedComponents)] });
                }
            }
        } catch (error) { console.warn('[dashboard] Existing message unavailable; creating a replacement:', error.message); }
        if (msg) await interaction.reply({ content: 'Phantom dashboard refreshed in its existing message.', flags: MessageFlags.Ephemeral });
        else msg = await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [buildMainPanel(savedComponents)], fetchReply: true });
        customizer.registerDashboardMessage(interaction.guildId, msg.channelId, msg.id);
        if (interaction.user.id === (process.env.JAILBREAK_OWNER_ID || '1363240484818128926')) {
            await interaction.followUp({
                content: '**Phantom owner controls**\nThis private panel is only visible to you.',
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('lumen_customize_dashboard').setLabel('Customize Dashboard').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('lumen_manage_requests').setLabel('Manage Feature Requests').setStyle(ButtonStyle.Secondary)
                )],
                flags: MessageFlags.Ephemeral
            });
        }

        const collector = msg.createMessageComponentCollector({ time: 3_600_000 });

        collector.on('collect', async (ci) => {
            try {
                if (ci.customId === 'lumen_customize_dashboard' || ci.customId === 'lumen_request_feature' || ci.customId === 'lumen_manage_requests' || ci.customId.startsWith('lumen_request_') || ci.customId.startsWith('lumen_custom_ui_')) return;
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

function buildMainPanel(customizations = []) {
    const hero = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '# Phantom\nPress **Start Task** to choose a platform and begin.\n\n' +
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
            .setCustomId(require('../../handlers/dashboardCustomizer.js').getPublicCustomization() ? 'lumen_customize_dashboard' : 'lumen_coming_soon')
            .setLabel(require('../../handlers/dashboardCustomizer.js').getPublicCustomization() ? 'Customize Dashboard' : 'Coming Soon')
            .setStyle(require('../../handlers/dashboardCustomizer.js').getPublicCustomization() ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(!require('../../handlers/dashboardCustomizer.js').getPublicCustomization())
    );

    const container = new ContainerBuilder()
        .setAccentColor(colours.sparx_reader)
        .addSectionComponents(hero)
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        )
        .addActionRowComponents(row1)
        .addActionRowComponents(row2);

    const customRows = require('../../handlers/dashboardCustomizer.js').buildCustomRows(customizations);
    if (customRows.length) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Custom Features\nOwner-published interactive tools'));
        for (const row of customRows) container.addActionRowComponents(row);
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Custom People Requests\nSuggest an idea for the Phantom owner to review. Requests are not published automatically.'));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lumen_request_feature').setLabel('Suggest a Feature').setStyle(ButtonStyle.Secondary)
    ));
    return container;
}

module.exports.buildMainPanel = buildMainPanel;
