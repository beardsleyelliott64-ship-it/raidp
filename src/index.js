const {
  Client, GatewayIntentBits, Partials, Events, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, ChannelType
} = require("discord.js");
const config = require("./config");
const { initDb, db, ensureSettings } = require("./db");
const { onMemberJoin, onMessage, createIncident, sendLog, setLockdown } = require("./security");
const { isAiEnabled } = require("./ai");

if (!config.token || !config.clientId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID environment variable.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

const pendingApplications = new Map();

function isStaff(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) ||
    config.ownerIds.includes(interaction.user.id);
}
function reasonOrDefault(value) { return value?.trim() || "No reason provided"; }

client.once(Events.ClientReady, c => {
  console.log(`Logged in as ${c.user.tag}. Gemini: ${isAiEnabled() ? "enabled" : "disabled"}.`);
});

client.on(Events.GuildMemberAdd, member => onMemberJoin(member).catch(console.error));
client.on(Events.MessageCreate, message => onMessage(message).catch(console.error));

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.guild) return interaction.reply({ content: "Use this command in a server.", ephemeral: true });
      const { commandName } = interaction;
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;
      await ensureSettings(guildId);

      if (commandName === "protect") {
        if (sub === "status") {
          const s = await ensureSettings(guildId);
          const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🛡️ Sentinel Protection Status")
            .addFields(
              { name: "Anti-raid", value: "Active (join-rate detection)", inline: true },
              { name: "Anti-spam", value: "Active", inline: true },
              { name: "Gemini AI", value: isAiEnabled() ? "Connected/configured" : "Disabled (missing key)", inline: true },
              { name: "Auto-lockdown", value: s.auto_lockdown ? "Enabled" : "Disabled", inline: true },
              { name: "Lockdown", value: s.lockdown_active ? "Active" : "Inactive", inline: true }
            ).setFooter({ text: "AI analysis is advisory; rule-based checks remain active." });
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }
        if (sub === "panel") {
          const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("sentinel:status").setLabel("Status").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("sentinel:lockdown").setLabel("Lockdown").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("sentinel:unlock").setLabel("Unlock").setStyle(ButtonStyle.Success)
          );
          const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🛡️ Sentinel AI Security Panel")
            .setDescription("Use the buttons to inspect status or manage emergency lockdown. Manage Server permission is required for actions.")
            .addFields({ name: "Detection", value: "Anti-raid and anti-spam", inline: true }, { name: "AI", value: isAiEnabled() ? "Gemini available" : "Not configured", inline: true });
          return interaction.reply({ embeds: [embed], components: [row1] });
        }
        if (!isStaff(interaction)) return interaction.reply({ content: "You need Manage Server or moderation permissions.", ephemeral: true });
        if (sub === "configure") {
          const threshold = interaction.options.getInteger("threshold");
          const auto = interaction.options.getBoolean("auto_lockdown");
          await db().query(`INSERT INTO guild_settings (guild_id, raid_threshold, auto_lockdown) VALUES ($1,$2,$3)
            ON CONFLICT (guild_id) DO UPDATE SET
            raid_threshold=COALESCE($2,guild_settings.raid_threshold),
            auto_lockdown=COALESCE($3,guild_settings.auto_lockdown), updated_at=NOW()`,
            [guildId, threshold, auto]);
          return interaction.reply({ content: `Updated settings. Threshold: ${threshold ?? "unchanged"}; auto-lockdown: ${auto ?? "unchanged"}.`, ephemeral: true });
        }
        if (sub === "lockdown" || sub === "unlock") {
          await setLockdown(interaction.guild, sub === "lockdown", interaction.user.id);
          await sendLog(interaction.guild, new EmbedBuilder().setTitle(`🔒 Lockdown ${sub === "lockdown" ? "activated" : "released"}`).setDescription(`By <@${interaction.user.id}>`).setTimestamp());
          return interaction.reply({ content: `Lockdown ${sub === "lockdown" ? "activated" : "released"}. Check channel permissions and logs.`, ephemeral: true });
        }
      }

      if (commandName === "moderation") {
        const user = interaction.options.getUser("user");
        const reason = reasonOrDefault(interaction.options.getString("reason"));
        const member = user ? await interaction.guild.members.fetch(user.id).catch(() => null) : null;
        if (sub !== "warnings" && !interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers) && !interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
          return interaction.reply({ content: "You need Moderate Members or Manage Messages.", ephemeral: true });
        }
        if (sub === "ban") {
          if (!member) return interaction.reply({ content: "That user is not currently in this server.", ephemeral: true });
          await member.ban({ reason: `${reason} | Moderator: ${interaction.user.id}` });
          await sendLog(interaction.guild, new EmbedBuilder().setTitle("🔨 Member banned").setDescription(`User: ${user.tag}\nModerator: ${interaction.user.tag}\nReason: ${reason}`).setTimestamp());
          return interaction.reply({ content: `Banned **${user.tag}**. Reason: ${reason}`, ephemeral: true });
        }
        if (sub === "kick") {
          if (!member) return interaction.reply({ content: "Member not found in this server.", ephemeral: true });
          await member.kick(`${reason} | Moderator: ${interaction.user.id}`);
          return interaction.reply({ content: `Kicked **${user.tag}**.`, ephemeral: true });
        }
        if (sub === "timeout") {
          if (!member) return interaction.reply({ content: "Member not found in this server.", ephemeral: true });
          await member.timeout(interaction.options.getInteger("minutes") * 60000, `${reason} | Moderator: ${interaction.user.id}`);
          return interaction.reply({ content: `Timed out **${user.tag}**. Reason: ${reason}`, ephemeral: true });
        }
        if (sub === "warn") {
          await db().query("INSERT INTO warnings (guild_id,user_id,moderator_id,reason) VALUES ($1,$2,$3,$4)", [guildId, user.id, interaction.user.id, reason]);
          await sendLog(interaction.guild, new EmbedBuilder().setTitle("⚠️ Member warned").setDescription(`User: ${user.tag}\nModerator: ${interaction.user.tag}\nReason: ${reason}`).setTimestamp());
          return interaction.reply({ content: `Warned **${user.tag}**.`, ephemeral: true });
        }
        if (sub === "warnings") {
          const result = await db().query("SELECT id,reason,moderator_id,created_at FROM warnings WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 10", [guildId, user.id]);
          const desc = result.rows.length ? result.rows.map(w => `**#${w.id}** ${w.reason} — <@${w.moderator_id}> (${new Date(w.created_at).toLocaleDateString()})`).join("\n") : "No warnings found.";
          return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Warnings for ${user.tag}`).setDescription(desc.slice(0, 4000))], ephemeral: true });
        }
        if (sub === "purge") {
          if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: "You need Manage Messages.", ephemeral: true });
          const amount = interaction.options.getInteger("amount");
          const deleted = await interaction.channel.bulkDelete(amount, true);
          return interaction.reply({ content: `Deleted ${deleted.size} recent messages. Messages older than 14 days cannot be bulk-deleted.`, ephemeral: true });
        }
        if (sub === "lock" || sub === "unlock") {
          if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: "You need Manage Channels.", ephemeral: true });
          await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: sub === "lock" ? false : null }, { reason: `Requested by ${interaction.user.tag}` });
          return interaction.reply({ content: `Channel ${sub === "lock" ? "locked" : "unlocked"}.`, ephemeral: true });
        }
      }

      if (commandName === "mod-papps") {
        if (!isStaff(interaction)) return interaction.reply({ content: "You need staff permissions.", ephemeral: true });
        if (sub === "panel") {
          const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("sentinel:apply").setLabel("Apply for Moderator").setStyle(ButtonStyle.Primary));
          const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("👮 Moderator Applications")
            .setDescription("Interested in helping the community? Click **Apply for Moderator** to submit an application. Please answer honestly.");
          return interaction.reply({ embeds: [embed], components: [row] });
        }
        if (sub === "open" || sub === "close") {
          const open = sub === "open";
          await db().query(`INSERT INTO guild_settings (guild_id, applications_open) VALUES ($1,$2)
            ON CONFLICT (guild_id) DO UPDATE SET applications_open=$2, updated_at=NOW()`, [guildId, open]);
          return interaction.reply({ content: `Moderator applications are now ${open ? "OPEN" : "CLOSED"}.`, ephemeral: true });
        }
        if (sub === "pending") {
          const r = await db().query("SELECT id,user_id,created_at FROM applications WHERE guild_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 15", [guildId]);
          const desc = r.rows.length ? r.rows.map(a => `**#${a.id}** <@${a.user_id}> — ${new Date(a.created_at).toLocaleString()}`).join("\n") : "No pending applications.";
          return interaction.reply({ embeds: [new EmbedBuilder().setTitle("Pending moderator applications").setDescription(desc)], ephemeral: true });
        }
        if (sub === "review") {
          const id = interaction.options.getInteger("id");
          const r = await db().query("SELECT * FROM applications WHERE id=$1 AND guild_id=$2", [id, guildId]);
          if (!r.rows[0]) return interaction.reply({ content: "Application not found.", ephemeral: true });
          const app = r.rows[0];
          const answers = app.answers || {};
          const embed = new EmbedBuilder().setTitle(`Moderator application #${id}`).setDescription(`Applicant: <@${app.user_id}>\nStatus: **${app.status}**\n\n${Object.entries(answers).map(([k,v]) => `**${k}**\n${v}`).join("\n\n")}`.slice(0, 4000));
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`sentinel:app:accept:${id}`).setLabel("Accept").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`sentinel:app:reject:${id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
          );
          return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }
      }

      if (commandName === "security" && sub === "incident") {
        if (!isStaff(interaction)) return interaction.reply({ content: "Staff only.", ephemeral: true });
        const r = await db().query("SELECT id,kind,severity,summary,created_at,resolved FROM incidents WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 10", [guildId]);
        const desc = r.rows.length ? r.rows.map(i => `**#${i.id}** [${i.severity}] ${i.kind} — ${i.summary.slice(0,160)} (${new Date(i.created_at).toLocaleString()})`).join("\n") : "No incidents recorded.";
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("Recent security incidents").setDescription(desc.slice(0, 4000))], ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id === "sentinel:status") {
        const s = await ensureSettings(interaction.guild.id);
        return interaction.reply({ content: `Auto-lockdown: **${s.auto_lockdown ? "ON" : "OFF"}**\nLockdown active: **${s.lockdown_active ? "YES" : "NO"}**\nGemini: **${isAiEnabled() ? "available" : "disabled"}**`, ephemeral: true });
      }
      if (id === "sentinel:lockdown" || id === "sentinel:unlock") {
        if (!isStaff(interaction)) return interaction.reply({ content: "Staff permissions required.", ephemeral: true });
        await setLockdown(interaction.guild, id.endsWith("lockdown"), interaction.user.id);
        return interaction.reply({ content: id.endsWith("lockdown") ? "Lockdown activated." : "Lockdown released.", ephemeral: true });
      }
      if (id === "sentinel:apply") {
        const settings = await ensureSettings(interaction.guild.id);
        if (!settings.applications_open) return interaction.reply({ content: "Applications are currently closed.", ephemeral: true });
        const existing = await db().query("SELECT id FROM applications WHERE guild_id=$1 AND user_id=$2 AND status='pending'", [interaction.guild.id, interaction.user.id]);
        if (existing.rows.length) return interaction.reply({ content: "You already have a pending application.", ephemeral: true });
        const modal = new ModalBuilder().setCustomId("sentinel:application:submit").setTitle("Moderator Application");
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("why").setLabel("Why do you want to be a moderator?").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("experience").setLabel("Previous experience (if any)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("scenario").setLabel("How would you handle repeated rule-breaking?").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("availability").setLabel("Typical availability").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("staff_abuse").setLabel("What if another mod abused permissions?").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000))
        );
        return interaction.showModal(modal);
      }
      if (id.startsWith("sentinel:app:")) {
        if (!isStaff(interaction)) return interaction.reply({ content: "Staff permissions required.", ephemeral: true });
        const [, , action, appId] = id.split(":");
        const status = action === "accept" ? "accepted" : "rejected";
        const r = await db().query("UPDATE applications SET status=$1, reviewer_id=$2, updated_at=NOW() WHERE id=$3 AND guild_id=$4 AND status='pending' RETURNING user_id", [status, interaction.user.id, Number(appId), interaction.guild.id]);
        if (!r.rows[0]) return interaction.reply({ content: "Application was already reviewed or not found.", ephemeral: true });
        const applicant = await client.users.fetch(r.rows[0].user_id).catch(() => null);
        if (applicant) await applicant.send(`Your moderator application in **${interaction.guild.name}** was **${status}**. ${status === "accepted" ? "Please contact staff for next steps." : "Thank you for applying."}`).catch(() => {});
        return interaction.update({ content: `Application #${appId} ${status} by ${interaction.user.tag}.`, embeds: [], components: [] });
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === "sentinel:application:submit") {
      const settings = await ensureSettings(interaction.guild.id);
      if (!settings.applications_open) return interaction.reply({ content: "Applications are closed.", ephemeral: true });
      const answers = {
        "Why do you want to be a moderator?": interaction.fields.getTextInputValue("why"),
        "Previous experience": interaction.fields.getTextInputValue("experience") || "Not provided",
        "Handling repeated rule-breaking": interaction.fields.getTextInputValue("scenario"),
        "Availability": interaction.fields.getTextInputValue("availability"),
        "Staff abuse scenario": interaction.fields.getTextInputValue("staff_abuse")
      };
      const result = await db().query("INSERT INTO applications (guild_id,user_id,answers) VALUES ($1,$2,$3) RETURNING id", [interaction.guild.id, interaction.user.id, JSON.stringify(answers)]);
      const appId = result.rows[0].id;
      const reviewChannelId = settings.review_channel_id || config.defaultApplicationReviewChannelId;
      const reviewChannel = reviewChannelId ? await interaction.guild.channels.fetch(reviewChannelId).catch(() => null) : null;
      if (reviewChannel?.isTextBased()) {
        const embed = new EmbedBuilder().setTitle(`📝 Moderator application #${appId}`).setDescription(`Applicant: <@${interaction.user.id}>\n\n${Object.entries(answers).map(([k,v]) => `**${k}**\n${v}`).join("\n\n")}`.slice(0, 4000)).setTimestamp();
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`sentinel:app:accept:${appId}`).setLabel("Accept").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`sentinel:app:reject:${appId}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
        );
        await reviewChannel.send({ embeds: [embed], components: [row] });
      }
      return interaction.reply({ content: `Application submitted! Your reference number is **#${appId}**.`, ephemeral: true });
    }
  } catch (error) {
    console.error("Interaction error:", error);
    const message = "Something went wrong. Check bot permissions and logs.";
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    } else if (interaction.isRepliable() && interaction.deferred) {
      await interaction.editReply({ content: message }).catch(() => {});
    }
  }
});

process.on("unhandledRejection", err => console.error("Unhandled rejection:", err));
process.on("uncaughtException", err => { console.error("Uncaught exception:", err); });

initDb()
  .then(() => client.login(config.token))
  .catch(err => { console.error("Startup failed:", err); process.exit(1); });
