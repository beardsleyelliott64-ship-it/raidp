const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const progressTracker = require('../../utils/progressTracker');
const { emojis, colours } = require('../../config.json');
const getProgressBar = require('../../utils/getProgressBar');
const formatTime = require('../../utils/formatTime');

async function autocomplete(userSession) {
    const homework = userSession.homeworks[0];
    const settings = userSession.settings;
    const to_language = homework.languageCode;

    // const tasksInHomework = homework.tasks.length;
    // const totalEstimatedTime = parseInt(homework.estimated_time) || 0;
    const cancel = new ButtonBuilder()
        .setCustomId('cancel')
        .setLabel('Cancel')
        .setEmoji(emojis.x)
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder()
        .addComponents(cancel);

    const initialEmbed = new EmbedBuilder()
        .setColor(colours.languagenut)
        .setTitle('LanguageNut Autocompleter')
        .setDescription(`\`Starting Questions...\``);

    const taskTimer = process.hrtime();
    let fakeTimeTotal = 0;

    const getTimeField = function () {
        return `> **Time Spent**: ${formatTime((process.hrtime(taskTimer))[0])}\n> **Time Simulated**: ${formatTime(fakeTimeTotal)}`;
    };

    const progressUpdater = new progressTracker(userSession.interaction, getTimeField);
    let currentGroup = [];
    const sectionsProgress = [];
    for (const task of homework.tasks) {
        const progressEntry = {
            name: task.name,
            value: getProgressBar(Number(task.gameResults?.percentage || 0) / 100, 1)
        };

        // Push into current group
        currentGroup.push(progressEntry);

        // If group reaches 5, push it to the main array and start new group
        if (currentGroup.length === 5) {
            sectionsProgress.push(currentGroup);
            currentGroup = [];
        }
    }
    if (currentGroup.length > 0) {
        sectionsProgress.push(currentGroup);
    }

    if (await progressUpdater.start(initialEmbed, row, sectionsProgress)) return;

    const minTime = settings.min;
    const maxTime = settings.max;
    const accuracySet = settings.accuracy / 100;

    for (let i = 0; i < homework.tasks.length; i++) {
        if (progressUpdater.cancelled) break;
        const task = homework.tasks[i];
        await progressUpdater.updateEmbed(`Completing ${task.name}...`);
        userSession.requesticator.loadFromObject({to_language, task, catalog_uid: task.catalog_uid || task.base[task.base.length - 1], rel_module_uid: task.rel_module_uid, game_uid: task.game_uid, game_type: task.type, homework_id: task.base[0]});
        userSession.requesticator.getTaskType();
        const answers = await userSession.requesticator.getData();

        const correctVocabs = [];
        const incorrectVocabs = [];
        let timestampOffset = 0;
        for (const answer of answers) {
            if (correctVocabs.length / answers.length < accuracySet) {
                correctVocabs.push(answer.uid);
            } else {
                incorrectVocabs.push(answer.uid);
            }
            timestampOffset += (Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime);
        }
        // await task_doer.logGameStart();
        // await task_doer.logHomeworkStart();
        await userSession.requesticator.send_answers(correctVocabs, incorrectVocabs, timestampOffset); // awrtfuoivg: '86935'
        // await task_doer.logGameEnd();

        fakeTimeTotal += timestampOffset;
        await progressUpdater.updateProgressBar(i, correctVocabs.length / answers.length);
        // this.token = task_doer.token;
    }

    await progressUpdater.updateEmbed(`Finished`);
    await progressUpdater.end();
    return fakeTimeTotal;
}

module.exports = autocomplete;