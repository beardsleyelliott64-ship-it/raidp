const { MessageFlags, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { checkAccount } = require('../../database/accounts');
const autocomplete = require('./autocomplete');
const autocompleteWrapper = require('../../utils/autocompleteWrapper');
const HOMEWORKS_PER_PAGE = 5;

async function menu(userSession) {

    const userAccount = await checkAccount(userSession.interaction.user.id);
    userSession.loadFromObject({settings: userAccount.languagenut_settings});
    const hwMessage = await userSession.updateEmbed();
    const collector = hwMessage.createMessageComponentCollector({
        time: 600_000
    });

    collector.on('collect', async (interaction) => {
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_homework') {

            const selectedHomeworkId = interaction.values[0];
            if (!selectedHomeworkId) {
                userSession.selectedHomeworkIndex = undefined;
            } else {
                const homeworkIndex = parseInt(selectedHomeworkId.split('_')[1]);
                userSession.selectedHomeworkIndex = homeworkIndex;
                userSession.homeworks = [userSession.originalHomeworks[homeworkIndex]];
            }

            await interaction.deferUpdate();
            await userSession.updateEmbed();
            return;
        }

        if (interaction.isButton()) {
            if (interaction.customId === 'start') {
                await interaction.deferUpdate();
                await userSession.updateEmbed(true);
                await autocompleteWrapper(interaction, 'languagenut', userSession, () => autocomplete(userSession));
            } else if (interaction.customId === 'homework_next_page' || interaction.customId === 'homework_prev_page') {
                await interaction.deferUpdate();
                const totalPages = Math.ceil(userSession.originalHomeworks.length / HOMEWORKS_PER_PAGE);

                if (interaction.customId === 'homework_next_page' && userSession.page < totalPages - 1) {
                    userSession.page++;
                } else if (interaction.customId === 'homework_prev_page' && userSession.page > 0) {
                    userSession.page--;
                }

                await userSession.updateEmbed();
            } else if (interaction.customId === 'save_account') {
                const modal = new ModalBuilder()
                    .setCustomId(`save_account_languagenut`)
                    .setTitle(`Save Account`);
                const input = new TextInputBuilder()
                    .setCustomId('master_password')
                    .setLabel('Master Password')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                await interaction.showModal(modal);
            } else if (interaction.customId === 'settings') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const { settingsDisplayer } = require('../../generic/settingsDisplayer.js');
                await settingsDisplayer(interaction, userSession.platform);
            }
        }
    });

    collector.on('end', async () => {
        await userSession.updateEmbed(true);
    });
}

module.exports = menu;