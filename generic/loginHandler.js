const { MessageFlags, LabelBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ComponentType } = require('discord.js');
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

    const collector = message_sent.createMessageComponentCollector({
        time: 420_000,
        componentType: ComponentType.Button
    });

    collector.on('collect', async (componentInteraction) => {
        if (componentInteraction.customId === 'login') {

            const modal = new ModalBuilder()
                .setCustomId(`autocompleterModule_${platform}_login`)
                .setTitle('Login');

            // Add input components to the modal
            const usernameInput = new TextInputBuilder()
                .setCustomId('username')
                .setLabel('Username')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const passwordInput = new TextInputBuilder()
                .setCustomId('password')
                .setLabel('Password')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            // Create action rows to hold the inputs
            if (school) {
                const schoolInput = new TextInputBuilder()
                    .setCustomId('school')
                    .setLabel('School')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const emailRow = new ActionRowBuilder().addComponents(schoolInput);
                modal.addComponents(emailRow);
            }
            const usernameRow = new ActionRowBuilder().addComponents(usernameInput);
            const passwordRow = new ActionRowBuilder().addComponents(passwordInput);

            // Add the action rows to the modal
            modal.addComponents(usernameRow, passwordRow);

            if (type) {
                const typeInput = new StringSelectMenuBuilder()
                    .setCustomId('type')
                    .setPlaceholder("Normal/Microsoft/Google")
                    .addOptions(
                        { label: "Normal", value: "Normal", emoji: emojis.sparx },
                        { label: "Microsoft", value: "Microsoft", emoji: emojis.microsoft },
                        { label: "Google", value: "Google", emoji: emojis.google }
                    );

                const typeLabel = new LabelBuilder({
                    label: 'Login Type',
                    component: typeInput
                });

                modal.addLabelComponents(typeLabel);
            }

            await componentInteraction.showModal(modal);
        } else if (componentInteraction.customId === `${platform}_savedAccounts_view`) {
            const { handleSavedAccounts } = require('../handlers/savedAccountsHandler.js');
            await handleSavedAccounts(componentInteraction, componentInteraction.customId.split('_')[2], platform);
        } else if (componentInteraction.customId === 'login_cookies') {

            const modal = new ModalBuilder()
                .setCustomId(`autocompleterModule_${platform}_loginCookie`)
                .setTitle('Login');

            // Add input components to the modal
            const usernameInput = new TextInputBuilder()
                .setCustomId('cookie')
                .setLabel('Cookie')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            const usernameRow = new ActionRowBuilder().addComponents(usernameInput);
            modal.addComponents(usernameRow);
            await componentInteraction.showModal(modal);
        }
    });

    collector.on('end', async () => {
        const newcontainer = disableComponents(container);
        await interaction.editReply({
            components: [newcontainer]
        });
    });

    return message_sent;
}

module.exports = loginHandler;