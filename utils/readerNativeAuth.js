// language: JavaScript, file: utils/readerNativeAuth.js
// Native Node fetch replacements for Reader auth — zero Python dependency.
// Implements getUserInfo and getHomeworks using raw gRPC-web + hand-rolled protobuf.
'use strict';

// ---------------------------------------------------------------------------
// Minimal protobuf reader
// ---------------------------------------------------------------------------
function readVarint(buf, pos) {
    let result = 0, shift = 0;
    while (pos < buf.length) {
        const b = buf[pos++];
        result |= (b & 0x7F) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
    }
    return { value: result, pos };
}

function readProtoFields(buf) {
    const fields = {}; // fieldNumber → array of raw values
    let i = 0;
    while (i < buf.length) {
        const tagResult = readVarint(buf, i);
        i = tagResult.pos;
        const tag         = tagResult.value;
        const fieldNumber = tag >>> 3;
        const wireType    = tag & 0x07;

        if (wireType === 0) { // varint
            const r = readVarint(buf, i);
            i = r.pos;
            if (!fields[fieldNumber]) fields[fieldNumber] = [];
            fields[fieldNumber].push(r.value);
        } else if (wireType === 2) { // length-delimited (string / bytes / embedded message)
            const lenR = readVarint(buf, i);
            i = lenR.pos;
            const bytes = buf.slice(i, i + lenR.value);
            i += lenR.value;
            if (!fields[fieldNumber]) fields[fieldNumber] = [];
            fields[fieldNumber].push(bytes);
        } else if (wireType === 1) { // 64-bit
            i += 8;
        } else if (wireType === 5) { // 32-bit
            i += 4;
        } else {
            break; // unknown — stop
        }
    }
    return fields;
}

function str(fields, no) {
    const v = fields[no];
    if (!v || !v[0]) return '';
    const b = v[0];
    return Buffer.isBuffer(b) ? b.toString('utf8') : String(b);
}

function bool(fields, no) {
    const v = fields[no];
    return v ? v[0] !== 0 : false;
}

function float32(fields, no) {
    // floats come as 32-bit wire type 5 — but we stored the raw bytes,
    // so they were skipped above.  Progress is encoded as a float in
    // wire type 5; re-implement with a proper 32-bit reader.
    return fields[no]?.[0] ?? 0;
}

// Re-parse progress (wire type 5 / 32-bit float) separately
function readProtoFieldsWithFloats(buf) {
    const base   = readProtoFields(buf);
    const floats = {}; // fieldNumber → float value
    let i = 0;
    while (i < buf.length) {
        const tagResult = readVarint(buf, i);
        i = tagResult.pos;
        const tag         = tagResult.value;
        const fieldNumber = tag >>> 3;
        const wireType    = tag & 0x07;
        if (wireType === 0) { readVarint(buf, i); const r = readVarint(buf, i); i = r.pos; }
        else if (wireType === 2) { const r = readVarint(buf, i); i = r.pos; i += r.value; }
        else if (wireType === 1) { i += 8; }
        else if (wireType === 5) {
            if (i + 4 <= buf.length) {
                floats[fieldNumber] = buf.readFloatLE(i);
            }
            i += 4;
        } else break;
    }
    return { fields: base, floats };
}

// ---------------------------------------------------------------------------
// gRPC-web request helper
// ---------------------------------------------------------------------------
const GRPC_HEADERS = {
    'content-type': 'application/grpc-web+proto',
    'x-grpc-web':   '1',
    'accept':       'application/grpc-web+proto, */*',
    'x-user-agent': 'grpc-web-javascript/0.1',
    'origin':       'https://reader.sparx-learning.com',
    'referer':      'https://reader.sparx-learning.com/'
};

// gRPC-web frame: [0x00][4-byte big-endian message length][message bytes]
function grpcFrame(msgBytes) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(msgBytes.length, 0);
    return Buffer.concat([Buffer.from([0x00]), len, msgBytes]);
}

// Extract message bytes from gRPC-web response frame
function unframe(buf) {
    if (buf.length < 5) return buf;
    const msgLen = buf.readUInt32BE(1);
    return buf.slice(5, 5 + msgLen);
}

async function grpcCall(jwt, url, bodyBytes, timeout = 10000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { ...GRPC_HEADERS, 'authorization': jwt },
            body: grpcFrame(bodyBytes),
            signal: ctrl.signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        return unframe(Buffer.from(arrayBuf));
    } finally {
        clearTimeout(timer);
    }
}

// Encode a string field (field N, wire type 2)
function encodeString(fieldNo, str) {
    const strBuf = Buffer.from(str, 'utf8');
    const tag    = (fieldNo << 3) | 2;
    // varint tag + varint length + string
    function varint(n) {
        const out = [];
        while (n > 0x7F) { out.push((n & 0x7F) | 0x80); n >>>= 7; }
        out.push(n);
        return Buffer.from(out);
    }
    return Buffer.concat([varint(tag), varint(strBuf.length), strBuf]);
}

// ---------------------------------------------------------------------------
// getUserInfo — returns { givenName, familyName, displayName, subject }
// ---------------------------------------------------------------------------
async function getNativeUserInfo(jwt) {
    // Empty request body for GetUserInfo
    const msgBuf = await grpcCall(
        jwt,
        'https://api.sparx-learning.com/sparx.auth.userinfo.v1.UserInfoService/GetUserInfo',
        Buffer.alloc(0)
    );

    const fields = readProtoFields(msgBuf);
    // UserInfo: 1=subject, 4=display_name, 5=given_name, 6=family_name, 7=email_address
    return {
        subject:     str(fields, 1),
        displayName: str(fields, 4),
        givenName:   str(fields, 5),
        familyName:  str(fields, 6),
        email:       str(fields, 7)
    };
}

// ---------------------------------------------------------------------------
// getHomeworks — returns array of { title, bookId, progress, setBook }
// ---------------------------------------------------------------------------
async function getNativeHomeworks(jwt) {
    // Empty request body for ListLibraryBooks
    const msgBuf = await grpcCall(
        jwt,
        'https://api.sparx-learning.com/reader/sparx.reading.users.librarybooks.v1.LibraryBooks/ListLibraryBooks',
        Buffer.alloc(0)
    );

    // ListLibraryBooksResponse: field 1 = repeated LibraryBook
    const responseFields = readProtoFields(msgBuf);
    const libraryBookBufs = responseFields[1] || [];

    const activeBooks = [];
    for (const lbBuf of libraryBookBufs) {
        // LibraryBook: field 2 = student_book (embedded message)
        const lbFields = readProtoFields(lbBuf);
        const sbBufs   = lbFields[2];
        if (!sbBufs || !sbBufs[0]) continue;

        const { fields: sbFields, floats: sbFloats } = readProtoFieldsWithFloats(sbBufs[0]);
        // StudentBook: 2=book_id, 3=progress(float32), 18=title, 19=is_active, 26=is_teacher_assigned
        const bookId          = str(sbFields, 2);
        const title           = str(sbFields, 18);
        const progress        = Math.round((sbFloats[3] ?? 0) * 100);
        const isActive        = bool(sbFields, 19);
        const isTeacherAssigned = bool(sbFields, 26);

        if (!isActive && !isTeacherAssigned) continue;
        if (isTeacherAssigned && progress >= 100) continue;

        activeBooks.push({
            title:   title || bookId,
            bookId,
            progress,
            setBook: isTeacherAssigned
        });
    }

    activeBooks.sort((a, b) => {
        if (a.setBook !== b.setBook) return a.setBook ? -1 : 1;
        return b.progress - a.progress;
    });

    return activeBooks;
}

// ---------------------------------------------------------------------------
// getTokenNative — exchange cookie string for JWT
// ---------------------------------------------------------------------------
async function getTokenNative(cookieString, attempts = 4) {
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch('https://api.sparx-learning.com/token', {
                method: 'GET',
                headers: {
                    'accept':          '*/*',
                    'accept-language': 'en-GB,en;q=0.9',
                    'cookie':          cookieString,
                    'referer':         'https://reader.sparx-learning.com/',
                    'origin':          'https://reader.sparx-learning.com',
                    'user-agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
                }
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = (await res.text()).trim();
            if (!text || text.startsWith('{')) throw new Error(`Unexpected: ${text.slice(0, 60)}`);
            return text;
        } catch (err) {
            if (i === attempts - 1) throw err;
            await new Promise(r => setTimeout(r, 1500));
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// decodeJwtClaims + userInfoFromJwt (fallback when gRPC fails)
// ---------------------------------------------------------------------------
function decodeJwtClaims(jwt) {
    try {
        const b64  = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch { return {}; }
}

function userInfoFromJwt(jwt) {
    const c = decodeJwtClaims(jwt);
    return {
        givenName:   c.given_name  || c.givenName  || (c.name ? c.name.split(' ')[0] : '') || '',
        familyName:  c.family_name || c.familyName || (c.name ? c.name.split(' ').slice(1).join(' ') : '') || '',
        displayName: c.name        || c.displayName || c.email || '',
        subject:     c.sub || '',
        email:       c.email || ''
    };
}

module.exports = { getTokenNative, getNativeUserInfo, getNativeHomeworks, decodeJwtClaims, userInfoFromJwt };
