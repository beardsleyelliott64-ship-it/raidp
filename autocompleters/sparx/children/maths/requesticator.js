const { decode, encode } = require('./sm_code.js');
const SparxBase = require('../../requesticator.js');

class SparxMaths extends SparxBase {
    constructor(authToken, login = {}, cookies) {
        super(authToken, login, cookies, decode, encode);
    }

    async getHomeworks() {
        const inputObject = {
            "includeAllActivePackages": true,
            "getPackages": true,
            "getTasks": false,
            "getTaskItems": false,
            "packageID": "",
            "taskIndex": 0,
            "taskItemIndex": 0
        };

        try {
            const fullMessage = await this.encodeStuff(inputObject, 'PackageDataRequest');
            const homeworkRequest = await this.send('https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetPackageData', fullMessage);

            if (!homeworkRequest || !homeworkRequest.data) {
                throw new Error("Failed to fetch homeworks: Empty response");
            }

            try {
                const homeworkResponse = await this.decodeStuff(homeworkRequest.data, 'PackageDataResponse');
                return homeworkResponse;
            } catch (decodeErr) {
                if (/Empty gRPC-Web response/i.test(String(decodeErr.message || ''))) {
                    this.log.logToFile('PackageData was empty; creating a fresh Maths client session and retrying.');
                    await this.getClientSession();
                    const retryRequest = await this.send('https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetPackageData', fullMessage);
                    return await this.decodeStuff(retryRequest.data, 'PackageDataResponse');
                }
                throw decodeErr;
            }
        } catch (err) {
            this.log.logToFile(`Error in getHomeworks: ${err.message}`);
            console.error('Error in getHomeworks:', err);
            throw err;
        }
    }


    async getTasksItems(packageID, taskIndex) {
        const inputObject = {
            "includeAllActivePackages": false,
            "getPackages": false,
            "getTasks": false,
            "getTaskItems": true,
            "packageID": packageID,
            "taskIndex": taskIndex,
            "taskItemIndex": 0
        };


        const fullMessage = await this.encodeStuff(inputObject, 'PackageDataRequest');

        const homeworkRequest = await this.send('https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetPackageData', fullMessage); // this.authToken

        // console.log(homeworkRequest.headers);

        const homeworkResponse = await this.decodeStuff(homeworkRequest.data, 'PackageDataResponse');

        return homeworkResponse.taskItems;
    }

    async getTasks(packageID) {
        const inputObject = {
            "includeAllActivePackages": false,
            "getPackages": false,
            "getTasks": true,
            "getTaskItems": false,
            "packageID": packageID,
            "taskIndex": 0,
            "taskItemIndex": 0
        };


        const fullMessage = await this.encodeStuff(inputObject, 'PackageDataRequest');

        const homeworkRequest = await this.send('https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetPackageData', fullMessage); // this.authToken

        // console.log(homeworkRequest.headers);

        const homeworkResponse = await this.decodeStuff(homeworkRequest.data, 'PackageDataResponse');

        return homeworkResponse;
    }

    async getActivity(timestamp, packageID, taskIndex, taskItemIndex, activityType = 0) {
        const inputObject = {
            "activityType": activityType,
            "payload": {},
            "method": 0,
            "clientFeatureFlags": {},
            "taskItem": {
                "packageID": packageID,
                "taskIndex": taskIndex,
                "taskItemIndex": taskItemIndex,
                "taskState": 0
            },
            "timestamp": timestamp
        };

        const fullMessage = await this.encodeStuff(inputObject, 'GetActivityRequest');

        const homeworkRequest = await this.send('https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetActivity', fullMessage); // this.authToken

        if (!homeworkRequest || homeworkRequest === 'break') {
            return homeworkRequest;
        }

        // console.log(homeworkRequest.headers);

        const homeworkResponse = await this.decodeStuff(homeworkRequest.data, 'Activity');

        return homeworkResponse;
    }

    async getClientSession() {
        const body = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);

        // ClientSession creates a new session; do not send the previous
        // x-session-id while requesting it. A stale id can make PackageData
        // return a trailer-only gRPC-Web response.
        this.curlRequests.headers = this.curlRequests.headers.filter(
            header => !header.toLowerCase().startsWith('x-session-id:')
        );

        const responseR = await this.curlRequests.sendRequest("https://api.sparx-learning.com/sparx.messaging.server.v1.SWServerSession/ClientSession", body, { responseType: 'arraybuffer', returnHeaders: true  });

        const responseBuffer = responseR.data;
        // console.log(responseBuffer);
        const response = await this.decodeStuff(responseBuffer, "ClientSessionResponse");
        // console.log(response.sessionId);
        this.sessionId = response.sessionId;
        this.curlRequests.headers = this.curlRequests.headers.map(header =>
            header.startsWith('x-session-id:')
                ? `x-session-id: ${this.sessionId}`
                : header
        );

        return response.sessionId;
    }


    async answerQuestion(inputObject) {
        const fullMessage = await this.encodeStuff(inputObject, 'ActivityAction');
        const answerRequest = await this.send('https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/ActivityAction', fullMessage);
        if (answerRequest?.status === 8) return 'TaskFinished';
        if (answerRequest?.status === 9) return 'WrongQuestionState';
        const grpcStatus = answerRequest?.headers?.['grpc-status'];
        const grpcMessage = answerRequest?.headers?.['grpc-message'];
        if (grpcStatus === '5' && grpcMessage === 'ActivityNotFound') return 'ActivityExpired';
        if (!answerRequest?.data) {
            throw new Error(`Sparx ActivityAction returned no response data${grpcMessage ? `: ${grpcMessage}` : ''}`);
        }
        return await this.decodeStuff(answerRequest.data, 'ActivityActionResponse');
    }

    async readyQuestion(inputObject) {

        const fullMessage = await this.encodeStuff(inputObject, 'ActivityAction');

        const answerRequest = await this.send('https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/ActivityAction', fullMessage); // this.authToken

        const answerResponse = await this.decodeStuff(answerRequest.data, 'ActivityActionResponse');

        return answerResponse;
    }

    async startTimesTable(inputObject) {
        const fullMessage = await this.encodeStuff(inputObject, 'GetActivityRequest');

        const answerRequest = await this.send('https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetActivity', fullMessage); // this.authToken

        const answerResponse = await this.decodeStuff(answerRequest.data, 'ActivityAction');

        return answerResponse;
    }

    async answerTimesTable(inputObject) {
        const fullMessage = await this.encodeStuff(inputObject, 'ActivityAction');

        const answerRequest = await this.send('https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/ActivityAction', fullMessage); // this.authToken

        const answerResponse = await this.decodeStuff(answerRequest.data, 'ActivityActionResponse');

        return answerResponse;
    }

    async searchIndependantLearning(inputObject) {
        const fullMessage = await this.encodeStuff(inputObject, 'Query');

        const answerRequest = await this.send('https://api.sparx-learning.com/sparx.content.search.v1.Search/Search', fullMessage); // this.authToken

        const answerResponse = await this.decodeStuff(answerRequest.data, 'Result');

        return answerResponse;
    }

    async getPackagesIndependantLearning(inputObject) {
        const fullMessage = await this.encodeStuff(inputObject, 'GetPackagesForObjectivesRequest');

        const answerRequest = await this.send('https://api.sparx-learning.com/sparx.revision.v1.Revision/GetPackagesForObjectives', fullMessage); // this.authToken

        const answerResponse = await this.decodeStuff(answerRequest.data, 'GetPackagesForObjectivesResponse');

        return answerResponse;
    }

    async getActivePackages(inputObject) {
        const fullMessage = await this.encodeStuff(inputObject, 'GetActivePackagesRequest');

        const answerRequest = await this.send('https://api.sparx-learning.com/sparx.revision.v1.Revision/GetActivePackages', fullMessage); // this.authToken

        const answerResponse = await this.decodeStuff(answerRequest.data, 'GetActivePackagesResponse');

        return answerResponse;
    }

    async listTopicSummariesRequest(inputObject) {
        const fullMessage = await this.encodeStuff(inputObject, 'ListTopicSummariesRequest');

        const answerRequest = await this.send('https://api.sparx-learning.com/sparx.content.summaries.v1.TopicSummaries/ListTopicSummaries', fullMessage); // this.authToken

        const answerResponse = await this.decodeStuff(answerRequest.data, 'ListTopicSummariesResponse');

        return answerResponse;
    }

    async listCurriculumSummaries(inputObject) {
        const fullMessage = await this.encodeStuff(inputObject, 'ListCurriculumSummariesRequest');

        const answerRequest = await this.send('https://api.sparx-learning.com/sparx.content.summaries.v1.CurriculumSummaries/ListCurriculumSummaries', fullMessage); // this.authToken

        const answerResponse = await this.decodeStuff(answerRequest.data, 'ListCurriculumSummariesResponse');

        return answerResponse;
    }
}

module.exports = SparxMaths;