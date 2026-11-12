require('dotenv').config();

// EAM public web dashboard: mirrors bot diagnostics/status for users who are not in Discord.
try {
    global.__eamDashboard = require('./web/dashboard.js');
    global.__eamDashboard.start();
} catch (e) {
    // Dashboard failure must never prevent the Discord bot from starting.
    console.error('[WEB] Dashboard failed to start:', e.message);
}
const fs = require('node:fs');
const util = require('util');

if (!fs.existsSync('crash.log')) {
    fs.writeFileSync('crash.log', ''); 
}
if (!fs.existsSync('logs.txt')) {
    fs.writeFileSync('logs.txt', ''); 
}
const logFile = fs.createWriteStream('logs.txt', { flags: 'w' });

const originalLog = console.log;
console.log = function (...args) {
    const rendered = util.format(...args);
    logFile.write(rendered + '\n');
    originalLog.apply(console, args);
    try { if (global.__eamDashboard) global.__eamDashboard.pushLog('INFO', rendered); } catch (_) {}
};

const originalError = console.error; 
console.error = function (...args) { 
    const rendered = util.format(...args);
    const msg = '[ERROR] ' + rendered + '\n'; 
    
    // Streams (like logFile) are already non-blocking/async-driven
    if (logFile.writable) {
        logFile.write(msg);
    }
    
    // Asynchronous fire-and-forget append. 
    // We attach a .catch() to silently fail instead of using a try/catch block.
    fs.promises.appendFile('crash.log', msg).catch(() => {
        // Silently fail if we can't write to the file, to avoid a fatal crash loop
    });

    originalError.apply(console, args); 
    try { if (global.__eamDashboard) global.__eamDashboard.pushLog('ERROR', rendered); } catch (_) {}
};

process.on('unhandledRejection', async (reason) => {
    const errorMsg = `[Unhandled Rejection] ${reason ? reason.stack || reason : 'Unknown reason'}\n`;
    console.error(errorMsg);

    try {
        const { logError } = require('./utils/errorLogger.js');
        
        // Ensure logError finishes, and if it fails, write to the log asynchronously
        await logError(reason, null, 'Global Unhandled Rejection').catch(async (e) => {
            await fs.promises.appendFile('crash.log', `[Meta-Error] Webhook failed: ${e.message}\n`).catch(() => {});
        });
    } catch (e) {
        // Await the file write here since this block is already inside an async function
        await fs.promises.appendFile('crash.log', `[Meta-Error] logError function failed: ${e}\n`).catch(() => {});
    }
});

process.on('exit', (code) => {
    const msg = `PROCESS EXITED WITH CODE: ${code}\n`;
    console.log(msg);
    fs.appendFileSync('crash.log', msg);
});

const { settingsDisplayer } = require('./generic/settingsDisplayer.js');
const { handleQueueInput } = require('./handlers/queueChangeHandler.js');
const token = process.env.DISCORD_TOKEN;
const fspromise = require('fs').promises;
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, MessageFlags } = require('discord.js');
const { executeViewAccounts, saveAccount } = require('./handlers/savedAccountsHandler.js');
const { createAccount } = require('./handlers/accountHandler.js');
const mainAccountLogin = require('./handlers/mainAccountLogin.js');
const { viewSavedAccounts, changeMasterPassword, updateAccountInteraction, changeSlots } = require('./handlers/accountManager.js');
const config = require('./config.json');
const imageSolverHandler = require('./imageSolver.js');
const processSettings = require('./generic/processSettings.js');
const seperateParentChild = require('./utils/seperateParentChild.js');
const processLogin = require('./generic/processLogin.js');
const axios = require('axios');
const FormData = require('form-data');
const { colours, admin_roles, down_channel, base_role, channels, image_solver } = require('./config.json');

// Environment overrides make Render configuration easier. Comma-separated IDs are supported.
const configuredAdminRoles = [
    ...((admin_roles || []).filter(Boolean)),
    ...(process.env.ADMIN_ROLE_IDS || '').split(',').map(v => v.trim()).filter(Boolean)
];

const configuredChannels = {
    ...(channels || {}),
    sparx_maths: process.env.SPARX_MATHS_CHANNEL_ID || channels?.sparx_maths || '',
    sparx_reader: process.env.SPARX_READER_CHANNEL_ID || channels?.sparx_reader || '',
    sparx_science: process.env.SPARX_SCIENCE_CHANNEL_ID || channels?.sparx_science || '',
    seneca: process.env.SENECA_CHANNEL_ID || channels?.seneca || ''
};
const sendStartedMessage = require('./utils/sendStartedMessage.js');
const { registerForClient } = require('./deployment.js');

async function showAutocompChannels(client) {
    const ids = {
        down: process.env.DOWN_CHANNEL_ID || down_channel,
        image: process.env.IMAGE_SOLVER_CHANNEL_ID || image_solver,
        baseRole: process.env.BASE_ROLE_ID || base_role
    };
    if (!ids.baseRole) return;
    async function safeChannel(id, action) {
        if (!id) return;
        try { const channel = await client.channels.fetch(id); if (channel) await action(channel); }
        catch (e) { console.warn(`[channels] Skipped ${id}: ${e.message}`); }
    }
    await safeChannel(ids.down, c => c.permissionOverwrites.edit(ids.baseRole, { ViewChannel: false }));
    await safeChannel(ids.image, c => c.permissionOverwrites.edit(ids.baseRole, { ViewChannel: true }));
    for (const id of Object.values(channels || {})) {
        await safeChannel(id, c => c.permissionOverwrites.edit(ids.baseRole, { ViewChannel: true }));
    }
}

const sendLog = require('./utils/sendLogsWebhook.js');
async function cleanAllLogs(dir = './sessionLogs') {
    fs.mkdirSync(dir, { recursive: true });
    const files = fs.readdirSync(dir);

    for (const name of files) {
        if (name === ".gitkeep") continue;
        const filePath = path.join(dir, name);
        const stats = fs.statSync(filePath);

        const embed = {
            title: 'Session Logs (Cleanup)',
            description: `Logs uploaded at **${new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '')}**`,
            color: colours.onyx,
            fields: [
                { name: 'File Path', value: filePath },
            ]
        };

        await sendLog(filePath, name, embed);
    }
}

// Call the function starting at the root 'autocompleters' folder
cleanAllLogs('./sessionLogs')
    .then(() => console.log('Log cleanup complete!'))
    .catch(console.error);

// legalDisclamer: `\n> **LEGAL DISCLAMER**: ${name} employs the use of human tutors to complete the tasks given to them by customers of ${name}. No LLM (AI) is used throughout this process. No content or material from the homework platform is used for anything other than its permitted purpose. ${name} is in compliance with all regulations and abides by all Terms of Service of this homework platform.`,
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
    ],
});

client.on('error', (error) => {
    console.error('Discord Client Error:', error);
});

client.on('warn', (info) => {
    console.warn('Discord Client Warning:', info);
});

client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    if (folder === '.DS_Store') continue;
    const commandsPath = path.join(foldersPath, folder);
    const stats = fs.statSync(commandsPath);
    if (!stats.isDirectory()) continue;
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        // Set a new item in the Collection with the key as the command name and the value as the exported module
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

async function sendPersistentEmbeds(client) {
    const dirPath = path.join(__dirname, 'autocompleters');
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    // Filter out only the directories
    const folders = entries.filter(entry => entry.isDirectory());

    let startEmbedCollector = require('./generic/startEmbedCollector.js');
    
    // Loop through them
    for (const folder of folders) {
        const folderPath = path.join(dirPath, folder.name);

        // Determine paths and config keys for startEmbed.js
        const childrenPath = path.join(folderPath, 'children');
        let embedTargets =[]; // Array of objects holding the path and the config dictionary key

        if (fs.existsSync(childrenPath) && fs.statSync(childrenPath).isDirectory()) {
            // If 'children' exists, read its subdirectories (maths, reader, science)
            const childEntries = fs.readdirSync(childrenPath, { withFileTypes: true });
            const childFolders = childEntries.filter(entry => entry.isDirectory());
            
            for (const childFolder of childFolders) {
                embedTargets.push({
                    path: path.join(childrenPath, childFolder.name, 'startEmbed.js'),
                    configKey: `${folder.name}_${childFolder.name}` // Creates "sparx_maths", "sparx_reader", etc.
                });
            }
        } else {
            // Standard behavior: root folder startEmbed.js
            embedTargets.push({
                path: path.join(folderPath, 'startEmbed.js'),
                configKey: folder.name // Uses just "languagenut", "seneca", etc.
            });
        }

        console.log(`Successfully loaded files from folder: ${folder.name}`);

        // Loop through however many targets were found for this folder
        for (const target of embedTargets) {
            if (!fs.existsSync(target.path)) {
                console.log(`Cannot find startEmbed.js at ${target.path}`);
                continue; 
            }

            // Fetch the channel using the specific target config key
            const channelID = configuredChannels[target.configKey];
            if (!channelID) {
                console.log(`Channel for ${target.configKey} is not configured`);
                continue; 
            }

            const channel = await client.channels.fetch(channelID);
            if (!channel) {
                console.log(`${target.configKey} channel not found`);
                continue;
            }

            const startEmbed = require(target.path);

            // Fetch recent messages to check for existing embeds
            const messages = await channel.messages.fetch({ limit: 50 });

            const existingMessage = messages.find(msg =>
                msg.author.id === client.user.id &&
                msg.components?.[0]?.components?.[0]?.components?.[0]?.data?.content === startEmbed.components[0].components[0].data.content
            );
            
            let embedMessage = existingMessage;

            if (!existingMessage) {
                console.log(`Sending persistent embed for ${target.configKey}`);
                
                embedMessage = await channel.send({
                    flags: MessageFlags.IsComponentsV2,
                    components: [startEmbed]
                });
            }

            if (startEmbedCollector) {
                await startEmbedCollector(embedMessage, folder.name);
            } else {
                console.log(`Cannot find collector for ${folder.name}`);
            }
        }
    }
}

async function DeleteVideos() {
    try {
        await fspromise.mkdir('videos', { recursive: true });
        const files = await fspromise.readdir('videos');
        if (files.length > 1) {
            console.log("Deleting files...");
            for (const file of files) {
                if (file == '.gitkeep') continue;
                const filePath = path.join('videos', file);
                await fspromise.unlink(filePath);
                console.log(`Deleted ${file}`);
            }
            console.log("All files deleted.");
        } else {
            console.log("No files to delete.");
        }
    } catch (err) {
        console.error("Error deleting files:", err);
    }
}

client.once("clientReady", async () => {
    console.log(`Bot has connected to Discord as ${client.user.tag}`);
    try { await require('./handlers/readerBookmarkletFlow.js').loadLoginBarEmojis(client); }
    catch (e) { console.error('[login-bar] Could not load server emojis:', e.message); }
    try { global.__eamDashboard?.setStatus({ bot:'Online', dmPanel:'Idle', reader:'Idle', maths:'Idle', database:'Connected', sessionActive:false }); } catch (_) {}

    // Register slash commands automatically every time the bot starts.
    // This happens after Discord authentication, so guild command registration
    // does not depend on a separate deployment command/process.
    try {
        const results = await registerForClient(client);
        const total = results.reduce((sum, result) => sum + result.count, 0);
        console.log(`[commands] Automatic registration finished. ${total} command registrations completed.`);
    } catch (e) {
        console.error(`[commands] Automatic registration ERROR: ${e.message}`);
    }

    try { await showAutocompChannels(client); } catch (e) { console.error('[channels] setup error:', e.message); }
    try { await sendStartedMessage(client); } catch (e) { console.error('[startup] status message error:', e.message); }
    try { await sendPersistentEmbeds(client); } catch (e) { console.error('[startup] persistent embeds skipped:', e.message); }
    try { await DeleteVideos(); } catch (e) { console.error('[startup] video cleanup skipped:', e.message); }
});

client.on('disconnect', () => console.log('Bot disconnected!'));

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return interaction.reply({ content: 'That command is not loaded yet. Try again in a few seconds.', flags: MessageFlags.Ephemeral });
    }
    // Prevent crash in DMs
    if (!interaction.guild) {
        return interaction.reply({
            content: 'This command can only be used in a server.',
            flags: MessageFlags.Ephemeral
        });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const isServerAdmin = member.permissions.has('Administrator') || interaction.guild.ownerId === interaction.user.id;
    const hasConfiguredAdminRole = configuredAdminRoles.some(roleId => member.roles.cache.has(roleId));
    // Commands are public by default. Only explicitly protected admin commands
    // below require Administrator/configured admin role.
    const adminOnlyCommands = new Set([
        'reset_slots', 'isolate', 'test_error', 'test_emojis', 'get_account',
        'restart', 'default_settings', 'shutdown', 'add_lifetime', 'audit',
        'resource_stats', 'update', 'reinstate', 'remove_main_account',
        'clear_mainaccounts'
    ]);
    const requiresAdmin = command.adminOnly === true || adminOnlyCommands.has(interaction.commandName);
    if (!isServerAdmin && !hasConfiguredAdminRole && requiresAdmin && !command.public) {
        return interaction.reply({
            content: 'Only admins can run that command, sowwy.',
            flags: MessageFlags.Ephemeral
        });
    }

    try { await command.execute(interaction, client); } catch (error) {
        console.error(`[command:${interaction.commandName}]`, error);
        const reply = { content: `Command failed: ${error.message || 'Unknown error'}`, flags: MessageFlags.Ephemeral };
        try { if (interaction.replied || interaction.deferred) await interaction.followUp(reply); else await interaction.reply(reply); } catch {}
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isMessageComponent()) return;
    if (interaction.customId === 'lumen_customize_dashboard') {
        try { await require('./handlers/dashboardCustomizer.js').open(interaction); }
        catch (error) {
            console.error('[dashboard-customizer] Could not open form:', error);
            const payload = { content: 'Could not open dashboard customisation. Please try again.', flags: MessageFlags.Ephemeral };
            try { if (interaction.replied || interaction.deferred) await interaction.followUp(payload); else await interaction.reply(payload); } catch {}
        }
        return;
    }
    if (interaction.customId.startsWith('lumen_custom_ui_') || interaction.customId.startsWith('lumen_feature_action_')) {
        try { await require('./handlers/dashboardCustomizer.js').handleComponent(interaction); }
        catch (error) {
            console.error('[dashboard-customizer] Component failed:', error);
            try { await interaction.reply({ content: 'That dashboard action failed. Please try again.', flags: MessageFlags.Ephemeral }); } catch {}
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    try {

        if (interaction.customId.startsWith('lumen_customize_submit_')) {
            await require('./handlers/dashboardCustomizer.js').handleModalSubmit(interaction);
            return;
        }

        if (interaction.customId.startsWith('lumen_jailbreak_')) {
            await require('./handlers/requestJailbreak.js').handleModalSubmit(interaction);
            return;
        }

        if (interaction.customId.startsWith('changeSettings')) {
            await processSettings(interaction);
            return;
        }

        if (interaction.customId.startsWith('queues_')) {
            await handleQueueInput(interaction);
            return;
        }

        if (interaction.customId.startsWith('lumen_')) {
            await require('./handlers/readerBookmarkletFlow.js').handleModalSubmit(interaction);
            return;
        }

        if (interaction.customId.startsWith('autocompleterModule_')) {
            const interactionSplit = interaction.customId.split('_');
            const action = interactionSplit[2];
            if (action.startsWith('login')) {
                const parent = seperateParentChild(interactionSplit[1]);
                const login = require(`./autocompleters/${parent.parent}/login.js`);
                const getTokenRequest = require(`./autocompleters/${parent.parent}/getTokenRequest.js`);
                const menu = require(`./autocompleters/${parent.parent}/menu.js`);
                let userSessions;
                if (!parent.child) {
                    userSessions = require(`./autocompleters/${parent.parent}/userSessions.js`);
                } else {
                    userSessions = require(`./autocompleters/${parent.parent}/children/${parent.child}/userSessions.js`);
                }
                await processLogin(interaction, parent.parent, login, getTokenRequest, userSessions, menu);
                return;
            }
    
            const part = interaction.customId
                .replace('autocompleterModule_', '') // sparx(science)_login
                .split('_')[0]                      // sparx(science)
                .split('(')[0];                    // sparx

            const modalExecutor = require(`./autocompleters/${part}/modalExecutor.js`);
            await modalExecutor(interaction);
            return;
        }

        if (interaction.customId.startsWith('set_slots')) {
            await interaction.deferUpdate({ flags: MessageFlags.Ephemeral });
            await changeSlots(interaction);
            return;
        }

        if (interaction.customId === 'handleSettings') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await settingsDisplayer(interaction);
            return;
        }

        if (interaction.customId === 'accountManager_service') {
            await interaction.deferUpdate({ flags: MessageFlags.Ephemeral });
            await updateAccountInteraction(interaction);
            return;
        }

        if (interaction.customId === 'view_accounts') {
            await viewSavedAccounts(interaction);
            return;
        }

        if (interaction.customId === 'change_master_password') {
            await changeMasterPassword(interaction);
            return;
        }

        if (interaction.customId.startsWith('main_account')) {
            if (interaction.customId.endsWith('configure')) {
                await mainAccountLogin(interaction);
            } else if (interaction.customId.endsWith('remove')) {
                await mainAccountLogin(interaction, true);
            }
            return;
        }

        if (interaction.customId === 'create_master_password') {
            await createAccount(interaction);
            return;
        }

        if (interaction.customId.startsWith('save_account')) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await saveAccount(interaction);
            return;
        }

        if (interaction.customId.startsWith('view_saved_accounts')) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await executeViewAccounts(interaction);
            return;
        }

    } catch (error) {
        const stack = error.stack ?? "No stack trace available";

        // Keep message under Discord's 2000 char limit
        const trimmedStack = stack.length > 1500
            ? stack.slice(0, 1500) + "\n... (truncated)"
            : stack;

        const errorMessage = {
            content: `⚠️ An error occurred:\n\`\`\`\n${error.message}\n\n${trimmedStack}\n\`\`\``,
            flags: MessageFlags.Ephemeral
        };

        try {
            await interaction.followUp(errorMessage);
        } catch {

        }
    }
});

client.on('messageCreate', async (message) => {
    await imageSolverHandler(message);
});

if (require.main === module) {
    client.login(token);
}
