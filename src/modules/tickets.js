// language: Node.js, file: src/modules/tickets.js
const {
  SlashCommandBuilder, EmbedBuilder,
  ChannelType, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const db = require('../utils/db');

const commands = [
  new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Set the category for tickets and the staff role')
    .addRoleOption(o => o.setName('staff-role').setDescription('Role that can see tickets').setRequired(true))
    .addChannelOption(o => o.setName('category').setDescription('Category for ticket channels').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Open a support ticket')
    .addStringOption(o => o.setName('reason').setDescription('Briefly describe your issue').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('ticket-close')
    .setDescription('Close this ticket and save a transcript')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('ticket-add')
    .setDescription('Add a user to this ticket')
    .addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
];

function init(client) {
  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;

    if (i.commandName === 'ticket-setup') {
      const role     = i.options.getRole('staff-role');
      const category = i.options.getChannel('category');
      db.set('tickets', 'staffRole',  role.id);
      db.set('tickets', 'categoryId', category?.id ?? null);
      return i.reply({ content: `✅ Ticket setup done. Staff role: <@&${role.id}>`, ephemeral: true });
    }

    if (i.commandName === 'ticket') {
      const reason     = i.options.getString('reason') ?? 'No reason provided';
      const staffRole  = db.get('tickets', 'staffRole');
      const categoryId = db.get('tickets', 'categoryId');
      const existing   = db.get('tickets', `open_${i.user.id}`);

      if (existing) {
        return i.reply({ content: `❌ You already have an open ticket: <#${existing}>`, ephemeral: true });
      }

      try {
        const overwrites = [
          { id: i.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: i.user.id,                 allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ];
        if (staffRole) {
          overwrites.push({ id: staffRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
        }

        const ch = await i.guild.channels.create({
          name:   `ticket-${i.user.username}`,
          type:   ChannelType.GuildText,
          parent: categoryId ?? undefined,
          permissionOverwrites: overwrites,
        });

        db.set('tickets', `open_${i.user.id}`, ch.id);
        db.set('tickets', `channel_${ch.id}`,  { userId: i.user.id, openedAt: Date.now(), reason });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ticket_close_${ch.id}`).setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
        );
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🎫 Support Ticket')
          .setDescription(`Ticket opened by <@${i.user.id}>\n**Reason:** ${reason}`)
          .addFields({ name: 'How to close', value: 'Click the button below or use `/ticket-close`' })
          .setTimestamp();

        await ch.send({ embeds: [embed], components: [row] });
        return i.reply({ content: `✅ Ticket opened: <#${ch.id}>`, ephemeral: true });
      } catch (e) {
        return i.reply({ content: `❌ Failed to create ticket: ${e.message}`, ephemeral: true });
      }
    }

    if (i.commandName === 'ticket-close') {
      const data = db.get('tickets', `channel_${i.channelId}`);
      if (!data) return i.reply({ content: '❌ This is not a ticket channel.', ephemeral: true });
      await closeTicket(client, i.channel, data, i);
    }

    if (i.commandName === 'ticket-add') {
      const data = db.get('tickets', `channel_${i.channelId}`);
      if (!data) return i.reply({ content: '❌ Not a ticket channel.', ephemeral: true });
      const target = i.options.getUser('user');
      await i.channel.permissionOverwrites.create(target.id, { ViewChannel: true, SendMessages: true });
      return i.reply({ content: `✅ Added <@${target.id}> to the ticket.` });
    }
  });

  // close button
  client.on('interactionCreate', async i => {
    if (!i.isButton() || !i.customId.startsWith('ticket_close_')) return;
    const chId = i.customId.replace('ticket_close_', '');
    if (i.channelId !== chId) return;
    const data = db.get('tickets', `channel_${chId}`);
    if (data) await closeTicket(client, i.channel, data, i);
  });
}

async function closeTicket(client, channel, data, interaction) {
  try {
    // fetch last 500 messages for transcript
    const messages = await channel.messages.fetch({ limit: 100 });
    const transcript = [...messages.values()]
      .reverse()
      .map(m => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content}`)
      .join('\n');

    const buffer = Buffer.from(transcript, 'utf8');
    const file   = { attachment: buffer, name: `transcript-${channel.name}.txt` };

    const staffRole  = db.get('tickets', 'staffRole');
    const logChannel = client.guilds.cache.get(channel.guild.id)?.channels.cache
      .find(c => c.name.includes('log') || c.name.includes('transcript')) ?? null;

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🎫 Ticket Closed')
      .addFields(
        { name: 'Opened by', value: `<@${data.userId}>`,                         inline: true },
        { name: 'Reason',    value: data.reason,                                  inline: true },
        { name: 'Duration',  value: msToHuman(Date.now() - data.openedAt),        inline: true },
      )
      .setTimestamp();

    if (logChannel) await logChannel.send({ embeds: [embed], files: [file] });

    // try to DM transcript to user
    try {
      const user = await client.users.fetch(data.userId);
      await user.send({ content: `Your ticket **${channel.name}** has been closed.`, files: [file] });
    } catch {}

    db.del('tickets', `open_${data.userId}`);
    db.del('tickets', `channel_${channel.id}`);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: '✅ Closing ticket…' }).catch(() => {});
    } else {
      await interaction.reply({ content: '✅ Closing ticket…', ephemeral: true }).catch(() => {});
    }

    setTimeout(() => channel.delete().catch(() => {}), 5_000);
  } catch (e) {
    console.error('[tickets] close error:', e.message);
  }
}

function msToHuman(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

module.exports = { commands, init };
