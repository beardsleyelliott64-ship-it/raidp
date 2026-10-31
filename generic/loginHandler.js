const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ComponentType, ButtonBuilder, ButtonStyle } = require('discord.js');
const { emojis } = require('../config.json');
const disableComponents = require('../utils/disableComponents.js');

async function loginHandler(interaction, container, platform, school=false, type=false) {
    let message_sent;
    if (interaction.deferred || interaction.replied) {
        message_sent = await interaction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container],
            fetchReply: true
        });
    } else {
        message_sent = await interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container],
            fetchReply: true
        });
    }

    // Stores chosen login type between the select step and the modal submit
    const pendingTypes = new Map();

    const collector = message_sent.createMessageComponentCollector({
        time: 420_000,
    });

    collector.on('collect', async (componentInteraction) => {
        const cid = componentInteraction.customId;

        // ── Type select (Sparx pre-modal step) ──────────────────────────────
        if (cid === 'login_type_select') {
            pendingTypes.set(componentInteraction.user.id, componentInteraction.values[0]);
            await componentInteraction.deferUpdate();
            return;
        }

        // ── Normal login button → open modal ────────────────────────────────
        if (cid === 'login') {
            // If type is required but nothing chosen yet, default to Normal
            if (type && !pendingTypes.has(componentInteraction.user.id)) {
                pendingTypes.set(componentInteraction.user.id, 'Normal');
            }

            const modal = new ModalBuilder()
                .setCustomId(`autocompleterModule_${platform}_login`)
                .setTitle('Login');

            if (school) {
                const schoolInput = new TextInputBuilder()
                    .setCustomId('school')
                    .setLabel('School')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(schoolInput));
            }

            const usernameInput = new TextInputBuilder()
                .setCustomId('username')
                .setLabel('Username / Email')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const passwordInput = new TextInputBuilder()
                .setCustomId('password')
                .setLabel('Password')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(usernameInput),
                new ActionRowBuilder().addComponents(passwordInput)
            );

            // If type is needed, embed the chosen value as a hidden text field
            if (type) {
                const chosen = pendingTypes.get(componentInteraction.user.id) || 'Normal';
                const typeInput = new TextInputBuilder()
                    .setCustomId('type_value')
                    .setLabel(`Login type (${chosen} selected — do not edit)`)
                    .setStyle(TextInputStyle.Short)
                    .setValue(chosen)
                    .setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(typeInput));
            }

            await componentInteraction.showModal(modal);
            return;
        }

        // ── Saved accounts ───────────────────────────────────────────────────
        if (cid === `${platform}_savedAccounts_view`) {
            const { handleSavedAccounts } = require('../handlers/savedAccountsHandler.js');
            await handleSavedAccounts(componentInteraction, 'view', platform);
            return;
        }

        // ── Cookie login ─────────────────────────────────────────────────────
        if (cid === 'login_cookies') {
            const modal = new ModalBuilder()
                .setCustomId(`autocompleterModule_${platform}_loginCookie`)
                .setTitle('Cookie Login');

            const cookieInput = new TextInputBuilder()
                .setCustomId('cookie')
                .setLabel('Cookie')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(cookieInput));
            await componentInteraction.showModal(modal);
        }
    });

    collector.on('end', async () => {
        try {
            const newcontainer = disableComponents(container);
            await interaction.editReply({ components: [newcontainer] });
        } catch {}
    });

    return message_sent;
}

module.exports = loginHandler;
