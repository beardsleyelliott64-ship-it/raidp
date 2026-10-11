// --- Configuration ---
const DEFAULT_TIMEOUT = 2000;

async function isElementVisible(page, selector) {
    try {
        // Playwright handles visibility checks natively and safely
        return await page.locator(selector).first().isVisible();
    } catch { 
        return false; 
    }
}

async function smartLogin(page, email, password, loginType = 'Normal', landedFunction, logFn = () => { }) {
    const log = (msg) => logFn(`[SmartLogin][${loginType}] ${msg}`);

    page.setDefaultTimeout(DEFAULT_TIMEOUT);

    const EMAIL_SELECTORS = ['input[name="loginfmt"]', 'input[type="email"]', 'input[name="identifier"]', '#i0116', '#Email'].join(',');
    const PASSWORD_SELECTORS = ['input[name="passwd"]', 'input[name="Passwd"]', 'input[type="password"]', '#i0118'].join(',');
    
    /*
    const TWO_FACTOR_SELECTORS = ['input[name="otc"]', '#idTxtBx_SAOTCC_OTC', 'input[name="code"]', '#idTxtBx_SMSOTP_OTC'].join(',');
    const AUTHENTICATOR_DISPLAY_SELECTORS = ['#idRichContext_DisplaySign', '.displaySign'].join(',');
    const ANOTHER_WAY_LINK = '#signInAnotherWay';
    const OPTION_List = 'div[data-bind*="options"] .table, #idDiv_SAOTCS_Proofs .table';
    */
    
    // Note: Puppeteer's ::-p-text() was replaced with Playwright's :has-text()
    const SUBMIT_BUTTONS = [
        '#idSIButton9', '#identifierNext', '#passwordNext', '#submit',
        'button[type="submit"]', 'button[id*="Next"]',
        '#identity-provider-linking-continue',
        'span:has-text("Continue")' 
    ].join(',');

    const ERROR_INDICATORS = ['#usernameError', '#passwordError', 'div[aria-live="assertive"]', '.error', '.text-danger'].join(',');

    let filledEmail = false;
    let filledPassword = false;
    let lastUrl = page.url();
    /*
    let last2FANumber = null;
    let lastAuthType = null;
    let isWaitingForUser = false;
    let userDecisionPromise = null;
    */

    const ALL_INTERACTIVE = `${EMAIL_SELECTORS},${PASSWORD_SELECTORS},${SUBMIT_BUTTONS}`;

    for (let attempt = 0; attempt < 25; attempt++) {
        const url = page.url();

        // 1. Success Check
        if (landedFunction({ url, page })) return { filledEmail, filledPassword };

        // 2. Navigation State Reset
        if (url !== lastUrl) {
            log(`Navigated: ${url.substring(0, 40)}...`);
            lastUrl = url;
            filledPassword = false; // Reset password state on navigation
        }

        try { 
            await page.locator(ALL_INTERACTIVE).first().waitFor({ state: 'visible', timeout: 500 }); 
        } catch { }

        // 4. Speedbump Handling
        if (url.includes('samlconfirmaccount') || url.includes('speedbump')) {
            log(`Speedbump page detected.`);
            try {
                const continueBtn = page.locator('#identity-provider-linking-continue, span:has-text("Continue")').first();
                if (await continueBtn.isVisible()) {
                    await continueBtn.click();
                    await page.waitForLoadState('networkidle', { timeout: 1000 }).catch(() => { });
                    continue;
                }
            } catch { }
        }

        // 5. Error Detection
        if (await isElementVisible(page, ERROR_INDICATORS)) {
            // Check PASSWORD selectors first. 
            // If the password field is visible, any error on screen is likely a password error.
            if (filledEmail && await isElementVisible(page, PASSWORD_SELECTORS)) {
                log(`Password Error. Retrying...`);
                filledPassword = false;
            }
            // Only if Password field is NOT visible do we assume it's an email error.
            else if (await isElementVisible(page, EMAIL_SELECTORS)) {
                try {
                    const currentVal = await page.locator(EMAIL_SELECTORS).first().inputValue();
                    if (currentVal !== email) {
                        log(`Email Error (Field mismatch). Retrying...`);
                        filledEmail = false;
                    }
                } catch {
                    log(`Email Error. Retrying...`);
                    filledEmail = false;
                }
            }
        }

        // --- Explicit State Check ---
        if (filledPassword) {
            try {
                const passVal = await page.locator(PASSWORD_SELECTORS).first().inputValue().catch(() => 'unknown');
                if (passVal === '') {
                    log('Password field detected empty. Retrying typing...');
                    filledPassword = false;
                }
            } catch { }
        }

        // 6. Handle 2FA Prompt (Commented but ported logic to Playwright APIs just in case)
        /*
        if (on2FA) {
            let authType = null;
            let value = null;
            let methods = [];

            if (await isElementVisible(page, AUTHENTICATOR_DISPLAY_SELECTORS)) {
                authType = 'approval';
                try {
                    value = await page.locator(AUTHENTICATOR_DISPLAY_SELECTORS).first().innerText();
                    value = value.trim();
                    if (value !== last2FANumber) {
                        last2FANumber = value;
                        isWaitingForUser = false;
                    }
                } catch (e) { log(`Error processing Authenticator number: ${e.message}`); }
            } else if (await isElementVisible(page, TWO_FACTOR_SELECTORS)) {
                authType = 'code';
            } else if (await isElementVisible(page, OPTION_List)) {
                authType = 'select_method';
                try {
                    const rows = page.locator('.table-row');
                    const rowCount = await rows.count();
                    for (let i = 0; i < rowCount; i++) {
                        const r = rows.nth(i);
                        const text = (await r.innerText()).split('\n')[0].trim();
                        const val = await r.locator('div[data-value]').first().getAttribute('data-value').catch(()=>null);
                        methods.push({ text, value: val, index: i });
                    }
                } catch (e) { log(`Error extracting methods: ${e.message}`); }
            }

            if (authType) {
                if (isWaitingForUser && (lastAuthType !== authType || (authType === 'approval' && value !== last2FANumber))) {
                    isWaitingForUser = false;
                    userDecisionPromise = null;
                }

                if (!isWaitingForUser) {
                    isWaitingForUser = true;
                    lastAuthType = authType;
                    last2FANumber = value;

                    userDecisionPromise = on2FA({
                        type: authType,
                        value: value,
                        methods: methods
                    });
                }

                const result = await Promise.race([
                    userDecisionPromise,
                    new Promise(r => setTimeout(() => r(null), 2000))
                ]);

                if (result) {
                    isWaitingForUser = false;
                    userDecisionPromise = null;

                    if (result.action === 'select_method') {
                        log(`User selected method index: ${result.index}`);
                        await page.evaluate((idx) => {
                            const domRows = document.querySelectorAll('.table-row');
                            if (domRows[idx]) domRows[idx].click();
                        }, result.index);
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    } else if (result.action === 'code') {
                        log('User entered code.');
                        const input = page.locator(TWO_FACTOR_SELECTORS).first();
                        if (await input.isVisible()) {
                            await input.fill(result.code);
                            await page.keyboard.press('Enter');
                        }
                        continue;
                    }
                } else {
                    continue;
                }
            } else {
                isWaitingForUser = false;
                userDecisionPromise = null;
            }
        }
        */

        // 7. Handle Email
        if (!filledEmail) {
            try {
                const emailLoc = page.locator(EMAIL_SELECTORS).first();
                if (await emailLoc.isVisible()) {
                    const currentVal = await emailLoc.inputValue();
                    if (currentVal !== email) {
                        log(`Typing Email...`);
                        
                        // Playwright's `fill` natively clears existing text and inputs new text seamlessly
                        await emailLoc.fill(email);
                        filledEmail = true;
                        
                        await page.keyboard.press('Enter');
                        continue;
                    } else {
                        filledEmail = true;
                    }
                }
            } catch { }
        }

        // 8. Handle Password
        if (filledEmail && !filledPassword) {
            try {
                const passLoc = page.locator(PASSWORD_SELECTORS).first();
                if (await passLoc.isVisible()) {
                    log(`Typing Password...`);
                    
                    await new Promise(r => setTimeout(r, 300));
                    
                    // .fill clears pre-existing fields, removing the need for manual focus & backspace overrides
                    await passLoc.fill(password);
                    
                    filledPassword = true;
                    await page.keyboard.press('Enter');
                    continue;
                }
            } catch { }
        }

        // 9. Click Next/Submit
        try {
            const buttonsLoc = page.locator(SUBMIT_BUTTONS);
            const count = await buttonsLoc.count();
            
            for (let i = 0; i < count; i++) {
                const btn = buttonsLoc.nth(i);
                if (await btn.isVisible()) {
                    // Prevention 1: Don't click Next if Email is visible but empty/wrong
                    if (!filledEmail && await isElementVisible(page, EMAIL_SELECTORS)) continue;

                    // Prevention 2: Don't click "Sign In" if password visible but not typed
                    if (await isElementVisible(page, PASSWORD_SELECTORS) && !filledPassword) continue;

                    log(`Clicking Next/Continue...`);
                    await btn.click({ force: true });
                    await new Promise(r => setTimeout(r, 500));
                    break;
                }
            }
        } catch { }
    }

    return { filledEmail, filledPassword };
}

module.exports = smartLogin;