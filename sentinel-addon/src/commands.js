const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ChannelType
} = require("discord.js");
const config = require("./config");

const commands = [
  new SlashCommandBuilder().setName("protect").setDescription("Protection controls")
    .addSubcommand(s => s.setName("status").setDescription("Show protection status"))
    .addSubcommand(s => s.setName("panel").setDescription("Post the security panel"))
    .addSubcommand(s => s.setName("lockdown").setDescription("Lock text channels"))
    .addSubcommand(s => s.setName("unlock").setDescription("Release lockdown"))
    .addSubcommand(s => s.setName("configure").setDescription("Configure anti-raid settings")
      .addIntegerOption(o => o.setName("threshold").setDescription("Joins in the detection window").setMinValue(3).setMaxValue(100).setRequired(false))
      .addBooleanOption(o => o.setName("auto_lockdown").setDescription("Enable automatic lockdown on join spike").setRequired(false))
      ),
  new SlashCommandBuilder().setName("moderation").setDescription("Moderation tools")
    .addSubcommand(s => s.setName("ban").setDescription("Ban a member")
      .addUserOption(o => o.setName("user").setDescription("Member to ban").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)))
    .addSubcommand(s => s.setName("kick").setDescription("Kick a member")
      .addUserOption(o => o.setName("user").setDescription("Member to kick").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)))
    .addSubcommand(s => s.setName("timeout").setDescription("Timeout a member")
      .addUserOption(o => o.setName("user").setDescription("Member to timeout").setRequired(true))
      .addIntegerOption(o => o.setName("minutes").setDescription("Duration in minutes").setMinValue(1).setMaxValue(40320).setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)))
    .addSubcommand(s => s.setName("warn").setDescription("Warn a member")
      .addUserOption(o => o.setName("user").setDescription("Member to warn").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)))
    .addSubcommand(s => s.setName("warnings").setDescription("Show a member's warnings")
      .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)))
    .addSubcommand(s => s.setName("purge").setDescription("Delete recent messages")
      .addIntegerOption(o => o.setName("amount").setDescription("1 to 100").setMinValue(1).setMaxValue(100).setRequired(true)))
    .addSubcommand(s => s.setName("lock").setDescription("Lock this channel"))
    .addSubcommand(s => s.setName("unlock").setDescription("Unlock this channel")),
  new SlashCommandBuilder().setName("mod-papps").setDescription("Moderator applications")
    .addSubcommand(s => s.setName("panel").setDescription("Post an application panel"))
    .addSubcommand(s => s.setName("open").setDescription("Open applications"))
    .addSubcommand(s => s.setName("close").setDescription("Close applications"))
    .addSubcommand(s => s.setName("pending").setDescription("List pending applications"))
    .addSubcommand(s => s.setName("review").setDescription("Post a review panel for an application")
      .addIntegerOption(o => o.setName("id").setDescription("Application ID").setRequired(true).setMinValue(1))
      ),
  new SlashCommandBuilder().setName("security").setDescription("Security incident tools")
    .addSubcommand(s => s.setName("incident").setDescription("View recent security incidents"))
];

module.exports = commands.map(c => c.toJSON());
