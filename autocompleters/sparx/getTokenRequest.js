const curlRequesticator = require('../../utils/curlRequesticator');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getTokenRequest(cookies, attempts = 3) {
  try {
    const requesticator = new curlRequesticator(cookies);
    const headers = [
      "accept: */*",
      "accept-language: en-GB,en;q=0.9",
      "content-type: application/json",
      "Referer: https://app.sparx-learning.com/"
    ];

    const response = await requesticator._executeCurl(
      "https://api.sparx-learning.com/token",
      headers
    );

    return typeof response === 'string' ? response.trim() : JSON.stringify(response);

  } catch {
    if (attempts > 0) {
      await delay(1500); // Reduced from 2000
      return getTokenRequest(cookies, attempts - 1);
    }
    return null;
  }
}

module.exports = getTokenRequest;