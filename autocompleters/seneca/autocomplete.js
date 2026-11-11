const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { DynamicSessionGenerator } = require('./parser');
const progressTracker = require('../../utils/progressTracker');
const { emojis, colours } = require('../../config.json');
const getProgressBar = require('../../utils/getProgressBar');
const formatTime = require('../../utils/formatTime');
const logger = require('../../utils/logger.js');
const { logError } = require('../../utils/errorLogger.js');

async function autocomplete(userSession) {
    const log = new logger(userSession.interaction.user.id, 'seneca');
    log.logToFile('Logging Start');
    log.logToFile('Settings', userSession.settings);

    const taskInfos = [];
    const sectionsProgress = [];
    let currentGroup = [];

    for (const sectionId of userSession.sectionIds) {
        const section = userSession.sectionStats.find(item => item.sectionId === sectionId) ?? { sectionId: sectionId, bestScore: 0 };

        const contentsUrl = await userSession.requesticator.get(`https://course.app.senecalearning.com/api/courses/${userSession.courseId}/signed-url?sectionId=${sectionId}&contentTypes=standard,hardestQuestions`, {
            "sectionId": sectionId,
            "contentTypes": "standard"
        });
        // console.log('Url', `https://course.app.senecalearning.com/api/courses/${userSession.courseId}/signed-url?sectionId=${sectionId}&contentTypes=standard,hardestQuestions`);

        const taskInfo = await userSession.requesticator.get(contentsUrl.url);
        taskInfos.push(taskInfo);

        const progressEntry = {
            name: `- ${taskInfo.title}`,
            value: getProgressBar(section.bestScore, 1),
            percentage: section.bestScore / 1 * 100
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

    const getTimeField = function () {
        return `**Time Spent:** ${formatTime((process.hrtime(this.taskTimer))[0])}\n**Time Simulated:** ${formatTime(this.totalSeconds)}`;
    };
    const getSettingsField = function () {
        return `**Time Settings:** ${userSession.settings.min}-${userSession.settings.max} Seconds`;
    };

    const progressUpdater = new progressTracker(userSession.interaction, getTimeField, getSettingsField, null, 'Seneca', 'seneca', userSession.selectedHomeworkDue, userSession);
    if (await progressUpdater.start(sectionsProgress)) return;

    try {
        for (const [index, taskInfo] of taskInfos.entries()) {
            if (progressUpdater.cancelled) break;
            await progressUpdater.updateEmbed(`Answering Questions for ${taskInfo.title}...`);
            await userSession.requesticator.startSession(userSession.courseId, taskInfo.id);

            const timeQuestions = [];
            let fakeTime = 0;
            for (let i = 0; i < 5; i++) {
                const timeTaken = Math.floor(Math.random() * (userSession.settings.max - userSession.settings.min + 1)) + userSession.settings.min;
                timeQuestions.push(timeTaken);
            }

            const generator = new DynamicSessionGenerator(taskInfo);

            const answerData = generator.generate({
                userId: userSession.userId,
                sessionId: userSession.requesticator.sessionId,
                durations: timeQuestions
            });

            const start = new Date(answerData.session.timeStarted);
            const finish = new Date(answerData.session.timeFinished);
            fakeTime += Math.floor((finish - start) / 1000);

            log.logToFile('Answer Data', JSON.stringify(answerData, null, 2));
            // console.log('Answer data', answerData);
            await userSession.requesticator.post('https://session.app.senecalearning.com/api/session', answerData);

            progressUpdater.totalSeconds += fakeTime;
            await progressUpdater.updateProgressBar(index, 1);
        }

        if (progressUpdater.cancelled) {
            await progressUpdater.updateEmbed(`Cancelled`);
        } else {
            await progressUpdater.updateEmbed(`Finished`);
        }
    } catch (err) {
        log.logToFile(err);
        logError(err, userSession.interaction.user.id, 'Seneca', log.filepath);
    } finally {
        await progressUpdater.end();
        await log.send(userSession.interaction.user);
    }

    return progressUpdater.totalSeconds;
}

module.exports = autocomplete;