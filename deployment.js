require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

function loadCommands() {
    const commands = [];
    const root = path.join(__dirname, 'commands');

    if (!fs.existsSync(root)) {
        throw new Error(`Commands folder not found: ${root}`);
    }

    for (const folder of fs.readdirSync(root)) {
        const folderPath = path.join(root, folder);
        if (!fs.statSync(folderPath).isDirectory()) continue;

        for (const file of fs.readdirSync(folderPath).filter(f => f.endsWith('.js'))) {
            const filePath = path.join(folderPath, file);
            try {
                const command = require(filePath);
                if (!command?.data?.toJSON || typeof command.execute !== 'function') {
                    console.warn(`[commands] Skipping ${file}: missing data/execute.`);
                    continue;
                }
                commands.push(command.data.toJSON());
            } catch (error) {
                // One broken command should not prevent all the other commands registering.
                console.error(`[commands] Could not load ${file}: ${error.message}`);
            }
        }
    }

    // Discord rejects duplicate command names. Fail with a useful message instead of
    // silently leaving the guild with no updated commands.
    const seen = new Set();
    const duplicates = [];
    for (const command of commands) {
        if (seen.has(command.name)) duplicates.push(command.name);
        seen.add(command.name);
    }
    if (duplicates.length) {
        throw new Error(`Duplicate command names found: ${[...new Set(duplicates)].join(', ')}`);
    }

    console.log(`[commands] Loaded ${commands.length} command definitions.`);
    return commands;
}

/**
 * Register commands directly through the logged-in discord.js application.
 * Using client.application.commands.set() is more reliable for automatic guild
 * registration than relying on a separate deployment process.
 */
async function registerForClient(client) {
    if (!client?.application) {
        throw new Error('Discord application is not ready yet. Registration must run after clientReady.');
    }

    const configured = (process.env.GUILD_ID || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);

    const guildIds = configured.length
        ? [...new Set(configured)]
        : [...client.guilds.cache.keys()];

    if (!guildIds.length) {
        throw new Error('No guilds found. Set GUILD_ID to the Discord server ID where commands should appear.');
    }

    const commands = loadCommands();
    const results = [];

    console.log(`[commands] Starting automatic guild registration for ${guildIds.length} guild(s)...`);

    for (const guildId of guildIds) {
        try {
            // Verify the bot can see the target guild before attempting registration.
            const guild = await client.guilds.fetch(guildId);
            if (!guild) throw new Error('Guild could not be fetched.');

            const registered = await client.application.commands.set(commands, guildId);
            console.log(`[commands] SUCCESS: ${registered.size} commands registered in ${guild.name} (${guildId}).`);
            results.push({ guildId, count: registered.size, ok: true });
        } catch (error) {
            console.error(`[commands] FAILED for guild ${guildId}: ${error.message}`);
            console.error('[commands] Make sure GUILD_ID is correct and the bot was invited with the applications.commands scope.');
            results.push({ guildId, count: 0, ok: false, error: error.message });
        }
    }

    const failed = results.filter(result => !result.ok);
    if (failed.length === results.length) {
        throw new Error(`Automatic command registration failed for every guild. ${failed.map(x => `${x.guildId}: ${x.error}`).join(' | ')}`);
    }

    return results;
}

/**
 * Manual fallback for `npm run register:guild`.
 * The normal Render startup path uses registerForClient() above.
 */
async function registerGuildCommands(clientId, token, guildIds) {
    if (!clientId || !token) {
        throw new Error('CLIENT_ID and DISCORD_TOKEN are required.');
    }

    const ids = [...new Set((guildIds || []).filter(Boolean))];
    if (!ids.length) throw new Error('Set GUILD_ID to at least one Discord server ID.');

    const commands = loadCommands();
    const rest = new REST({ version: '10' }).setToken(token);

    for (const guildId of ids) {
        const registered = await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands }
        );
        console.log(`[commands] SUCCESS: ${registered.length} commands registered in guild ${guildId}.`);
    }

    return commands.length;
}

if (require.main === module) {
    registerGuildCommands(
        process.env.CLIENT_ID,
        process.env.DISCORD_TOKEN,
        (process.env.GUILD_ID || '').split(',').map(x => x.trim()).filter(Boolean)
    )
        .then(count => console.log(`[commands] Manual registration complete: ${count} commands.`))
        .catch(error => {
            console.error('[commands] Manual registration failed:', error);
            process.exitCode = 1;
        });
}

module.exports = { loadCommands, registerGuildCommands, registerForClient };
