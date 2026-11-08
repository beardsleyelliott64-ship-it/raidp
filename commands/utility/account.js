const { SlashCommandBuilder, TextInputStyle, ModalBuilder, MessageFlags, StringSelectMenuBuilder, LabelBuilder, TextInputBuilder, ComponentType, ButtonBuilder, ButtonStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { checkAccount, activateFreeTrial } = require('../../database/accounts');
const config = require('../../config.json');
const queueRanksPositions = config.queue_ranks;
const emojis = config.emojis;
const whatRole = require('../../utils/whatRole');
const formatTime = require('../../utils/formatTime');
const { name, colours } = require('../../config.json');
const fs = require('node:fs').promises; // Use the Promise-based fs API
const path = require('node:path');

async function getSettingsData() {
    const baseDir = path.join(process.cwd(), 'autocompleters');
    let results = [];
    
    // Create an internal helper function that CAN take parameters
    async function searchDirectory(currentDir) {
        let items;
        try {
            items = await fs.readdir(currentDir, { withFileTypes: true });
        } catch {
            // Silently return if the directory doesn't exist or permissions fail
            return;
        }

        const promises = [];

        for (const item of items) {
            const fullPath = path.join(currentDir, item.name);

            if (item.isDirectory()) {
                // Recursively call the HELPER function concurrently
                promises.push(searchDirectory(fullPath));
            } else if (item.isFile() && item.name === 'settings.json') {
                
                // 1. Get the path relative to the baseDir 
                // (e.g., returns "sparx/children/maths" or "sparx\children\maths" depending on OS)
                const relativeDir = path.relative(baseDir, currentDir);
                
                // 2. Split the path by the OS-specific separator (\ on Windows, / on Mac/Linux)
                const pathParts = relativeDir.split(path.sep);
                
                let combinedValue;
                
                // 3. If nested deep enough, grab the top folder and the immediate parent folder
                if (pathParts.length > 1) {
                    const topFolder = pathParts[0];                     // e.g., 'sparx'
                    const bottomFolder = pathParts[pathParts.length - 1]; // e.g., 'maths'
                    combinedValue = `${topFolder}_${bottomFolder}`;     // 'sparx_maths'
                } else {
                    // Fallback just in case a settings.json is directly inside a top-level folder
                    combinedValue = pathParts[0]; 
                }

                // Keep your original folderName logic for the label
                const folderName = path.basename(currentDir);
                const labelName = folderName.charAt(0).toUpperCase() + folderName.slice(1);

                results.push({
                    label: labelName,           // Stays as 'Maths'
                    value: combinedValue,      // Now 'sparx_maths'
                    emoji: emojis[combinedValue] // Now looks up emojis['sparx_maths']
                });
            }
        }
        
        // Wait for all subdirectories in this folder to finish searching
        await Promise.all(promises);
    }

    // Start the search and wait for the entire tree
    await searchDirectory(baseDir);

    return results;
}

async function getPlatformNames() {
    const baseDir = path.join(process.cwd(), 'autocompleters');
    let results = [];

    try {
        // Read only the direct contents of the autocompleters directory asynchronously
        const items = await fs.readdir(baseDir, { withFileTypes: true });

        for (const item of items) {
            // Only get the names of the parent folders, ignoring any stray files
            if (item.isDirectory()) {
                const folderName = item.name;
                
                // Capitalize the first letter (e.g., 'seneca' -> 'Seneca')
                const labelName = folderName.charAt(0).toUpperCase() + folderName.slice(1);

                results.push({
                    label: labelName,
                    value: folderName,
                    emoji: emojis[folderName] // Strictly relies on the dictionary, no fallback
                });
            }
        }
    } catch (error) {
        console.error("Failed to read autocompleters base directory:", error);
    }

    return results;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('account')
        .setDescription(`View your ${name} Account`),
    public: true,
    async execute(interaction) {
        const seperator = new SeparatorBuilder({
            spacing: SeparatorSpacingSize.Small
        });

        const roleID = whatRole(await interaction.guild.members.fetch(interaction.user.id));
        const userRole = Object.keys(queueRanksPositions).find(key => queueRanksPositions[key] === roleID) ?? null;
        const account = await checkAccount(interaction.user.id, userRole);

        if (account) {

            let totalUses = 0;
            let platformsUsed = '';
            let timeSaved = 0;
            let timeSavedPlatforms = '';
            for (const [name, platform] of Object.entries(account.total_usage)) {
                totalUses += platform.total_uses;
                platformsUsed += `${name.charAt(0).toUpperCase() + name.slice(1)}: ${platform.total_uses}\n`;
                timeSaved += platform.time_saved;
                timeSavedPlatforms += `${name.charAt(0).toUpperCase() + name.slice(1)}: ${formatTime(platform.time_saved)}\n`;
            }

            let usages = '';
            for (const [platform, usage] of Object.entries(account.uses)) {
                usages += `${platform.charAt(0).toUpperCase() + platform.slice(1)}: ${usage.length}/${account.slots}\n`;
            }

            const statsBtn = new ButtonBuilder()
                .setCustomId('view_stats')
                .setLabel('View Stats')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(emojis.stats);

            const savedBtn = new ButtonBuilder()
                .setCustomId('manage_saved_accounts')
                .setLabel('Saved Accounts')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(emojis.accounts);

            const mainBtn = new ButtonBuilder()
                .setCustomId('configure_main_accounts')
                .setLabel('Main Accounts')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(emojis.main_accounts);

            const settingBtn = new ButtonBuilder()
                .setCustomId('settings')
                .setLabel('Settings')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(emojis.settings);

            const freetrialBtn = new ButtonBuilder()
                .setCustomId('activate_free_trial')
                .setLabel('Activate Free Trial')
                .setEmoji(emojis.tick)
                .setStyle(ButtonStyle.Success);

            const row = new ActionRowBuilder().addComponents(statsBtn, savedBtn);
            const row2 = new ActionRowBuilder().addComponents();
            if (config.require_mainaccounts) {
                row2.addComponents(mainBtn);
            }
            row2.addComponents(settingBtn);
            if (account.free_trial_start === null && !account.license) {
                row2.addComponents(freetrialBtn);
            }

            const container = new ContainerBuilder()
                .setAccentColor(colours.onyx)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## <@${interaction.user.id}>'s Account\n**Total Usage**: You have used the bot a total of **${totalUses}** times.\n**Slots Limit**: You have an account slots limit of **${account.slots}**.\n**Account Rank**: Your current account rank is **${account.license ?? 'None'}**.\n### Account Slots (Last 24 Hours)\n\`\`\`js\n${usages || 'No slots used in the past 24 Hours'}\`\`\``)
                )
                .addSeparatorComponents(
                    seperator
                )
                .addActionRowComponents(
                    row,
                    row2
                );

            const message_sent = await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container],
                fetchReply: true
            });

            const collector = message_sent.createMessageComponentCollector({
                componentType: ComponentType.Button
            });

            collector.on('collect', async (buttonInteraction) => {

                if (buttonInteraction.customId === 'settings') {
                    const modal = new ModalBuilder()
                        .setCustomId('handleSettings')
                        .setTitle('Settings for Platform...');

                    const generalSetting = { label: 'General', value: 'general'};
                    
                    // Added await since getSettingsData is now async
                    const platformSettings  = [generalSetting, ...(await getSettingsData())]; 
                    
                    const sparxInput = new StringSelectMenuBuilder()
                        .setCustomId('platform')
                        .setPlaceholder("Platform")
                        .addOptions(
                            ...platformSettings
                        );

                    const typeLabel = new LabelBuilder({
                        label: 'Platform',
                        component: sparxInput
                    });
                    modal.addLabelComponents(typeLabel);
                    await buttonInteraction.showModal(modal);
                    return;
                    // await handleSettings(buttonInteraction);
                }

                await buttonInteraction.deferUpdate();

                if (buttonInteraction.customId === 'view_stats') {
                    const container = new ContainerBuilder()
                        .setAccentColor(colours.onyx)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## 📊 Statistics\n**Total Usage**: You have used the bot a total of **${totalUses}** times.\n**Time Saved**: You have saved **${formatTime(timeSaved)}** of time.\n### Platform Usage\n\`\`\`js\n${platformsUsed}\`\`\`\n### Time Saved\n\`\`\`js\n${timeSavedPlatforms}\`\`\``)
                        );

                    await buttonInteraction.followUp({
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                        components: [container]
                    });
                } else if (buttonInteraction.customId === 'manage_saved_accounts') {
                    const statsBtn = new ButtonBuilder()
                        .setCustomId("view_accounts")
                        .setLabel('View Accounts')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji(emojis.accounts);

                    const savedBtn = new ButtonBuilder()
                        .setCustomId("change_master_password")
                        .setLabel('Change Master Password')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji(emojis.key);

                    const row = new ActionRowBuilder().addComponents(statsBtn, savedBtn);

                    // 3. Assemble everything into the main container
                    const container = new ContainerBuilder()
                        .setAccentColor(colours.onyx)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## 🗂️ Saved Accounts\nManage all your saved accounts. You can save accounts by clicking on the \`Save Account\` button at the homework selection on one of our services, this option only appears if you **did not** login with cookies.\n### Warning: Changing your Master Password will delete all saved accounts!`)
                        )
                        .addSeparatorComponents(
                            seperator
                        )
                        .addActionRowComponents(
                            row
                        );

                    const message_sent = await buttonInteraction.followUp({
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                        components: [container],
                        fetchReply: true
                    });

                    const collector = message_sent.createMessageComponentCollector({
                        componentType: ComponentType.Button
                    });

                    collector.on('collect', async (accountInteraction) => {
                        const buttons = [];
                        const schoolInput = new TextInputBuilder()
                            .setCustomId('master_password')
                            .setLabel("Master Password")
                            .setStyle(TextInputStyle.Short);

                        buttons.push(schoolInput);
                        if (accountInteraction.customId === 'view_accounts') {
                            const modal = new ModalBuilder()
                                .setCustomId('view_accounts')
                                .setTitle('Saved Accounts Login');

                            for (const button of buttons) {
                                modal.addComponents(new ActionRowBuilder().addComponents(button));
                            }

                            await accountInteraction.showModal(modal);
                        } else if (accountInteraction.customId === 'change_master_password') {
                            const modal = new ModalBuilder()
                                .setCustomId('change_master_password')
                                .setTitle('Change Master Password');

                            for (const button of buttons) {
                                modal.addComponents(new ActionRowBuilder().addComponents(button));
                            }

                            await accountInteraction.showModal(modal);
                        }

                    });
                } else if (buttonInteraction.customId === 'configure_main_accounts') {
                    let configured = '';
                    const mainAccountsConfigured = [];
                    for (const mainAccount of Object.keys(account.main_accounts)) {
                        configured += `${mainAccount.charAt(0).toUpperCase() + mainAccount.slice(1)}: Configured\n`;
                        mainAccountsConfigured.push(mainAccount);
                    }

                    // Added await since getPlatformNames is now async
                    const platforms = await getPlatformNames(); 
                    
                    const filteredPlatforms = platforms.filter(item => !mainAccountsConfigured.includes(item.value));
                    const statsBtn = new ButtonBuilder()
                        .setCustomId("add_main_account")
                        .setLabel('Add Main Account')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji(emojis.main_accounts);

                    const cookieBtn = new ButtonBuilder()
                        .setCustomId("add_main_account_cookie")
                        .setLabel('Add Main Account')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji(emojis.cookies);

                    const row = new ActionRowBuilder().addComponents(statsBtn, cookieBtn);

                    const container = new ContainerBuilder()
                        .setAccentColor(colours.onyx)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## 🔒 Configure Main Accounts\nConfigure your main accounts for each platform. Main accounts do **not** count towards your accounts slots. **Your main accounts should only be your own personal accounts**, this is so you can still do *your* homework if you use up your daily slots and it is also used to prevent free trial abusing.\n### Main Accounts Configured\n\`\`\`js\n${configured || 'You have no Main Accounts Configured'}\`\`\`\n### Warning: Configuring a Main Account is irreversible!`)
                        )
                        .addSeparatorComponents(
                            seperator
                        );

                    if (filteredPlatforms.length) {
                        container.addActionRowComponents(
                            row
                        );
                    }

                    const message_sent = await buttonInteraction.followUp({
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                        components: [container],
                        fetchReply: true
                    });

                    const collector = message_sent.createMessageComponentCollector({
                        componentType: ComponentType.Button
                    });

                    collector.on('collect', async (accountInteraction) => {
                        
                        const modal = new ModalBuilder()
                            .setCustomId('main_account_configure')
                            .setTitle('Main Account Configuration');

                        const sparxInput = new StringSelectMenuBuilder()
                            .setCustomId('platform')
                            .setPlaceholder("Platform")
                            .addOptions(
                                ...filteredPlatforms
                            );

                        const sparxLabel = new LabelBuilder({
                            label: 'Platform',
                            component: sparxInput
                        });

                        modal.addLabelComponents(sparxLabel);

                        if (accountInteraction.customId === 'add_main_account') { 
                            const schoolInput = new TextInputBuilder()
                                .setCustomId('school')
                                .setLabel("School")
                                .setPlaceholder('If needed for login')
                                .setRequired(false)
                                .setStyle(TextInputStyle.Short);

                            const emailInput = new TextInputBuilder()
                                .setCustomId('username')
                                .setLabel("Username")
                                .setStyle(TextInputStyle.Short);

                            const passwordInput = new TextInputBuilder()
                                .setCustomId('password')
                                .setLabel("Password")
                                .setStyle(TextInputStyle.Short);

                            const typeInput = new StringSelectMenuBuilder()
                                .setCustomId('type')
                                .setPlaceholder("Normal/Microsoft/Google (If needed for login)")
                                .addOptions(
                                    { label: "Normal", value: "Normal", emoji: emojis.sparx },
                                    { label: "Microsoft", value: "Microsoft", emoji: emojis.microsoft },
                                    { label: "Google", value: "Google", emoji: emojis.google }
                                );

                            const buttons = [schoolInput, emailInput, passwordInput];
                            const typeLabel = new LabelBuilder({
                                label: 'Login Type',
                                component: typeInput
                            });

                            for (const button of buttons) {
                                modal.addComponents(new ActionRowBuilder().addComponents(button));
                            }
                            modal.addLabelComponents(typeLabel);
                        } else if (accountInteraction.customId === 'add_main_account_cookie') {
                            const usernameInput = new TextInputBuilder()
                                .setCustomId('cookie')
                                .setLabel('Cookie')
                                .setStyle(TextInputStyle.Paragraph)
                                .setRequired(true);

                            const usernameRow = new ActionRowBuilder().addComponents(usernameInput);
                            modal.addComponents(usernameRow);
                        }

                        await accountInteraction.showModal(modal);
                    });

                } else if (buttonInteraction.customId === 'activate_free_trial') {
                    if (!Object.keys(account.main_accounts).length) {
                        const container = new ContainerBuilder()
                            .setAccentColor(colours.light_red)
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`### No Main Accounts Exist\nYou have no main accounts configured. Please configure at least one main account to activate your free trial. If you have *just* configured a main account, please run the command \`/account\` again.`)
                            );

                        await buttonInteraction.followUp({
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                            components: [container]
                        });

                        return;
                    }
                    const freeTrailActivatedSuccess = await activateFreeTrial(buttonInteraction.user.id);
                    if (freeTrailActivatedSuccess) {
                        const freetrialRoleId = queueRanksPositions["free-trial"];

                        try {
                            await interaction.member.roles.add(freetrialRoleId);
                        } catch (error) {
                            console.error(error);
                        }

                        const container = new ContainerBuilder()
                            .setAccentColor(colours.light_green)
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`### Free Trial Activated\nYour 3-day Free Trial for ${name} has been successfully activated!`)
                            );

                        await buttonInteraction.followUp({
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                            components: [container]
                        });
                    } else {

                        const container = new ContainerBuilder()
                            .setAccentColor(colours.light_red)
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`### Free Trial Already Exists\nYou already activated your Free Trial.`)
                            );

                        await buttonInteraction.followUp({
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                            components: [container]
                        });
                    }
                }
            });
        } else {
            const statsBtn = new ButtonBuilder()
                .setCustomId('agree')
                .setLabel('I Agree')
                .setEmoji(emojis.tick)
                .setStyle(ButtonStyle.Success);

            const row = new ActionRowBuilder().addComponents(statsBtn);

            // 3. Assemble everything into the main container
            const container = new ContainerBuilder()
                .setAccentColor(colours.onyx)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## Create an Account\nBy creating an account, you agree to the Terms of Service of ${name} which can be found at ${config.tos_channel}`)
                )
                .addSeparatorComponents(
                    seperator
                )
                .addActionRowComponents(
                    row
                );

            const message_sent = await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container],
                fetchReply: true
            });

            const collector = message_sent.createMessageComponentCollector({
                componentType: ComponentType.Button
            });

            collector.on('collect', async (buttonInteraction) => {
                if (buttonInteraction.customId === 'agree') {
                    await buttonInteraction.deferUpdate();

                    const statsBtn = new ButtonBuilder()
                        .setCustomId('create_master_password')
                        .setLabel('Create Master Password')
                        .setEmoji(emojis.key)
                        .setStyle(ButtonStyle.Primary);

                    const row = new ActionRowBuilder().addComponents(statsBtn);
                    // 3. Assemble everything into the main container
                    const container = new ContainerBuilder()
                        .setAccentColor(colours.onyx)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## Create Master Password\nCreate a Master Password that will be used whenever you choose to save an account one of our services. The option to save an account will be provided at the homework selection assuming you **did not** login with cookies. You will be prompted to input your Master Password whenever you try to save an account.\n\nThe Master Password stored in the Database is hashed and all saved account data is encrypted. Consequently, we **cannot view your saved accounts or master password** meaning all saved accounts are deleted when changing the Master Password.`)
                        )
                        .addSeparatorComponents(
                            seperator
                        )
                        .addActionRowComponents(
                            row
                        );

                    await buttonInteraction.editReply({
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                        components: [container]
                    });
                } else if (buttonInteraction.customId === 'create_master_password') {
                    const buttons = [];
                    const schoolInput = new TextInputBuilder()
                        .setCustomId('master_password')
                        .setLabel("Master Password")
                        .setStyle(TextInputStyle.Short);

                    buttons.push(schoolInput);
                    const modal = new ModalBuilder()
                        .setCustomId('create_master_password')
                        .setTitle('Saved Accounts Login');

                    for (const button of buttons) {
                        modal.addComponents(new ActionRowBuilder().addComponents(button));
                    }

                    await buttonInteraction.showModal(modal);
                }
            });
        }
    },
};