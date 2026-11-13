'use strict';
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const service = require('../../chatbot/service');
module.exports = {
 data: new SlashCommandBuilder().setName('chatbot').setDescription('Chat with Lumen or manage its AI chat settings')
  .addSubcommand(s => s.setName('chat').setDescription('Start a private chat with Lumen').addStringOption(o => o.setName('message').setDescription('What would you like to say?').setRequired(true).setMaxLength(1500)))
  .addSubcommand(s => s.setName('status').setDescription('View chatbot status (owner only)'))
  .addSubcommand(s => s.setName('enable').setDescription('Enable automatic conversations (owner only)'))
  .addSubcommand(s => s.setName('disable').setDescription('Disable automatic conversations (owner only)'))
  .addSubcommand(s => s.setName('clear').setDescription('Clear your Lumen conversation memory')),
 async execute(interaction) {
  const sub = interaction.options.getSubcommand(), owner = interaction.user.id === service.OWNER_ID;
  if (['status','enable','disable'].includes(sub) && !owner) return interaction.reply({ content: 'Only the bot owner can change or inspect chatbot settings.', flags: MessageFlags.Ephemeral });
  if (sub === 'status') { const s=service.load(); return interaction.reply({ content:`Chatbot: **${s.enabled?'Enabled':'Disabled'}**\nModel: ${s.model}\nCooldown: ${s.cooldownMs}ms\nConversation timeout: ${Math.round(s.timeoutMs/60000)} minutes`, flags:MessageFlags.Ephemeral }); }
  if (sub === 'enable' || sub === 'disable') { const s=service.configure({ enabled:sub==='enable' }); return interaction.reply({ content:`Automatic Lumen conversations are now **${s.enabled?'enabled':'disabled'}**.`, flags:MessageFlags.Ephemeral }); }
  if (sub === 'clear') { const count=service.clearUser(interaction.guildId, interaction.user.id); return interaction.reply({ content:`Cleared ${count} conversation memory session(s).`, flags:MessageFlags.Ephemeral }); }
  const message=interaction.options.getString('message');
  if (!process.env.GEMINI_API_KEY) return interaction.reply({ content:'Gemini API key is not configured.', flags:MessageFlags.Ephemeral });
  await interaction.deferReply({ flags:MessageFlags.Ephemeral });
  try { const {GoogleGenAI}=require('@google/genai'); const s=service.load(); const ai=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY}); const result=await ai.models.generateContent({model:s.model,contents:`You are Lumen, a casual Discord chatbot. You are a bot, not a human. Be natural, concise, friendly, context-aware and safe. User ${interaction.user.username} says: ${message}\nLumen:`}); const text=String(result?.text||'').trim().slice(0,1900); await interaction.editReply(text||'hmm, got nothing back that time. try again?'); }
  catch(e) { console.error('[chatbot command]',e); await interaction.editReply('Gemini is having trouble right now. Try again in a bit.'); }
 }
};
