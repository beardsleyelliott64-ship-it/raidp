const { decode, encode } = require('./ss_code.js');
const SparxBase = require('../../requesticator.js');

class SparxScience extends SparxBase {
    constructor(authToken, login={}, cookies) {
        super(authToken, login, cookies, decode, encode);
    }

    async getClientID() {
        const htmlContent = await this.curlRequests.sendRequest('https://science.sparx-learning.com/packages', null, false);
        const regex = /science\/([a-z0-9]{40})\//;

        // console.log('Html content', htmlContent);
        const match = htmlContent.data.match(regex);

        if (match) {
            const id = match[1]; // match[1] contains the captured ID
            this.clientID = id;
            this.curlRequests.additionalHeaders = [`spx-app-version: ${id} (2026-02-11T12:49:29Z) science`];
            return id;
        } else {
            return null;
        }
    }

    async getHomeworks() {
        const futureDate = new Date();
        futureDate.setMonth(futureDate.getMonth() - 3);

        // 2. Get the Unix timestamp in seconds (integer part)
        const futureTimestampInSeconds = Math.floor(futureDate.getTime() / 1000);
        const nanos = (Math.floor(Math.random() * 900) + 100) * 1_000_000;

        const homeworkInput = {
            "parentName": "assignments/",
            "endTimestampAfter": {
                "seconds": futureTimestampInSeconds,
                "nanos": nanos
            }
        };

        const url = 'https://api.sparx-learning.com/science/sparx.packageactivity.v1.Packages/ListStudentPackages';

        const fullMessage = await this.encodeStuff(homeworkInput, 'ListStudentPackagesRequest');

        const positiveNounRequest = await this.send(url, fullMessage);

        const positiveNounResponse = await this.decodeStuff(positiveNounRequest.data, 'ListStudentPackagesResponse');

        return positiveNounResponse;

    }

    async getTaskItems(packageID) {
        let url = 'https://api.sparx-learning.com/science/sparx.packageactivity.v1.Packages/GetPackage';

        let fullMessage = await this.encodeStuff({packageName: packageID}, 'GeneratePackageContentsRequest'); // packages/c463f131-8e83-484f-b98f-cc215be18577
        const userInfoBuffer = await this.send(url, fullMessage);
        if (userInfoBuffer.headers['grpc-status'] === '16') {
            // console.log(`The network request was unsuccessful: ${userInfoBuffer.headers['grpc-message']}`);
            return;
        }


        const userInfo = await this.decodeStuff(userInfoBuffer.data, 'GeneratePackageContentsResponse');
        return userInfo;
    }

    async generateTaskItems(packageID) {
        let url = 'https://api.sparx-learning.com/science/sparx.packageactivity.v1.Packages/GeneratePackageContents';

        let fullMessage = await this.encodeStuff({packageName: packageID}, 'GeneratePackageContentsRequest'); // packages/c463f131-8e83-484f-b98f-cc215be18577
        const userInfoBuffer = await this.send(url, fullMessage);
        if (userInfoBuffer.headers['grpc-status'] === '16') {
            // console.log(`The network request was unsuccessful: ${userInfoBuffer.headers['grpc-message']}`);
            return;
        }


        const userInfo = await this.decodeStuff(userInfoBuffer.data, 'GeneratePackageContentsResponse');
        return userInfo;
    }

    async getQuestion(activity) {
        const questionInput = {
            "name": activity, // "activities/bf1a6415-7fc5-4462-943d-63fc71b2d9d3"
            "action": {
                "oneofKind": "view",
                "view": {
                    "unload": false
                }
            },
            "token": ""
        };

        const url = 'https://api.sparx-learning.com/science/sparx.packageactivity.v1.Activities/ActivityAction';

        const fullMessage = await this.encodeStuff(questionInput, 'ActivityActionRequest');

        const positiveNounRequest = await this.send(url, fullMessage);

        // console.log(positiveNounRequest.headers);

        const positiveNounResponse = await this.decodeStuff(positiveNounRequest.data, 'ActivityActionResponse');

        return positiveNounResponse;

    }

    async getQuestionActivity(packageID) {
        const questionActivityInput = {
            "name": "",
            "taskItemName": packageID
        };

        const url = 'https://api.sparx-learning.com/science/sparx.packageactivity.v1.Activities/GetActivity';

        const fullMessage = await this.encodeStuff(questionActivityInput, 'GetActivityRequest');

        const positiveNounRequest = await this.send(url, fullMessage);

        const positiveNounResponse = await this.decodeStuff(positiveNounRequest.data, 'GetActivityResponse');

        return positiveNounResponse;
    }

    async answerQuestion(answerObject) {
        const url = 'https://api.sparx-learning.com/science/sparx.packageactivity.v1.Activities/ActivityAction';

        const fullMessage = await this.encodeStuff(answerObject, 'ActivityActionRequest');

        const positiveNounRequest = await this.send(url, fullMessage);

        if (positiveNounRequest.status === 9) return 9;

        const positiveNounResponse = await this.decodeStuff(positiveNounRequest.data, 'ActivityActionResponse');

        return positiveNounResponse;

    }

    async readyQuestion(activity, token) {
        const questionInput = {
            "name": activity,
            "action": {
                "oneofKind": "next",
                "next": {}
            },
            "token": token
        };

        const url = 'https://api.sparx-learning.com/science/sparx.packageactivity.v1.Activities/ActivityAction';

        const fullMessage = await this.encodeStuff(questionInput, 'ActivityActionRequest');

        const positiveNounRequest = await this.send(url, fullMessage);

        const positiveNounResponse = await this.decodeStuff(positiveNounRequest.data, 'ActivityActionResponse');

        return positiveNounResponse;
    }
}

module.exports = SparxScience;