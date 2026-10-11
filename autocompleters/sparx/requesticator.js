const Sparx_Requesticator = require('./requesticatorBasic.js');
const {decode, encode} = require('./children/maths/sm_code.js');
const getTokenSparx = require('./login.js');
const getTokenRequest = require('./getTokenRequest.js');
const puppetQueue = require('../../queues/puppeteerQueue.js');

class SparxBase {
    /**
     * @param {string} authToken 
     * @param {object} login 
     * @param {string} cookies 
     * @param {function} decodeFunc - The subject-specific decode function
     * @param {function} encodeFunc - The subject-specific encode function
     */
    constructor(authToken, login = {}, cookies, decodeFunc=decode, encodeFunc=encode) {
        this.authToken = authToken;
        this.login = login;
        this.cookies = cookies;
        this.decodeFunc = decodeFunc;
        this.encodeFunc = encodeFunc;
        this.studentUserId = null;
        this.log = {
            logToFile: () => {}
        };
        
        // Default Requesticator — pass both token and cookies so the
        // curl_cffi proxy actually sends the session cookies Sparx requires.
        this.curlRequests = new Sparx_Requesticator(authToken, cookies);
    }

    async send(url, uint8Array, attempts = 3) {
        try {
            this.log.logToFile(`Sending request to ${url} with input headers`);
            const response = await this.curlRequests.sendRequest(url, uint8Array);
            this.log.logToFile(`**Response returned**\nStatus: ${response.status}\n${JSON.stringify(response.headers, null, 2)}`);

            // 1. Check for standard HTTP 401 Unauthorized
            if (response.status == 503) {
                const err = new Error("503 Error");
                err.response = { status: 503 };
                throw err;
            }

            if (response.status == 401) {
                const err = new Error("Unauthorized");
                err.response = { status: 401 };
                throw err;
            }

            const grpcStatus = response.headers?.['grpc-status'];
            const grpcMessage = response.headers?.['grpc-message'];

            // A few Sparx endpoints occasionally return a successful gRPC
            // trailer with no data frame at all. Treat that as transient,
            // rather than handing an empty buffer to protobuf. The retry path
            // below will give the session another chance to produce a data frame.
            if ((response.data == null || (response.data?.length === 0)) && grpcStatus === '0') {
                const err = new Error(`Empty gRPC-Web response from ${url}`);
                err.code = 'EMPTY_GRPC_RESPONSE';
                throw err;
            }

            // 2. Handle gRPC Specific Statuses and Messages
            if (grpcStatus) {
                if (grpcStatus === '8') return { status: 8, message: "Task Finished"};
                if (grpcStatus === '9' && grpcMessage === 'wrong question state for answer action') return { status: 9, message: grpcMessage};
                if ((grpcStatus === '7' && grpcMessage === 'permission denied') || (grpcStatus === '16' && grpcMessage === 'Bad auth info')) {
                    const err = new Error("Unauthorized");
                    err.response = { status: 401 };
                    throw err;  
                };
                
                if (grpcMessage?.includes('SessionInactive')) {
                    this.log.logToFile("SESSION INACTIVE CAUGHT!");
                    if (typeof this.getClientSession === 'function') {
                        await this.getClientSession();
                    }
                    return await this.send(url, uint8Array, attempts); 
                }
            }

            // 3. Return successful response
            return response;
        } catch (err) {
            // 1. Check attempts
            if (attempts <= 1) {
                const failMsg = `Request failed after exhausting all retries. Last error: ${err.message}`;
                this.log.logToFile(`[GIVING UP] ${failMsg}`);
                err.message = failMsg; 
                throw err;
            }

            // 2. Handle 401 Re-authentication WITH A LOCK
            if (err.response?.status === 401) {
                this.log.logToFile("Caught 401 Unauthorized.");
                
                // If a login isn't already happening, start one
                if (!this.authPromise) {
                    this.log.logToFile("Initiating new login process...");
                    this.authPromise = this._reauthenticate();
                } else {
                    this.log.logToFile("Login already in progress, waiting for it to finish...");
                }

                // Both the heartbeat and the main request will wait right here!
                await this.authPromise; 

            } else {
                // Empty gRPC data is normally transient. Refresh the Sparx
                // client session before retrying, because PackageData/GetActivity
                // can otherwise return a trailer-only response.
                if (err.code === 'EMPTY_GRPC_RESPONSE' && typeof this.getClientSession === 'function') {
                    this.log.logToFile('Empty gRPC response detected; refreshing client session before retry.');
                    try { await this.getClientSession(); } catch (sessionErr) {
                        this.log.logToFile(`Client session refresh failed: ${sessionErr.message}`);
                    }
                }
                this.log.logToFile(`Attempting retry... (${attempts - 1} attempts left). Caught error: ${err.message}`);
                await new Promise(res => setTimeout(res, err.code === 'EMPTY_GRPC_RESPONSE' ? 1200 : 5000));
            }

            // 4. Retry request
            return await this.send(url, uint8Array, attempts - 1);
        }
    }

    async _reauthenticate(maxRetries = 3) {
        // Outer try-finally block ensures the lock (authPromise) is ONLY cleared 
        // after all retries are exhausted or the login is successful.
        try {
            this.log.logToFile(`Starting re-authentication process (Max attempts: ${maxRetries})...`);

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    this.log.logToFile(`Login attempt ${attempt} of ${maxRetries}...`);
                    let newAuthToken = await getTokenRequest(this.cookies);
                    if (newAuthToken?.includes('Unauthorized') && !this.login?.school) {
                        throw new Error(`Failed to get a new token: The server returned Strictly Unauthorized.`);
                    }

                    if (!newAuthToken) {
                        this.log.logToFile('Trying to login with puppeteer');
                        const newAuthTokenN = await puppetQueue.add(() =>
                            getTokenSparx({
                                school: this.login.school,
                                username: this.login.username,
                                password: this.login.password,
                                type: this.login.type
                            })
                        );
                        if (newAuthTokenN?.cookies) {
                            this.cookies = newAuthTokenN.cookies;
                            if (typeof this.curlRequests.setCookies === 'function') {
                                this.curlRequests.setCookies(this.cookies);
                            } else {
                                this.curlRequests.cookies = this.curlRequests._parseCookies
                                    ? this.curlRequests._parseCookies(this.cookies)
                                    : this.cookies;
                            }
                        }
                        if (newAuthTokenN?.authToken) {
                            newAuthToken = newAuthTokenN.authToken;
                        }
                    }

                    if (newAuthToken) {
                        this.log.logToFile('The new authtoken has been successfully acquired!');
                        this.authToken = newAuthToken;
                        if (typeof this.curlRequests.setAuthToken === 'function') {
                            this.curlRequests.setAuthToken(this.authToken);
                        } else {
                            this.curlRequests.headers = this.curlRequests.headers.map(h =>
                                h.toLowerCase().startsWith('authorization:')
                                    ? `authorization: ${this.authToken}`
                                    : h
                            );
                        }
                        if (this.cookies && typeof this.curlRequests.setCookies === 'function') {
                            this.curlRequests.setCookies(this.cookies);
                        }
                        
                        if (typeof this.getClientSession === 'function') {
                            await this.getClientSession();
                        }
                        
                        // SUCCESS: Exit the function. 
                        // The outer finally block will still run to clear the lock.
                        return; 
                    } else {
                        throw new Error("Authentication failed: No token returned");
                    }

                } catch (err) {
                    this.log.logToFile(`[WARNING] Login attempt ${attempt} failed: ${err.message}`);
                    
                    // If we've reached the max retries, throw the error out completely
                    if (attempt >= maxRetries) {
                        const fatalMsg = `[FATAL] Exhausted all ${maxRetries} login retries. Last error: ${err.message}`;
                        this.log.logToFile(fatalMsg);
                        throw new Error(fatalMsg);
                    }
                }
            }
        } finally {
            // CRITICAL: Clear the promise lock so future 401s can trigger a new login if needed.
            // Because this is outside the loop, it only clears once the whole process finishes.
            this.authPromise = null;
        }
    }

    stripGrpcWebTrailer(uint8Array) {
        const TRAILER_FLAG = 0x80;
        const dataView = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);

        for (let i = 0; i <= uint8Array.length - 5; i++) {
            const isTrailer = (uint8Array[i] & TRAILER_FLAG) === TRAILER_FLAG;

            if (isTrailer) {
                const length = dataView.getUint32(i + 1); // Big-endian by default
                if (i + 5 + length === uint8Array.length) {
                    return uint8Array.slice(0, i); // trailer detected and stripped
                }
            }
        }
        return uint8Array; // no trailer found
    }

    async decodeStuff(buffer, className) {
        // gRPC-Web responses are framed as: 1 byte flags + 4 byte big-endian
        // length + payload.  A response may contain a data frame followed by
        // a trailer frame.  The old implementation blindly removed the first
        // 5 bytes and then decoded the rest, which can feed a second frame
        // header/trailer into protobuf and produce errors such as:
        // "illegal tag: field no 13 wire type 7".
        const bytes = buffer instanceof Uint8Array
            ? buffer
            : new Uint8Array(buffer);

        const frames = [];
        let offset = 0;

        while (offset + 5 <= bytes.length) {
            const flags = bytes[offset];
            const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, 4).getUint32(0, false);
            const frameStart = offset + 5;
            const frameEnd = frameStart + length;

            if (frameEnd > bytes.length) {
                const previewBytes = bytes.slice(0, Math.min(bytes.length, 96));
                const preview = Buffer.from(previewBytes).toString('utf8').replace(/[\\x00-\\x1f\\x7f]/g, ' ').trim();
                if (/<!doctype|<html|<head|<body/i.test(preview)) {
                    throw new Error(`Sparx returned an HTML page instead of gRPC-Web for ${className}. Response starts: ${preview.slice(0, 120)}`);
                }
                throw new Error(`Invalid gRPC-Web frame for ${className}: declared ${length} bytes, only ${bytes.length - frameStart} available.`);
            }

            const payload = bytes.slice(frameStart, frameEnd);
            const isTrailer = (flags & 0x80) !== 0;
            if (!isTrailer && payload.length) frames.push(payload);
            offset = frameEnd;
        }

        // Some endpoints/proxies can return a raw protobuf body rather than a
        // gRPC-Web frame. Preserve compatibility with that response shape.
        if (frames.length === 0 && bytes.length) {
            const first = bytes[0];
            const looksFramed = bytes.length >= 5 && (first === 0 || (first & 0x80) !== 0);
            if (!looksFramed) frames.push(bytes);
        }

        if (frames.length === 0) {
            throw new Error(`Empty gRPC-Web response while decoding ${className}.`);
        }

        // A normal unary RPC has one data frame. If a server/proxy supplied
        // more than one data frame, decode the first complete protobuf message
        // rather than accidentally concatenating frame headers into it.
        try {
            return await this.decodeFunc(frames[0], className);
        } catch (err) {
            const detail = err?.message || String(err);
            throw new Error(`Failed to decode gRPC-Web ${className}: ${detail}`);
        }
    }

    async encodeStuff(inputObject, className) {
        const data = await this.encodeFunc(inputObject, className);

        const grpcHeader = Buffer.alloc(5);
        grpcHeader.writeUInt8(0, 0); // Compression flag (0 = not compressed)
        grpcHeader.writeUInt32BE(data.length, 1);
        const fullMessage = Buffer.concat([grpcHeader, data]);

        return fullMessage;
    }

    async getUserDisplayName() {
        const url = 'https://api.sparx-learning.com/sparx.leaderboards.userdisplay.v1.UserDisplay/GetUserDisplayDataForCurrentUser';
        const fullMessage = await this.encodeStuff({}, 'GetUserDisplayDataForCurrentUserRequest');

        const userDisplayBuffer = await this.send(url, fullMessage);
        if (userDisplayBuffer.headers['grpc-status'] === '16') {
            return null;
        }

        const userDisplayData = await this.decodeStuff(userDisplayBuffer.data, 'UserDisplayData');
        return userDisplayData.positiveNoun || 'User';
    }

    async getUserInfo() {
        const url = 'https://api.sparx-learning.com/sparx.auth.userinfo.v1.UserInfoService/GetUserInfo';
        const fullMessage = await this.encodeStuff({}, 'UpdateUserDisplayDataForCurrentUserRequest');

        const userInfoBuffer = await this.send(url, fullMessage);
        if (userInfoBuffer?.headers['grpc-status'] === '16') {
            return;
        }

        const userInfo = await this.decodeStuff(userInfoBuffer.data, 'UserInfo');
        if (userInfo.subject) {
            this.studentUserId = (userInfo.subject.split('/'))[1];
        }
        return userInfo;
    }

    async changePositiveNoun(noun) {
        const positiveNounInput = {
            "userDisplayData": {
                "name": `users/${this.studentUserId}/userdisplaydata`,
                "positiveNoun": noun,
                "optedOutProducts": []
            },
            "updateMask": {
                "paths": ["positive_noun", "opted_out_products"]
            }
        };

        const url = 'https://api.sparx-learning.com/sparx.leaderboards.userdisplay.v1.UserDisplay/UpdateUserDisplayDataForCurrentUser';
        const fullMessage = await this.encodeStuff(positiveNounInput, 'UpdateUserDisplayDataForCurrentUserRequest');

        const positiveNounRequest = await this.send(url, fullMessage);

        if (positiveNounRequest.headers['grpc-status'] === '3') {
            return 3;
        }
        return 1;
    }

    async getAccountId() {
        const userInfo = await this.getUserInfo();
        return userInfo.subject + userInfo.displayName;
    }
}

module.exports = SparxBase;