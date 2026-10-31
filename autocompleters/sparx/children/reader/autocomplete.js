const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { logError } = require('../../../../utils/errorLogger.js');
const progressTracker = require('../../../../utils/progressTracker.js');
const formatTime = require('../../../../utils/formatTime');
const getProgressBar = require('../../../../utils/getProgressBar');
const getAIanswer = require('../../../../utils/getAIanswer.js');
const { checkAccount } = require('../../../../database/accounts.js');
const logger = require('../../../../utils/logger.js');
const { colours } = require('../../../../config.json');
const { addToDb, checkAnswer } = require('../../../../database/reader.js');
const getApiKeys = require('../../../../utils/getApiKeys.js');
const { answerQuestionAi } = require('../../../../gemini/sparx_reader/main.js');
const queues = require('../../../../queues/queues.js');
const useApiKeys = require('../../../../utils/useApiKeys.js');

class sparxReaderAutocompleter {
    constructor(requesticator, apikeys, progressUpdater, settings, log) {
        this.requesticator = requesticator;
        this.apikeys = apikeys;
        this.log = log;
        this.progressUpdater = progressUpdater;
        this.settings = settings;
        this.cancelActive = false;
        this.taskIdsLoaded = [];
    }

    async load(taskId) {
        if (!this.taskIdsLoaded.includes(taskId)) {
            const loadObj = {
                "taskId": taskId,
                "action": {
                    "action": {
                        "oneofKind": "load",
                        "load": true
                    }
                },
                "catchUpMode": false
            };

            const fullMessage = await this.requesticator.encodeStuff(loadObj, 'SendTaskActionRequest');

            await this.requesticator.send('https://api.sparx-learning.com/reader/sparx.reading.tasks.v1.Tasks/SendTaskAction', fullMessage);
            this.taskIdsLoaded.push(taskId);
        }
    }

    async answerQuestion(extract, taskId, first, answer, identifier) {

        if (first) {
            const questionObj = await this.requesticator.proceedQuestion(taskId);
            if (questionObj.status === 9) {
                // console.log("Finished questions!");
                return;
            }
            identifier = questionObj.questionIdentifier;

            answer = await this.getAnswer(questionObj.questionIdentifier, extract, questionObj);
            if (typeof answer === 'number') return answer;

            const submitted = await this.submitAnswer(taskId, answer, identifier);
            if (submitted === null) {
                // The attempt was not graded because the part has already moved
                // past this question. Never re-send the same answer against a
                // closed part: ask the reader to fetch a genuinely new question
                // and answer that one, otherwise report the part as finished.
                this.log.logToFile('Reader answer was not graded; looking for a new question');
                const current = await this.requesticator.proceedQuestion(taskId);

                if (current?.status === 9) {
                    if (current.completed) {
                        this.log.logToFile('Reader part is already finished; moving to the next part');
                        return { status: 9, completed: true };
                    }
                    this.log.logToFile('Reader has no gradeable question for this part');
                    return { experience: 0, results: [] };
                }

                const isNewQuestion = current?.questionIdentifier && current.questionIdentifier !== identifier;
                if (!isNewQuestion) {
                    // Same question came back. It cannot be graded again, so
                    // report zero instead of burning an attempt on a resend.
                    this.log.logToFile('Reader did not receive a new question; not re-sending');
                    return { experience: 0, results: [] };
                }

                const freshAnswer = await this.getAnswer(current.questionIdentifier, extract, current);
                if (typeof freshAnswer === 'number') return freshAnswer;
                return await this.submitAnswer(taskId, freshAnswer, current.questionIdentifier);
            }

            if (submitted?.status === 9 && submitted.completed) {
                this.log.logToFile('Reader part is already finished; moving to the next part');
            }
            return submitted;
        }

        return await this.submitAnswer(taskId, answer, identifier);
    }

    // Sends one answer to Sparx and normalises the three possible outcomes:
    // graded result, question advanced elsewhere (null), or a hard failure.
    async submitAnswer(taskId, answer, identifier) {
        const url = 'https://api.sparx-learning.com/reader/sparx.reading.tasks.v1.Tasks/SendTaskAction';

        const answerObj = {
            "taskId": taskId,
            "action": {
                "action": {
                    "oneofKind": "paperback",
                    "paperback": {
                        "action": {
                            "oneofKind": "answer",
                            "answer": answer
                        },
                        "identifier": identifier
                    }
                }
            },
            "catchUpMode": false,
            "signatureEvent": {
                "signatures": []
            }
        };

        const fullMessage = await this.requesticator.encodeStuff(answerObj, 'SendTaskActionRequest');
        const buffer = await this.requesticator.send(url, fullMessage);

        const grpcStatus = String(buffer?.headers?.['grpc-status'] ?? '0');
        const grpcMessage = String(buffer?.headers?.['grpc-message'] ?? '');
        if (grpcStatus !== '' && grpcStatus !== '0') {
            this.log.logToFile(`Reader answer rejected: grpc=${grpcStatus} ${grpcMessage}`);
            // Sparx reports an unknown stage when it has already moved past the
            // question being answered; treat that as "answer the current one".
            if (grpcStatus === '9' || /unknown stage/i.test(grpcMessage)) return null;
            throw new Error(`Sparx rejected the Reader answer: ${grpcMessage || `grpc status ${grpcStatus}`}`);
        }

        if (!buffer?.data || !buffer.data.length) {
            this.log.logToFile('Reader answer returned no payload');
            return { experience: 0, results: [] };
        }

        const response = await this.requesticator.decodeStuff(buffer.data, 'SendTaskActionResponse');
        this.log.logToFile('Reader answer response received');

        if (response?.task?.state?.experience) {
            return {
                experience: response.task.state.experience,
                results: response.task.state.results || []
            };
        }

        const paperwork = response?.task?.state?.state?.paperback;
        if (paperwork?.currentQuestion) {
            // The server already moved on without grading this attempt.
            this.log.logToFile('Reader answer was not graded; the task had already advanced');
            return null;
        }

        return { experience: 0, results: [] };
    }

    async handleDbAdd(results) {
        for (const result of results) {
            if (result.correct) {
                await addToDb(result.questionId, result.answer, []);
            } else {
                await addToDb(result.questionId, null, [result.answer]);
            }
        }
    }

    async getAnswer(id, extract, questionObj) {
        const options = (Array.isArray(questionObj?.questionOptions) ? questionObj.questionOptions : [])
            .map(o => typeof o === 'string' ? o : (o?.text ?? o?.label ?? o?.answer ?? o?.value ?? ''))
            .map(String).map(o => o.trim()).filter(Boolean);

        const normalise = value => String(value ?? '')
            .toLowerCase().replace(/\s+/g, ' ').trim();

        const matchOption = value => {
            const raw = String(value ?? '').trim();
            if (!raw) return null;
            const exact = options.find(o => normalise(o) === normalise(raw));
            if (exact) return { answer: exact, method: 'exact' };

            const number = raw.match(/^(?:answer\s*(?:is|:)?)?\s*([1-9]\d*)\s*[.)]?$/i);
            if (number) {
                const i = Number(number[1]) - 1;
                if (options[i]) return { answer: options[i], method: 'index' };
            }

            const letter = raw.match(/^(?:answer\s*(?:is|:)?)?\s*([A-Z])\s*[.)]?$/i);
            if (letter) {
                const i = letter[1].toUpperCase().charCodeAt(0) - 65;
                if (options[i]) return { answer: options[i], method: 'letter' };
            }

            const lowered = normalise(raw);
            const contained = options.find(o => lowered.includes(normalise(o)));
            return contained ? { answer: contained, method: 'contained' } : null;
        };

        this.log.logToFile('Reader answer resolver', JSON.stringify({ id, options }, null, 2));

        let result = null;
        try {
            result = await checkAnswer(id, questionObj);
        } catch (err) {
            this.log.logToFile('Reader cache lookup failed; continuing without cache', String(err?.message || err));
        }

        // A cached answer is useful only if it still corresponds to one of the
        // current options. Never blindly trust a stale cache value.
        if (typeof result === 'string') {
            const cached = matchOption(result);
            if (cached) {
                this.log.logToFile(`ANSWER METHOD: cache-${cached.method}`);
                this.log.logToFile(`ANSWER CANDIDATE: ${cached.answer}`);
                return cached.answer;
            }
            this.log.logToFile(`CACHE REJECTED: '${result}' is not one of the current options`);
        }

        const apikeys = await getApiKeys(this.apikeys);
        const aiArgs = Array.isArray(result)
            ? [extract, questionObj.questionText, questionObj.questionOptions, result]
            : [extract, questionObj.questionText, questionObj.questionOptions];

        this.log.logToFile('AI Args prepared');
        this.log.logToFile('Question Options', questionObj.questionOptions);

        const rawAnswer = await useApiKeys(apikeys, answerQuestionAi, aiArgs);
        const candidate = matchOption(rawAnswer);

        if (!candidate) {
            this.log.logToFile(`ANSWER UNMATCHED: ${String(rawAnswer)}`);
            throw new Error('Reader answer resolver could not map the model response to a current option.');
        }

        this.log.logToFile(`ANSWER METHOD: ai-${candidate.method}`);
        this.log.logToFile(`ANSWER CANDIDATE: ${candidate.answer}`);
        return candidate.answer;
    }

  async maintainActive() {
    await this.requesticator.sendUserActive('/task');

    setInterval(() => {
      if (this.cancelActive) return;
      this.requesticator.sendUserActive('/task');
    }, 12_000);
  }
}

async function autocomplete(userSession) {
    let bookUid = userSession.selectedHomework;
    let bookName = userSession.bookNames[bookUid];

    const log = new logger(userSession.interaction.user.id, 'sparx_reader');
    userSession.requesticator.log = log;
    log.logToFile('Logging Start');
    log.logToFile(`**Settings**\n ${[
        ["bookUid", bookUid],
        ["userSession.srp", userSession.settings.srp],
        ["userSession.wpm", userSession.settings.wpm],
        ["bookName", bookName],
        ["mode", userSession.mode]
    ].map(([name, value]) => `${name}: ${value}`).join("\n")}`);
    // await interaction.deferUpdate();

    const userApiKeys = (await checkAccount(userSession.interaction.user.id)).apikeys;
    const queue = queues.get('sparx_reader');
    let readUntilFinish = userSession.mode === 'Read Until Book Completed';
    // let readUntilGold = userSession.mode === 'Read Until Gold Reader Acquired';
    let pointsAcquired = 0;
    let timesO = 0;
    let finishedBook = false;
    let correctQuestions = 0;
    let totalQuestions = 0;
    let finishedAllBooks = false;
    let questionsAnswered = 0;
    let lastAward = 0;
    let totalAwarded = 0;
    let awardedAttempts = 0;

    const sectionsProgress = [[{
        name: `- Progress (${userSession.settings.srp} SRP)`,
        value: getProgressBar(0, 1),
        percentage: 0
    }]];

    const getTimeField = function () {
        const accuracy = totalQuestions === 0 ? 100 : Math.round(correctQuestions / totalQuestions * 100);
        const average = awardedAttempts === 0 ? 0 : (totalAwarded / awardedAttempts).toFixed(1);
        return `**Time Spent:** ${formatTime((process.hrtime(this.taskTimer))[0])}\n**SRP Earned:** ${pointsAcquired} of ${userSession.settings.srp}\n**Last Question:** +${lastAward} SRP\n**Questions Answered:** ${questionsAnswered}\n**Average Per Question:** ${average} SRP\n**Accuracy:** ${correctQuestions}/${totalQuestions} (${accuracy}%)\n**Reading:** ${bookName}`;
    };
    const getSettingsField = function () {
        return `**Sparx Reader Points Target:** ${userSession.settings.srp}\n**Words Per Minute:** ${userSession.settings.wpm}\n**Question Time:** ${userSession.settings.min}-${userSession.settings.max}`;
    };

    const sparxReaderExecuter = new sparxReaderAutocompleter(userSession.requesticator, userApiKeys, null, userSession.settings, log);
    sparxReaderExecuter.maintainActive();
    const progressUpdater = new progressTracker(userSession.interaction, getTimeField, getSettingsField, sparxReaderExecuter, 'Sparx Reader', 'sparx_reader', null, userSession);
    sparxReaderExecuter.progressUpdater = progressUpdater;
    if (await progressUpdater.start(sectionsProgress)) return;

    // The target is checked first and on its own, so reaching it always stops
    // the run. Previously the target was only one of several conditions and the
    // reading wait could not see it, so a run kept reading and earning past the
    // requested SRP.
    const targetReached = () => !readUntilFinish && pointsAcquired >= userSession.settings.srp;
    const shouldStop = async () => {
        if (targetReached()) return true;
        if (progressUpdater.cancelled) return true;
        if (pointsAcquired >= userSession.settings.srp && readUntilFinish) {
            // 'Read Until Book Completed' still honours the target as a floor,
            // but never stops early once it is met.
            return !(await queue.stillUsing(userSession.interaction.user.id));
        }
        return !((pointsAcquired < userSession.settings.srp || readUntilFinish) && timesO < 10 && (await queue.stillUsing(userSession.interaction.user.id)));
    };

    try {
        while (!(await shouldStop())) {
            log.logToFile(`Points Accumulated: ${pointsAcquired}\nLast Question Award: +${lastAward} SRP\nQuestions Answered: ${questionsAnswered}\nQuestions Correct: ${correctQuestions}/${totalQuestions}`);
            const taskId = await userSession.requesticator.getBookTask(bookUid);
            if (taskId.message === "Task Finished") {
                finishedBook = true;
                log.logToFile(`Book finished!`);
                if (readUntilFinish) {
                    break;
                }

                let homeworkBooks = await userSession.requesticator.getHomeworks();

                if (!homeworkBooks.length) {
                    bookUid = await userSession.requesticator.getNewBook();
                    if (!bookUid) {
                        finishedAllBooks = true;
                        break;
                    };
                    await userSession.requesticator.getBookTask(bookUid);
                    homeworkBooks = await userSession.requesticator.getHomeworks();
                }
                bookUid = homeworkBooks[0].bookId;
                bookName = homeworkBooks[0].title;
                log.logToFile(`New Book UID: ${bookUid}\nNew Bookname: ${bookName}`);

                continue;
            }
            await sparxReaderExecuter.load(taskId);

            const bookTextObj = await userSession.requesticator.getBookText(bookUid, taskId);
            const bookText = bookTextObj.paragraph;
            const wordCount = bookTextObj.wordCount;
            if (targetReached()) break;
            if (userSession.settings.wpm) {
                const totalTime = (wordCount / userSession.settings.wpm) * 60;
                await progressUpdater.wait(totalTime, `"Reading" at ${userSession.settings.wpm} Words Per Minute`, shouldStop);
            }

            if (targetReached()) break;
            if (await shouldStop()) {
                break;
            }
            log.logToFile(`About to get AI Answer`);
            const results = await getAIanswer(
                () => sparxReaderExecuter.answerQuestion(bookText, taskId, true),
                queue,
                userSession.interaction,
                progressUpdater,
                60000,
                3000,
                () => progressUpdater.cancelled,
                Infinity
            );

            const experienceGained = results?.experience ?? 0;

            pointsAcquired += experienceGained;
            questionsAnswered += 1;
            if (experienceGained > 0) {
                lastAward = experienceGained;
                totalAwarded += experienceGained;
                awardedAttempts += 1;
            } else {
                lastAward = 0;
            }
            log.logToFile(`Sparx awarded +${experienceGained} SRP this question (running total ${pointsAcquired}/${userSession.settings.srp}).`);

            if (results?.results) {
                for (const result of results.results) {
                    correctQuestions += result.score;
                    totalQuestions += result.total;
                }
            }

            timesO += 1;
            // Always update the SRP bar, including 0-XP/incorrect attempts.
            // The old code only refreshed the bar when XP changed, which left
            // the panel visually stuck at 0%.
            await progressUpdater.updateProgressBar(0, pointsAcquired, userSession.settings.srp);

            if (experienceGained !== 0) {
                log.logToFile('Got questions right!');
                await progressUpdater.updateEmbed(`+${experienceGained} SRP — ${pointsAcquired} of ${userSession.settings.srp}`);
                timesO = 0;
            } else {
                log.logToFile('Reader attempt returned no experience.');
                await progressUpdater.updateEmbed(`No SRP this question — retrying (${pointsAcquired} of ${userSession.settings.srp})`);
            }

            if (targetReached()) {
                log.logToFile(`SRP target reached (${pointsAcquired}/${userSession.settings.srp}); stopping now.`);
                break;
            }

            if (await shouldStop()) {
                break;
            }
        }
    } catch (err) {
        log.logToFile("Error caught");
        log.logToFile(err);
        logError(err, userSession.interaction.user.id, 'Sparx Reader', log.filepath);
    } finally {
        sparxReaderExecuter.cancelActive = true;
        let finalMessage = 'Encountered an error causing the autocompleter to fail';
        if (finishedAllBooks) {
            finalMessage = 'No more books to read';
        }
        else if (progressUpdater.cancelled) {
            finalMessage = 'Cancelled';
        }
        else if (pointsAcquired >= userSession.settings.srp && !readUntilFinish) {
            finalMessage = `SRP target of ${userSession.settings.srp} has been achieved`;
        }
        else if (finishedBook && readUntilFinish) {
            finalMessage = 'The book has been Finished';
        }
        log.logToFile(`Final Message: ${finalMessage}`);
        await log.send(userSession.interaction.user);

        await progressUpdater.updateEmbed(finalMessage);
        await progressUpdater.end();
    }

    return (process.hrtime(progressUpdater.taskTimer))[0];
}

module.exports = autocomplete;