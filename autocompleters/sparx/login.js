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

const SESSION_COOKIE_NAMES = [
  'live_ssoprovider_session',
  'spxlrn_session',
  'spx_session',
  'sparx_session',
  '__Host-spxlrn_session',
  'csrf_token',
  'XSRF-TOKEN'
];

// --- Fast safe click ---
async function safeClick(page, selector, maxAttempts = 3) {
  const locator = page.locator(selector).first();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await locator.click({ force: true, timeout: 2500 });
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

    if (attempt < maxAttempts - 1) await delay(150);
  }
  throw new Error(`Failed to click ${selector}`);
}

function buildCookieString(cookies) {
  // Prefer known session cookies, but always include every cookie from
  // sparx / auth hosts so token exchange has the full jar.
  const byName = new Map();
  for (const c of cookies) {
    const host = (c.domain || '').replace(/^\./, '');
    if (
      host.includes('sparx') ||
      host.includes('sparxmaths') ||
      host.includes('sparx-learning') ||
      SESSION_COOKIE_NAMES.includes(c.name)
    ) {
      byName.set(c.name, c.value);
    }
  }
  // Always surface the two primary names first if present
  const parts = [];
  for (const name of SESSION_COOKIE_NAMES) {
    if (byName.has(name)) {
      parts.push(`${name}=${byName.get(name)}`);
      byName.delete(name);
    }
  }
  for (const [name, value] of byName) {
    parts.push(`${name}=${value}`);
  }
  return parts.join('; ');
}

async function waitForLanding(page, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const url = page.url();
    if (landedFunction({ url })) return url;
    // oauth callback / student portal — give redirect chain time to finish
    if (/sparx-learning\.com\/(student|oauth|callback|auth)/i.test(url)) {
      await delay(800);
      if (landedFunction({ url: page.url() })) return page.url();
    }
    // still on Microsoft / Google intermediate — click through KMSI if present
    if (/login\.microsoftonline\.com|login\.live\.com|accounts\.google\.com/i.test(url)) {
      try {
        const yes = page.locator('#idSIButton9, input[value="Yes"], button:has-text("Yes")').first();
        if (await yes.isVisible({ timeout: 400 }).catch(() => false)) {
          await yes.click({ force: true }).catch(() => {});
          await delay(1500);
          continue;
        }
      } catch { /* ignore */ }
    }
    await delay(400);
  }
  return page.url();
}

async function login({ school, username, password, type } = {}) {
  const schoolData = await searchSchool(school);
  if (!schoolData) return { status: 'error', message: 'No School Found' };

  const schoolUUID = schoolData.i;
  const startURL = `https://api.sparx-learning.com/oauth2/login?school=${schoolUUID}`;

  let logs = '';
  const addLog = (msg) => { logs += `\n${msg}`; };

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
    // Longer window — Microsoft / Google SSO routinely exceeds 40s on cold starts.
    forceKillTimer = setTimeout(async () => {
      addLog('Force killing after 90s timeout');
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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
    ];
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

    context = await browser.newContext({
      userAgent: randomUserAgent,
      ignoreHTTPSErrors: true,
      viewport: { width: 1366, height: 768 }
    });

    await context.route('https://cdn.cookie-script.com/**', route => route.abort());

    page = await context.newPage();
    addLog('Browser launched and new page created.');
    page.setDefaultTimeout(25000);

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
      timeout: 20000
    });
    addLog(`Navigated to login page. Using type: ${type}`);

    const loginType = String(type || 'normal').toLowerCase();

    if (loginType !== 'normal') {
      loginTypeStatus = true;
      await page.evaluate(() => {
        const selector =
          'button[formaction^="https://auth.sparx-learning.com/oauth2/login"], input[formaction^="https://auth.sparx-learning.com/oauth2/login"], a[href*="oauth2/login"]';
        const el = document.querySelector(selector);
        if (el) el.click();
      });
      // brief pause so SSO page can load before smartLogin starts probing
      await delay(1200);
      smartLoginVar = await smartLogin(page, username, password, type, landedFunction, addLog);
      emailTypeStatus = !!smartLoginVar?.filledEmail;
      passTypeStatus = !!smartLoginVar?.filledPassword;
    } else {
      await page.waitForSelector('.sm-input, input[type="email"], input[name="username"], input[type="text"]', {
        state: 'visible',
        timeout: 8000
      }).catch(() => {
        throw new Error('Normal login inputs did not appear within 8 seconds.');
      });

      // Prefer Sparx class, fall back to generic inputs
      let emailInput = page.locator('.sm-input').nth(0);
      let passInput = page.locator('.sm-input').nth(1);
      const smCount = await page.locator('.sm-input').count();
      if (smCount < 2) {
        emailInput = page.locator('input[type="email"], input[name="username"], input[type="text"]').first();
        passInput = page.locator('input[type="password"]').first();
      }

      await emailInput.fill('');
      await emailInput.fill(username);
      emailTypeStatus = true;

      await passInput.fill('');
      await passInput.fill(password);
      passTypeStatus = true;

      // Submit
      const submitCandidates = [
        '.sm-button.login-button',
        'button.login-button',
        'button[type="submit"]',
        'button:has-text("Log in")',
        'button:has-text("Sign in")'
      ];
      let submitted = false;
      for (const sel of submitCandidates) {
        try {
          await safeClick(page, sel);
          submitted = true;
          break;
        } catch { /* try next */ }
      }
      if (!submitted) {
        // last resort: press Enter in password field
        await passInput.press('Enter');
      }

      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 });
      } catch {}
    }

    addLog('Got past the logins — waiting for Sparx landing URL…');
    // Microsoft/Google SSO redirect chains need more time than normal login
    const waitMs = /microsoft|google|office/i.test(String(type || '')) ? 45000 : 28000;
    const landedUrl = await waitForLanding(page, waitMs);
    addLog(`Landing URL: ${landedUrl}`);

    // Extra settle so Set-Cookie from final redirect is in the jar
    await delay(2000);

    // Nudge app origin if still on oauth intermediate or IdP
    if (!landedFunction({ url: page.url() })) {
      // Prefer finishing the oauth callback first if we're stuck on the IdP
      for (const dest of [
        `https://api.sparx-learning.com/oauth2/login?school=${schoolUUID}`,
        'https://maths.sparx-learning.com/',
        'https://app.sparx-learning.com/',
        'https://reader.sparx-learning.com/'
      ]) {
        try {
          await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: 12000 });
          await delay(800);
          if (landedFunction({ url: page.url() })) break;
        } catch { /* continue */ }
      }
      await delay(1000);
    }

    const allCookies = await context.cookies();
    addLog(`Cookie count from browser: ${allCookies.length}`);
    const cookieString = buildCookieString(allCookies);
    addLog(`Session cookie string length: ${cookieString.length}`);

    const hasPrimary =
      /live_ssoprovider_session=/.test(cookieString) ||
      /spxlrn_session=/.test(cookieString) ||
      /spx_session=/.test(cookieString);

    if (!hasPrimary && cookieString.length < 20) {
      addLog('Login failed - no valid session cookies found');
      throw new Error('Login failed - no valid session cookies found');
    }

    let token = await getTokenRequest(cookieString);
    if (!token || String(token).includes('Unauthorized') || String(token).length < 20) {
      addLog(`Primary token exchange failed (${String(token).slice(0, 80)}). Retrying…`);
      await delay(1200);
      token = await getTokenRequest(cookieString);
    }

    if (!token || String(token).includes('Unauthorized') || String(token).length < 20) {
      addLog('Token exchange failed after retry');
      throw new Error('Token exchange failed');
    }

    returnObj.cookies = cookieString;
    returnObj.authToken = typeof token === 'string' ? token.trim() : String(token);
    returnObj.status = 'ok';

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
