const { MessageFlags, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { checkAccount } = require('../../database/accounts');
const autocomplete = require('./autocomplete');
const autocompleteWrapper = require('../../utils/autocompleteWrapper');

async function menu(userSession) {
    await userSession.init();

    const userAccount = await checkAccount(userSession.interaction.user.id);
    userSession.loadFromObject({settings: userAccount.seneca_settings});
    const hwMessage = await userSession.updateEmbed();
    const collector = hwMessage.createMessageComponentCollector({
        time: 600_000
    });

    collector.on('collect', async (componentInteraction) => {

        if (componentInteraction.isStringSelectMenu()) {
            await componentInteraction.deferUpdate();
            userSession.selectedHomework = componentInteraction.values[0];
            userSession.selectedHomeworkDue = userSession.homeworksEnddate[componentInteraction.values[0]];
            await userSession.updateEmbed();
        } else if (componentInteraction.isButton()) {
            if (componentInteraction.customId === 'start') {
                await componentInteraction.deferUpdate();
                await userSession.updateEmbed(true);
                // console.log(userSession.assignments);
                const homeworkTask = userSession.assignments.items.find(item => item.id === userSession.selectedHomework);
                const courseId = homeworkTask.spec.courseId;
                userSession.loadFromObject({courseId, sectionIds: homeworkTask.spec.sectionIds, sectionStats: homeworkTask.sectionStats});
                await autocompleteWrapper(componentInteraction, 'seneca', userSession, () => autocomplete(userSession));
            } else if (componentInteraction.customId === 'save_account') {
                const modal = new ModalBuilder()
                    .setCustomId(`save_account_seneca`)
                    .setTitle(`Save Account`);
                const input = new TextInputBuilder()
                    .setCustomId('master_password')
                    .setLabel('Master Password')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                await componentInteraction.showModal(modal);
            } else if (componentInteraction.customId === 'settings') {
                await componentInteraction.deferReply({ flags: MessageFlags.Ephemeral });
                const { settingsDisplayer } = require('../../generic/settingsDisplayer.js');
                await settingsDisplayer(componentInteraction, userSession.platform);
            }
        }
    });
    
}

module.exports = menu;