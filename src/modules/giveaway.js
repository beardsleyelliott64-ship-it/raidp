// language: Node.js, file: src/modules/giveaway.js
const {
  SlashCommandBuilder, EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('../utils/db');

const ENTER_EMOJI = '🎉';

const commands = [
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaway commands')
    .addSubcommand(s => s.setName('create')
      .setDescription('Start a giveaway')
      .addStringOption(o => o.setName('prize').setDescription('What are you giving away?').setRequired(true))
      .addStringOption(o => o.setName('duration').setDescription('Duration e.g. 10m, 2h, 1d').setRequired(true))
      .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setRequired(false)))
    .addSubcommand(s => s.setName('end')
      .setDescription('End a giveaway early')
      .addStringOption(o => o.setName('message-id').setDescription('Message ID of the giveaway').setRequired(true)))
    .addSubcommand(s => s.setName('reroll')
      .setDescription('Reroll a giveaway winner')
      .addStringOption(o => o.setName('message-id').setDescription('Message ID').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
];

function parseDuration(str) {
  const m = str.match(/^(\d+)(m|h|d)$/i);
  if (!m) return null;
  const n = parseInt(m[1]);
  const u = m[2].toLowerCase();
  if (u === 'm') return n * 60_000;
  if (u === 'h') return n * 3_600_000;
  if (u === 'd') return n * 86_400_000;
  return null;
}

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function endGiveaway(client, msgId, channelId, reroll = false) {
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    const msg = await channel.messages.fetch(msgId).catch(() => null);
    if (!msg) return;

    const reaction = msg.reactions.cache.get(ENTER_EMOJI);
    if (!reaction) return;

    await reaction.users.fetch();
    const users = [...reaction.users.cache.values()].filter(u => !u.bot);

    // anti-alt: filter accounts less than 7 days old
    const filtered = users.filter(u => {
      const age = Date.now() - u.createdTimestamp;
      return age > 7 * 86_400_000;
    });

    const pool = filtered.length ? filtered : users;
    const data = db.get('giveaways', msgId, {});
    const winnerCount = data.winners ?? 1;

    const winners = [];
    const pool2 = [...pool];
    for (let i = 0; i < winnerCount && pool2.length; i++) {
      const idx = Math.floor(Math.random() * pool2.length);
      winners.push(pool2.splice(idx, 1)[0]);
    }

    const prize = data.prize ?? 'Unknown prize';
    const mentions = winners.map(w => `<@${w.id}>`).join(', ');

    if (!reroll) {
      const embed = EmbedBuilder.from(msg.embeds[0] ?? new EmbedBuilder())
        .setColor(0xf0b132)
        .setTitle('🎉 Giveaway Ended')
        .setDescription(`**Prize:** ${prize}\n**Winner(s):** ${mentions || 'No valid entries.'}`)
        .setTimestamp();
      await msg.edit({ embeds: [embed] });
    }

    await channel.send(winners.length
      ? `🎉 Congratulations ${mentions}! You won **${prize}**!`
      : '❌ No valid entries for the giveaway.');

    db.del('giveaways', msgId);
  } catch (e) {
    console.error('[giveaway] end error:', e.message);
  }
}

function init(client) {
  // restore active giveaways from DB on startup
  client.once('ready', () => {
    const all = db.read('giveaways');
    for (const [msgId, data] of Object.entries(all)) {
      const remaining = data.endsAt - Date.now();
      if (remaining <= 0) {
        endGiveaway(client, msgId, data.channelId);
      } else {
        setTimeout(() => endGiveaway(client, msgId, data.channelId), remaining);
      }
    }
  });

  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand() || i.commandName !== 'giveaway') return;
    const sub = i.options.getSubcommand();

    if (sub === 'create') {
      const prize     = i.options.getString('prize');
      const durStr    = i.options.getString('duration');
      const winners   = i.options.getInteger('winners') ?? 1;
      const duration  = parseDuration(durStr);

      if (!duration) return i.reply({ content: '❌ Invalid duration. Use formats like `10m`, `2h`, `1d`.', ephemeral: true });

      const endsAt = Date.now() + duration;
      const embed  = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎉 GIVEAWAY')
        .setDescription(`**Prize:** ${prize}\n\nReact with 🎉 to enter!\n**${winners} winner${winners > 1 ? 's' : ''}**`)
        .addFields({ name: '⏰ Ends', value: `<t:${Math.floor(endsAt / 1000)}:R>`, inline: true })
        .setFooter({ text: 'Accounts < 7 days old are automatically filtered.' })
        .setTimestamp(endsAt);

      await i.reply({ content: '✅ Giveaway started!', ephemeral: true });
      const msg = await i.channel.send({ embeds: [embed] });
      await msg.react(ENTER_EMOJI);

      db.set('giveaways', msg.id, { prize, winners, endsAt, channelId: i.channelId, guildId: i.guildId });
      setTimeout(() => endGiveaway(client, msg.id, i.channelId), duration);
    }

    if (sub === 'end') {
      const msgId = i.options.getString('message-id');
      const data  = db.get('giveaways', msgId);
      if (!data) return i.reply({ content: '❌ Giveaway not found.', ephemeral: true });
      await i.reply({ content: '✅ Ending giveaway…', ephemeral: true });
      await endGiveaway(client, msgId, data.channelId);
    }

    if (sub === 'reroll') {
      const msgId = i.options.getString('message-id');
      const data  = db.get('giveaways', msgId) ?? { channelId: i.channelId, prize: 'Unknown', winners: 1 };
      await i.reply({ content: '✅ Rerolling…', ephemeral: true });
      await endGiveaway(client, msgId, data.channelId, true);
    }
  });
}

module.exports = { commands, init };
