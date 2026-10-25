// language: Node.js, file: src/modules/stats.js
// Fortnite: fortnite-api.com (free, no key)
// Valorant: henrikdev API (free, no key)
// CS2: Steam Web API (needs STEAM_API_KEY)
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const commands = [
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Look up game stats')
    .addSubcommand(s => s.setName('fortnite')
      .setDescription('Fortnite stats')
      .addStringOption(o => o.setName('username').setDescription('Epic Games username').setRequired(true))
      .addStringOption(o => o.setName('platform').setDescription('Platform').setRequired(false)
        .addChoices({ name: 'Epic', value: 'epic' }, { name: 'PSN', value: 'psn' }, { name: 'XBL', value: 'xbl' })))
    .addSubcommand(s => s.setName('valorant')
      .setDescription('Valorant stats')
      .addStringOption(o => o.setName('username').setDescription('Riot ID e.g. Name#TAG').setRequired(true))
      .addStringOption(o => o.setName('region').setDescription('Region').setRequired(false)
        .addChoices({ name: 'EU', value: 'eu' }, { name: 'NA', value: 'na' }, { name: 'AP', value: 'ap' }, { name: 'KR', value: 'kr' })))
    .addSubcommand(s => s.setName('cs2')
      .setDescription('CS2 stats')
      .addStringOption(o => o.setName('steamid').setDescription('Steam64 ID or vanity URL name').setRequired(true)))
    .toJSON(),
];

async function fortniteStats(username, platform = 'epic') {
  const res = await axios.get(`https://fortnite-api.com/v2/stats/br/v2`, {
    params: { name: username, accountType: platform, timeWindow: 'lifetime', image: 'all' },
    timeout: 15_000,
  });
  return res.data?.data;
}

async function valorantStats(riotId, region = 'eu') {
  const [name, tag] = riotId.split('#');
  if (!tag) throw new Error('Use format Name#TAG');
  const res = await axios.get(`https://api.henrikdev.xyz/valorant/v2/mmr/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`, {
    timeout: 15_000,
  });
  return res.data?.data;
}

async function cs2Stats(steamId) {
  const key = process.env.STEAM_API_KEY;
  if (!key) throw new Error('STEAM_API_KEY not set');
  // resolve vanity if not 64-bit
  let id64 = steamId;
  if (!/^\d{17}$/.test(steamId)) {
    const res = await axios.get(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${key}&vanityurl=${steamId}`);
    id64 = res.data?.response?.steamid;
    if (!id64) throw new Error('Could not resolve Steam ID');
  }
  const res = await axios.get(`https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v2/?appid=730&key=${key}&steamid=${id64}`, { timeout: 15_000 });
  const stats = res.data?.playerstats?.stats ?? [];
  const val   = name => stats.find(s => s.name === name)?.value ?? 0;
  return {
    kills:   val('total_kills'),
    deaths:  val('total_deaths'),
    wins:    val('total_wins'),
    rounds:  val('total_rounds_played'),
    mvp:     val('total_mvps'),
    hs:      val('total_kills_headshot'),
    hours:   Math.round(val('total_time_played') / 3600),
  };
}

function init(client) {
  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand() || i.commandName !== 'stats') return;
    await i.deferReply();

    const sub = i.options.getSubcommand();

    try {
      if (sub === 'fortnite') {
        const username = i.options.getString('username');
        const platform = i.options.getString('platform') ?? 'epic';
        const data = await fortniteStats(username, platform);
        if (!data) return i.editReply('❌ Player not found or stats private.');

        const all = data.stats?.all?.overall ?? {};
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`🎮 Fortnite — ${data.account?.name ?? username}`)
          .setThumbnail(data.image ?? null)
          .addFields(
            { name: '🏆 Wins',     value: String(all.wins    ?? 0), inline: true },
            { name: '💀 Kills',    value: String(all.kills   ?? 0), inline: true },
            { name: '☠️ Deaths',   value: String(all.deaths  ?? 0), inline: true },
            { name: '📈 K/D',      value: (all.kd       ?? 0).toFixed(2),      inline: true },
            { name: '🎯 Win%',     value: `${(all.winRate ?? 0).toFixed(1)}%`, inline: true },
            { name: '🔢 Matches',  value: String(all.matches ?? 0),            inline: true },
          )
          .setFooter({ text: `Platform: ${platform.toUpperCase()}` })
          .setTimestamp();
        return i.editReply({ embeds: [embed] });
      }

      if (sub === 'valorant') {
        const riotId = i.options.getString('username');
        const region = i.options.getString('region') ?? 'eu';
        const data = await valorantStats(riotId, region);
        if (!data) return i.editReply('❌ Player not found.');

        const rankImg = data.images?.large ?? null;
        const embed = new EmbedBuilder()
          .setColor(0xff4655)
          .setTitle(`🎮 Valorant — ${riotId}`)
          .setThumbnail(rankImg)
          .addFields(
            { name: '🏅 Rank',     value: data.currenttierpatched ?? 'Unranked', inline: true },
            { name: '🔢 RR',       value: String(data.ranking_in_tier ?? 0),     inline: true },
            { name: '📊 Peak',     value: data.highest_rank?.patched_tier ?? 'N/A', inline: true },
            { name: '🔼 Games',    value: String(data.games_needed_for_rating ?? 'N/A'), inline: true },
          )
          .setFooter({ text: `Region: ${region.toUpperCase()}` })
          .setTimestamp();
        return i.editReply({ embeds: [embed] });
      }

      if (sub === 'cs2') {
        const steamId = i.options.getString('steamid');
        const data    = await cs2Stats(steamId);
        const kd      = data.deaths ? (data.kills / data.deaths).toFixed(2) : 'N/A';
        const hs_pct  = data.kills  ? ((data.hs / data.kills) * 100).toFixed(1) : 'N/A';
        const embed = new EmbedBuilder()
          .setColor(0xf4a201)
          .setTitle(`🎮 CS2 — ${steamId}`)
          .addFields(
            { name: '💀 Kills',    value: data.kills.toLocaleString(),  inline: true },
            { name: '☠️ Deaths',   value: data.deaths.toLocaleString(), inline: true },
            { name: '📈 K/D',      value: kd,                           inline: true },
            { name: '🏆 Wins',     value: data.wins.toLocaleString(),   inline: true },
            { name: '🎯 HS%',      value: `${hs_pct}%`,                 inline: true },
            { name: '⏱️ Hours',    value: String(data.hours),           inline: true },
            { name: '🎖️ MVPs',     value: data.mvp.toLocaleString(),    inline: true },
            { name: '🔢 Rounds',   value: data.rounds.toLocaleString(), inline: true },
          )
          .setFooter({ text: 'Steam Web API' })
          .setTimestamp();
        return i.editReply({ embeds: [embed] });
      }
    } catch (e) {
      console.error('[stats]', e.message);
      return i.editReply(`❌ Error: ${e.message}`);
    }
  });
}

module.exports = { commands, init };
