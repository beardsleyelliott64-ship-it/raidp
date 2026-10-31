// language: JavaScript, file: generic/processLogin.js
const { MessageFlags, AttachmentBuilder, FileBuilder, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const loginWrapper = require('../utils/loginWrapper.js');
const { colours } = require('../config.json');

function getIfExists(fields, id) {
    return fields.fields.has(id) ? fields.getTextInputValue(id) : undefined;
}

async function processLogin(interaction, platform, login, getTokenRequest, userSessions, menu) {
    // Ack immediately — modal submit needs deferReply, component needs deferUpdate.
    if (interaction.isModalSubmit()) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
        await interaction.deferUpdate();
    }

    let loginDetails = { app: platform };

    if (interaction.customId.endsWith('_login')) {
        const school   = getIfExists(interaction.fields, 'school');
        const username = interaction.fields.getTextInputValue('username');
        const password = interaction.fields.getTextInputValue('password');

        let type;
        if (interaction.fields.fields.has('type_value')) {
            type = interaction.fields.getTextInputValue('type_value') || undefined;
        } else if (interaction.fields.fields.has('type')) {
            type = interaction.fields.getTextInputValue('type') || undefined;
        }

        loginDetails = { app: platform, username, password, ...(school && { school }), ...(type && { type }) };

    } else if (interaction.customId.endsWith('_loginSaved')) {
        const { school, username, password, type } = interaction.loginDetails;
        loginDetails = { app: platform, username, password, ...(school && { school }), ...(type && { type }) };

    } else if (interaction.customId.endsWith('_loginCookie')) {
        loginDetails = { app: platform, cookie: interaction.fields.getTextInputValue('cookie') };
    }

    // Loading state — always use followUp so we never conflict with prior editReply state
    const loadingContainer = new ContainerBuilder()
        .setAccentColor(colours.onyx)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### Logging in… :hourglass:\nContacting ${platform}…`)
        );

    const loadingMsg = await interaction.followUp({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [loadingContainer],
        fetchReply: true,
    });

    async function updateLoading(opts) {
        try { await loadingMsg.edit(opts); } catch { await interaction.followUp({ ...opts, fetchReply: false }); }
    }

    let authToken, cookies, sessionResults = {};

    if (!loginDetails.cookie) {
        sessionResults = await loginWrapper(() => login(loginDetails));
        authToken = sessionResults.authToken;
        cookies   = sessionResults.cookies;
    } else {
        authToken = await getTokenRequest(loginDetails.cookie);
        cookies   = loginDetails.cookie;
    }

    if (sessionResults.status === 'error' && sessionResults.message === 'No School Found') {
        await updateLoading({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [new ContainerBuilder()
                .setAccentColor(colours.light_red)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### ❌ School Not Found\n` +
                    `Go to https://selectschool.sparx-learning.com/?app=sparx_learning, search for your school, and use the exact text as your school name. Remove any \`'\` characters.`
                ))],
        });
        return;
    }

    if (!authToken || authToken.length < 50) {
        const attachment = new AttachmentBuilder(Buffer.from(sessionResults?.logs ?? '', 'utf8'), { name: 'logs.txt' });
        try {
            await updateLoading({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [new ContainerBuilder()
                    .setAccentColor(colours.light_red)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ❌ Login Failed\nCheck your credentials and try again.`))
                    .addFileComponents(new FileBuilder().setURL('attachment://logs.txt'))],
                files: [attachment],
            });
        } catch {
            await interaction.followUp({
                content: '❌ Login failed — check your credentials.',
                flags: MessageFlags.Ephemeral,
            });
        }
        return;
    }

    await userSessions.createNewSession(interaction, loginDetails, authToken, cookies);

    await updateLoading({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [new ContainerBuilder()
            .setAccentColor(colours.light_green)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ✅ Login Successful\nLoading your session…`))],
    });

    const userSession = userSessions.get(interaction.user.id);
    await menu(userSession);
}

module.exports = processLogin;
