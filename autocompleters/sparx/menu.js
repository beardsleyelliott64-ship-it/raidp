const { MessageFlags, LabelBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
// const autocomplete = require('./autocomplete');
const { checkAccount } = require('../../database/accounts');
const positiveNounChanger = require('./positiveNounChanger');
const autocompleteWrapper = require('../../utils/autocompleteWrapper');
const queues = require('../../queues/queues.js');

async function menu(userSession) {
    // Never leave the ephemeral login message stuck on "Loading..." if a
    // Sparx API call fails while building the post-login panel.
    try {
        await userSession.init();
        const userAccount = await checkAccount(userSession.interaction.user.id) || {};
        await userSession.loadFromObject({settings: userAccount[`sparx_${userSession.platform}_settings`]});
    } catch (err) {
        console.error(`[Sparx ${userSession.platform}] Failed to initialise menu:`, err);
        const { ContainerBuilder, TextDisplayBuilder } = require('discord.js');
        const { colours } = require('../../config.json');
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ❌ Failed to load ${userSession.platform}\nSparx logged you in, but the account panel could not be loaded.\n\n\`${String(err.message || err).slice(0, 900)}\`\n\nPlease try the account again.`
            ));
        await userSession.interaction.editReply({ components: [container] }).catch(() => {});
        return;
    }

    let hwMessage;
    try {
        hwMessage = await userSession.updateEmbed();
    } catch (err) {
        console.error(`[Sparx ${userSession.platform}] Failed to build menu:`, err);
        const { ContainerBuilder, TextDisplayBuilder } = require('discord.js');
        const { colours } = require('../../config.json');
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ❌ Failed to load ${userSession.platform}\nSparx login succeeded, but homework data could not be loaded.\n\n\`${String(err.message || err).slice(0, 900)}\``
            ));
        await userSession.interaction.editReply({ components: [container] }).catch(() => {});
        return;
    }
    const collector = hwMessage.createMessageComponentCollector({
        time: 600_000
    });

    collector.on('collect', async (interaction) => {
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_homework') {
            await interaction.deferUpdate();
            userSession.selectedHomework = interaction.values[0];
            userSession.selectedHomeworkDue = userSession.homeworksEnddate[interaction.values[0]];
            await userSession.updateEmbed();
            return;
        }

        if (interaction.isButton()) {
            if (interaction.customId === 'start') {
                await interaction.deferUpdate();
                await userSession.updateEmbed(true);
                const autocomplete = require(`./children/${userSession.platform}/autocomplete`);
                const queueToUse = queues.get(`sparx_${userSession.platform}`);
                const platform = `sparx(${userSession.platform})`;
                await queueToUse.addQueue({
                    action: async () => {
                        return await autocompleteWrapper(
                            interaction, 
                            platform, 
                            userSession, 
                            () => autocomplete(userSession)
                        );
                    },
                    id: interaction.user.id,
                    interaction: interaction
                });
            } else if (interaction.customId === 'save_account') {
                const modal = new ModalBuilder()
                    .setCustomId(`save_account_sparx(${userSession.platform})`)
                    .setTitle(`Save Account`);
                const input = new TextInputBuilder()
                    .setCustomId('master_password')
                    .setLabel('Master Password')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                await interaction.showModal(modal);
            } else if (interaction.customId === 'tag_changer') { 
                await positiveNounChanger(interaction, userSession);
            } else if (interaction.customId === 'mode') {
                const modal = new ModalBuilder()
                    .setCustomId(`autocompleterModule_sparx(reader)_changeMode`)
                    .setTitle(`Mode`);
                const typeInput = new StringSelectMenuBuilder()
                    .setCustomId('type')
                    .setPlaceholder("Choose a Mode")
                    .addOptions(
                        { label: "Read Until Points Target Achieved", value: "Read Until Points Target Achieved" },
                        { label: "Read Until Book Completed", value: "Read Until Book Completed" }
                    );
                const typeLabel = new LabelBuilder({
                    label: 'Mode Type',
                    component: typeInput
                });

                modal.addLabelComponents(typeLabel);
                await interaction.showModal(modal);
            } else if (interaction.customId === 'settings') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const { settingsDisplayer } = require('../../generic/settingsDisplayer.js');
                await settingsDisplayer(interaction, `sparx_${userSession.platform}`);
            } else if (interaction.customId === 'independent_learning') {
                if (userSession.platform === 'maths') {
                    const modal = new ModalBuilder()
                        .setCustomId(`autocompleterModule_sparx(maths)_independant_learning`)
                        .setTitle('Independant Learning Code');

                    const curriculums = await userSession.requesticator.listCurriculumSummaries({
                        "includeHidden": false,
                        "subjectName": ""
                    });

                    const curriculumInput = new StringSelectMenuBuilder()
                        .setCustomId('curriculum')
                        .setPlaceholder("Curriculum");

                    for (const cur of curriculums.curriculumSummaries) {
                        // console.log(cur.curriculum.displayName, cur.curriculum.name);
                        curriculumInput.addOptions({ label: cur.curriculum.displayName, value: cur.curriculum.name });
                    }

                    const levelInput = new StringSelectMenuBuilder()
                        .setCustomId('level')
                        .setPlaceholder("Level")
                        .addOptions(
                            { label: "Level 1", value: "1" },
                            { label: "Level 2", value: "2" },
                            { label: "Level 3", value: "3" },
                            { label: "Level 4", value: "4" },
                            { label: "Level 5", value: "5" }
                        );

                    const curriculumLabel = new LabelBuilder({
                        label: 'Curriculum',
                        component: curriculumInput
                    });
                    const levelLabel = new LabelBuilder({
                        label: 'Level',
                        component: levelInput
                    });

                    const cookieInput = new TextInputBuilder()
                        .setCustomId('code')
                        .setLabel('Code')
                        .setStyle(TextInputStyle.Short);

                    modal.addLabelComponents(curriculumLabel);
                    modal.addComponents(new ActionRowBuilder().addComponents(cookieInput));
                    modal.addLabelComponents(levelLabel);
                    await interaction.showModal(modal);
                }
            } else if (interaction.customId === 'xp_farming') {
                await interaction.deferUpdate();
                const curriculums = await userSession.requesticator.listCurriculumSummaries({
                    "includeHidden": false,
                    "subjectName": ""
                });

                const curriculumInput = new StringSelectMenuBuilder()
                    .setCustomId('curriculum')
                    .setPlaceholder("Curriculum");

                for (const cur of curriculums.curriculumSummaries) {
                    // console.log(cur.curriculum.displayName, cur.curriculum.name);
                    curriculumInput.addOptions({ label: cur.curriculum.displayName, value: cur.curriculum.name });
                }
                const curriculum = curriculums.curriculumSummaries.find(cur => cur.curriculum.displayName === 'GCSE');
                const curriculumId = curriculum.curriculum.name;

                const topicSummariesRequest = {
                    "topicParent": curriculumId,
                    "options": {
                        "includeLearningPaths": true,
                        "omitKeyQuestions": true,
                        "omitTopicLinks": false,
                        "includeAllQuestions": false,
                        "includeQuestionLayoutJson": false,
                        "includeSkillFlagsAndTags": false
                    }
                };

                const topicSummaries = await userSession.requesticator.listTopicSummariesRequest(topicSummariesRequest);
                const queue = queues.get('sparx_maths');
                const autocomplete = require('./children/maths/autocomplete');
                queue.changeFarmingStatus(interaction.user.id, 'ongoing');
                let farmingBlocked = false;
                for (const summary of topicSummaries.topicSummaries) {
                    if (farmingBlocked) break;
                    for (const learningPath of summary.learningPaths) {
                        const specName = learningPath.specName;
                        const learningUnitNames = learningPath.learningUnitNames;

                        const packagesActive = {
                            "curriculumName": curriculumId,
                            "topicLevelName": specName,
                            "objectiveNames": learningUnitNames
                        };

                        const packagesResponse = await userSession.requesticator.getPackagesIndependantLearning(packagesActive);
                        const packageId = packagesResponse.packages[0].packageId;

                        if (!packageId) {
                            continue;
                        }
                        userSession.selectedHomework = packageId;

                        userSession.selectRow.setDisabled(true);
                        await userSession.updateEmbed(true);
                        await queue.waitUntilNoUse(interaction.user.id);
                        const returnValue = await queue.addQueue({
                            action: async () => {
                                return await autocompleteWrapper(
                                    interaction, 
                                    'sparx(maths)', 
                                    userSession, 
                                    () => autocomplete(userSession)
                                );
                            },
                            id: interaction.user.id,
                            interaction: interaction,
                            farming: true
                        });
                        if (returnValue === 'blocked') {
                            farmingBlocked = true;
                            break;
                        }
                    }
                }
            }
        }
    });

    collector.on('end', async () => {
        await userSession.updateEmbed(true);
    });
}

module.exports = menu;