// language: Node.js, file: src/modules/chatbot.js
// Gemini-powered chatbot — fallback chain through model list on any failure
// Needs: GEMINI_API_KEY (aistudio.google.com)
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const db    = require('../utils/db');

// ordered lite → pro — try cheapest first, escalate on failure
const MODEL_CHAIN = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-pro-preview',
];

const SYSTEM = 'You are a witty, helpful Discord bot. Keep responses concise — under 200 words. No markdown headers. Be conversational.';

const commands = [
  new SlashCommandBuilder()
    .setName('set-chatbot')
    .setDescription('Set the channel where the AI chatbot responds to all messages')
    .addChannelOption(o => o.setName('channel').setDescription('Chatbot channel').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('chatbot-off')
    .setDescription('Disable the chatbot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
];

// per-user history: [{ role: 'user'|'model', parts: [{ text }] }]
const histories = new Map();

async function callGemini(model, contents) {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await axios.post(url, {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents,
    generationConfig: { maxOutputTokens: 600, temperature: 0.9 },
  }, { timeout: 20_000 });
  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

async function askGemini(userId, message) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return '⚠️ No GEMINI_API_KEY set in environment variables.';

  if (!histories.has(userId)) histories.set(userId, []);
  const history = histories.get(userId);

  // append user turn
  history.push({ role: 'user', parts: [{ text: message }] });
  if (history.length > 20) history.splice(0, 2);   // keep last 10 exchanges

  // try each model in chain
  for (let i = 0; i < MODEL_CHAIN.length; i++) {
    const model = MODEL_CHAIN[i];
    try {
      const reply = await callGemini(model, history);
      if (!reply) throw new Error('empty response');
      // append model turn on success
      history.push({ role: 'model', parts: [{ text: reply }] });
      if (i > 0) console.log(`[chatbot] fell back to ${model}`);
      return reply;
    } catch (e) {
      const status = e.response?.status;
      const reason = e.response?.data?.error?.message ?? e.message;
      console.warn(`[chatbot] ${model} failed (${status ?? 'err'}): ${reason}`);
      // on last model, give up
      if (i === MODEL_CHAIN.length - 1) {
        history.pop(); // remove unanswered user turn
        return `❌ All models failed. Last error: ${reason}`;
      }
      // otherwise try next model in chain
    }
  }
}

function init(client) {
  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;

    if (i.commandName === 'set-chatbot') {
      const ch = i.options.getChannel('channel');
      db.set('chatbot', 'channelId', ch.id);
      await i.reply({ content: `✅ Chatbot active in <#${ch.id}>. Powered by Gemini with ${MODEL_CHAIN.length}-model fallback.`, ephemeral: true });
    }

    if (i.commandName === 'chatbot-off') {
      db.set('chatbot', 'channelId', null);
      await i.reply({ content: '✅ Chatbot disabled.', ephemeral: true });
    }
  });

  client.on('messageCreate', async msg => {
    if (msg.author.bot) return;
    const chId = db.get('chatbot', 'channelId');
    if (!chId || msg.channelId !== chId) return;

    try {
      await msg.channel.sendTyping();
      const reply = await askGemini(msg.author.id, msg.content.slice(0, 2000));
      // Discord message limit 2000 chars
      const chunks = reply.match(/[\s\S]{1,2000}/g) ?? ['…'];
      for (const chunk of chunks) await msg.reply(chunk);
    } catch (e) {
      console.error('[chatbot]', e.message);
    }
  });
}

module.exports = { commands, init };
