'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { GoogleGenAI } = require('@google/genai');
const OWNER_ID = process.env.JAILBREAK_OWNER_ID || '1363240484818128926';
const FILE = path.join(__dirname, '..', 'data', 'chatbot-settings.json');
const sessions = new Map();
const cooldowns = new Map();
const DEFAULTS = { enabled: true, model: process.env.GEMINI_CHATBOT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash', cooldownMs: 4500, timeoutMs: 5 * 60 * 1000, maxHistory: 12, allowedChannels: [] };
function load() { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { ...DEFAULTS, ...d }; } catch { return { ...DEFAULTS }; } }
function save(d) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); const tmp = `${FILE}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 }); fs.renameSync(tmp, FILE); }
function sessionKey(m) { return `${m.guildId || 'dm'}:${m.channelId}:${m.author.id}`; }
function clean(text) { return String(text || '').replace(/<@!?\d+>/g, '').trim().slice(0, 1800); }
async function replyToMessage(message, force = false) {
  if (!message.guild || message.author.bot || message.webhookId) return false;
  const settings = load(); if (!settings.enabled) return false;
  if (!process.env.GEMINI_API_KEY) { if (message.mentions.users.has(message.client.user.id)) await message.reply({ content: 'Gemini API key is not configured.', allowedMentions: { repliedUser: false, parse: [] } }).catch(() => {}); return false; }
  if (settings.allowedChannels.length && !settings.allowedChannels.includes(message.channelId)) return false;
  const key = sessionKey(message), now = Date.now(), previous = sessions.get(key);
  const isMention = message.mentions.users.has(message.client.user.id);
  const isReply = message.reference?.messageId && await message.fetchReference().then(m => m.author.id === message.client.user.id).catch(() => false);
  const active = previous && now - previous.lastAt <= settings.timeoutMs;
  if (!force && !isMention && !isReply && !active) return false;
  if (previous?.optOutUntil > now) return false;
  const cdKey = `${message.channelId}:${message.author.id}`;
  if (now - (cooldowns.get(cdKey) || 0) < settings.cooldownMs) return false;
  const content = clean(message.content);
  if (!content) return false;
  cooldowns.set(cdKey, now);
  try {
    const history = previous?.history || [];
    const prompt = `You are Lumen, a Discord bot with a casual, believable, friendly personality. You are not a human; never claim to be one. Speak naturally, usually briefly. Slang, lowercase and occasional minor typos are okay but never impair important information. Match the seriousness of the user. Understand jokes and context, avoid repetitive catchphrases, do not harass or pressure anyone, and respect requests to stop. Never claim to have taken actions you did not take. Reply with only the message to send. Keep most replies under 60 words.\n\nRecent conversation:\n${history.map(x => `${x.role}: ${x.text}`).join('\n')}\nMember (${message.author.username}): ${content}\nLumen:`;
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await ai.models.generateContent({ model: settings.model, contents: prompt });
    const answer = String(result?.text || '').trim().slice(0, 1900);
    if (!answer) return false;
    await message.reply({ content: answer, allowedMentions: { repliedUser: false, parse: [] } });
    const next = [...history, { role: message.author.username, text: content }, { role: 'Lumen', text: answer }].slice(-settings.maxHistory);
    sessions.set(key, { history: next, lastAt: Date.now() });
    return true;
  } catch (error) { console.error('[chatbot] Gemini/Discord error:', error.message); return false; }
}
function clearUser(guildId, userId, channelId) { let count = 0; for (const key of sessions.keys()) if (key.startsWith(`${guildId || 'dm'}:${channelId || ''}`) && key.endsWith(`:${userId}`)) { sessions.delete(key); count++; } return count; }
function configure(patch) { const next = { ...load(), ...patch }; save(next); return next; }
module.exports = { OWNER_ID, load, save, configure, replyToMessage, clearUser };
