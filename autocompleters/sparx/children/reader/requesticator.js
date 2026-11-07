const { decode, encode } = require('./sr_code.js');
const SparxBase = require('../../requesticator.js');

class SparxReader extends SparxBase {
    constructor(authToken, login={}, cookies) {
        super(authToken, login, cookies, decode, encode);

        // Reader uses its own web origin. The shared Sparx requesticator
        // defaults to the Maths origin, which can cause Sparx/WAF to return
        // an HTML page instead of a gRPC-Web response. That HTML then gets
        // misread as a gRPC frame (e.g. "!DOC" becomes the frame length).
        this.curlRequests.headers = this.curlRequests.headers.map(header => {
            const lower = header.toLowerCase();
            if (lower.startsWith('origin:')) return 'origin: https://reader.sparx-learning.com/';
            if (lower.startsWith('referer:')) return 'referer: https://reader.sparx-learning.com/';
            if (lower.startsWith('user-agent:')) return 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
            return header;
        });
    }

    async sendUserActive(path) {
        const url = 'https://api.sparx-learning.com/reader/sparx.reading.users.v1.Sessions/UserActive';
        let fullMessage = await this.encodeStuff({"currentPath": path}, 'UserActiveRequest');
        await this.send(url, fullMessage);
    } // /library; /task;

    async startSwappedBook(bookObj) {
        let url = 'https://api.sparx-learning.com/reader/sparx.reading.users.librarybooks.v1.LibraryBooks/UpdateLibraryBook';
        bookObj.swapped = 1;
        bookObj.isEnded = false;
        bookObj.recommendedBy = "";
        // console.log('Update book input', {studentBook: bookObj});

        let fullMessage = await this.encodeStuff({studentBook: bookObj}, 'UpdateLibraryBookRequest');
        const userInfoBuffer = await this.send(url, fullMessage);
        await this.decodeStuff(userInfoBuffer.data, 'UpdateLibraryBookResponse');
        // console.log('Book update response', bookUpdateResponse);
    }

    async getNewBook() {
        let url = 'https://api.sparx-learning.com/reader/sparx.reading.users.librarybooks.v1.LibraryBooks/ListLibraryBooks';

        let fullMessage = await this.encodeStuff({}, 'UpdateUserDisplayDataForCurrentUserRequest');

        const userInfoBuffer = await this.send(url, fullMessage);
        const libraryBooks = await this.decodeStuff(userInfoBuffer.data, 'ListLibraryBooks');
        for (const book of libraryBooks.libraryBooks) {
            // console.log('Book check', book);
            if (book.studentBook.swapped === 2 && !book.studentBook.isComplete) {
                await this.startSwappedBook(book.studentBook);
                return book.studentBook.bookId;
            }
        }

        const bookOptions = await this.getNewBookOptions();
        if (bookOptions.books.length) {
            return bookOptions.books[0].name.split('/')[1]; // bookUid
        }

        return null;
        /*
        for (const book of libraryBooks.libraryBooks) {
            // console.log('Book check', book);
            if (!book.studentBook.isActive && !book.studentBook.isComplete) {
                await this.startSwappedBook(book.studentBook);
                return book.studentBook.bookId;
            }
        }
        */
    }

    async getHomeworks() {
        // https://api.sparx-learning.com/reader/sparx.reading.users.librarybooks.v1.LibraryBooks/ListLibraryBooks
        // console.log(this.authToken);
        let url = 'https://api.sparx-learning.com/reader/sparx.reading.users.librarybooks.v1.LibraryBooks/ListLibraryBooks';

        let fullMessage = await this.encodeStuff({}, 'UpdateUserDisplayDataForCurrentUserRequest');

        const userInfoBuffer = await this.send(url, fullMessage);
        const libraryBooks = await this.decodeStuff(userInfoBuffer.data, 'ListLibraryBooks');
        const activeBooks = [];

        for (const book of libraryBooks.libraryBooks) {
            if (book.studentBook.isActive || book.studentBook.isTeacherAssigned) {
                const progress = Math.round(book.studentBook.progress * 100);
                const bookObj = {
                    title: book.studentBook.title,
                    bookId: book.studentBook.bookId,
                    progress: progress
                };
                if (book.studentBook.isTeacherAssigned) {
                    if (progress < 100) {
                        bookObj.setBook = true;
                        activeBooks.push(bookObj);
                    }
                } else {
                    bookObj.setBook = false;
                    activeBooks.push(bookObj);
                }
            }
        }

        return activeBooks;
    }

    async getGoldReaderState() {
        let url = 'https://api.sparx-learning.com/reader/sparx.reading.users.v1.Sessions/GetGoldReaderState';

        let fullMessage = await this.encodeStuff({}, 'UpdateUserDisplayDataForCurrentUserRequest');

        const userInfoBuffer = await this.send(url, fullMessage);
        if (userInfoBuffer.headers['grpc-status'] === '16') {
            // console.log(`The network request was unsuccessful: ${userInfoBuffer.headers['grpc-message']}`);
            return;
        }

        const userInfo = await this.decodeStuff(userInfoBuffer.data, 'GetGoldReaderStateResponse');
        return userInfo.goldReaderState;
    }

    async getBookText(bookId, taskId) {
        // https://api.sparx-learning.com/reader/sparx.reading.content.v1.Books/GetBook
        
        // console.log(this.authToken);
        let url = 'https://api.sparx-learning.com/reader/sparx.reading.content.v1.Books/GetBook';

        const bookRequest = {
            "bookId": bookId,
            "taskId": taskId
        };

        let fullMessage = await this.encodeStuff(bookRequest, 'GetBookRequest');

        // console.log("Get book text calls send");
        const userInfoBuffer = await this.send(url, fullMessage);
        if (userInfoBuffer.headers['grpc-status'] === '16') {
            // console.log(`The network request was unsuccessful: ${userInfoBuffer.headers['grpc-message']}`);
            return;
        }

        const bookText = await this.decodeStuff(userInfoBuffer.data, 'GetBookResponse');

        // console.log(bookText.bookV2.content.reflowable.body.sections[0]);

        let paragraph = "";
        let wordCount = 0;

        for (const text of bookText.bookV2.content.reflowable.body.sections) {
            // console.log(text.content.paragraph.spans);
            if (text.content.oneofKind === 'paragraph') {
                // console.log(text.content.paragraph.spans[0].runs[0].content);
                for (const span of text.content.paragraph.spans) {
                    wordCount += span.wordCount;
                    for (const run of span.runs) {
                        const textBody = run.content;
                        paragraph += ` ${textBody}`;
                    }
                }
                // const textBody = text.content.paragraph.spans[0].runs[0].content;
                // paragraph += ` ${textBody}`;
            }
        }

        // console.log(paragraph);

        // console.log(bookText);

        return { paragraph: paragraph, wordCount: wordCount };
    }

    async getBookTask(bookId) {
        const url = "https://api.sparx-learning.com/reader/sparx.reading.tasks.v1.Tasks/GetBookTask";
        const bookObj = {
            "bookId": bookId,
            "chapterName": undefined,
            "requestReread": true
        };
        const proceedMessage = await this.encodeStuff(bookObj, 'GetBookTaskRequest');

        // console.log("Book task calls send");
        const questionBuffer = await this.send(url, proceedMessage);
        if ((questionBuffer.status === 8) && (questionBuffer.message === 'Task Finished')) {
            return questionBuffer;
        }


        const questionFull = await this.decodeStuff(questionBuffer.data, 'GetBookTaskResponse');
        // console.log('getBookTask', questionFull);
        return questionFull.loadTaskId;

    }

    async proceedTimeout(taskId) {
        const url = 'https://api.sparx-learning.com/reader/sparx.reading.tasks.v1.Tasks/SendTaskAction';
        const proceedObj = {
            "taskId": taskId,
            "action": {
                "action": {
                    "oneofKind": "paperback",
                    "paperback": {
                        "action": {
                            "oneofKind": "answer",
                            "answer": "<timeout>"
                        },
                        "identifier": ""
                    }
                }
            },
            "catchUpMode": false,
            "signatureEvent": {
                "signatures": []
            }
        };


        const proceedMessage = await this.encodeStuff(proceedObj, 'SendTaskActionRequest');
        // console.log("proceed question buffer calls send");
        await this.send(url, proceedMessage);
    }

    async getTask(taskId) {
        const url = 'https://api.sparx-learning.com/reader/sparx.reading.tasks.v1.Tasks/GetTask';
        const message = await this.encodeStuff({ taskId }, 'GetTaskRequest');
        const buffer = await this.send(url, message);
        const status = String(buffer.headers?.['grpc-status'] || '');
        if (status && status !== '0') return { status: Number(status), message: buffer.headers?.['grpc-message'] || '' };
        return await this.decodeStuff(buffer.data, 'GetTaskResponse');
    }

    async proceedQuestion(taskId) {
        const url = 'https://api.sparx-learning.com/reader/sparx.reading.tasks.v1.Tasks/SendTaskAction';

        const makeProceed = async () => {
            const obj = {
                taskId,
                action: {
                    action: {
                        oneofKind: 'paperback',
                        paperback: {
                            action: { oneofKind: 'proceed', proceed: true },
                            identifier: ''
                        }
                    }
                },
                catchUpMode: false,
                signatureEvent: { signatures: [] }
            };
            return this.send(url, await this.encodeStuff(obj, 'SendTaskActionRequest'));
        };

        const questionFromTask = (taskResponse) => {
            const paperback = taskResponse?.task?.state?.state?.paperback;
            const q = paperback?.currentQuestion;
            if (!q) return null;
            return {
                questionIdentifier: q.questionId,
                questionText: q.questionText,
                questionOptions: q.options
            };
        };

        const stateCheck = async (label) => {
            this.log?.logToFile(`Reader state check: ${label}`);
            try {
                const message = await this.encodeStuff({ taskId }, 'GetTaskRequest');
                const buffer = await this.send(
                    'https://api.sparx-learning.com/reader/sparx.reading.tasks.v1.Tasks/GetTask',
                    message
                );
                const grpc = String(buffer?.headers?.['grpc-status'] ?? '');
                if (grpc && grpc !== '0') {
                    this.log?.logToFile(`Reader state check rejected: grpc=${grpc} ${buffer?.headers?.['grpc-message'] || ''}`);
                    return null;
                }
                const full = await this.decodeStuff(buffer.data, 'GetTaskResponse');
                const paperback = full?.task?.state?.state?.paperback;
                const stage = paperback?.currentStage;
                this.log?.logToFile(`Reader state: stage=${stage} currentQuestion=${Boolean(paperback?.currentQuestion)} completed=${Boolean(full?.task?.state?.completed)}`);
                return full;
            } catch (err) {
                this.log?.logToFile(`Reader state check failed: ${err?.stack || err}`);
                return null;
            }
        };

        // First try the normal transition.
        let buffer = await makeProceed();
        let grpc = String(buffer?.headers?.['grpc-status'] ?? '');
        if (grpc !== '9') {
            const full = await this.decodeStuff(buffer.data, 'SendTaskActionResponse');
            this.log.logToFile('Question Full', full);
            const q = questionFromTask(full);
            if (q) return q;
            if (full?.task?.state?.experience) {
                return { experience: full.task.state.experience, results: full.task.state.results || [] };
            }
            return { status: 9, retry: true };
        }

        const message = String(buffer?.headers?.['grpc-message'] || '');
        this.log?.logToFile(`Proceed rejected: ${message}`);

        // IMPORTANT: don't blindly send another proceed. Ask Sparx what state
        // the task is actually in. This is the path the previous build was
        // missing in live deployments.
        for (let attempt = 1; attempt <= 5; attempt++) {
            const full = await stateCheck(`attempt ${attempt}`);
            const q = questionFromTask(full);
            if (q) {
                this.log?.logToFile(`Recovered current question on state check ${attempt}`);
                return q;
            }
            if (full?.task?.state?.experience) {
                return { experience: full.task.state.experience, results: full.task.state.results || [] };
            }

            const paperback = full?.task?.state?.state?.paperback;
            const stage = paperback?.currentStage;
            const finished = full?.task?.state?.completed || paperback?.finished;
            if (finished) {
                this.log?.logToFile('Reader task is completed during state recovery');
                // Do NOT re-send when the part is already closed. Two prior
                // runs kept submitting into a finished part, which never grades
                // and simply burns the attempt budget. Report it instead so the
                // caller can move to the next part.
                return { status: 9, completed: true };
            }

            // Only issue proceed again when the server reports a result stage.
            // If the stage is still unknown/unavailable, wait and re-read state.
            if (stage === 5 || String(stage).toUpperCase() === 'QUESTION_RESULT') {
                await new Promise(resolve => setTimeout(resolve, 350));
                buffer = await makeProceed();
                grpc = String(buffer?.headers?.['grpc-status'] ?? '');
                if (grpc !== '9') {
                    const response = await this.decodeStuff(buffer.data, 'SendTaskActionResponse');
                    this.log.logToFile('Question Full', response);
                    const next = questionFromTask(response);
                    if (next) return next;
                    if (response?.task?.state?.experience) {
                        return { experience: response.task.state.experience, results: response.task.state.results || [] };
                    }
                }
            }

            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }

        this.log?.logToFile('Reader could not recover a question without a valid Sparx stage');
        return { status: 9, retry: true };
    }

    async retryQuestion(taskId) {
        const url = 'https://api.sparx-learning.com/reader/sparx.reading.tasks.v1.Tasks/SendTaskAction';
        const proceedObj = {
            "taskId": taskId,
            "action": {
                "action": {
                    "oneofKind": "retry",
                    "retry": true
                }
            },
            "catchUpMode": false
        };

        const proceedMessage = await this.encodeStuff(proceedObj, 'SendTaskActionRequest');
        const buffer = await this.send(url, proceedMessage);
        const grpc = String(buffer?.headers?.['grpc-status'] ?? '');
        if (grpc && grpc !== '0') {
            this.log?.logToFile(`Reader retry rejected: grpc=${grpc} ${buffer?.headers?.['grpc-message'] || ''}`);
            return null;
        }
        if (!buffer?.data || !buffer.data.length) return null;
        const full = await this.decodeStuff(buffer.data, 'SendTaskActionResponse');
        const question = full?.task?.state?.state?.paperback?.currentQuestion;
        if (question?.questionId) {
            this.log?.logToFile('Reader retry produced a new question');
            return {
                questionIdentifier: question.questionId,
                questionText: question.questionText,
                questionOptions: question.options
            };
        }
        this.log?.logToFile('Reader retry produced no new question');
        return null;
    }

    async getNewBookOptions() {
        let url = 'https://api.sparx-learning.com/reader/sparx.reading.users.librarybooks.v1.LibraryBooks/ListNewBooks';

        let fullMessage = await this.encodeStuff({"userId": ""}, 'ListNewBooksRequest');

        const userDisplayBuffer = await this.send(url, fullMessage);
        if (userDisplayBuffer.headers['grpc-status'] === '16') {
            return null;
        }

        const userDisplayData = await this.decodeStuff(userDisplayBuffer.data, 'ListNewBooksResponse');

        return userDisplayData;
    }
}

module.exports = SparxReader;