// language: Node.js, file: src/modules/voice.js
// Temp voice channels — join lobby VC → private VC auto-created, deleted when empty
const {
  SlashCommandBuilder, EmbedBuilder,
  PermissionFlagsBits, ChannelType,
} = require('discord.js');
const db = require('../utils/db');

const commands = [
  new SlashCommandBuilder()
    .setName('set-lobby')
    .setDescription('Set the "Join to Create" voice channel')
    .addChannelOption(o => o
      .setName('channel')
      .setDescription('The lobby voice channel')
      .addChannelTypes(ChannelType.GuildVoice)
      .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
];

// channelId → ownerId
const tempChannels = new Map();

function init(client) {
  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand() || i.commandName !== 'set-lobby') return;
    const ch = i.options.getChannel('channel');
    db.set('voice', 'lobbyId', ch.id);
    await i.reply({ content: `✅ Lobby set to **${ch.name}**. Joining it will create a private VC.`, ephemeral: true });
  });

  client.on('voiceStateUpdate', async (oldState, newState) => {
    const lobbyId = db.get('voice', 'lobbyId');
    if (!lobbyId) return;

    // joined the lobby → create temp channel
    if (newState.channelId === lobbyId && oldState.channelId !== lobbyId) {
      const member = newState.member;
      try {
        const category = newState.channel.parentId;
        const temp = await newState.guild.channels.create({
          name:   `🔊 ${member.displayName}'s VC`,
          type:   ChannelType.GuildVoice,
          parent: category,
          permissionOverwrites: [
            {
              id:    member.id,
              allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers],
            },
          ],
        });
        tempChannels.set(temp.id, member.id);
        await member.voice.setChannel(temp);
      } catch (e) {
        console.error('[voice] create error:', e.message);
      }
    }

    // someone left a temp channel → check if empty
    if (oldState.channelId && tempChannels.has(oldState.channelId)) {
      const ch = oldState.guild.channels.cache.get(oldState.channelId);
      if (ch && ch.members.size === 0) {
        tempChannels.delete(oldState.channelId);
        ch.delete().catch(() => {});
      }
    }
  });
}

module.exports = { commands, init };
