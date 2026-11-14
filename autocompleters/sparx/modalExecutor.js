const getChildrenFromId = require('../../utils/getChildrenFromId.js');
const { MessageFlags } = require('discord.js');
const autocompleteWrapper = require('../../utils/autocompleteWrapper');
const queues = require('../../queues/queues.js');

async function modelExecutor(interaction) {
    const child = getChildrenFromId(interaction.customId)[0];

    const userSessions = require(`./children/${child}/userSessions.js`);
    if (interaction.customId === 'autocompleterModule_sparx(maths)_independant_learning') {
        await interaction.deferUpdate();
        const userSession = userSessions.get(interaction.user.id);
        const autocomplete = require('./children/maths/autocomplete.js');
        const queueMaths = queues.get('sparx_maths');

        const code = interaction.fields.getTextInputValue('code');
        const curriculumId = interaction.fields.getField('curriculum').values[0];
        const level = Number(interaction.fields.getField('level').values[0]);
        const sparxMaths = userSession.requesticator;
        try {

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

            const topicSummaries = await sparxMaths.listTopicSummariesRequest(topicSummariesRequest);

            const foundTopic = topicSummaries.topicSummaries.find(topic => topic.topic.code === code);

            foundTopic.learningPaths.sort((a, b) => {
                return Number(a.level) - Number(b.level);
            });

            const specName = foundTopic.learningPaths[level - 1].specName;
            const learningUnitNames = foundTopic.learningPaths[level - 1].learningUnitNames;

            const packagesActive = {
                "curriculumName": curriculumId,
                "topicLevelName": specName,
                "objectiveNames": learningUnitNames
            };

            const packagesResponse = await sparxMaths.getPackagesIndependantLearning(packagesActive);
            const packageId = packagesResponse.packages[0].packageId;

            if (!packageId) {
                throw new Error('No Package ID');
            }
            userSession.selectedHomework = packageId;

            userSession.selectRow.setDisabled(true);
            await userSession.updateEmbed(true);

            await queueMaths.addQueue({
                action: async () => {
                    return await autocompleteWrapper(
                        interaction, 
                        'sparx(maths)', 
                        userSession, 
                        () => autocomplete(userSession)
                    );
                },
                id: interaction.user.id,
                interaction: interaction
            });
        } catch {
            await interaction.followUp({ flags: MessageFlags.Ephemeral, content: "Invalid Code or an Error Occured" });
        }
    } else if (interaction.customId === 'autocompleterModule_sparx(reader)_changeMode') {
        await interaction.deferUpdate();
        const modeType = interaction.fields.getField('type').values[0];
        const userSession = userSessions.get(interaction.user.id);
        userSession.mode = modeType;
        await userSession.updateEmbed();
    }

}

module.exports = modelExecutor;