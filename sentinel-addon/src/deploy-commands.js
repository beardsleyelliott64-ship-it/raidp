const { REST, Routes } = require("discord.js");
require("dotenv").config();
const commands = require("./commands");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !clientId) throw new Error("Set DISCORD_TOKEN and DISCORD_CLIENT_ID first.");

const rest = new REST({ version: "10" }).setToken(token);
(async () => {
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
  await rest.put(route, { body: commands });
  console.log(`Registered ${commands.length} commands ${guildId ? `in guild ${guildId}` : "globally"}.`);
})().catch(err => { console.error(err); process.exit(1); });
