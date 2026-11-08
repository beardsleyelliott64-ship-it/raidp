require('dotenv').config();

class curlRequesticator {
  constructor(cookies) {
    this.cookies = this._parseCookies(cookies);
    this.microserviceUrl = process.env.PYTHON_MICROSERVICE_URL || 'http://127.0.0.1:8000/fetch';
  }

  _parseCookies(cookieData) {
    if (!cookieData) return {};
    if (typeof cookieData === 'object' && !Array.isArray(cookieData)) return cookieData;
    
    const cookieObj = {};
    if (typeof cookieData === 'string') {
        cookieData.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const value = parts.slice(1).join('=').trim();
                cookieObj[key] = value;
            }
        });
    }
    return cookieObj;
  }

  async _executeCurl(url, headers, data = null, options = {}) {
    const requestData = {
        url: url,
        method: data ? 'POST' : 'GET',
        headers: {},
        cookies: this.cookies,
        data: null,
        is_binary_data: false
    };

    if (Array.isArray(headers)) {
        headers.forEach(h => {
            const parts = h.split(':');
            if (parts.length >= 2) {
                const key = parts[0].trim().toLowerCase();
                const value = parts.slice(1).join(':').trim();
                requestData.headers[key] = value;
            }
        });
    }

    if (Buffer.isBuffer(data)) {
        requestData.data = data.toString('base64');
        requestData.is_binary_data = true;
    } else if (data) {
        requestData.data = typeof data === 'object' ? JSON.stringify(data) : data;
    }

    try {
        const proxyResponse = await fetch(this.microserviceUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });

        if (!proxyResponse.ok) {
            const errorDetails = await proxyResponse.text();
            throw new Error(`Microservice HTTP ${proxyResponse.status}: ${errorDetails}`);
        }

        const result = await proxyResponse.json();
        const bodyBuffer = Buffer.from(result.body, 'base64');
        let responseBody;

        if (options.responseType === 'arraybuffer') {
            responseBody = bodyBuffer;
        } else {
            const bodyString = bodyBuffer.toString('utf8');
            try {
                responseBody = JSON.parse(bodyString);
            } catch {
                responseBody = bodyString;
            }
        }

        if (options.returnHeaders) {
            return {
                status: result.statusCode,
                headers: result.headers,
                data: responseBody
            };
        } else {
            return responseBody;
        }

    } catch (e) {
        console.error('Python Request Failed:', e);
        throw e;
    }
  }
}

module.exports = curlRequesticator;