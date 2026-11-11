const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

const searchSchool = require('./searchSchool');
const smartLogin = require('../../utils/smartLogin');
const getTokenRequest = require('./getTokenRequest');
const { getTokenNative } = require('../../utils/readerNativeAuth');

chromium.use(StealthPlugin());

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = await matches.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      const locator = matches.nth(index);
      if (await locator.isVisible().catch(() => false)) return locator;
    }
  }
  return null;
}

async function getSessionCookies(context) {
  const cookies = await context.cookies();
  const live = cookies.find(c => c.name === 'live_ssoprovider_session');
  const spx = cookies.find(c => c.name === 'spxlrn_session');
  if (!live?.value || !spx?.value) return null;
  return { cookieString: `live_ssoprovider_session=${live.value}; spxlrn_session=${spx.value}` };
}

const landedFunction = ({ url }) =>
  ['science', 'reader', 'maths', 'app']
    .some(sub => url.includes(sub + '.sparx-learning.com'));

// --- Fast safe click ---
async function safeClick(page, selector, maxAttempts = 2) {
  const locator = page.locator(selector).first();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await locator.click({ force: true, timeout: 2000 });
      return true;
    } catch {
      const clicked = await page.evaluate(sel => {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          el.click();
          return true;
        }
        return false;
      }, selector);

      if (clicked) return true;
    }

    if (attempt < maxAttempts - 1) await delay(100);
  }
  throw new Error(`Failed to click ${selector}`);
}

// Exchange session cookies for a JWT.
// Tries native Node fetch first (no Python microservice required),
// then falls back to the curl requesticator (Python microservice) if native fails.
async function exchangeForToken(cookieString, addLog) {
  // --- Primary: native Node fetch, zero Python dependency ---
  try {
    const token = await getTokenNative(cookieString, 2);
    if (token && typeof token === 'string' && token.split('.').length >= 2) {
      addLog('Token exchange succeeded via native fetch.');
      return token;
    }
  } catch (nativeErr) {
    addLog(`Native token exchange failed (${nativeErr.message}); trying curl fallback.`);
  }

  // --- Fallback: Python curl microservice ---
  try {
    const token = await getTokenRequest(cookieString);
    if (token && typeof token === 'string' && token.split('.').length >= 2) {
      addLog('Token exchange succeeded via curl fallback.');
      return token;
    }
  } catch (curlErr) {
    addLog(`Curl token exchange also failed: ${curlErr.message}`);
  }

  return null;
}

async function login({ school, username, password, type } = {}) {
  const schoolData = await searchSchool(school);
  if (!schoolData) return { status: 'error', message: 'No School Found' };

  if (!schoolData.i) return { status: 'error', message: 'The selected school has no Sparx school ID.' };
  const schoolUUID = schoolData.i;
  const startURL = `https://api.sparx-learning.com/oauth2/login?school=${schoolUUID}`;

  let logs = '';
  const addLog = (msg) => {
    logs += `\n${String(msg).slice(0, 1200)}`;
    console.log(`[Sparx login] ${String(msg).slice(0, 1200)}`);
  };

  let browser;
  let context;
  let page;

  let schoolStatus = true;
  let loginTypeStatus = false;
  let emailTypeStatus = false;
  let passTypeStatus = false;
  let smartLoginVar = { filledEmail: false, filledPassword: false };

  const returnObj = {};
  
  let forceKillTimer;

  try {
    // Hard safety timeout; normal login gets time for redirects and session creation.
    forceKillTimer = setTimeout(async () => {
      addLog('Force killing after 90s safety timeout');
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }, 90000);

    browser = await chromium.launch({
      headless: true,
      args: [
        '--start-maximized',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--ignore-certificate-errors',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--ignore-certificate-errors-spki-list'
      ]
    });

    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.71',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    ];

    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

    context = await browser.newContext({
      userAgent: randomUserAgent,
      ignoreHTTPSErrors: true
    });

    await context.route('https://cdn.cookie-script.com/**', route => route.abort());

    page = await context.newPage();
    addLog('Browser launched and new page created.');

    // Set a default timeout for the page so NO action hangs for more than 20 seconds
    page.setDefaultTimeout(20000); 

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };

      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters)
      );

      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    });

    await page.goto(startURL, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    addLog(`Navigated to login page. Using type: ${(type || 'normal')}`);
    addLog(`Initial page URL: ${page.url()}`);
    addLog(`Initial page title: ${await page.title().catch(() => 'Unavailable')}`);

    if ((type || 'normal').toLowerCase() !== 'normal') {
      // look for any element (button/input) whose formaction starts with the SSO URL
      await page.evaluate(() => {
        const selector =
          'button[formaction^="https://auth.sparx-learning.com/oauth2/login"], input[formaction^="https://auth.sparx-learning.com/oauth2/login"]';

        const el = document.querySelector(selector);
        if (el) el.click();
      });

      smartLoginVar = await smartLogin(page, username, password, type, landedFunction, addLog);

    } else {
      // Prefer Sparx's native form, but tolerate standard HTML input attributes too.
      await page.waitForFunction(() => {
        return !!document.querySelector('.sm-input, input[type="password"]');
      }, undefined, { timeout: 18000 }).catch(() => null);

      let passwordInput = await firstVisible(page, [
        'input.sm-input[type="password"]',
        '.sm-input[type="password"]',
        'input[type="password"]'
      ]);

      let usernameInput = await firstVisible(page, [
        'input.sm-input:not([type="password"])',
        '.sm-input[type="email"]',
        'input[type="email"]',
        'input[autocomplete="username"]',
        'input[name*="user" i]',
        'input[name*="email" i]',
        'input[type="text"]'
      ]);

      // The legacy Sparx form uses two generic `.sm-input` fields without
      // semantic input types: username first, password second. Preserve that
      // known ordering, but never treat the first field as both inputs.
      const legacyInputs = page.locator('.sm-input:visible');
      const legacyCount = await legacyInputs.count().catch(() => 0);
      if ((!usernameInput || !passwordInput) && legacyCount >= 2) {
        if (!usernameInput) usernameInput = legacyInputs.nth(0);
        if (!passwordInput) passwordInput = legacyInputs.nth(1);
      }

      const sameField = usernameInput && passwordInput
        ? await usernameInput.evaluate((el, other) => el === other, await passwordInput.elementHandle().catch(() => null)).catch(() => false)
        : false;

      if (!passwordInput || !usernameInput || sameField) {
        addLog('Native username/password fields were not identified safely; trying the identity-provider login flow.');
        smartLoginVar = await smartLogin(page, username, password, 'Normal', landedFunction, addLog);
        if (!smartLoginVar?.authenticated) {
          const details = smartLoginVar?.status === 'verification_required'
            ? 'Sparx requires an additional verification step. Complete it and try again.'
            : 'The login form could not be completed or Sparx did not confirm authentication.';
          throw new Error(details);
        }
      } else {
        const userValue = await usernameInput.inputValue().catch(() => '');
        if (userValue.trim() !== username) {
          await usernameInput.fill(username);
          emailTypeStatus = true;
        }

        const passValue = await passwordInput.inputValue().catch(() => '');
        if (!passValue) {
          await passwordInput.fill(password);
          passTypeStatus = true;
        }

        addLog('Username and password fields were populated; submitting the login form.');
        const submit = await firstVisible(page, [
          '.sm-button.login-button',
          'button[type="submit"]',
          'input[type="submit"]',
          'button:has-text("Log in")',
          'button:has-text("Login")'
        ]);

        if (submit) await submit.click({ timeout: 8000 });
        else await passwordInput.press('Enter');
      }
    }
    addLog('Login form submitted; waiting for Sparx session cookies.');
    let session = null;
    const cookieDeadline = Date.now() + 25000;
    while (Date.now() < cookieDeadline) {
      session = await getSessionCookies(context);
      if (session) break;
      await delay(500);
    }

    if (!session) {
      const inputMetadata = await page.locator('input').evaluateAll(nodes => nodes
        .filter(input => input.offsetParent !== null)
        .map(input => ({ type: input.type, name: input.name, placeholder: input.placeholder }))
      ).catch(() => []);
      addLog(`Authentication did not create both expected session cookies. Current URL: ${page.url()}`);
      addLog(`Current page title: ${await page.title().catch(() => 'Unavailable')}`);
      addLog(`Visible input metadata (no values): ${JSON.stringify(inputMetadata)}`);
      const verificationVisible = await page.locator(
        'input[name="otc"], input[name="code"], #idTxtBx_SAOTCC_OTC, iframe[title*="captcha" i]'
      ).count().catch(() => 0);
      if (verificationVisible) {
        throw new Error('Sparx is asking for an additional verification step. This login flow cannot complete that step automatically.');
      }
      throw new Error('Login was submitted, but Sparx did not issue the expected session cookies. Check the username, password, and school selection.');
    }

    const cookieString = session.cookieString;
    addLog('Both required Sparx session cookies were received.');

    // Exchange cookies for JWT — native fetch primary, curl fallback
    const token = await exchangeForToken(cookieString, addLog);
    if (!token) {
      throw new Error(
        'Sparx session cookies were received, but neither the native token exchange nor the ' +
        'curl fallback returned a valid JWT. ' +
        'The session may have expired immediately, or the Sparx token endpoint may be temporarily unavailable.'
      );
    }

    returnObj.cookies = cookieString;
    returnObj.authToken = token;

    emailTypeStatus = smartLoginVar?.filledEmail || emailTypeStatus;
    passTypeStatus = smartLoginVar?.filledPassword || passTypeStatus;

  } catch (err) {
    addLog(`Error encountered: ${err.message}`);
    returnObj.status = 'error';
    returnObj.schoolStatus = schoolStatus;
    returnObj.loginTypeStatus = loginTypeStatus;
    returnObj.emailTypeStatus = smartLoginVar?.filledEmail || emailTypeStatus;
    returnObj.passTypeStatus = smartLoginVar?.filledPassword || passTypeStatus;

  } finally {
    clearTimeout(forceKillTimer);
    returnObj.logs = logs;
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  return returnObj;
}

module.exports = login;
