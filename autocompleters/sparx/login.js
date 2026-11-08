const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

const searchSchool = require('./searchSchool');
const smartLogin = require('../../utils/smartLogin');
const getTokenRequest = require('./getTokenRequest');

chromium.use(StealthPlugin());

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function login({ school, username, password, type } = {}) {
  const schoolData = await searchSchool(school);
  if (!schoolData) return { status: 'error', message: 'No School Found' };

  const schoolUUID = schoolData.i;
  const startURL = `https://api.sparx-learning.com/oauth2/login?school=${schoolUUID}`;

  let logs = '';
  const addLog = (msg) => logs += `\n${msg}`;

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
    // Force kill the browser after 40s. This immediately triggers the catch block below.
    forceKillTimer = setTimeout(async () => {
      addLog('Force killing after 40s timeout');
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }, 40000);

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

    addLog(`Navigated to login page. Using type: ${type}`);

    if (type.toLowerCase() !== 'normal') {
      // look for any element (button/input) whose formaction starts with the SSO URL
      await page.evaluate(() => {
        const selector =
          'button[formaction^="https://auth.sparx-learning.com/oauth2/login"], input[formaction^="https://auth.sparx-learning.com/oauth2/login"]';

        const el = document.querySelector(selector);
        if (el) el.click();
      });

      smartLoginVar = await smartLogin(page, username, password, type, landedFunction, addLog);

    } else {
      await page.waitForSelector('.sm-input', { state: 'visible', timeout: 5000 }).catch(() => {
         throw new Error('Normal login inputs did not appear within 5 seconds.');
      });

      const inputs = page.locator('.sm-input');
      const count = await inputs.count();

      if (count >= 2) {
        const emailInput = inputs.nth(0);
        const passInput = inputs.nth(1);

        const emailValue = await emailInput.inputValue();
        if (!emailValue?.trim()) {
          await emailInput.fill(username);
          emailTypeStatus = true;
        }

        const passValue = await passInput.inputValue();
        if (!passValue?.trim()) {
          await passInput.fill(password);
          passTypeStatus = true;
        }
      } else {
        throw new Error('Normal login inputs not found.');
      }

      emailTypeStatus = true;
      passTypeStatus = true;

      await safeClick(page, '.sm-button.login-button');

      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
      } catch {}
    }
    
    addLog('Got past the logins');
    await delay(1500);

    const cookies = await context.cookies();
    const live = cookies.find(c => c.name === 'live_ssoprovider_session');
    const spx = cookies.find(c => c.name === 'spxlrn_session');

    const cookieString = `live_ssoprovider_session=${live?.value || ''}; spxlrn_session=${spx?.value || ''}`;

    if (cookieString.length <= 42) {
      addLog('Login failed - no valid cookies found');
      throw new Error('Login failed - no valid cookies found');
    }

    const token = await getTokenRequest(cookieString);

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
    clearTimeout(forceKillTimer); // Clear it so it doesn't trigger if finished early
    returnObj.logs = logs;
    // Ensuring everything cleans up properly even if an error is thrown
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  return returnObj;
}

module.exports = login;