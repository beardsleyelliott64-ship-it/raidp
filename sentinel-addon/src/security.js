const { EmbedBuilder, PermissionsBitField } = require("discord.js");
const config = require("./config");
const { db, ensureSettings } = require("./db");
const { analyseIncident } = require("./ai");

const joinBuckets = new Map();
const messageBuckets = new Map();
const previousOverwrites = new Map();

async function sendLog(guild, embed) {
  try {
    const settings = await ensureSettings(guild.id);
    const channelId = settings.log_channel_id || config.defaultLogChannelId;
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (channel && channel.isTextBased()) await channel.send({ embeds: [embed] });
  } catch (e) { console.error("Could not send security log:", e.message); }
}

async function createIncident(guild, kind, severity, summary, evidence = {}) {
  let ai = null;
  if (config.aiIncidentAnalysis) {
    ai = await analyseIncident({ guild_id: guild.id, kind, severity, summary, evidence });
  }
  const result = await db().query(
    "INSERT INTO incidents (guild_id, kind, severity, summary, ai_analysis) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [guild.id, kind, severity, summary, ai ? JSON.stringify(ai) : null]
  );
  const embed = new EmbedBuilder()
    .setColor(severity === "CRITICAL" ? 0x992d22 : severity === "HIGH" ? 0xe67e22 : 0xf1c40f)
    .setTitle(`🚨 Security incident #${result.rows[0].id}`)
    .setDescription(summary.slice(0, 4000))
    .addFields({ name: "Type", value: kind, inline: true }, { name: "Severity", value: severity, inline: true })
    .setTimestamp();
  if (ai) {
    const observations = Array.isArray(ai.observations) ? ai.observations.slice(0, 3).join("\n") : "";
    const recs = Array.isArray(ai.recommended_actions) ? ai.recommended_actions.slice(0, 3).join("\n") : "";
    if (observations) embed.addFields({ name: "Gemini observations", value: observations.slice(0, 1000) });
    if (recs) embed.addFields({ name: "Suggested actions (review first)", value: recs.slice(0, 1000) });
  }
  await sendLog(guild, embed);
  return result.rows[0].id;
}

async function setLockdown(guild, enabled, actorId = "system") {
  const everyone = guild.roles.everyone;
  const channels = await guild.channels.fetch();
  if (enabled) {
    for (const [, channel] of channels) {
      if (!channel || !channel.isTextBased() || !channel.permissionOverwrites) continue;
      try {
        const existing = channel.permissionOverwrites.cache.get(everyone.id);
        const prior = existing ? existing.allow.bitfield.toString() + ":" + existing.deny.bitfield.toString() : "none";
        previousOverwrites.set(`${guild.id}:${channel.id}`, prior);
        await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason: `Sentinel lockdown initiated by ${actorId}` });
      } catch (e) { console.warn(`Lockdown could not update ${channel?.name}: ${e.message}`); }
    }
  } else {
    // Restore only the SendMessages state where we have an in-process snapshot.
    for (const [, channel] of channels) {
      const key = `${guild.id}:${channel?.id}`;
      if (!channel || !previousOverwrites.has(key)) continue;
      const prior = previousOverwrites.get(key);
      previousOverwrites.delete(key);
      try {
        if (prior === "none") await channel.permissionOverwrites.delete(everyone, "Sentinel lockdown released");
        else {
          const [allowBits, denyBits] = prior.split(":");
          const allow = BigInt(allowBits), deny = BigInt(denyBits);
          const sendBit = PermissionsBitField.Flags.SendMessages;
          const allowSend = (allow & sendBit) !== 0n;
          const denySend = (deny & sendBit) !== 0n;
          await channel.permissionOverwrites.edit(everyone, { SendMessages: allowSend ? true : denySend ? false : null }, { reason: "Sentinel lockdown released" });
        }
      } catch (e) { console.warn(`Unlock could not update ${channel?.name}: ${e.message}`); }
    }
  }
  await db().query(
    `INSERT INTO guild_settings (guild_id, lockdown_active) VALUES ($1,$2)
     ON CONFLICT (guild_id) DO UPDATE SET lockdown_active=$2, updated_at=NOW()`,
    [guild.id, enabled]
  );
}

async function onMemberJoin(member) {
  const now = Date.now();
  const list = (joinBuckets.get(member.guild.id) || []).filter(t => now - t < config.raidWindowSeconds * 1000);
  list.push(now);
  joinBuckets.set(member.guild.id, list);
  const settings = await (async () => {
    const { ensureSettings } = require("./db");
    return ensureSettings(member.guild.id);
  })();
  const threshold = settings.raid_threshold || config.raidJoinThreshold;
  if (list.length === threshold) {
    await createIncident(member.guild, "ANTI_RAID", "HIGH",
      `${list.length} members joined within ${config.raidWindowSeconds} seconds.`,
      { join_count: list.length, threshold, window_seconds: config.raidWindowSeconds });
    if (config.autoLockdown || settings.auto_lockdown) {
      try { await setLockdown(member.guild, true, "anti-raid auto-response"); }
      catch (e) { console.error("Auto-lockdown failed:", e.message); }
    }
  }
}

async function onMessage(message) {
  if (!message.guild || message.author.bot) return;
  const now = Date.now();
  const key = `${message.guild.id}:${message.author.id}`;
  const list = (messageBuckets.get(key) || []).filter(t => now - t < config.antiSpamWindowSeconds * 1000);
  list.push(now);
  messageBuckets.set(key, list);
  if (list.length < config.antiSpamMaxMessages) return;

  messageBuckets.delete(key);
  const member = message.member;
  if (!member || member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;
  await createIncident(message.guild, "ANTI_SPAM", "MEDIUM",
    `Potential message flood from user ${message.author.tag} (${message.author.id}).`,
    { message_count: list.length, window_seconds: config.antiSpamWindowSeconds });
  try {
    await member.timeout(config.antiSpamTimeoutSeconds * 1000, "Sentinel anti-spam threshold exceeded");
    await message.channel.send({ content: `⚠️ ${message.author} was temporarily timed out for message flooding.` });
  } catch (e) { console.warn("Anti-spam timeout failed:", e.message); }
}

module.exports = { onMemberJoin, onMessage, createIncident, sendLog, setLockdown };
