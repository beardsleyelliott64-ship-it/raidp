// language: Node.js, file: src/modules/tracker.js
// Fortnite item shop tracker — posts each new shop entry as a standalone embed
// API: fortnite-api.com (free, no key required)
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const axios  = require('axios');
const cron   = require('node-cron');
const db     = require('../utils/db');

const RARITY_COLOR = {
  common:    0xb0b0b0,
  uncommon:  0x1eff00,
  rare:      0x0070dd,
  epic:      0xa335ee,
  legendary: 0xff8000,
  mythic:    0xe6cc80,
  exotic:    0x0ff0ff,
  icon:      0x00ccff,
  starwars:  0x111111,
  dc:        0x1c4b91,
  marvel:    0xed1d24,
  gaminglegends: 0x6a0dad,
  slurp:     0x00e5ff,
  dark:      0x310a3c,
  frosted:   0x92c7e0,
  lava:      0xd63e1f,
  shadow:    0x39393f,
};

const commands = [
  new SlashCommandBuilder()
    .setName('set-tracker')
    .setDescription('Set the channel for game skin/shop updates')
    .addChannelOption(o => o.setName('channel').setDescription('Where to post updates').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('tracker-status')
    .setDescription('Show current tracker config')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('tracker-fetch')
    .setDescription('Force-fetch and post the current Fortnite shop now')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
];

async function fetchShop() {
  const res = await axios.get('https://fortnite-api.com/v2/shop/br', {
    params: { language: 'en' },
    timeout: 15_000,
  });
  return res.data?.data ?? null;
}

function buildEmbed(entry) {
  const item    = entry.items?.[0];
  if (!item) return null;

  const rarity  = (item.rarity?.value ?? 'common').toLowerCase();
  const color   = RARITY_COLOR[rarity] ?? 0x5865f2;
  const price   = entry.finalPrice ?? entry.regularPrice ?? 0;
  const name    = item.name ?? 'Unknown';
  const type    = item.type?.displayValue ?? item.type?.value ?? 'Item';
  const desc    = item.description ?? '';
  const img     = item.images?.featured ?? item.images?.icon ?? null;
  const series  = item.series?.value ?? null;

  const embed = new EmbedBuilder()
    .setTitle(`${name}`)
    .setColor(color)
    .addFields(
      { name: '🏷️ Type',   value: type,                      inline: true },
      { name: '✨ Rarity', value: capitalise(rarity),         inline: true },
      { name: '🔵 Price',  value: `${price.toLocaleString()} V-Bucks`, inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'Fortnite Item Shop' });

  if (desc)    embed.setDescription(desc);
  if (img)     embed.setImage(img);
  if (series)  embed.addFields({ name: '📦 Series', value: series, inline: true });

  // bundle items (e.g. outfit + back bling + pickaxe in a set)
  if (entry.items.length > 1) {
    const bundle = entry.items.slice(1).map(x => `• ${x.name}`).join('\n');
    embed.addFields({ name: '🎒 Bundle Includes', value: bundle.slice(0, 1024), inline: false });
  }

  return embed;
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function postShop(client, channelId, force = false) {
  try {
    const shop = await fetchShop();
    if (!shop) return;

    const today = shop.date?.split('T')[0] ?? new Date().toISOString().split('T')[0];
    const last  = db.get('tracker', 'lastShopDate');

    if (!force && last === today) return;       // already posted today
    db.set('tracker', 'lastShopDate', today);

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const entries = [
      ...(shop.featured?.entries ?? []),
      ...(shop.daily?.entries ?? []),
      ...(shop.specialFeatured?.entries ?? []),
      ...(shop.specialDaily?.entries ?? []),
      ...(shop.votes?.entries ?? []),
    ];

    // header embed
    const header = new EmbedBuilder()
      .setTitle('🛒 Fortnite Item Shop')
      .setColor(0x5865f2)
      .setDescription(`**${entries.length} items** available today — ${today}`)
      .setTimestamp();

    await channel.send({ embeds: [header] });

    // post up to 25 items (Discord rate limits; pick most expensive/featured first)
    const sorted = entries
      .filter(e => e.items?.length > 0)
      .sort((a, b) => (b.finalPrice ?? 0) - (a.finalPrice ?? 0))
      .slice(0, 25);

    for (const entry of sorted) {
      const embed = buildEmbed(entry);
      if (!embed) continue;
      await channel.send({ embeds: [embed] });
      await new Promise(r => setTimeout(r, 300)); // small gap to avoid rate limits
    }

    console.log(`[tracker] posted ${sorted.length} Fortnite shop items`);
  } catch (e) {
    console.error('[tracker] fetch error:', e.message);
  }
}

function init(client) {
  // commands
  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;

    if (i.commandName === 'set-tracker') {
      const ch = i.options.getChannel('channel');
      db.set('tracker', 'channelId', ch.id);
      db.set('tracker', 'guildId',   i.guildId);
      await i.reply({ content: `✅ Tracker channel set to <#${ch.id}>. Shop posts daily at midnight UTC.`, ephemeral: true });
    }

    if (i.commandName === 'tracker-status') {
      const chId   = db.get('tracker', 'channelId');
      const last   = db.get('tracker', 'lastShopDate', 'Never');
      const embed  = new EmbedBuilder()
        .setTitle('📡 Tracker Status')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Channel',    value: chId ? `<#${chId}>` : '❌ Not set', inline: true },
          { name: 'Last Post',  value: last,                                inline: true },
          { name: 'Games',      value: 'Fortnite Item Shop',                inline: true },
        );
      await i.reply({ embeds: [embed], ephemeral: true });
    }

    if (i.commandName === 'tracker-fetch') {
      const chId = db.get('tracker', 'channelId');
      if (!chId) return i.reply({ content: '❌ No tracker channel set. Use `/set-tracker` first.', ephemeral: true });
      await i.reply({ content: '⏳ Fetching shop now…', ephemeral: true });
      await postShop(client, chId, true);
    }
  });

  // cron: every day at 00:05 UTC (shop resets midnight)
  cron.schedule('5 0 * * *', () => {
    const chId = db.get('tracker', 'channelId');
    if (chId) postShop(client, chId);
  });

  console.log('[tracker] ready — daily cron at 00:05 UTC');
}

module.exports = { commands, init };
