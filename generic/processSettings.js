const getOptionalUserSession = require('../utils/getOptionalUserSession.js');
const seperateParentChild = require('../utils/seperateParentChild.js');
const { updateDB } = require('../database/general');
const { MessageFlags } = require('discord.js');
const { handleApiKeyRequest } = require('../handlers/apikeyHandler.js');
const { updateSettingsEmbed } = require('./updateSettingsEmbeds');

async function processSettings(interaction) {
    await interaction.deferUpdate();
    const platform = seperateParentChild(interaction.customId.split('_')[1]);
    if (platform.parent === 'general') {
        await handleApiKeyRequest(interaction);
        return;
    }
    const platformString = platform.child ? `${platform.parent}_${platform.child}` : `${platform.parent}`;
    const platformSettingsString = platform.child ? `${platform.parent}_${platform.child}_settings` : `${platform.parent}_settings`;

    const action = interaction.customId.split('_').slice(2).join('_');
    let userSessions;
    let userSession;
    let settingsConfiguration;
    if (platform.child) {
        userSessions = require(`../autocompleters/${platform.parent}/children/${platform.child}/userSessions`);
        settingsConfiguration = require(`../autocompleters/${platform.parent}/children/${platform.child}/settings.json`);
    } else {
        userSessions = require(`../autocompleters/${platform.parent}/userSessions`);
        settingsConfiguration = require(`../autocompleters/${platform.parent}/settings.json`);
    }
    userSession = await getOptionalUserSession(userSessions.get(interaction.user.id), interaction.user.id, platform.parent, platform.child);

    const settingView = settingsConfiguration.settings[action];
    if (!settingView || !Array.isArray(settingView.inputs)) {
        await interaction.followUp({ content: '❌ This setting is unavailable.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
    }
    
    // 1. Clone the current settings so we don't mutate state if a constraint fails
    const proposedSettings = JSON.parse(JSON.stringify(userSession.settings || {}));

    for (const input of settingView.inputs) {
        let data;
        if (input.type === 'number') {
            data = Number(interaction.fields.getTextInputValue(input.id));
            if (isNaN(data) || (input.valueRange && ((data < input.valueRange.min) || (data > input.valueRange.max)))) {
                return; // Fails boundary validation
            }
        } else if (input.type === 'text') {
            data = interaction.fields.getTextInputValue(input.id);
        } else if (input.type === 'choice') {
            data = interaction.fields.getField(input.id).values[0];
        }
        if (input.boolean) data = data === 'true';

        // Apply changes to the proposed settings
        if (input.inside) {
            if (!proposedSettings[input.inside]) proposedSettings[input.inside] = {};
            proposedSettings[input.inside][input.id] = data; 
        } else {
            proposedSettings[input.id] = data;
        }
    }

    // 2. Evaluate Global Constraints
    if (settingsConfiguration.constraints && settingsConfiguration.constraints.length > 0) {
        // Flatten the proposed settings object so nested variables are accessible by ID 
        // (e.g. proposedSettings.time.min -> flatSettings.min)
        const flatSettings = {};
        for (const key in proposedSettings) {
            if (typeof proposedSettings[key] === 'object' && proposedSettings[key] !== null) {
                for (const subKey in proposedSettings[key]) {
                    flatSettings[subKey] = proposedSettings[key][subKey];
                }
            } else {
                flatSettings[key] = proposedSettings[key];
            }
        }

        const keys = Object.keys(flatSettings);
        const values = Object.values(flatSettings);

        for (const constraint of settingsConfiguration.constraints) {
            try {
                // Dynamically build a function using our setting IDs as variable names
                const evaluate = new Function(...keys, `return ${constraint};`);
                const isValid = evaluate(...values);
                
                // 3. Abort update if constraints aren't met
                if (!isValid) {
                    await interaction.followUp({ 
                        content: `❌ **Failed to update:** The requirement \`${constraint}\` was not met.`, 
                        flags: MessageFlags.Ephemeral 
                    });
                    return; 
                }
            } catch (error) {
                console.error(`Error evaluating constraint: ${constraint}`, error);
                await interaction.followUp({ 
                    content: `❌ **Error:** An issue occurred while evaluating constraints.`, 
                    flags: MessageFlags.Ephemeral 
                });
                return;
            }
        }
    }

    // 4. Overwrite session settings with validated proposed settings
    userSession.settings = proposedSettings;
    
    await updateDB('accounts', { [platformSettingsString]: userSession.settings }, 'discord_id', interaction.user.id);
    await userSession.updateEmbed();
    await updateSettingsEmbed(interaction, platformString);
}

module.exports = processSettings;