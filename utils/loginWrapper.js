const puppetQueue = require('../queues/puppeteerQueue');

function loginWrapper(loginFn) {
    return puppetQueue.add(async () => {
        // Create a timeout promise (e.g., 60 seconds)
        const timeout = new Promise((resolve) => 
            setTimeout(() => {
                resolve({ status: 'error', logs: 'Task timed out after 60s' });
            }, 60000) // Adjust time as needed
        );

        // The task will resolve with whichever finishes first: the login script or the timeout
        return Promise.race([loginFn(), timeout]);
    });
}

module.exports = loginWrapper;