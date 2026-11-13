require('dotenv').config();
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Enable stealth plugin
chromium.use(StealthPlugin());

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const smartLogin = require('../../utils/smartLogin');

async function login({
  username,
  password,
  type
} = {}) {
  let browser;
  let context;
  let page;

  let logs = '';
  const addLog = (msg) => logs += `\n${msg}`;

  const returnObj = { };
  let forceKillTimer;

  try {
    forceKillTimer = setTimeout(async () => {
      addLog('Force killing after 40s timeout');
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }, 40000);

    browser = await chromium.launch({ headless: true });

    context = await browser.newContext();
    page = await context.newPage();

    // --- Attach request listener early ---
    const accessKeyPromise = new Promise(resolve => {
      const onRequest = (req) => {
        const headers = req.headers();
        if (headers['access-key']) {
          returnObj.authToken = headers['access-key'];
          page.off('request', onRequest);
          resolve();
        }
      };
      page.on('request', onRequest);
    });

    addLog('Navigating to Seneca login page');

    await page.goto('https://app.senecalearning.com/login', {
      waitUntil: 'networkidle',
      timeout: 20000
    });

    const allButtons = await page.$$('button');
    const continueButtons = [];

    for (const btn of allButtons) {
      const text = await btn.evaluate(el => el.innerText);
      if (text && text.toLowerCase().includes('continue')) {
        continueButtons.push(btn);
      }
    }

    const landedFunction = ({ page }) => page.isClosed();

    if (type === 'Microsoft') {
      const popupPromise = page.waitForEvent('popup');
      await continueButtons[1].click();

      const popup = await popupPromise;
      await popup.bringToFront();

      addLog('Microsoft login initiated');

      await smartLogin(popup, username, password, 'Microsoft', landedFunction, addLog);

    } else if (type === 'Google') {
      const popupPromise = page.waitForEvent('popup');
      await continueButtons[0].click();

      const popup = await popupPromise;
      await popup.bringToFront();

      addLog('Google login initiated');

      await smartLogin(popup, username, password, 'Google', landedFunction, addLog);

    } else {
      await continueButtons[2].click();

      await page.waitForSelector('#email', { state: 'visible' });
      await page.fill('#email', username);
      await page.fill('#password', password);

      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await btn.evaluate(el => el.innerText.trim());
        if (text === 'Log in' || text === 'Send one-time email link') {
          await btn.click();
          break;
        }
      }

      addLog('Email/password login submitted');
    }

    await Promise.race([
      accessKeyPromise,
      delay(10000)
    ]);

    addLog('Login flow completed');

  } catch (err) {
    addLog(`Error: ${err.message}`);
    returnObj.status = 'error';
  } finally {
    clearTimeout(forceKillTimer); // Clear it so it doesn't trigger if finished early
    returnObj.logs = logs;
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  return returnObj;
}

module.exports = login;