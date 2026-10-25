// language: Node.js, file: src/modules/panel.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const START = Date.now();

const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Bot status — ping, uptime, guilds, modules')
    .toJSON(),
];

function init(client) {
  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand() || i.commandName !== 'panel') return;
    const ping    = client.ws.ping;
    const upMs    = Date.now() - START;
    const upSec   = Math.floor(upMs / 1000);
    const days    = Math.floor(upSec / 86400);
    const hrs     = Math.floor((upSec % 86400) / 3600);
    const mins    = Math.floor((upSec % 3600)  / 60);
    const secs    = upSec % 60;
    const upStr   = `${days}d ${hrs}h ${mins}m ${secs}s`;
    const guilds  = client.guilds.cache.size;
    const users   = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);

    const pingColor = ping < 100 ? 0x23a55a : ping < 200 ? 0xf0b132 : 0xed4245;

    const embed = new EmbedBuilder()
      .setTitle('⚙️ Bot Panel')
      .setColor(pingColor)
      .setThumbnail(client.user.displayAvatarURL())
      .addFields(
        { name: '🟢 Status',    value: 'Online',           inline: true },
        { name: '🏓 Ping',      value: `${ping}ms`,        inline: true },
        { name: '⏱️ Uptime',    value: upStr,              inline: true },
        { name: '🏠 Servers',   value: String(guilds),     inline: true },
        { name: '👥 Users',     value: String(users),      inline: true },
        { name: '🤖 Tag',       value: client.user.tag,    inline: true },
        { name: '📦 Node',      value: process.version,    inline: true },
        { name: '💾 Memory',    value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: `ID: ${client.user.id}` });

    await i.reply({ embeds: [embed], ephemeral: true });
  });
}

module.exports = { commands, init };
