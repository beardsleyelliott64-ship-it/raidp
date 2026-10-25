// language: Node.js, file: src/modules/applications.js
// /apply starts a DM-based multi-step form, posts completed embed to staff channel
const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('../utils/db');

const DEFAULT_QUESTIONS = [
  'How old are you?',
  'What timezone are you in?',
  'Why do you want to apply?',
  'How active are you per week (hours)?',
  'Do you have any prior experience? If so, describe briefly.',
];

const commands = [
  new SlashCommandBuilder()
    .setName('app-setup')
    .setDescription('Set the channel where completed applications are posted')
    .addChannelOption(o => o.setName('channel').setDescription('Staff review channel').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Submit an application')
    .addStringOption(o => o.setName('role').setDescription('What are you applying for? e.g. Staff, Moderator').setRequired(true))
    .toJSON(),
];

// userId → { role, answers, questionIdx, guildId, guildName }
const activeSessions = new Map();

function init(client) {
  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;

    if (i.commandName === 'app-setup') {
      const ch = i.options.getChannel('channel');
      db.set('applications', 'channelId', ch.id);
      return i.reply({ content: `✅ Application channel set to <#${ch.id}>.`, ephemeral: true });
    }

    if (i.commandName === 'apply') {
      if (activeSessions.has(i.user.id))
        return i.reply({ content: '❌ You already have an application in progress. Check your DMs.', ephemeral: true });

      const role = i.options.getString('role');
      activeSessions.set(i.user.id, {
        role,
        answers:     [],
        questionIdx: 0,
        guildId:     i.guildId,
        guildName:   i.guild?.name ?? 'Unknown',
      });

      try {
        const dm = await i.user.createDM();
        await dm.send(
          `📋 **Application — ${role}** (${i.guild?.name})\n\nAnswer each question. Type \`cancel\` at any time to stop.\n\n**Q1:** ${DEFAULT_QUESTIONS[0]}`
        );
        await i.reply({ content: '📬 Check your DMs to complete the application.', ephemeral: true });
      } catch {
        activeSessions.delete(i.user.id);
        return i.reply({ content: '❌ I couldn\'t DM you. Enable DMs from server members and try again.', ephemeral: true });
      }
    }
  });

  // listen for DM answers
  client.on('messageCreate', async msg => {
    if (msg.author.bot || msg.guild) return;
    const session = activeSessions.get(msg.author.id);
    if (!session) return;

    if (msg.content.toLowerCase() === 'cancel') {
      activeSessions.delete(msg.author.id);
      return msg.reply('❌ Application cancelled.');
    }

    session.answers.push(msg.content.slice(0, 500));
    session.questionIdx++;

    if (session.questionIdx < DEFAULT_QUESTIONS.length) {
      const next = DEFAULT_QUESTIONS[session.questionIdx];
      return msg.reply(`**Q${session.questionIdx + 1}:** ${next}`);
    }

    // form complete
    activeSessions.delete(msg.author.id);
    await msg.reply('✅ Application submitted! Staff will review it shortly.');

    // post to staff channel
    try {
      const chId = db.get('applications', 'channelId');
      if (!chId) return;
      const channel = await client.channels.fetch(chId).catch(() => null);
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📋 New Application — ${session.role}`)
        .setAuthor({ name: msg.author.tag, iconURL: msg.author.displayAvatarURL() })
        .setDescription(`**Server:** ${session.guildName}`)
        .setTimestamp();

      DEFAULT_QUESTIONS.forEach((q, idx) => {
        embed.addFields({ name: `Q${idx + 1}: ${q}`, value: session.answers[idx] ?? 'N/A', inline: false });
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`app_accept_${msg.author.id}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`app_deny_${msg.author.id}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
      );

      await channel.send({ embeds: [embed], components: [row] });
    } catch (e) {
      console.error('[applications] post error:', e.message);
    }
  });

  // accept/deny buttons
  client.on('interactionCreate', async i => {
    if (!i.isButton()) return;
    if (!i.customId.startsWith('app_accept_') && !i.customId.startsWith('app_deny_')) return;

    const isAccept = i.customId.startsWith('app_accept_');
    const userId   = i.customId.split('_')[2];

    try {
      const user = await client.users.fetch(userId);
      const msg  = isAccept
        ? `✅ Your application in **${i.guild?.name}** has been **accepted**!`
        : `❌ Your application in **${i.guild?.name}** has been **denied**.`;
      await user.send(msg).catch(() => {});
    } catch {}

    const embed = EmbedBuilder.from(i.message.embeds[0])
      .setColor(isAccept ? 0x23a55a : 0xed4245)
      .setFooter({ text: `${isAccept ? 'Accepted' : 'Denied'} by ${i.user.tag}` });

    await i.update({ embeds: [embed], components: [] });
  });
}

module.exports = { commands, init };
