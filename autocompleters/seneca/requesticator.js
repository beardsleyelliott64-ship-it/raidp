const axios = require('axios');
const generateUUID = require('../../utils/generateUUID');
const WebSocket = require('ws');

class Requesticator {
    constructor(token, loginDetails) {
        this.authToken = token;
        this.loginDetails = loginDetails;
    }

    loadFromObject(data) {
        Object.assign(this, data);
    }

    async getAccountId() {
        const userInfo = await this.get('https://user-info.app.senecalearning.com/api/user-info/me');
        return userInfo.userId;
    }

    async startSession(courseId, sectionId) {
        this.sessionId = generateUUID();
        const url = `wss://session-ws.app.senecalearning.com/?access-key=${this.authToken}&sessionId=${this.sessionId}`;

        const ws = await new Promise((resolve, reject) => {
            const socket = new WebSocket(url, {
                headers: {
                    'Origin': 'https://app.senecalearning.com',
                    'User-Agent': 'Mozilla/5.0'
                }
            });

            socket.on('open', () => resolve(socket));
            socket.on('error', (err) => reject(err));
        });

        // Send message
        ws.send(JSON.stringify({
            action: "start-session",
            data: {
                userId: this.userId,
                sessionId: this.sessionId,
                courseId,
                sectionId
            }
        }));
    }

    async post(url, body = {}, attempts = 3) {
        try {

            const response = await axios.request({
                url: url,
                method: 'POST',
                headers: {
                    accept: '*/*',
                    'accept-language': 'en-GB,en;q=0.9,en-US;q=0.8',
                    'access-key': this.authToken,
                    'content-type': 'application/json',
                    correlationid: '1763233862854::4c3cc314-bc1f-4c34-a16b-2f8056a93e76',
                    origin: 'https://app.senecalearning.com',
                    priority: 'u=1, i',
                    referer: 'https://app.senecalearning.com/',
                    'sec-ch-ua': '"Chromium";v="142", "Microsoft Edge";v="142", "Not_A Brand";v="99"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-site',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
                    'user-region': 'GB',
                    'x-amz-date': '20251115T191102Z'
                },
                data: body // pass the request body here
            });

            return response.data; // only the response body
        } catch (err) {
            if (attempts) {
                await new Promise(res => setTimeout(res, 5000));
                return await this.post(url, body, attempts - 1);
            } else {
                throw err;
            }
        }
    }

    async get(url, params = {}, attempts = 3) {

        try {

            const response = await axios.get(url, {
                params: params,
                headers: {
                    accept: '*/*',
                    'accept-language': 'en-GB,en;q=0.9,en-US;q=0.8',
                    'access-key': this.authToken,
                    'content-type': 'application/json',
                    correlationid: '1763233862854::4c3cc314-bc1f-4c34-a16b-2f8056a93e76',
                    origin: 'https://app.senecalearning.com',
                    priority: 'u=1, i',
                    referer: 'https://app.senecalearning.com/',
                    'sec-ch-ua': '"Chromium";v="142", "Microsoft Edge";v="142", "Not_A Brand";v="99"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-site',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
                    'user-region': 'GB',
                    'x-amz-date': '20251115T191102Z'
                }
            });

            return response.data; // only the response body
        } catch (err) {
            if (attempts) {
                await new Promise(res => setTimeout(res, 5000));
                return await this.get(url, params, attempts - 1);
            } else {
                throw err;
            }
        }
    }

}

module.exports = Requesticator;