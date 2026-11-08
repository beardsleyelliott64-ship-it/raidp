// language: JavaScript, file: utils/readerNativeAuth.js
// Native fetch replacements for Reader auth — no Python microservice required.
// Used for the token-exchange and user-info steps only.
// gRPC calls (getHomeworks, autocomplete) still go through Python.
'use strict';

/**
 * Fetch the Sparx auth JWT from the token endpoint using native Node fetch.
 * Equivalent to getTokenRequest() but requires no Python microservice.
 * @param {string} cookieString  e.g. "live_ssoprovider_session=...; spxlrn_session=..."
 * @returns {Promise<string|null>} JWT string or null on failure
 */
async function getTokenNative(cookieString, attempts = 4) {
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch('https://api.sparx-learning.com/token', {
                method: 'GET',
                headers: {
                    'accept': '*/*',
                    'accept-language': 'en-GB,en;q=0.9',
                    'cookie': cookieString,
                    'referer': 'https://reader.sparx-learning.com/',
                    'origin': 'https://reader.sparx-learning.com',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
                }
            });

            if (!res.ok) {
                throw new Error(`Token endpoint returned HTTP ${res.status}`);
            }

            const text = (await res.text()).trim();
            if (!text || text.startsWith('{')) {
                throw new Error(`Unexpected token response: ${text.slice(0, 80)}`);
            }

            return text;
        } catch (err) {
            if (i === attempts - 1) throw err;
            await new Promise(r => setTimeout(r, 1500));
        }
    }
    return null;
}

/**
 * Decode a JWT payload without verifying the signature.
 * Returns the claims object, or {} on parse failure.
 * @param {string} jwt
 * @returns {object}
 */
function decodeJwtClaims(jwt) {
    try {
        const parts = jwt.split('.');
        if (parts.length !== 3) return {};
        // Base64url → base64 → Buffer → JSON
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const json = Buffer.from(b64, 'base64').toString('utf8');
        return JSON.parse(json);
    } catch {
        return {};
    }
}

/**
 * Build a userInfo-compatible object from JWT claims.
 * Falls back gracefully when claims are absent.
 * Sparx JWTs typically contain: given_name, family_name, name, sub, email
 */
function userInfoFromJwt(jwt) {
    const c = decodeJwtClaims(jwt);
    return {
        givenName:   c.given_name  || c.givenName  || (c.name ? c.name.split(' ')[0] : '') || '',
        familyName:  c.family_name || c.familyName || (c.name ? c.name.split(' ').slice(1).join(' ') : '') || '',
        displayName: c.name        || c.displayName || c.email || '',
        subject:     c.sub         || '',
        email:       c.email       || ''
    };
}

module.exports = { getTokenNative, decodeJwtClaims, userInfoFromJwt };
