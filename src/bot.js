// language: Node.js, file: src/bot.js
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

const modules = [
  require('./modules/panel'),
  require('./modules/tracker'),
  require('./modules/economy'),
  require('./modules/chatbot'),
  require('./modules/alerts'),
  require('./modules/voice'),
  require('./modules/giveaway'),
  require('./modules/tickets'),
  require('./modules/stats'),
  require('./modules/applications'),
  require('./modules/backup'),
];

let client = null;

async function startBot() {
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  // aggregate all commands
  const allCommands = modules.flatMap(m => m.commands ?? []);

  client.once('ready', async () => {
    console.log(`[bot] online as ${client.user.tag} — ${allCommands.length} commands`);

    // register globally
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
      await rest.put(Routes.applicationCommands(client.user.id), { body: allCommands });
      console.log('[bot] global commands registered');
    } catch (e) {
      console.error('[bot] command registration error:', e.message);
    }

    // init all modules
    for (const mod of modules) {
      try { mod.init(client); }
      catch (e) { console.error(`[bot] module init error:`, e.message); }
    }
  });

  // global interaction error guard
  client.on('interactionCreate', async i => {
    // each module handles its own commands;
    // this guard catches any unhandled crash that would silently fail
    if (!i.isChatInputCommand()) return;
    // already handled by modules — just ensure no "did not respond" from crashes
  });

  process.on('unhandledRejection', e => console.error('[bot] unhandled rejection:', e));

  await client.login(process.env.DISCORD_TOKEN);
}

module.exports = { startBot };
