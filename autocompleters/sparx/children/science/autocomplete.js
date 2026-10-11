const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { emojis, colours } = require('../../../../config.json');
const parseQuestionForDB = require('../../parseQuestionForDB.js');
const SparxParser = require('./parser.js');
const { appendToDB, getFromDB, getSparxQuestion, updateSparxAnswerRPC } = require('../../../../database/general.js'); // deleteEntryDB
const { logError } = require('../../../../utils/errorLogger.js');
const progressTracker = require('../../../../utils/progressTracker.js');
const formatTime = require('../../../../utils/formatTime');
const getProgressBar = require('../../../../utils/getProgressBar');
const getAIanswer = require('../../../../utils/getAIanswer.js');
const logger = require('../../../../utils/logger.js');
const { checkAccount } = require('../../../../database/accounts.js');
const convertAItoObject = require('../../../../utils/convertAItoObject.js');
const isHigherModel = require('../../../../utils/isHighestModel.js');
const queues = require('../../../../queues/queues.js');

class sparxScienceAutocompleter {
    constructor(sparxScience, interaction) {
        this.sparxScience = sparxScience;
        this.interaction = interaction;
    }

    async getAnswerFromDB(question) {
        return await getSparxQuestion(question.content, 'sparx_science');
    }

    async answerQuestion(answerObject) {
        const questionResponse = await this.sparxScience.answerQuestion(answerObject);
        return questionResponse;
    }

    async readyQuestion(activity, token) {
        const questionResponse = await this.sparxScience.readyQuestion(activity, token);
        return questionResponse?.activity?.state?.token;
    }

}

async function sparxScienceAutocomplete(userSession) {
    const interaction = userSession.interaction;
    const sparxScience = userSession.requesticator;
    const packageID = userSession.selectedHomework;
    const apikeys = (await checkAccount(interaction.user.id)).apikeys;
    const ai = convertAItoObject(userSession.settings.model);
    const log = new logger(userSession.interaction.user.id, 'sparx_science');
    sparxScience.log = log;
    log.logToFile('Logging Start');
    log.logToFile(`**Settings**\nFaketime Min: ${userSession.settings.min}\nFaktime Max: ${userSession.settings.max}`);

    const queueScience = queues.get('sparx_science');
    const parser = new SparxParser(apikeys);

    const taskTimer = process.hrtime();

    const sparxScienceExecuter = new sparxScienceAutocompleter(sparxScience, interaction);

    const getTimeField = function () {
        return `**Time Spent:** ${formatTime((process.hrtime(taskTimer))[0])}`;
    };

    const getSettingsField = function () {
        return `**Time Settings:** ${userSession.settings.min}-${userSession.settings.max} Seconds`;
    };

    const progressUpdater = new progressTracker(interaction, getTimeField, getSettingsField, sparxScienceExecuter, 'Sparx Science', 'sparx_science', userSession.selectedHomeworkDue, userSession);
    let errorOccured = false;
    let aiFailed = false;

    try {

        let homeworkTasks = await sparxScience.getTaskItems(packageID);
        if ((homeworkTasks.package.contents.tasks.length === 0)) {
            await sparxScience.generateTaskItems(packageID);
            homeworkTasks = await sparxScience.getTaskItems(packageID);
        }

        const sectionsProgress = [];
        const tasksScores = [];
        let currentGroup = [];
        for (const task of homeworkTasks.package.contents.tasks) {
            let totalCorrect = 0;
            let total;
            if (task.type === 'flashcards') {
                let correct = task?.state?.completion?.progress?.C ?? 0;
                let halfCorrect = task?.state?.completion?.progress?.FNR ?? 0;
                totalCorrect = correct + (halfCorrect * 0.5);
                total = task?.state?.completion?.size ?? 10;
            } else {
                totalCorrect = 0;
                total = task.contents.skillsTask.taskItems.length;
                for (const skillTask of task.contents.skillsTask.taskItems) {
                    if (skillTask.state.completed) totalCorrect++;
                }
            }

            const progressEntry = { // ${Number(index)+1}
                name: `- ${task.title}`,
                value: getProgressBar(totalCorrect, total),
                percentage: totalCorrect / total * 100
            };

            tasksScores.push({ totalCorrect, total });

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

        if (await progressUpdater.start(sectionsProgress)) return;

        log.logToFile(homeworkTasks.package.contents.tasks);
        const shouldStop = async () => progressUpdater.cancelled || !(await queueScience.stillUsing(interaction.user.id));
    
        for (const task of homeworkTasks.package.contents.tasks) {
            if (await shouldStop()) break;
            await progressUpdater.updateEmbed(`Moving onto Task ${task.taskIndex + 1}...`);
            log.logToFile(`Moving onto Task ${task.taskIndex + 1}...`);
            let index = 0;
            for (const skillTask of task.contents.skillsTask.taskItems) {
                if (await shouldStop()) break;
                index++;
                if (skillTask.state.completed) continue;
                let stayOnQuestion = true;
                let aiModel = ai[0];
                log.logToFile(`Task type: ${task.type}`);
                let isFlashcard = task.type === 'flashcards';
                let timesIncorrect = 0;
                let timesO = 0;
                let supportMaterial = '';
                while (stayOnQuestion && timesO < 20) {
                    timesO += 1;
                    if (isFlashcard) {
                        await progressUpdater.updateEmbed(`Completing Flashcards at Task ${task.taskIndex + 1}...`);
                        log.logToFile(`Completing Flashcards at Task ${task.taskIndex + 1}...`);
                    } else if (aiModel === ai[0]) {
                        await progressUpdater.updateEmbed(`Completing Question ${index} at Task ${task.taskIndex + 1}...`);
                        log.logToFile(`Completing Question ${index} at Task ${task.taskIndex + 1}...`);
                    } else {
                        await progressUpdater.updateEmbed(`Retrying Question ${index} at Task ${task.taskIndex + 1}...`);
                        log.logToFile(`Retrying Question ${index} at Task ${task.taskIndex + 1}...`);
                    }
                    const questionActivity = await sparxScience.getQuestionActivity(skillTask.name);
                    log.logToFile(questionActivity);
                    const activityName = questionActivity.activity.name;
                    let token = questionActivity.activity.state.token;
                    log.logToFile("Token (1)", token);
                    const question = await sparxScience.getQuestion(questionActivity.activity.name);
                    if (!question?.activity?.state?.skillActivity?.question?.questionJson) break;
                    const questionLayout = JSON.parse(question.activity.state.skillActivity.question.questionJson);

                    const readyResponse = await sparxScienceExecuter.readyQuestion(activityName, token);
                    if (readyResponse) {
                        token = readyResponse;
                    }
                    log.logToFile("Token (2)", token);

                    await progressUpdater.wait(userSession.settings, isFlashcard ? `Waiting to Complete Flashcards at Task ${task.taskIndex + 1}` : `Waiting to Complete Question ${index} at Task ${task.taskIndex + 1}`, shouldStop);

                    /*
                    So there's three possible states it can be:
                    - There's no question in the db and so we should add it after (with or without the correct answer)
                    - The question is in the db but without an answer and so we should retry if we have a higher ai model, otherwise break
                    - The question is in the db WITH an answer so try it and delete the entry from the db if its wrong
                    */
                    const questionParsedForDB = parseQuestionForDB(question.activity.state.skillActivity.question.questionJson, true);
                    let aiAnswered = await sparxScienceExecuter.getAnswerFromDB(questionParsedForDB);
                    const previousIncorrectAnswers = aiAnswered?.incorrect_answers;
                    const alreadyInDBCorrect = !!aiAnswered?.answer;
                    const InDb = !!aiAnswered;

                    if (!aiAnswered?.answer && !ai[0]) {
                        stayOnQuestion = false;
                        break;
                    }

                    let failedQuestion = !aiAnswered?.answer && InDb;
                    let shouldTry = true;
                    log.logToFile(`Question was failed ${failedQuestion}`);
                    log.logToFile('questionParsedForDB.content', JSON.stringify(questionParsedForDB.content, null, 0));
                    if (failedQuestion) { // S2
                        let nextBetterModel = null;

                        for (const item of Object.values(ai)) {
                            if (!item) break;
                            const model = `gemini-${item}`;

                            if (isHigherModel(model, aiAnswered.ai_model)) {
                                nextBetterModel = item;
                                break;
                            }
                        }

                        if (!nextBetterModel) shouldTry = false;
                        if (nextBetterModel) aiModel = nextBetterModel;
                    }

                    log.logToFile('Should try', shouldTry);
                    if (!shouldTry) { // S2 Break
                        break;
                    }

                    log.logToFile('AI Answer before checks', JSON.stringify(aiAnswered, null, 2));
                    if (!aiAnswered?.answer) { // Try it with the ai
                        log.logToFile('Trying to run AI Model', aiModel);

                        aiAnswered = await getAIanswer(
                            () => parser.parse(questionLayout[questionLayout.length - 1], aiModel, activityName, token, supportMaterial, previousIncorrectAnswers),
                            queueScience,
                            interaction,
                            progressUpdater,
                            60000,
                            3000,
                            () => progressUpdater.cancelled
                        );
                        if (aiAnswered?.status === 'Failed due to Invalid AI Response') {
                            aiFailed = true;
                            throw new Error('AI Overloaded');
                        }

                        log.logToFile("AI Answer:");
                        log.logToFile(aiAnswered.action.answer.components);

                    } else {
                        log.logToFile('AIanswered before get question object', aiAnswered);
                        aiAnswered = parser.getQuestionObject(aiAnswered.answer, activityName, token);
                        log.logToFile("DB Answer:");
                        log.logToFile(aiAnswered.action.answer.components);
                    }

                    if (await shouldStop()) {
                        break;
                    }

                    log.logToFile('AI Answer after checks', JSON.stringify(aiAnswered, null, 2));

                    let errorCode = await sparxScienceExecuter.answerQuestion(aiAnswered);
                    log.logToFile('Question response after AI Answered', errorCode);
                    if (errorCode === 9) {
                        const readyResponse = await sparxScienceExecuter.readyQuestion(activityName, token);
                        if (readyResponse) {
                            token = readyResponse;
                            aiAnswered.token = token;
                        }
                        log.logToFile('About to input for twice', aiAnswered);
                        errorCode = await sparxScienceExecuter.answerQuestion(aiAnswered);
                        log.logToFile(`Error code twice`);
                        log.logToFile(errorCode);
                    }
                    log.logToFile("Token (3)", token);
                    // await progressUpdater.updateProgressBar(packageID, taskTimer);
                    let continuousRetry = errorCode.activity?.annotations?.multistep_type === "continuous";
                    log.logToFile(`Continious retry ${continuousRetry}`); // Need to check for flashcards if correct
                    let questionSuccecceed;
                    if (isFlashcard) { // marks
                        questionSuccecceed = errorCode.packageUpdate.contents.tasks[task.taskIndex].contents.skillsTask.taskItems[index - 1].state.marks === 1;
                        if (task?.state?.completion?.progress?.C !== errorCode.packageUpdate.contents.tasks[task.taskIndex].state?.completion?.progress?.C) {
                            task.state.completion.progress.C = errorCode.packageUpdate.contents.tasks[task.taskIndex].state?.completion.progress.C;
                            tasksScores[task.taskIndex].totalCorrect += 1;
                        } else if (task?.state?.completion?.progress?.FNR !== errorCode.packageUpdate.contents.tasks[task.taskIndex].state?.completion?.progress?.FNR) {
                            task.state.completion.progress.FNR = errorCode.packageUpdate.contents.tasks[task.taskIndex].state?.completion.progress.FNR;
                            tasksScores[task.taskIndex].totalCorrect += 0.5;
                        }
                    } else {
                        questionSuccecceed = errorCode.packageUpdate.contents.tasks[task.taskIndex].contents.skillsTask.taskItems[index - 1].state.status === 1;
                        if (questionSuccecceed) tasksScores[task.taskIndex].totalCorrect += 1;
                    }
                    log.logToFile('Question Succedded', questionSuccecceed);
                    if (errorCode.activity.state.skillActivity.question?.supportMaterial) {
                        supportMaterial = errorCode.activity.state.skillActivity.question.supportMaterial?.text;
                    }

                    if (alreadyInDBCorrect && !questionSuccecceed) {
                        log.logToFile('Deleting stuff in db I guess');
                        // await deleteEntryDB('sparx_science', 'content', JSON.stringify(questionLayout));
                    }
                    log.logToFile('Support Material', supportMaterial); // supportMaterial

                    log.logToFile('Task Score', tasksScores[task.taskIndex]);
                    await progressUpdater.updateProgressBar(task.taskIndex, tasksScores[task.taskIndex].totalCorrect, tasksScores[task.taskIndex].total);
                    log.logToFile('Stay questions', (aiModel === ai[1]), !(isFlashcard && questionSuccecceed), !continuousRetry);
                    if (aiModel === ai[1] && (timesIncorrect > 3 || isFlashcard) && !(isFlashcard && questionSuccecceed) && (timesIncorrect > 5 || !continuousRetry)) {
                        stayOnQuestion = false;
                    }

                    if (questionSuccecceed) {
                        if (!alreadyInDBCorrect) {
                            questionParsedForDB.answer = aiAnswered.action.answer.components;
                            if (!InDb) {
                                log.logToFile("Adding science question to db");                                
                                log.logToFile("Data to add", questionParsedForDB);
                                if (!questionParsedForDB.answer) {
                                    throw new Error('Data Answer for science not found');
                                }
                                appendToDB('sparx_science', questionParsedForDB);
                            } else {
                                log.logToFile("Updating science db with correct answer");
                                if (!questionParsedForDB.answer) {
                                    throw new Error('Data Answer for science update not found');
                                }
                                await updateSparxAnswerRPC(
                                    'sparx_science', 
                                    questionParsedForDB.content, 
                                    { answer: questionParsedForDB.answer }
                                );
                            }
                        }
                        timesIncorrect = 0;
                        aiModel = ai[0];
                    } else {
                        log.logToFile('Failed question!!');
                        const incorrect_answers = [aiAnswered.action.answer.components];
                        if (!InDb) {
                            log.logToFile('Question wrong, not in db');
                            questionParsedForDB.incorrect_answers = incorrect_answers;
                            questionParsedForDB.ai_model = aiModel;
                            await appendToDB('sparx_science', questionParsedForDB);
                        } else {
                            log.logToFile('Question wrong, failed question was in db');
                            previousIncorrectAnswers.push(...incorrect_answers);
                            log.logToFile('sparx_science', {incorrect_answers: previousIncorrectAnswers, ai_model: aiModel }, 'content', questionParsedForDB.content);
                            await updateSparxAnswerRPC(
                                'sparx_science', 
                                questionParsedForDB.content, 
                                { 
                                    incorrect_answers: previousIncorrectAnswers, 
                                    ai_model: aiModel 
                                }
                            );
                        }
                        timesIncorrect += 1;
                        aiModel = ai[1];
                        if (!aiModel) {
                            stayOnQuestion = false;
                        }
                    }
                }
                log.logToFile("We finished all questions!");
            }
        }

    } catch (err) {
        errorOccured = true;
        log.logToFile("Sparx science error");
        log.logToFile(err);
        logError(err, interaction.user.id, 'Sparx Science', log.filepath);
    } finally {
        await log.send(userSession.interaction.user);
        if (aiFailed) {
            await progressUpdater.updateEmbed(`The AI is overloaded, try again later or switch to 'No Modals' in the platform setting.`);
        }
        else if (errorOccured) {
            await progressUpdater.updateEmbed('An Unexpected Error has occured!');
        } else {
            await progressUpdater.updateEmbed('Finished');
        }
        await progressUpdater.end();
    }
    return (process.hrtime(taskTimer))[0];
}

module.exports = sparxScienceAutocomplete;