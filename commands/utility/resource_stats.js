const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, WebhookClient } = require('discord.js');
const os = require('os');
const fs = require('fs').promises; // Use Promise-based fs
const { monitorEventLoopDelay } = require('perf_hooks');
const QuickChart = require('quickchart-js');

// Global reference to the client for background ping tracking
let discordClient = null;

// =====================================================================
// 1. ADVANCED BACKGROUND TELEMETRY (Runs continuously)
// =====================================================================

const MAX_DATA_POINTS = 36; // 3 minutes of historical data
const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
const WEBHOOK_INTERVAL_MS = 10 * 60 * 1000; // Send to webhook every 10 minutes

// Start Event Loop Delay Histogram
const elHistogram = monitorEventLoopDelay({ resolution: 10 });
elHistogram.enable();

const history = {
    botCpu: [],         // Bot CPU (100% = 1 core)
    botCpuAvg: [],      // Bot CPU 60-second moving average
    sysCpu: [],         // Total System CPU (Max = Cores * 100%)
    eld: [],            // Event Loop Delay p95 (ms)
    wsPing: [],         // Discord WebSocket Ping (ms)
    heapUsed: [],       // Actively used V8 JS Memory (MB)
    heapTotal: [],      // Total allocated V8 JS Memory (MB)
    external: [],       // C++ external memory allocations (MB)
    sysMemPressure: [], // True System Memory utilization (%)
    heapSysShare: []    // Bot Heap as % of total system RAM
};

// Gets total system CPU ticks 
function getSysCpuTicks() {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    for (const cpu of cpus) {
        for (const type in cpu.times) total += cpu.times[type];
        idle += cpu.times.idle;
    }
    return { idle, total, cores: cpus.length };
}

// Calculates TRUE memory pressure bypassing OS caching mechanisms (ASYNC)
async function getSystemMemory() {
    const total = os.totalmem();
    let available = os.freemem(); // Fallback for Windows/Mac
    
    if (os.platform() === 'linux') {
        try {
            // Read file asynchronously to prevent event loop blocking
            const meminfo = await fs.readFile('/proc/meminfo', 'utf8');
            const match = meminfo.match(/MemAvailable:\s+(\d+)/);
            if (match) available = parseInt(match[1], 10) * 1024; // Convert kB to Bytes
        } catch  {
            // Silently fallback to os.freemem() if reading fails
        }
    }
    
    const used = total - available;
    const pressure = (used / total) * 100;
    return { total, available, used, pressure };
}

// Baseline states for delta calculation
let lastBotCpuUsage = process.cpuUsage();
let lastBotHrTime = process.hrtime.bigint();
let lastSysCpuTicks = getSysCpuTicks();

// Made the interval callback async
setInterval(async () => {
    // Capture these immediately at the start of the tick for accurate timing
    const nowHrTime = process.hrtime.bigint();
    const botCpuUsage = process.cpuUsage(lastBotCpuUsage);
    
    // --- 1. CPU Calculations (HTOP Scale: 100% = 1 Core) ---
    const elapsedMicros = Number(nowHrTime - lastBotHrTime) / 1000;
    const botTotalMicros = botCpuUsage.user + botCpuUsage.system;
    const currentBotCpu = (botTotalMicros / elapsedMicros) * 100;

    const currentSysCpuTicks = getSysCpuTicks();
    const idleDelta = currentSysCpuTicks.idle - lastSysCpuTicks.idle;
    const totalDelta = currentSysCpuTicks.total - lastSysCpuTicks.total;
    
    const ticksPerCore = totalDelta / currentSysCpuTicks.cores;
    const usedSysTicks = totalDelta - idleDelta;
    const currentSysCpu = (usedSysTicks / ticksPerCore) * 100;

    // --- 2. Latency (Event Loop & Ping) ---
    const currentEld = elHistogram.percentile(95) / 1e6; // p95 in milliseconds
    elHistogram.reset();
    
    const currentPing = discordClient ? Math.max(0, discordClient.ws.ping) : 0; 

    // --- 3. Memory & Heap Stats ---
    const memUsage = process.memoryUsage();
    const sysMem = await getSystemMemory(); // Awaited async memory check

    const heapUsedMb = memUsage.heapUsed / 1024 ** 2;
    const heapTotalMb = memUsage.heapTotal / 1024 ** 2;
    const externalMb = memUsage.external / 1024 ** 2;
    const heapSysShare = (memUsage.heapUsed / sysMem.total) * 100;

    // --- 4. Store History ---
    history.botCpu.push(currentBotCpu);
    history.sysCpu.push(currentSysCpu);
    history.eld.push(currentEld);
    history.wsPing.push(currentPing);
    history.heapUsed.push(heapUsedMb);
    history.heapTotal.push(heapTotalMb);
    history.external.push(externalMb);
    history.sysMemPressure.push(sysMem.pressure);
    history.heapSysShare.push(heapSysShare);

    const avgSlice = history.botCpu.slice(-12);
    const botAvg = avgSlice.reduce((a, b) => a + b, 0) / avgSlice.length;
    history.botCpuAvg.push(botAvg);

    for (const key in history) {
        if (history[key].length > MAX_DATA_POINTS) history[key].shift();
    }

    lastBotCpuUsage = process.cpuUsage();
    lastBotHrTime = nowHrTime;
    lastSysCpuTicks = currentSysCpuTicks;
}, POLL_INTERVAL_MS);

// =====================================================================
// 2. REPORT GENERATION ENGINE (Used by Command & Webhook)
// =====================================================================

async function buildTelemetryReport() {
    if (history.botCpu.length < 3) return "⏳ Building baseline telemetry... Try again in 15 seconds.";

    const labels = history.botCpu.map((_, i) => {
        const secondsAgo = (history.botCpu.length - 1 - i) * (POLL_INTERVAL_MS / 1000);
        return secondsAgo === 0 ? 'Now' : `-${secondsAgo}s`;
    });

    // -------------------------------------------------------------
    // GRAPH 1: CPU & LATENCY
    // -------------------------------------------------------------
    const cpuChart = new QuickChart().setBackgroundColor('#2B2D31');
    cpuChart.setConfig({
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'System CPU (%)', data: history.sysCpu.map(v => v.toFixed(1)),
                    borderColor: '#ED4245', borderWidth: 2, fill: false, tension: 0.4, yAxisID: 'y1'
                },
                {
                    label: 'Bot Thread (%)', data: history.botCpu.map(v => v.toFixed(1)),
                    borderColor: '#5865F2', backgroundColor: 'rgba(88, 101, 242, 0.1)',
                    borderWidth: 2, fill: true, tension: 0.4, yAxisID: 'y1'
                },
                {
                    label: 'Bot 60s Avg', data: history.botCpuAvg.map(v => v.toFixed(1)),
                    borderColor: '#5865F2', borderDash: [5, 5], 
                    borderWidth: 2, fill: false, tension: 0.4, yAxisID: 'y1'
                },
                {
                    label: 'WS Ping (ms)', data: history.wsPing.map(v => v.toFixed(0)),
                    borderColor: '#1ABC9C', borderDash: [3, 3], // Aqua dashed line
                    borderWidth: 2, fill: false, tension: 0.4, yAxisID: 'y2'
                },
                {
                    label: 'Event Loop p95 (ms)', data: history.eld.map(v => v.toFixed(2)),
                    borderColor: '#FEE75C', borderWidth: 2, fill: false, tension: 0.4, yAxisID: 'y2'
                }
            ]
        },
        options: {
            scales: {
                yAxes: [
                    { id: 'y1', position: 'left', ticks: { fontColor: '#fff', suggestedMax: 100, min: 0 }, scaleLabel: { display: true, labelString: 'CPU Load (100% = 1 Core)', fontColor: '#fff' } },
                    { id: 'y2', position: 'right', ticks: { fontColor: '#FEE75C', min: 0 }, scaleLabel: { display: true, labelString: 'Latency (ms)', fontColor: '#FEE75C' }, gridLines: { drawOnChartArea: false } }
                ],
                xAxes: [{ ticks: { fontColor: '#fff', maxTicksLimit: 10 } }]
            },
            legend: { labels: { fontColor: '#fff', fontSize: 11 } }
        }
    });
    const cpuAttachment = new AttachmentBuilder(await cpuChart.toBinary(), { name: 'cpu-health.png' });

    // -------------------------------------------------------------
    // GRAPH 2: HEAP & MEMORY PRESSURE
    // -------------------------------------------------------------
    const ramChart = new QuickChart().setBackgroundColor('#2B2D31');
    ramChart.setConfig({
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'V8 Heap Used (MB)', data: history.heapUsed.map(v => v.toFixed(1)),
                    borderColor: '#5865F2', backgroundColor: 'rgba(88, 101, 242, 0.1)',
                    borderWidth: 2, fill: true, tension: 0.4, yAxisID: 'y1'
                },
                {
                    label: 'V8 Allocated (MB)', data: history.heapTotal.map(v => v.toFixed(1)),
                    borderColor: '#57F287', borderDash: [5, 5],
                    borderWidth: 2, fill: false, tension: 0.4, yAxisID: 'y1'
                },
                {
                    label: 'C++ External (MB)', data: history.external.map(v => v.toFixed(1)),
                    borderColor: '#EB459E', borderDash: [2, 2],
                    borderWidth: 2, fill: false, tension: 0.4, yAxisID: 'y1'
                },
                {
                    label: 'System Pressure (%)', data: history.sysMemPressure.map(v => v.toFixed(1)),
                    borderColor: '#ED4245', borderWidth: 2, fill: false, tension: 0.4, yAxisID: 'y2'
                },
                {
                    label: 'Bot Sys Share (%)', data: history.heapSysShare.map(v => v.toFixed(3)),
                    borderColor: '#FEE75C', borderWidth: 1, fill: false, tension: 0.4, yAxisID: 'y2'
                }
            ]
        },
        options: {
            scales: {
                yAxes: [
                    { id: 'y1', position: 'left', ticks: { fontColor: '#fff', min: 0 }, scaleLabel: { display: true, labelString: 'Node Memory (MB)', fontColor: '#fff' } },
                    { id: 'y2', position: 'right', ticks: { fontColor: '#ED4245', min: 0, max: 100 }, scaleLabel: { display: true, labelString: 'System Pressure (%)', fontColor: '#ED4245' }, gridLines: { drawOnChartArea: false } }
                ],
                xAxes: [{ ticks: { fontColor: '#fff', maxTicksLimit: 10 } }]
            },
            legend: { labels: { fontColor: '#fff', fontSize: 11 } }
        }
    });
    const ramAttachment = new AttachmentBuilder(await ramChart.toBinary(), { name: 'ram-pressure.png' });

    // -------------------------------------------------------------
    // BUILD EMBEDS
    // -------------------------------------------------------------
    const curSysCpu = history.sysCpu[history.sysCpu.length - 1];
    const curBotCpu = history.botCpu[history.botCpu.length - 1];
    const curBotAvg = history.botCpuAvg[history.botCpuAvg.length - 1];
    
    const curEld = history.eld[history.eld.length - 1];
    const curPing = history.wsPing[history.wsPing.length - 1];
    
    const curSysMem = history.sysMemPressure[history.sysMemPressure.length - 1];
    const curHeapUsed = history.heapUsed[history.heapUsed.length - 1];
    const curHeapTotal = history.heapTotal[history.heapTotal.length - 1];
    const curExt = history.external[history.external.length - 1];
    const curShare = history.heapSysShare[history.heapSysShare.length - 1];

    const cpuEmbed = new EmbedBuilder()
        .setTitle('⚙️ Processor & Latency Health')
        .setColor('#ED4245')
        .setDescription(`**Host OS:** \`${os.type()} ${os.release()}\`\n**CPU:** \`${os.cpus()[0].model}\` (${os.cpus().length} Cores)`)
        .addFields(
            { name: '🖥️ System Load', value: `\`${curSysCpu.toFixed(1)}%\`\n(Max: ${os.cpus().length * 100}%)`, inline: true },
            { name: '🤖 Bot Thread', value: `\`${curBotCpu.toFixed(1)}%\`\n(60s Avg: ${curBotAvg.toFixed(1)}%)`, inline: true },
            { name: '⏱️ Latency', value: `WS Ping: \`${curPing.toFixed(0)} ms\`\nEvent Loop: \`${curEld.toFixed(2)} ms\``, inline: true }
        )
        .setImage('attachment://cpu-health.png');

    const sysMemStats = await getSystemMemory(); // Awaited async memory check
    const ramEmbed = new EmbedBuilder()
        .setTitle('🧠 Memory Pressure & GC')
        .setColor('#57F287')
        .addFields(
            { name: '🖥️ System Pressure', value: `\`${curSysMem.toFixed(1)}%\`\n(${(sysMemStats.used/1024**3).toFixed(1)} / ${(sysMemStats.total/1024**3).toFixed(1)} GB)`, inline: true },
            { name: '🤖 V8 JS Heap', value: `Used: \`${curHeapUsed.toFixed(1)} MB\`\nAllocated: \`${curHeapTotal.toFixed(1)} MB\``, inline: true },
            { name: 'C++ & Footprint', value: `External: \`${curExt.toFixed(1)} MB\`\nSystem Share: \`${curShare.toFixed(3)}%\``, inline: true }
        )
        .setImage('attachment://ram-pressure.png')
        .setFooter({ text: `Graphs represent the last ${(history.botCpu.length * (POLL_INTERVAL_MS / 1000))} seconds.` });

    return { embeds: [cpuEmbed, ramEmbed], files: [cpuAttachment, ramAttachment] };
}

// =====================================================================
// 3. AUTOMATED WEBHOOK POSTING
// =====================================================================
if (process.env.RESOURCE_WEBHOOK_URL) {
    const webhookClient = new WebhookClient({ url: process.env.RESOURCE_WEBHOOK_URL });
    
    setInterval(async () => {
        // Ensure we have enough data before sending a blank graph
        if (history.botCpu.length < 3) return; 

        try {
            const reportPayload = await buildTelemetryReport();
            
            // If it returned a string, it means it's still buffering data
            if (typeof reportPayload !== 'string') {
                await webhookClient.send(reportPayload);
            }
        } catch (err) {
            console.error('[Telemetry] Failed to send webhook:', err);
        }
    }, WEBHOOK_INTERVAL_MS);
}

// =====================================================================
// 4. DISCORD COMMAND EXECUTION
// =====================================================================

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resource_stats')
        .setDescription('Production-grade Node.js and system APM graphs.'),
    async execute(interaction, client) {
        // Capture the client on the first run so the background graph can track Ping
        if (!discordClient) discordClient = client;

        await interaction.deferReply();

        const report = await buildTelemetryReport();

        if (typeof report === 'string') {
            await interaction.editReply(report);
        } else {
            await interaction.editReply(report);
        }
    },
};