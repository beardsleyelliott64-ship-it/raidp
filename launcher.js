const { spawn, exec } = require('child_process');
const path = require('path');
const RESTART_DELAY = 3000;
const BOT_SCRIPT = path.resolve(__dirname, 'index.js');
const TOOLS_DIR = path.resolve(__dirname, 'tools'); 
let PYTHON_PORT = null;

const getPort = require('get-port').default;
const sendBotLogs = require('./utils/sendBotLogs');
const sendShutdownWebhook = require('./utils/sendShutdownWebhook');
let child = null;
let pythonChild = null; 
let stopping = false;

function timestamp() {
    return new Date().toISOString().replace('T', ' ').replace(/\..+/, '');
}

function log(msg) {
    console.log(`[${timestamp()}] [monitor] ${msg}`);
}

// === PORT CLEANUP UTILITY ===
// Automatically finds and kills any zombie process holding the port
function freePort(port) {
    return new Promise((resolve) => {
        log(`Checking for ghost processes on port ${port}...`);
        
        const isWin = process.platform === 'win32';
        
        if (isWin) {
            exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
                if (!stdout) return resolve(); // Port is free

                const pids = new Set();
                stdout.split('\n').forEach(line => {
                    if (line.includes(`:${port}`) && line.includes('LISTENING')) {
                        const parts = line.trim().split(/\s+/);
                        const pid = parts[parts.length - 1];
                        if (pid && pid !== '0') pids.add(pid);
                    }
                });

                if (pids.size === 0) return resolve();

                log(`Found stale processes on port ${port} (PIDs: ${Array.from(pids).join(', ')}). Killing them...`);
                let killed = 0;
                pids.forEach(pid => {
                    exec(`taskkill /F /PID ${pid}`, () => {
                        killed++;
                        if (killed === pids.size) {
                            setTimeout(resolve, 1000); // Give OS a second to free the port completely
                        }
                    });
                });
            });
        } else {
            // Linux/Mac implementation
            exec(`lsof -t -i:${port}`, (err, stdout) => {
                if (!stdout) return resolve();
                
                const pids = stdout.trim().split('\n').filter(Boolean);
                if (pids.length === 0) return resolve();
                
                log(`Found stale processes on port ${port} (PIDs: ${pids.join(', ')}). Killing them...`);
                let killed = 0;
                pids.forEach(pid => {
                    exec(`kill -9 ${pid}`, () => {
                        killed++;
                        if (killed === pids.length) {
                            setTimeout(resolve, 1000);
                        }
                    });
                });
            });
        }
    });
}

// === PYTHON MICROSERVICE MANAGER ===
function startPython() {
    if (stopping) return;
    if (pythonChild) return;

    log(`Starting Python microservice on port ${PYTHON_PORT}...`);

    const pythonCommand = process.env.PYTHON_BIN || (process.platform === 'win32'
        ? path.resolve(__dirname, 'venv', 'Scripts', 'python.exe')
        : path.resolve(__dirname, 'venv', 'bin', 'python'));
    if (!require('fs').existsSync(pythonCommand)) {
        log(`Python executable not found at ${pythonCommand}; starting Node bot without the Python helper.`);
        return;
    }

    pythonChild = spawn(pythonCommand, [
        '-m', 'uvicorn', 
        'curl_cffi_script:app', 
        '--host', '127.0.0.1', 
        '--port', PYTHON_PORT.toString()
    ], {
        cwd: TOOLS_DIR,
        stdio: 'inherit', 
        env: { ...process.env }
    });

    pythonChild.on('exit', (code, signal) => {
        pythonChild = null;
        if (!stopping) {
            log(`Python microservice exited unexpectedly (code=${code}, signal=${signal}). Restarting in ${RESTART_DELAY}ms...`);
            // Clear the port again just in case it crashed and left a zombie, then restart
            setTimeout(() => {
                freePort(PYTHON_PORT).then(startPython);
            }, RESTART_DELAY);
        }
    });

    pythonChild.on('error', (err) => {
        log(`Failed to start Python microservice: ${err.message}`);
        pythonChild = null;
        if (!stopping) setTimeout(startPython, RESTART_DELAY);
    });
}

// === NODE BOT MANAGER ===
async function start() {
    if (stopping) return;

    log(`Starting bot...`);

    child = spawn('node', [
        '--trace-warnings',
        '--trace-uncaught',
        BOT_SCRIPT
    ], {
        stdio: 'inherit',
        env: {
            ...process.env
        }
    });

    child.on('exit', async (code, signal) => {
        let message = '';
        if (stopping) {
            message = `Bot exited cleanly (code=${code}, signal=${signal}). Monitor shutting down.`;
            log(message);
            await sendShutdownWebhook(message, false);
            process.exit(0);
        }

        if (code === 0) {
            message = `Bot exited due to the restart command (code=${code}, signal=${signal}). Restarting in ${RESTART_DELAY}ms...`;
        } else {
            message = `Bot exited unexpectedly (code=${code}, signal=${signal}). Restarting in ${RESTART_DELAY}ms...`;
        }
        log(message);
        await sendShutdownWebhook(message, code === 0 ? false : true);
        child = null;
        setTimeout(start, RESTART_DELAY);
    });

    child.on('error', async (err) => {
        log(`Failed to start bot: ${err.message}`);
        child = null;
        if (err.message !== 'kill EPERM') {
            await sendShutdownWebhook(`Error: ${err.message}`, true);
        }
        if (!stopping) setTimeout(start, RESTART_DELAY);
    });
}

// === SHUTDOWN HANDLER ===
function shutdown(signal) {
    log(`Monitor received ${signal}. Stopping bot and Python service...`);
    stopping = true;
    
    if (child) child.kill(signal);
    if (pythonChild) pythonChild.kill(signal);

    setTimeout(() => {
        process.exit(0);
    }, 1500);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// === INITIALIZATION ===
async function init() {
    await sendBotLogs();
    
    PYTHON_PORT = await getPort();

    log(`Selected dynamic Python port: ${PYTHON_PORT}`);
    
    process.env.PYTHON_MICROSERVICE_URL = `http://127.0.0.1:${PYTHON_PORT}/fetch`;
    startPython();
    
    // 3. Poll the Python microservice until it responds, then start the bot.
    //    This replaces the old fixed 2 s delay which was too short on cold starts.
    const PYTHON_READY_TIMEOUT = 30_000; // give up after 30 s
    const PYTHON_POLL_INTERVAL = 500;

    async function waitForPython() {
        const deadline = Date.now() + PYTHON_READY_TIMEOUT;
        while (Date.now() < deadline) {
            try {
                const res = await fetch(`http://127.0.0.1:${PYTHON_PORT}/fetch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: 'https://example.com', method: 'GET', headers: {}, cookies: {} }),
                    signal: AbortSignal.timeout(1000)
                });
                if (res.status < 500) {
                    log('Python microservice is ready.');
                    return;
                }
            } catch {}
            await new Promise(r => setTimeout(r, PYTHON_POLL_INTERVAL));
        }
        log('Python microservice did not respond in time — starting bot anyway.');
    }

    // If Python failed to start (venv missing etc.) skip the wait entirely
    if (pythonChild) {
        await waitForPython();
    } else {
        log('No Python process — skipping readiness wait.');
    }

    start();
}

// Boot up
init();