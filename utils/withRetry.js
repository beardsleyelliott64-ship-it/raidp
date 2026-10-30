const delay = require('./delay');

function withRetry(fn, retries = 3) {
    // Returns a new function that acts exactly like your original one, but with retries
    return async function (...args) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                // Try to run the original function
                return fn(...args);
            } catch (error) {
                // Check if it's the Cloudflare HTML error or a general connection timeout
                const isHtmlError = error.message && error.message.includes('<!DOCTYPE html>');
                const isNetworkError = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';

                if ((isHtmlError || isNetworkError) && attempt < retries) {
                    await delay(2000); // Wait 2 seconds before retrying
                } else {
                    // If it's a real code/SQL error, or we ran out of retries, throw it
                    throw error;
                }
            }
        }
    };
}

module.exports = withRetry;