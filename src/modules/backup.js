// language: Node.js, file: src/modules/backup.js
// Exports server roles, channels, and settings as a JSON attachment
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Export server structure (roles, channels, settings) as a JSON file')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

function init(client) {
  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand() || i.commandName !== 'backup') return;
    await i.deferReply({ ephemeral: true });

    try {
      const guild = i.guild;
      await guild.fetch();
      await guild.roles.fetch();
      await guild.channels.fetch();

      const data = {
        meta: {
          name:        guild.name,
          id:          guild.id,
          icon:        guild.iconURL(),
          memberCount: guild.memberCount,
          createdAt:   guild.createdAt.toISOString(),
          backedUpAt:  new Date().toISOString(),
          backedUpBy:  i.user.tag,
        },
        roles: guild.roles.cache
          .filter(r => !r.managed && r.id !== guild.roles.everyone.id)
          .sort((a, b) => b.position - a.position)
          .map(r => ({
            id:          r.id,
            name:        r.name,
            color:       r.hexColor,
            hoist:       r.hoist,
            mentionable: r.mentionable,
            position:    r.position,
            permissions: r.permissions.toArray(),
          })),
        categories: guild.channels.cache
          .filter(c => c.type === 4)
          .sort((a, b) => a.rawPosition - b.rawPosition)
          .map(cat => ({
            id:       cat.id,
            name:     cat.name,
            position: cat.rawPosition,
            channels: guild.channels.cache
              .filter(c => c.parentId === cat.id)
              .sort((a, b) => a.rawPosition - b.rawPosition)
              .map(c => ({
                id:    c.id,
                name:  c.name,
                type:  c.type,
                topic: c.topic ?? null,
                nsfw:  c.nsfw ?? false,
                slowmode: c.rateLimitPerUser ?? 0,
              })),
          })),
        topLevelChannels: guild.channels.cache
          .filter(c => !c.parentId && c.type !== 4)
          .map(c => ({ id: c.id, name: c.name, type: c.type })),
      };

      const json   = JSON.stringify(data, null, 2);
      const buffer = Buffer.from(json, 'utf8');
      const name   = `backup-${guild.name.replace(/\s+/g, '-')}-${Date.now()}.json`;

      const embed = new EmbedBuilder()
        .setColor(0x23a55a)
        .setTitle('✅ Backup Complete')
        .addFields(
          { name: 'Roles',    value: String(data.roles.length),      inline: true },
          { name: 'Channels', value: String(guild.channels.cache.size), inline: true },
          { name: 'Members',  value: String(guild.memberCount),      inline: true },
        )
        .setTimestamp();

      await i.editReply({ embeds: [embed], files: [{ attachment: buffer, name }] });
    } catch (e) {
      console.error('[backup]', e.message);
      await i.editReply(`❌ Backup failed: ${e.message}`);
    }
  });
}

module.exports = { commands, init };
