// language: Node.js, file: src/modules/alerts.js
// Twitch live alerts + YouTube new video alerts
// Twitch: polls every 2 min via Helix API (needs CLIENT_ID + CLIENT_SECRET)
// YouTube: polls RSS feed every 10 min (no key needed)
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const cron  = require('node-cron');
const db    = require('../utils/db');

const commands = [
  new SlashCommandBuilder()
    .setName('set-alerts')
    .setDescription('Set the channel for live/video alerts')
    .addChannelOption(o => o.setName('channel').setDescription('Alert channel').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('add-twitch')
    .setDescription('Track a Twitch channel for live alerts')
    .addStringOption(o => o.setName('username').setDescription('Twitch username').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remove-twitch')
    .setDescription('Stop tracking a Twitch channel')
    .addStringOption(o => o.setName('username').setDescription('Twitch username').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('add-youtube')
    .setDescription('Track a YouTube channel for new video alerts (paste channel ID)')
    .addStringOption(o => o.setName('channel-id').setDescription('YouTube channel ID (UCxxxxxx)').setRequired(true))
    .addStringOption(o => o.setName('name').setDescription('Display name').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remove-youtube')
    .setDescription('Stop tracking a YouTube channel')
    .addStringOption(o => o.setName('channel-id').setDescription('YouTube channel ID').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('alerts-list')
    .setDescription('List all tracked channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
];

// ── Twitch auth ────────────────────────────────────────────────────────────────
let twitchToken = null;
let twitchExpiry = 0;

async function getTwitchToken() {
  if (twitchToken && Date.now() < twitchExpiry) return twitchToken;
  const cid = process.env.TWITCH_CLIENT_ID;
  const cs  = process.env.TWITCH_CLIENT_SECRET;
  if (!cid || !cs) return null;
  try {
    const res = await axios.post(`https://id.twitch.tv/oauth2/token?client_id=${cid}&client_secret=${cs}&grant_type=client_credentials`);
    twitchToken  = res.data.access_token;
    twitchExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
    return twitchToken;
  } catch { return null; }
}

async function checkTwitch(client) {
  const channels = db.get('alerts', 'twitch', []);
  const chId     = db.get('alerts', 'channelId');
  if (!channels.length || !chId) return;

  const token = await getTwitchToken();
  if (!token) return;

  const cid   = process.env.TWITCH_CLIENT_ID;
  const names = channels.map(c => c.username);

  try {
    const res = await axios.get('https://api.twitch.tv/helix/streams', {
      headers: { 'Client-ID': cid, Authorization: `Bearer ${token}` },
      params:  { user_login: names, first: 100 },
    });

    const live       = new Set(res.data.data.map(s => s.user_login.toLowerCase()));
    const prevLive   = new Set(db.get('alerts', 'twitchLive', []));
      
    const channel = await client.channels.fetch(chId).catch(() => null);
    if (!channel) return;

    for (const stream of res.data.data) {
      const name = stream.user_login.toLowerCase();
      if (prevLive.has(name)) continue; // already notified
      const embed = new EmbedBuilder()
        .setColor(0x9146ff)
        .setTitle(`🟣 ${stream.user_name} is Live!`)
        .setDescription(`**${stream.title}**`)
        .addFields(
          { name: '🎮 Game',    value: stream.game_name || 'Unknown', inline: true },
          { name: '👁️ Viewers', value: stream.viewer_count.toLocaleString(), inline: true },
        )
        .setImage(stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720'))
        .setURL(`https://twitch.tv/${stream.user_login}`)
        .setFooter({ text: 'Twitch' })
        .setTimestamp(new Date(stream.started_at));
      await channel.send({ content: `@everyone **${stream.user_name}** just went live!`, embeds: [embed] });
    }

    // update live set
    db.set('alerts', 'twitchLive', [...live]);
  } catch (e) {
    console.error('[alerts] Twitch check error:', e.message);
  }
}

async function checkYouTube(client) {
  const channels = db.get('alerts', 'youtube', []);
  const chId     = db.get('alerts', 'channelId');
  if (!channels.length || !chId) return;

  const channel = await client.channels.fetch(chId).catch(() => null);
  if (!channel) return;

  const seenVideos = db.get('alerts', 'seenYT', []);
  const seenSet    = new Set(seenVideos);
  const newSeen    = [];

  for (const yt of channels) {
    try {
      const rss = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${yt.id}`, { timeout: 10_000 });
      // parse RSS manually — avoid xml2js dep
      const entries = rss.data.match(/<entry>([\s\S]*?)<\/entry>/g) ?? [];
      for (const entry of entries.slice(0, 3)) {
        const videoId = (entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/) ?? [])[1];
        if (!videoId || seenSet.has(videoId)) { newSeen.push(videoId); continue; }
        const title   = (entry.match(/<title>(.*?)<\/title>/) ?? [])[1] ?? 'New Video';
        const published = (entry.match(/<published>(.*?)<\/published>/) ?? [])[1];
        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle(`▶️ New Video — ${yt.name}`)
          .setDescription(`**${title}**`)
          .setURL(`https://www.youtube.com/watch?v=${videoId}`)
          .setImage(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`)
          .setFooter({ text: 'YouTube' })
          .setTimestamp(published ? new Date(published) : undefined);
        await channel.send({ embeds: [embed] });
        newSeen.push(videoId);
      }
    } catch (e) {
      console.error(`[alerts] YouTube ${yt.id} error:`, e.message);
    }
  }

  if (newSeen.length) db.set('alerts', 'seenYT', [...new Set([...seenVideos, ...newSeen])].slice(-200));
}

function init(client) {
  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;

    if (i.commandName === 'set-alerts') {
      const ch = i.options.getChannel('channel');
      db.set('alerts', 'channelId', ch.id);
      return i.reply({ content: `✅ Alert channel set to <#${ch.id}>.`, ephemeral: true });
    }

    if (i.commandName === 'add-twitch') {
      const username = i.options.getString('username').toLowerCase();
      const list = db.get('alerts', 'twitch', []);
      if (list.find(c => c.username === username)) return i.reply({ content: '❌ Already tracking.', ephemeral: true });
      list.push({ username });
      db.set('alerts', 'twitch', list);
      return i.reply({ content: `✅ Now tracking **${username}** on Twitch.`, ephemeral: true });
    }

    if (i.commandName === 'remove-twitch') {
      const username = i.options.getString('username').toLowerCase();
      const list = db.get('alerts', 'twitch', []).filter(c => c.username !== username);
      db.set('alerts', 'twitch', list);
      return i.reply({ content: `✅ Removed **${username}**.`, ephemeral: true });
    }

    if (i.commandName === 'add-youtube') {
      const id   = i.options.getString('channel-id');
      const name = i.options.getString('name');
      const list = db.get('alerts', 'youtube', []);
      if (list.find(c => c.id === id)) return i.reply({ content: '❌ Already tracking.', ephemeral: true });
      list.push({ id, name });
      db.set('alerts', 'youtube', list);
      // seed seen videos so we don't spam old ones
      checkYouTube(client).catch(() => {});
      return i.reply({ content: `✅ Now tracking **${name}** on YouTube.`, ephemeral: true });
    }

    if (i.commandName === 'remove-youtube') {
      const id   = i.options.getString('channel-id');
      const list = db.get('alerts', 'youtube', []).filter(c => c.id !== id);
      db.set('alerts', 'youtube', list);
      return i.reply({ content: `✅ Removed.`, ephemeral: true });
    }

    if (i.commandName === 'alerts-list') {
      const twitch  = db.get('alerts', 'twitch',  []).map(c => c.username).join(', ') || 'None';
      const youtube = db.get('alerts', 'youtube', []).map(c => c.name).join(', ')     || 'None';
      const chId    = db.get('alerts', 'channelId');
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📡 Alert Tracker')
        .addFields(
          { name: 'Channel',  value: chId ? `<#${chId}>` : '❌ Not set', inline: false },
          { name: '🟣 Twitch', value: twitch,                             inline: false },
          { name: '▶️ YouTube', value: youtube,                           inline: false },
        );
      return i.reply({ embeds: [embed], ephemeral: true });
    }
  });

  cron.schedule('*/2 * * * *', () => checkTwitch(client).catch(console.error));
  cron.schedule('*/10 * * * *', () => checkYouTube(client).catch(console.error));
  console.log('[alerts] Twitch every 2min, YouTube every 10min');
}

module.exports = { commands, init };
