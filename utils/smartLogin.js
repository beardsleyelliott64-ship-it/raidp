const DEFAULT_TIMEOUT = 8000;
const MAX_ATTEMPTS = 45;

async function isElementVisible(page, selector) {
    try {
        const locator = page.locator(selector);
        const count = await locator.count();
        for (let index = 0; index < count; index++) {
            if (await locator.nth(index).isVisible().catch(() => false)) return true;
        }
        return false;
    } catch {
        return false;
    }
}

async function firstVisibleLocator(page, selector) {
    try {
        const locator = page.locator(selector);
        const count = await locator.count();
        for (let index = 0; index < count; index++) {
            const candidate = locator.nth(index);
            if (await candidate.isVisible().catch(() => false)) return candidate;
        }
    } catch {}
    return null;
}

async function smartLogin(
    page,
    email,
    password,
    loginType = 'Normal',
    landedFunction,
    logFn = () => {}
) {
    const log = (msg) => logFn(`[SmartLogin][${loginType}] ${msg}`);

    page.setDefaultTimeout(DEFAULT_TIMEOUT);

    const EMAIL_SELECTORS = [
        'input[name="loginfmt"]',
        'input[type="email"]',
        'input[name="identifier"]',
        '#i0116',
        '#Email'
    ].join(',');

    const PASSWORD_SELECTORS = [
        'input[name="passwd"]',
        'input[name="Passwd"]',
        'input[type="password"]',
        '#i0118'
    ].join(',');

    const SUBMIT_BUTTONS = [
        '#idSIButton9',
        '#identifierNext',
        '#passwordNext',
        '#submit',
        'button[type="submit"]',
        'button[id*="Next"]',
        '#identity-provider-linking-continue'
    ].join(',');

    const ERROR_INDICATORS = [
        '#usernameError',
        '#passwordError',
        'div[aria-live="assertive"]',
        '.error',
        '.text-danger'
    ].join(',');

    let filledEmail = false;
    let filledPassword = false;
    let lastUrl = page.url();

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
            const url = page.url();

            // Only the supplied Sparx success detector can confirm success.
            if (typeof landedFunction === 'function') {
                if (await landedFunction({ url, page })) {
                    log('Authentication destination detected.');
                    return {
                        status: 'success',
                        authenticated: true,
                        filledEmail,
                        filledPassword
                    };
                }
            }

            if (url !== lastUrl) {
                log(`Navigation detected: ${url.substring(0, 100)}`);
                lastUrl = url;
            }

            // Give the page time to render its next authentication step.
            await page.waitForTimeout(500);

            if (await isElementVisible(page, ERROR_INDICATORS)) {
                log('An authentication error indicator is visible.');

                if (await isElementVisible(page, PASSWORD_SELECTORS)) {
                    filledPassword = false;
                } else if (await isElementVisible(page, EMAIL_SELECTORS)) {
                    filledEmail = false;
                }
            }

            // Handle email/username.
            if (await isElementVisible(page, EMAIL_SELECTORS)) {
                const emailInput = await firstVisibleLocator(page, EMAIL_SELECTORS);
                if (!emailInput) continue;
                const currentValue = await emailInput.inputValue().catch(() => '');

                if (currentValue !== email) {
                    log('Entering username/email.');
                    await emailInput.fill(email);
                }

                filledEmail = true;

                // Click the visible submit button if present.
                const submit = await firstVisibleLocator(page, SUBMIT_BUTTONS);

                if (submit) {
                    await submit.click();
                } else {
                    await emailInput.press('Enter');
                }

                await page.waitForTimeout(1000);
                continue;
            }

            // Handle password.
            if (await isElementVisible(page, PASSWORD_SELECTORS)) {
                const passwordInput = await firstVisibleLocator(page, PASSWORD_SELECTORS);
                if (!passwordInput) continue;
                const currentValue = await passwordInput.inputValue().catch(() => '');

                if (!filledPassword || !currentValue) {
                    log('Entering password.');
                    await passwordInput.fill(password);
                }

                filledPassword = true;

                const submit = await firstVisibleLocator(page, SUBMIT_BUTTONS);

                if (submit) {
                    await submit.click();
                } else {
                    await passwordInput.press('Enter');
                }

                await page.waitForTimeout(1500);
                continue;
            }

            // Handle an identity-provider confirmation page.
            if (
                url.includes('samlconfirmaccount') ||
                url.includes('speedbump')
            ) {
                const continueButton = await firstVisibleLocator(
                    page,
                    '#identity-provider-linking-continue'
                );

                if (continueButton) {
                    log('Identity-provider confirmation detected.');
                    await continueButton.click();
                    await page.waitForTimeout(1000);
                    continue;
                }
            }

            // Do not automatically bypass MFA or CAPTCHA.
            if (await isElementVisible(
                page,
                'input[name="otc"], #idTxtBx_SAOTCC_OTC, input[name="code"]'
            )) {
                log('Additional verification is required.');
                return {
                    status: 'verification_required',
                    authenticated: false,
                    filledEmail,
                    filledPassword
                };
            }

        } catch (error) {
            log(`Attempt ${attempt + 1} encountered an issue: ${error.message}`);
        }

        await page.waitForTimeout(500);
    }

    log('Login did not reach a confirmed authentication destination.');

    return {
        status: 'timeout',
        authenticated: false,
        filledEmail,
        filledPassword
    };
}

module.exports = smartLogin;
