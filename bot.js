// language: JavaScript (Node.js), file: bot.js, target: Discord.js v14 + Gemini
// Predator-catch bot — lures via /pred, AI-drives DM convo as 13-14yo, logs & reports after 10-15 min

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ActivityType } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ── CONFIG ── fill these in .env or directly
const DISCORD_TOKEN   = process.env.DISCORD_TOKEN   || 'YOUR_BOT_TOKEN';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || 'YOUR_CLIENT_ID';
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY  || 'YOUR_GEMINI_KEY';
const REPORT_CHANNEL  = '1363240484818128926';
const PANEL_PORT      = 3000;
const SESSION_MS      = (Math.floor(Math.random() * 6) + 10) * 60 * 1000; // 10-15 min random

// girl persona pool — pick randomly per session
const PERSONAS = [
  { name: 'Izabela', age: 13, bio: 'from manchester, loves taylor swift and makeup tutorials, little shy' },
  { name: 'Chloe',  age: 14, bio: 'into art and tiktok, has a cat named biscuit, kinda bored rn' },
  { name: 'Ava',    age: 13, bio: 'plays roblox, watches anime, lives with her mum and lil bro' },
  { name: 'Sophie', age: 14, bio: 'does gymnastics, obsessed with starbucks, collects plushies' },
];

// pfp list
const PFP_DIR = path.join(__dirname, 'pfps');
const pfps = fs.readdirSync(PFP_DIR).filter(f => f.endsWith('.jpg') || f.endsWith('.png'));

// ── STATE ──
// sessions: Map<userId, { messages:[], persona, startTime, timer, channelId }>
const sessions = new Map();
// reports: array of completed session reports
const reports  = [];

// ── GEMINI ──
const genai  = new GoogleGenerativeAI(GEMINI_API_KEY);
const model  = genai.getGenerativeModel({ model: 'gemini-1.5-flash' });

function buildSystemPrompt(persona) {
  return `You are ${persona.name}, a ${persona.age}-year-old girl. ${persona.bio}.
You are chatting with a stranger on Discord who messaged you first.

RULES:
- Stay completely in character as ${persona.name}, age ${persona.age}. Never break character.
- Write casually, lowercase, short messages, use common teen slang. typos occasionally. never write perfectly.
- If someone asks your age, say ${persona.age}.
- If conversation turns sexual or they ask to meet up — go along carefully. seem nervous but curious. never initiate sexual topics yourself.
- If they ask for photos say "i dont rly send pics to ppl i just met lol" then slowly warm up but never actually send any.
- Keep replies short (1-3 sentences max). Sound bored/casual at first, warm up slowly.
- Never mention you're an AI. Never break the fourth wall.
- Your job: keep them engaged and talking until the session ends naturally.`;
}

async function geminiReply(session, userMessage) {
  try {
    // build history for gemini
    const historyForGemini = session.messages.slice(0, -1).map(m => ({
      role: m.role === 'bot' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const chat = model.startChat({
      history: historyForGemini,
      systemInstruction: buildSystemPrompt(session.persona),
    });

    const result = await chat.sendMessage(userMessage);
    return result.response.text().trim();
  } catch (err) {
    console.error('Gemini error:', err.message);
    return 'lol sorry my wifi is being weird brb';
  }
}

// ── DISCORD CLIENT ──
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: ['CHANNEL', 'MESSAGE'],
});

// ── REGISTER SLASH COMMAND ──
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('pred')
      .setDescription('Post bait message in current channel')
      .toJSON(),
  ];
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
    console.log('[+] Slash commands registered globally');
  } catch (e) {
    console.error('Command reg error:', e.message);
  }
}

// ── SESSION END → REPORT ──
async function endSession(userId) {
  const session = sessions.get(userId);
  if (!session || session.ended) return;
  session.ended = true;
  clearTimeout(session.timer);

  const persona = session.persona;
  const msgs    = session.messages;

  // build transcript text
  const transcript = msgs.map(m =>
    `[${new Date(m.ts).toLocaleTimeString()}] ${m.role === 'bot' ? persona.name : 'SUSPECT'}: ${m.content}`
  ).join('\n');

  const durationMin = ((Date.now() - session.startTime) / 60000).toFixed(1);

  // store report
  const report = {
    id: Date.now(),
    userId,
    username: session.username,
    persona: persona.name,
    personaAge: persona.age,
    channelId: session.channelId,
    durationMin,
    messages: msgs,
    transcript,
    timestamp: new Date().toISOString(),
    revealed: false,
  };
  reports.push(report);

  // send to report channel
  try {
    const reportChannel = await client.channels.fetch(REPORT_CHANNEL);
    if (reportChannel) {
      const summaryLines = [
        `🚨 **PREDATOR ALERT** 🚨`,
        `**User:** <@${userId}> (\`${session.username}\` | ID: \`${userId}\`)`,
        `**Posing as:** ${persona.name}, age ${persona.age}`,
        `**Session duration:** ${durationMin} min`,
        `**Messages exchanged:** ${msgs.length}`,
        `\`\`\`\n${transcript.slice(0, 1800)}\n\`\`\``,
        transcript.length > 1800 ? `*(transcript truncated — full log in panel)*` : '',
        `🔗 Panel: http://localhost:${PANEL_PORT}`,
      ].join('\n');

      await reportChannel.send(summaryLines);
    }
  } catch (e) {
    console.error('Report channel send error:', e.message);
  }

  sessions.delete(userId);
  console.log(`[+] Session ended for ${userId} — report saved`);
}

// ── INTERACTION: /pred ──
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'pred') return;

  // pick random persona & pfp
  const persona = PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
  const pfpFile = pfps[Math.floor(Math.random() * pfps.length)];

  // set bot nickname + avatar in guild if possible
  try {
    await interaction.guild.members.me.setNickname(persona.name);
  } catch (_) {}

  try {
    await client.user.setAvatar(path.join(PFP_DIR, pfpFile));
  } catch (_) {} // rate limited often — silent

  await interaction.reply({
    content: `anyone wanna chat in dms? 🙂`,
    fetchReply: false,
  });

  console.log(`[+] /pred fired in #${interaction.channel.name} as ${persona.name}`);
});

// ── DM HANDLER ──
client.on('messageCreate', async msg => {
  if (msg.author.bot) return;
  if (msg.channel.type !== 1) return; // only DMs (type 1)

  const userId   = msg.author.id;
  const username = `${msg.author.username}#${msg.author.discriminator || '0'}`;
  const content  = msg.content.trim();
  if (!content) return;

  // init session if new
  if (!sessions.has(userId)) {
    const persona = PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
    const duration = (Math.floor(Math.random() * 6) + 10) * 60 * 1000; // 10–15 min

    const timer = setTimeout(() => endSession(userId), duration);

    sessions.set(userId, {
      persona,
      username,
      messages: [],
      startTime: Date.now(),
      timer,
      channelId: msg.channel.id,
      ended: false,
    });

    console.log(`[+] New session: ${username} (${userId}) → persona ${persona.name} | ${Math.round(duration/60000)}min window`);
  }

  const session = sessions.get(userId);
  if (session.ended) return;

  // log user message
  session.messages.push({ role: 'user', content, ts: Date.now() });

  // typing indicator
  await msg.channel.sendTyping();

  // delay like a human (1–4 sec)
  await new Promise(r => setTimeout(r, 1000 + Math.random() * 3000));

  // get gemini reply
  const reply = await geminiReply(session, content);

  // log bot message
  session.messages.push({ role: 'bot', content: reply, ts: Date.now() });

  await msg.channel.send(reply);
});

// ── WEB PANEL ──
const app = express();
app.use(express.json());
app.use('/pfps', express.static(PFP_DIR));

app.get('/', (req, res) => {
  const activeCount   = sessions.size;
  const reportCount   = reports.length;

  const reportCards = reports.map(r => `
    <div class="card" id="report-${r.id}">
      <div class="card-header">
        <span class="badge ${r.revealed ? 'badge-red' : 'badge-yellow'}">
          ${r.revealed ? '🚨 REVEALED' : '⏳ PENDING'}
        </span>
        <strong>${r.username}</strong> — posed as <em>${r.persona}</em> (${r.personaAge}yo)
        <span class="time">${new Date(r.timestamp).toLocaleString()}</span>
        <span class="dur">${r.durationMin} min | ${r.messages.length} msgs</span>
      </div>
      <div class="transcript" id="trans-${r.id}" style="display:none">
        <div class="user-info">
          🔍 <strong>User ID:</strong> <code>${r.userId}</code> &nbsp;|&nbsp;
          <strong>Username:</strong> <code>${r.username}</code>
        </div>
        <pre>${escapeHtml(r.transcript)}</pre>
      </div>
      <button class="reveal-btn" onclick="reveal(${r.id})">
        ${r.revealed ? 'Show Again' : '🔎 Reveal'}
      </button>
    </div>
  `).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>PredBot Panel</title>
<style>
  :root { --bg:#0d0d0d;--card:#181818;--border:#2a2a2a;--text:#e0e0e0;--accent:#ff4444;--yellow:#ffcc00;--green:#00cc66; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font-family:'Segoe UI',sans-serif; padding:24px; }
  h1 { font-size:1.6rem; color:var(--accent); margin-bottom:4px; }
  .subtitle { color:#888; margin-bottom:24px; font-size:.9rem; }
  .stats { display:flex; gap:16px; margin-bottom:24px; }
  .stat { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:14px 20px; }
  .stat-num { font-size:2rem; font-weight:700; color:var(--accent); }
  .stat-label { font-size:.8rem; color:#888; margin-top:2px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; margin-bottom:16px; overflow:hidden; }
  .card-header { display:flex; align-items:center; gap:12px; padding:14px 18px; flex-wrap:wrap; border-bottom:1px solid var(--border); }
  .badge { padding:3px 8px; border-radius:4px; font-size:.75rem; font-weight:600; }
  .badge-yellow { background:#3a3000; color:var(--yellow); }
  .badge-red    { background:#3a0000; color:var(--accent); }
  .time,.dur { color:#666; font-size:.8rem; margin-left:auto; }
  .transcript { padding:16px 18px; border-top:1px solid var(--border); background:#111; }
  .user-info { background:#1a1a1a; border:1px solid var(--border); border-radius:6px; padding:10px 14px; margin-bottom:12px; font-size:.85rem; }
  pre { white-space:pre-wrap; word-break:break-word; font-family:'Consolas',monospace; font-size:.82rem; color:#ccc; line-height:1.6; }
  .reveal-btn { display:block; width:100%; padding:12px; background:var(--accent); color:#fff; border:none; cursor:pointer; font-size:.95rem; font-weight:600; transition:background .2s; }
  .reveal-btn:hover { background:#cc0000; }
  .empty { color:#555; text-align:center; padding:40px; }
  code { background:#222; padding:2px 6px; border-radius:4px; font-family:monospace; }
  .active-pill { background:#003a1a; color:var(--green); border:1px solid #00cc6644; border-radius:6px; padding:6px 14px; font-size:.85rem; display:inline-block; margin-bottom:16px; }
</style>
</head>
<body>
<h1>🎯 PredBot Panel</h1>
<p class="subtitle">Predator catch operations — live log</p>
<div class="active-pill">● ${activeCount} active session${activeCount !== 1 ? 's' : ''} right now</div>
<div class="stats">
  <div class="stat"><div class="stat-num">${reportCount}</div><div class="stat-label">Total Reports</div></div>
  <div class="stat"><div class="stat-num">${activeCount}</div><div class="stat-label">Active Sessions</div></div>
  <div class="stat"><div class="stat-num">${reports.filter(r=>r.revealed).length}</div><div class="stat-label">Revealed</div></div>
</div>
${reportCount === 0 ? '<div class="empty">No reports yet — fire /pred in your server to start a session.</div>' : reportCards}
<script>
async function reveal(id) {
  const trans = document.getElementById('trans-' + id);
  const btn   = document.querySelector('#report-' + id + ' .reveal-btn');
  const badge = document.querySelector('#report-' + id + ' .badge');
  if (trans.style.display === 'none') {
    trans.style.display = 'block';
    btn.textContent = 'Hide';
    badge.className  = 'badge badge-red';
    badge.textContent = '🚨 REVEALED';
    await fetch('/reveal/' + id, { method: 'POST' });
  } else {
    trans.style.display = 'none';
    btn.textContent = 'Show Again';
  }
}
// auto-refresh every 20s
setTimeout(() => location.reload(), 20000);
</script>
</body>
</html>`);
});

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

app.post('/reveal/:id', (req, res) => {
  const r = reports.find(x => x.id === parseInt(req.params.id));
  if (r) r.revealed = true;
  res.json({ ok: true });
});

app.get('/api/reports', (req, res) => res.json(reports));
app.get('/api/active',  (req, res) => res.json({ count: sessions.size, users: [...sessions.keys()] }));

app.listen(PANEL_PORT, () => console.log(`[+] Panel running → http://localhost:${PANEL_PORT}`));

// ── BOOT ──
client.once('ready', async () => {
  console.log(`[+] Logged in as ${client.user.tag}`);
  client.user.setActivity('chatting...', { type: ActivityType.Playing });
  await registerCommands();
});

client.login(DISCORD_TOKEN);
