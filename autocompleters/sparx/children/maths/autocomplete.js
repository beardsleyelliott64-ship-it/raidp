const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags, AttachmentBuilder, ContainerBuilder, FileBuilder, TextDisplayBuilder } = require('discord.js');
const fs = require('fs').promises;
const { emojis, colours } = require('../../../../config.json');
const { getBookworks, addToDbBookwork } = require('../../../../database/bookwork.js');
const { appendToDB, getFromDB, updateDB, getSparxQuestion, updateSparxAnswerRPC } = require('../../../../database/general.js');
const { getBookworkCheckAnswer } = require('./bookwork.js');
const { convertToPDF } = require('./latexPDF.js');
const parseQuestionForDB = require('../../parseQuestionForDB.js');
const { logError } = require('../../../../utils/errorLogger.js');
const progressTracker = require('../../../../utils/progressTracker.js');
const formatTime = require('../../../../utils/formatTime');
const getProgressBar = require('../../../../utils/getProgressBar');
const getAIanswer = require('../../../../utils/getAIanswer.js');
const logger = require('../../../../utils/logger.js');
const userAutocompleters = {};
const convertAItoObject = require('../../../../utils/convertAItoObject.js');
const { checkAccount } = require('../../../../database/accounts.js');
const isHigherModel = require('../../../../utils/isHighestModel.js');
const makeGroupArray = require('../../../../utils/makeGroupArray.js');
const SparxQuestionParser = require('./parser');
const canonicalize = require('../../../../utils/canonicalize.js');
const queues = require('../../../../queues/queues.js');
const queue = queues.get('sparx_maths');

function simplifyAnswers(data) {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
        result[key] = (value && typeof value === 'object' && value.answer !== undefined) 
            ? value.answer 
            : value;
    }
    return result;
}

class sparxMathsAutocompleter {
    constructor(sparxMaths, interaction, packageID, log, settings) {
        this.sparxMaths = sparxMaths;
        this.interaction = interaction;
        this.packageID = packageID;
        this.log = log;
        this.currentBookmark = null;
        this.bookmarks = {};
        this.startTimestamp = Math.floor(Date.now() / 1000);
        this.totalFakeTime = 0;
        this.settings = settings;
    }

    async getAnswerFromDB(question) {
        return await getSparxQuestion(question.content, 'sparx_maths');
    }

    async sendBookWork() {

        const bookworkRow = await getBookworks(this.packageID);
        let bookworksObj = {};
        if (Array.isArray(bookworkRow.bookworks)) {
            bookworkRow.bookworks = '{}';
        };

        try {
            bookworksObj = JSON.parse(bookworkRow.bookworks || '{}');
        } catch (err) {
            console.error("Failed to parse bookworks:", err);
        }

        const pdfAttachment = await convertToPDF(bookworksObj, this.packageID, false, this.settings.pdfSettings.question);

        if (pdfAttachment) {
            const attachment = new AttachmentBuilder(pdfAttachment, { name: 'bookwork.pdf' });
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('# Session Finished!'))
                .addFileComponents(new FileBuilder().setURL('attachment://bookwork.pdf'));
            
            await this.interaction.user.send({ 
                files: [attachment], 
                components: [container], 
                flags: MessageFlags.IsComponentsV2 
            });
        } else {
            await this.interaction.user.send({
                components: [
                    new ContainerBuilder().addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('# Session Finished!\nCould not generate a PDF of the bookwork codes.')
                    )
                ], 
                flags: MessageFlags.IsComponentsV2 
            });
        }
    }

    async addAnswer(answer) {
        this.bookmarks[this.currentBookmark] = answer;
        await addToDbBookwork(this.packageID, { [this.currentBookmark]: this.bookmarks[this.currentBookmark] });
    }

    async readyBookwork(activityIndex) {
        const readyObj = {
            "activityIndex": activityIndex,
            "action": {
                "oneofKind": "wac",
                "wac": {
                    "actionType": 0,
                    "extraData": {}
                }
            },
            "timestamp": this.getTimestamp()
        };

        await this.sparxMaths.readyQuestion(readyObj);
    }

    async readyQuestion(questionIndex, activityIndex) {
        const readyObj = {
            "activityIndex": activityIndex,
            "action": {
                "oneofKind": "question",
                "question": {
                    "questionIndex": questionIndex,
                    "actionType": 0
                }
            },
            "timestamp": this.getTimestamp()
        };

        return await this.sparxMaths.readyQuestion(readyObj);
    }

    async answerQuestionWrapper(type, answerObject, sparxMathsExecuter, question, taskIndex, index) {
        const answerQResponse = await this.answerQuestion(answerObject, sparxMathsExecuter, question);
        if (answerQResponse === 'expired') {
            this.log.logToFile('Activity Expired Caught!!!!!');
            this.log.logToFile('taskIndex', taskIndex, ';index', index, ';type', type);
            let item;
            if (type === 'bookwork') {
                item = await this.sparxMaths.getActivity(sparxMathsExecuter.getTimestamp(), this.packageID, taskIndex, index, 1);
            } else {
                item = await this.sparxMaths.getActivity(sparxMathsExecuter.getTimestamp(), this.packageID, taskIndex, index);
            }
            this.log.logToFile('New activity item', item);
            const activityIndex = item.activityIndex;
            const questionIndex = item.payload.question.questionIndex;
            this.log.logToFile('questionIndex from Item', item.payload.question.questionIndex);
            this.log.logToFile('New activity Index', activityIndex);
            if (type === 'bookwork') {
                await sparxMathsExecuter.readyBookwork(activityIndex);
            } else {
                await sparxMathsExecuter.readyQuestion(questionIndex, activityIndex);
            }
            answerObject.activityIndex = activityIndex;
            answerObject.action.question.questionIndex = questionIndex;
            return await this.answerQuestion(answerObject, sparxMathsExecuter, question);
        }
        return answerQResponse;
    }

    async answerQuestion(answerObject, sparxMathsExecuter, question) {
        this.log.logToFile('Answer Object', answerObject);
        const answerResponse = await this.sparxMaths.answerQuestion(answerObject);
        this.log.logToFile('---');
        this.log.logToFile(answerResponse);
        if (answerResponse === 'ActivityExpired' || answerResponse === 'WrongQuestionState') {
            return 'expired';
        }
        if (!answerResponse?.response) {
            this.log.logToFile(`Unexpected ActivityAction response: ${JSON.stringify(answerResponse)}`);
            return false;
        }
        if (answerResponse.response.status === 'SUCCESS') {
            if (answerObject.action.oneofKind === 'wac') {
                return true;
            }

            // Sparx can return status SUCCESS with success:false when the answer is wrong
            const markedCorrect = answerResponse.response.success !== false
              && Number(answerResponse.response.taskItemStatus) !== 1;

            const result = String(answerResponse.response.givenAnswerXML || '')
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (markedCorrect) {
                await sparxMathsExecuter.addAnswer({ answer: result, question }).catch((e) => {
                    this.log.logToFile('bookwork store failed (non-fatal)', e?.message || e);
                });
                return true;
            }

            this.log.logToFile(`Answer marked incorrect by Sparx (given=${result}, taskItemStatus=${answerResponse.response.taskItemStatus})`);
            return false;
        }

        return false;

    }

    async answerTimesTable(activityIndex) {
        const timesTableInput = {
            "activityIndex": activityIndex,
            "action": {
                "oneofKind": "game",
                "game": {
                    "action": {
                        "oneofKind": "tablesAnswer",
                        "tablesAnswer": {
                            "answers": [
                                {
                                    "questionText": "6x5=?,30",
                                    "answerText": "30",
                                    "correct": true,
                                    "timedOut": false,
                                    "timeTaken": 2.959,
                                    "game": "100club",
                                    "enterCorrectionPhase": false,
                                    "leaveCorrectionPhase": false,
                                    "inputString": "0",
                                    "questionGap": 1000,
                                    "badData": false,
                                    "questionSetID": "tables",
                                    "deliveryMechanism": "basicKeypad",
                                    "target": false,
                                    "numPendingTalkAndLearns": 0,
                                    "context": 1,
                                    "didNotKnow": false,
                                    "indexWithinQuiz": 0,
                                    "talPromptType": "",
                                    "secondChance": false,
                                    "talCycleCount": 0,
                                    "indexWithinGameSession": 0,
                                    "isEndOfQuiz": false,
                                    "answerTime": this.getTimestamp()
                                }
                            ]
                        }
                    }
                }
            },
            "timestamp": this.getTimestamp()
        };

        await this.sparxMaths.answerTimesTable(timesTableInput);
    }

    async startTimesTable(packageId, taskIndex) {
        const timesTableInput = {
            "activityType": 3,
            "payload": {
                "oneofKind": "gameID",
                "gameID": "HundredClub"
            },
            "method": 0,
            "clientFeatureFlags": {},
            "taskItem": {
                "packageID": packageId,
                "taskIndex": taskIndex,
                "taskItemIndex": 0,
                "taskState": 0
            },
            "timestamp": this.getTimestamp()
        };

        const timestableStarted = await this.sparxMaths.startTimesTable(timesTableInput);
        return timestableStarted.activityIndex;
    }

    getTimestamp(addToUser) {
        // Random offset in seconds
        let offset = Math.floor(Math.random() * (this.settings.max - this.settings.min + 1)) + this.settings.min;
        this.startTimestamp += offset;
        if (addToUser) {
            this.totalFakeTime += offset;
        }

        // Random 3-digit number 100-999, then append six zeros
        const nanos = (Math.floor(Math.random() * 900) + 100) * 1_000_000;

        this.log.logToFile(`Time recorded is ${this.startTimestamp} and ${addToUser}`);

        return {
            "seconds": this.startTimestamp,
            "nanos": nanos
        };
    }

}

function addGroup(task) {
    let progressEntry = {
        name: task.title
    };
    if (task.title.endsWith('Times Tables')) {
        progressEntry.value = getProgressBar(task.completion.progress.C, task.completion.size);
        progressEntry.percentage = task.completion.progress.C / task.completion.size * 100;
    } else {
        progressEntry.value = getProgressBar(task.numTaskItemsDone, task.numTaskItems);
        progressEntry.percentage = task.numTaskItemsDone / task.numTaskItems * 100;
    }

    return progressEntry;
}

async function sparxMathsAutocomplete(userSession) {
    const interaction = userSession.interaction;
    const sparxMaths = userSession.requesticator;
    const packageID = userSession.selectedHomework;
    const account = await checkAccount(interaction.user.id);
    const apikeys = account?.apikeys ?? [];
    const ai = convertAItoObject(userSession.settings.model);
    const keyCount = Array.isArray(apikeys) ? apikeys.length : Object.keys(apikeys || {}).length;
    if ((!ai[0] || ai[0] === 'No Models') && keyCount) ai[0] = '3.8-flash';
    if (ai[0] === '2.5-flash') ai[0] = '3.8-flash';
    if (ai[1] === '2.5-pro') ai[1] = '3.8-pro';
    if (ai[1] === '2.5-flash') ai[1] = '3.5-flash';
    const log = new logger(userSession.interaction.user.id, 'sparx_maths');
    sparxMaths.log = log;
    log.logToFile('Logging Start');
    log.logToFile(`**Settings**\nFaketime Min: ${userSession.settings.min}\nFaktime Max: ${userSession.settings.max}\nPDF Settings: ${JSON.stringify(userSession.settings.pdfSettings, null, 2)}`);
    const queueMaths = queues.get('sparx_maths');

    const parser = new SparxQuestionParser(interaction, apikeys);

    const taskTimer = process.hrtime();

    const cancel = new ButtonBuilder()
        .setCustomId('cancel')
        .setLabel('Cancel')
        .setEmoji(emojis.x)
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder()
        .addComponents(cancel);

    const initialEmbed = new EmbedBuilder()
        .setColor(colours.sparx_maths)
        .setTitle('Sparx Maths Autocompleter')
        .setDescription(`\`Starting Questions...\``);

    // const packageID = interaction.values[0];
    const sparxMathsExecuter = new sparxMathsAutocompleter(sparxMaths, interaction, packageID, log, userSession.settings);
    userSession.sparxMathsExecuter = sparxMathsExecuter;
    userAutocompleters[interaction.user.id] = sparxMathsExecuter;
    let errorOccured = false;
    let aiFailed = false;
    let bookworkNotFound = false;

    const tasks = await sparxMaths.getTasks(packageID);

    const sectionsProgress = await makeGroupArray(
        tasks.tasks,
        addGroup,
        5
    );

    const getTimeField = function () {
        return `**Time Spent:** ${formatTime((process.hrtime(taskTimer))[0])}\n**Time Simulated:** ${formatTime(sparxMathsExecuter.totalFakeTime)}`;
    };
    const getSettingsField = function () {
        return `**Time Settings:** ${userSession.settings.min}-${userSession.settings.max} Seconds`;
    };

    const progressUpdater = new progressTracker(interaction, getTimeField, getSettingsField, sparxMathsExecuter, 'Sparx Maths', 'sparx_maths', userSession.selectedHomeworkDue, userSession);
    try {
        if (await progressUpdater.start(sectionsProgress)) return;
        const shouldStop = async () => progressUpdater.cancelled || !(await queueMaths.stillUsing(interaction.user.id));

        for (const task of tasks.tasks) {

            if (await shouldStop()) break;
            await progressUpdater.updateEmbed(`Moving on to Task ${task.taskIndex}...`);
            log.logToFile(`Moving on to Task ${task.taskIndex}...`);

            if (task.title.endsWith('Times Tables') && (task.completion.size > (task.completion?.progress?.C ?? 0))) {
                log.logToFile('Timestable detected');
                await progressUpdater.updateEmbed(`Completing Times Table...`);

                let activityIndex = await sparxMathsExecuter.startTimesTable(packageID, task.taskIndex);
                for (let i = 0; i < 50; i++) {
                    await sparxMathsExecuter.answerTimesTable(activityIndex);
                }
                await progressUpdater.updateProgressBar(task.taskIndex - 1, 1, 1);
                continue;
            }

            const taskItems = await sparxMaths.getTasksItems(packageID, task.taskIndex);

            let index = 1;

            while (true) {

                if (taskItems[index - 1]?.status === 1) {
                    index++;
                    continue;
                } else if (taskItems[index - 1]?.status === undefined) {
                    break;
                }

                const item = await sparxMaths.getActivity(sparxMathsExecuter.getTimestamp(), packageID, task.taskIndex, index);
                if (item === 'break') break;

                async function completeBookwork(item) {
                    if (!item || item?.payload?.oneofKind === undefined) {
                        const bookworkInitialData = await sparxMaths.getActivity(sparxMathsExecuter.getTimestamp(), packageID, task.taskIndex, index, 1);

                        let activityIndex = bookworkInitialData.activityIndex;

                        if (await progressUpdater.updateEmbed(`Answering Bookwork Check...`));

                        const rawData = JSON.parse((await getBookworks(packageID)).bookworks);
                        const bookmarks = simplifyAnswers(rawData);
                        log.logToFile('Bookmarks', bookmarks);
                        log.logToFile('Bookwork data', bookworkInitialData.payload.wac);

                        const bookmarksCorrectAnswer = await parser.parseBookworkData(bookworkInitialData.payload.wac, bookmarks);
                        if (bookmarksCorrectAnswer) { // bookmarksCorrectAnswer
                            log.logToFile(bookmarksCorrectAnswer);
                            const bookworkAnswer = parser.parseBookwork(activityIndex, bookmarksCorrectAnswer, sparxMathsExecuter);
                            await sparxMathsExecuter.readyBookwork(activityIndex);
                            log.logToFile('!!!');
                            log.logToFile(bookworkAnswer);
                            await sparxMathsExecuter.answerQuestionWrapper('bookwork', bookworkAnswer, sparxMathsExecuter, null, task.taskIndex, index);
                            return true;
                        }

                        log.logToFile("Bookwork not found in the stuff");
                        bookworkNotFound = true;
                        throw new Error("Bookwork not found in the stuff");
                        let commonAnswersPrevious = [];

                        let counterComplete = 0;
                        while (commonAnswersPrevious.length !== 1 && counterComplete < 15) {
                            const data = await sparxMaths.getActivity(sparxMathsExecuter.getTimestamp(), packageID, task.taskIndex, index, 1);
                            activityIndex = data.activityIndex;
                            const commonAnswers = getBookworkCheckAnswer(data, commonAnswersPrevious);
                            commonAnswersPrevious = commonAnswers;

                            counterComplete++;
                        }

                        const bookworkAnswer = parser.parseBookwork(activityIndex, commonAnswersPrevious[0], sparxMathsExecuter);
                        await sparxMathsExecuter.readyBookwork(activityIndex);
                        await sparxMathsExecuter.answerQuestionWrapper('bookwork', bookworkAnswer, sparxMathsExecuter, null, task.taskIndex, index);

                        return true;
                    }

                    return false;
                }

                if (await completeBookwork(item)) continue;

                if (await shouldStop()) break;

                await progressUpdater.updateEmbed(`Starting Question ${index} at Task ${task.taskIndex}...`);
                log.logToFile(`Starting Question ${index} at Task ${task.taskIndex}...`);
                if (taskItems[index - 1].status === 1) {
                    await progressUpdater.updateEmbed(`Question ${index} at Task ${task.taskIndex} already finished, moving onto next question...`);
                    log.logToFile(`Question ${index} at Task ${task.taskIndex} already finished, moving onto next question...`);
                    index++;
                    continue;
                }
                sparxMathsExecuter.currentBookmark = item.payload.question.bookworkCode;

                async function attemptQuestion(attempts = 1) {
                    if (await shouldStop()) return 'break';
                    const item = await sparxMaths.getActivity(sparxMathsExecuter.getTimestamp(), packageID, task.taskIndex, index);
                    if (item === 'break') return 'break';
                    if (await completeBookwork(item)) return 'continue';
                    let model = ai[attempts-1];
                    if (!model && attempts > 1) return 'blank';
                    const activityIndex = item.activityIndex;
                    const questionIndex = item.payload.question.questionIndex;
                    const questionLayout = JSON.parse(item.payload.question.questionSpec);

                    log.logToFile(item);

                    await sparxMathsExecuter.readyQuestion(questionIndex, activityIndex);

                    let shouldTry = true;
                    
                    /*
                    So there's three possible states it can be:
                    - There's no question in the db and so we should add it after (with or without the correct answer)
                    - The question is in the db but without an answer and so we should retry if we have a higher ai model, otherwise break
                    - The question is in the db WITH an answer so try it and delete the entry from the db if its wrong
                    */
                    const questionParsed = parseQuestionForDB(item.payload.question.questionSpec);
                    const dbAnswer = await sparxMathsExecuter.getAnswerFromDB(questionParsed);
                    const previousIncorrectAnswers = Array.isArray(dbAnswer?.incorrect_answers) ? [...dbAnswer.incorrect_answers] : [];
                    const alreadyInDBCorrect = !!dbAnswer?.answer;
                    const InDb = !!dbAnswer;
                    log.logToFile('questionParsed.content', JSON.stringify(questionParsed.content, null, 0));

                    let questionObjectSend;
                    if (dbAnswer?.answer) {
                        questionObjectSend = {
                            "activityIndex": activityIndex,
                            "action": {
                                "oneofKind": "question",
                                "question": {
                                    "questionIndex": questionIndex,
                                    "actionType": 1,
                                    "answer": {
                                        "components": dbAnswer.answer,
                                        "hash": ""
                                    }
                                }
                            },
                            "timestamp": userAutocompleters[interaction.user.id].getTimestamp(true)
                        };
                    }

                    let failedQuestion = !dbAnswer?.answer && InDb;
                    log.logToFile(`Question was failed ${failedQuestion}`);
                    if (failedQuestion) {
                        let nextBetterModel = null;

                        for (const item of Object.values(ai)) {
                            if (!item) break;
                            const model = `gemini-${item}`;

                            if (isHigherModel(model, dbAnswer.ai_model)) {
                                nextBetterModel = item;
                                break;
                            }
                        }

                        if (!nextBetterModel) shouldTry = false;
                        if (nextBetterModel) model = nextBetterModel;
                    }

                    if (!shouldTry) {
                        return 'blank';
                    }

                    if (!questionObjectSend && !ai[0]) {
                        return 'blank';
                    }

                    if (!questionObjectSend && (ai[0])) {
                        log.logToFile('Using AI Model', model);
                        questionObjectSend = await getAIanswer(
                            () => parser.parse(questionLayout[0], activityIndex, questionIndex, model, dbAnswer?.incorrect_answers),
                            queueMaths,
                            interaction,
                            progressUpdater,
                            60000,
                            3000,
                            () => progressUpdater.cancelled
                        );
                        if (questionObjectSend?.status === 'Failed due to Invalid AI Response') {
                            aiFailed = true;
                            throw new Error('AI Overloaded');
                        }
                    }

                    const questionSuccess = await sparxMathsExecuter.answerQuestionWrapper('question', questionObjectSend, sparxMathsExecuter, parser.parseQuestion(questionLayout[0]), task.taskIndex, index);
                    if (questionSuccess) task.numTaskItemsDone++;
                    await progressUpdater.updateProgressBar(task.taskIndex - 1, task.numTaskItemsDone, task.numTaskItems);
                    if (questionSuccess) {
                        const data = questionParsed;
                        if (!data.content.length) throw new Error('No Data to Add!');
                        data.answer = questionObjectSend.action.question.answer.components;
                        if (!InDb) {
                            log.logToFile("Adding maths question to db with answer");     
                            appendToDB('sparx_maths', data);
                        } else {
                            log.logToFile("Updating maths question to db with answer");   
                            await updateSparxAnswerRPC(
                                'sparx_maths', 
                                data.content, 
                                { answer: data.answer }
                            );
                        }
                    } else {
                        const incorrect_answers = questionObjectSend.action.question.answer.components;
                        if (!InDb) {
                            log.logToFile('Question wrong, not in db');
                            questionParsed.incorrect_answers = incorrect_answers;
                            questionParsed.ai_model = model;
                            await appendToDB('sparx_maths', questionParsed);
                        } else {
                            log.logToFile('Question wrong, failed question was in db');
                            previousIncorrectAnswers.push(...incorrect_answers);
                            await updateSparxAnswerRPC(
                                'sparx_maths', 
                                questionParsed.content, 
                                { 
                                    incorrect_answers: previousIncorrectAnswers, 
                                    ai_model: model 
                                }
                            );
                        }

                        if (attempts < 3) {
                            if (attempts === 1) {
                                if (await progressUpdater.updateEmbed(`Retrying Question ${index} at Task ${task.taskIndex}...`)) return 'break';
                            } else if (attempts === 2) {
                                if (await progressUpdater.updateEmbed(`Retrying Question ${index} at Task ${task.taskIndex} Again...`)) return 'break';
                            }
                            return await attemptQuestion(attempts + 1);
                        }
                    }
                }

                await progressUpdater.updateEmbed(`Answering Question ${index} at Task ${task.taskIndex}...`);
                const attemptQuestionResponse = await attemptQuestion();
                if (attemptQuestionResponse === 'break') {
                    break;
                } else if (attemptQuestionResponse === 'continue') {
                    continue;
                }
                index++; // move to the next index
            }
            await progressUpdater.updateEmbed(`Completed Section`);
        }
        log.logToFile('We finished all questions!');
    } catch (err) {
        log.logToFile(err);
        logError(err, interaction.user.id, 'Sparx Maths', log.filepath);
        errorOccured = true;
    } finally {
        if (progressUpdater.cancelled || errorOccured) queue.changeFarmingStatus(interaction.user.id, 'blocked');
        if (aiFailed) {
            await progressUpdater.updateEmbed(`The AI is overloaded, try again later or switch to 'No Models' in the platform setting.`);
        }
        else if (bookworkNotFound) {
            await progressUpdater.updateEmbed(`The bot did not do the question the bookwork check is asking for. Please login to Sparx and complete the bookwork check manually.`);
        }
        else if (errorOccured) {
            await progressUpdater.updateEmbed(`An Unexpected Error has occured!`);
        } else if (progressUpdater.cancelled) {
            await progressUpdater.updateEmbed(`Cancelled`);
        } else {
            await progressUpdater.updateEmbed(`Finished`);
        }

        await progressUpdater.end();
        try {
            await sparxMathsExecuter.sendBookWork();
        } catch (dmError) {
            console.error('Failed to send feedback DM:', dmError);
        }
        await log.send(interaction.user);
    }
    return sparxMathsExecuter.totalFakeTime;
}

module.exports = sparxMathsAutocomplete;