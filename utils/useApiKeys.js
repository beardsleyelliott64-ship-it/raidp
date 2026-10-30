const addApiKeyExhausted = require('./addApiKeyExhausted');
const removeApiKey = require('./removeApiKey');

function statusOf(err) {
    return Number(err?.status ?? err?.code ?? err?.response?.status);
}

async function useApiKeys(apikeys, fn, fnArguments) {
    const keys = [...new Set((Array.isArray(apikeys) ? apikeys : []).filter(Boolean))];
    if (!keys.length) throw new Error('No Gemini API keys are configured. Set GEMINI_API_KEY or GEMINI_API_KEYS.');

    let lastError;

    for (const apikey of keys) {
        try {
            const answer = await fn(apikey, ...fnArguments);
            if (answer === 429) {
                await addApiKeyExhausted(apikey).catch(() => {});
                continue;
            }
            if (answer === 400) {
                await removeApiKey(apikey).catch(() => {});
                continue;
            }
            if (typeof answer !== 'number') return answer;
        } catch (err) {
            lastError = err;
            const status = statusOf(err);

            // Rotate keys instead of failing the entire Reader on rate limits,
            // temporary Gemini capacity errors, or an unavailable model.
            if (status === 429) {
                await addApiKeyExhausted(apikey).catch(() => {});
                continue;
            }
            if (status === 400 || status === 401 || status === 403) {
                await removeApiKey(apikey).catch(() => {});
                continue;
            }
            if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504 || status === 404) {
                continue;
            }

            throw err;
        }
    }

    if (lastError) throw lastError;
    return undefined;
}

module.exports = useApiKeys;
