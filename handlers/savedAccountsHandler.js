const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, StringSelectMenuOptionBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { checkAccounts, deleteAccounts, addAccount } = require('../database/saved_accounts');
const { checkAccount } = require('../database/accounts');
const hashCompare = require('../utils/hashCompare');
const { name, colours } = require('../config.json');
const seperateParentChild = require('../utils/seperateParentChild');
const processLogin = require('../generic/processLogin.js');

async function handleSavedAccounts(interaction, action, platform) {
    if (action === 'view') {
        const account = await checkAccount(interaction.user.id);

        // If saved accounts are disabled, or enabled-without-password (empty string), proceed immediately
        if (!account.master_password) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return await executeViewAccounts(interaction);
        }

        // master_password is present (hashed) -> require it via modal
        const modal = new ModalBuilder()
            .setCustomId('view_saved_accounts_'+platform)
            .setTitle('Saved Accounts Login');

        const buttons = [];
        const schoolInput = new TextInputBuilder()
            .setCustomId('master_password')
            .setLabel("Master Password")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        buttons.push(schoolInput);
        for (const button of buttons) {
            modal.addComponents(new ActionRowBuilder().addComponents(button));
        }

        await interaction.showModal(modal);
    }
    else if (action === 'delete') {
        await deleteAccounts(interaction.user.id);

        const container = new ContainerBuilder()
            .setAccentColor(colours.onyx)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# Accounts Deleted\nAll accounts saved by you have been deleted!`)
            );

        await interaction.reply({ 
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });

    }
}

async function executeViewAccounts(interaction) {
    const master_password = interaction.fields ? interaction.fields.getTextInputValue('master_password') : '';

    const accounts = await checkAccounts(interaction.user.id, master_password);

    if (accounts === false) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# Password was Incorrect\nThe password to your saved accounts was incorrect!`)
            );

        await interaction.followUp({ 
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });
        return;
    } else if (accounts === null || !accounts.length) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# No Accounts Saved\nYou have no accounts saved!`)
            );

        await interaction.followUp({ 
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });
        return;
    }

    const platform = interaction.customId.split('_')[3];
    const platValue = seperateParentChild(platform);
    // console.log(accounts);

    const select = new StringSelectMenuBuilder()
        .setCustomId(`autocompleterModule_${platform}_loginSaved`)
        .setPlaceholder('Choose an account...');

    const accountsView = [];
    for (const account of accounts) {
        if (account?.app === platValue.parent) {
            const option = new StringSelectMenuOptionBuilder()
                .setLabel(account.username)
                .setValue(account.username);
            
            select.addOptions(option);
            accountsView.push(account);
        }
    }

    if (!select.options.length) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# No Accounts Saved\nYou have no accounts saved!`)
            );

        await interaction.followUp({ 
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });
        return;
    }

    const row = new ActionRowBuilder().addComponents(select);

    const container = new ContainerBuilder()
        .setAccentColor(colours.onyx)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# Accounts\nAll saved accounts for the specific service requested are listed below!`)
        );

    const message_sent = await interaction.editReply({ 
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container, row]
    });

    const collector = message_sent.createMessageComponentCollector({
        time: 600_000
    });

    let interactedWith = false;
    collector.on('collect', async (componentInteraction) => {
        if (interactedWith) return;
        interactedWith = true;
        // await componentInteraction.deferUpdate();
        const account = accountsView.find(value => value.username === componentInteraction.values[0]);
        componentInteraction.loginDetails = account;
        // console.log(componentInteraction.customId);
        const login = require(`../autocompleters/${platValue.parent}/login.js`);
        const getTokenRequest = require(`../autocompleters/${platValue.parent}/getTokenRequest.js`);
        const menu = require(`../autocompleters/${platValue.parent}/menu.js`);
        let userSessions;
        if (!platValue.child) {
            userSessions = require(`../autocompleters/${platValue.parent}/userSessions.js`);
        } else {
            userSessions = require(`../autocompleters/${platValue.parent}/children/${platValue.child}/userSessions.js`);
        }
        await processLogin(componentInteraction, platValue.parent, login, getTokenRequest, userSessions, menu);
        // const modalExecutor = require(`../autocompleters/${platValue.parent}/modalExecutor`);
        // await modalExecutor(componentInteraction);
	});

}

async function saveAccount(interaction) {
    const master_password = interaction.fields.getTextInputValue('master_password');
    const account = await checkAccount(interaction.user.id);

    let passwordCorrect = false;
    if (account.master_password === null) {
        if (!master_password) passwordCorrect = true;
    } else {
        if (await hashCompare(master_password, account.master_password)) passwordCorrect = true;
    }

    if (!passwordCorrect) {
        const container = new ContainerBuilder().setAccentColor(colours.light_red).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Password was Incorrect\nThe password you entered was incorrect!`));
        await interaction.followUp({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] });
        return;
    }

    let accounts = await checkAccounts(interaction.user.id, master_password) ?? [];
    if (accounts === false) {
        // This case should ideally not happen if hash check passed, unless data corruption
        const container = new ContainerBuilder().setAccentColor(colours.light_red).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Error Decrypting Accounts\nCould not decrypt accounts despite correct password.`));
        await interaction.followUp({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] });
        return;
    }
    const platform = interaction.customId.split('_')[2];
    const platValue = seperateParentChild(platform);
    // console.log(accounts);
    accounts = accounts.filter(value => value.app === platValue.parent);
    let userSessions;
    if (!platValue.child) {
        userSessions = require(`../autocompleters/${platValue.parent}/userSessions`);
    } else {
        userSessions = require(`../autocompleters/${platValue.parent}/children/${platValue.child}/userSessions`);
    }
    const loginDetails = (userSessions.get(interaction.user.id)).loginDetails;

    if (accounts.length >= 25) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# Account Max Reached\nYou cannot have more than 25 accounts saved!`)
            );

        await interaction.followUp({ 
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });
        return;
    }

    const emailExists = accounts.some(user => user.username === loginDetails.username);
    if (emailExists) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# Account already Saved\nThe account you tried to save is already saved to your accounts!`)
            );

        await interaction.followUp({ 
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });
        return;
    }

    // const sparxList = ['reader', 'maths', 'science'];
    // if (sparxList.includes(loginsSavedTempAccount[interaction.user.id].app)) loginsSavedTempAccount[interaction.user.id].app = 'sparx';
    // console.log(loginDetails);
    await addAccount(interaction.user.id, loginDetails, master_password);

    const container = new ContainerBuilder()
        .setAccentColor(colours.light_green)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# Account Saved\nYour account has been saved to ${name}!`)
        );

    await interaction.followUp({ 
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container]
    });
}

module.exports = { handleSavedAccounts, executeViewAccounts, saveAccount };