// language: JavaScript, file: clear_and_sync.js
// Run once: node clear_and_sync.js
// - Clears ALL guild commands for every guild the bot is in (kills old bot leftovers)
// - Then syncs current commands to GUILD_ID (1565835601347878946)
// Requires: DISCORD_TOKEN, CLIENT_ID in .env or env vars

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./deployment.js');

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const TARGET    = process.env.GUILD_ID || '1565835601347878946';

if (!TOKEN || !CLIENT_ID) {
    console.error('DISCORD_TOKEN and CLIENT_ID must be set.');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function run() {
    // ── 1. Wipe global commands (catches old global registrations) ────────────
    console.log('[1/3] Wiping global application commands...');
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
        console.log('      ✓ Global commands cleared.');
    } catch (e) {
        console.warn('      ⚠ Could not clear global commands:', e.message);
    }

    // ── 2. Wipe commands from every guild the bot can see ─────────────────────
    console.log('[2/3] Fetching guilds this bot is in...');
    let guilds = [];
    try {
        guilds = await rest.get(Routes.userGuilds());
        console.log(`      Found ${guilds.length} guild(s).`);
    } catch (e) {
        console.warn('      ⚠ Could not fetch guild list:', e.message);
    }

    for (const guild of guilds) {
        try {
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guild.id), { body: [] });
            console.log(`      ✓ Cleared commands in guild ${guild.id} (${guild.name})`);
        } catch (e) {
            console.warn(`      ⚠ Skipped guild ${guild.id}: ${e.message}`);
        }
    }

    // ── 3. Register current commands into target guild ─────────────────────────
    console.log(`[3/3] Registering commands into guild ${TARGET}...`);
    const commands = loadCommands();
    try {
        const result = await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, TARGET),
            { body: commands }
        );
        console.log(`      ✓ ${result.length} commands registered in ${TARGET}.`);
        console.log('      Commands:', result.map(c => `/${c.name}`).join(', '));
    } catch (e) {
        console.error('      ✗ Registration failed:', e.message);
        process.exitCode = 1;
    }
}

run().catch(e => { console.error(e); process.exitCode = 1; });
