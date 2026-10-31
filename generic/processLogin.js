// language: JavaScript, file: generic/processLogin.js
const { MessageFlags, AttachmentBuilder, FileBuilder, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const loginWrapper = require('../utils/loginWrapper.js');
const { colours } = require('../config.json');

function getIfExists(fields, id) {
    return fields.fields.has(id) ? fields.getTextInputValue(id) : undefined;
}

async function processLogin(interaction, platform, login, getTokenRequest, userSessions, menu) {
    // Ack immediately — modal needs deferReply, component needs deferUpdate.
    // Skip if already acked (saved-accounts collector defers first to beat the 3s window).
    if (!interaction.deferred && !interaction.replied) {
        if (interaction.isModalSubmit()) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } else {
            await interaction.deferUpdate();
        }
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

    } else if (interaction.customId.endsWith('_loginSaved') || interaction.loginDetails) {
        const { school, username, password, type } = interaction.loginDetails;
        loginDetails = { app: platform, username, password, ...(school && { school }), ...(type && { type }) };

    } else if (interaction.customId.endsWith('_loginCookie')) {
        loginDetails = { app: platform, cookie: interaction.fields.getTextInputValue('cookie') };
    }

    // Helper: always succeeds — falls back through followUp → plain text
    async function send(opts) {
        try {
            if (interaction.deferred || interaction.replied) {
                return await interaction.editReply(opts);
            }
            return await interaction.reply({ ...opts, flags: MessageFlags.Ephemeral });
        } catch {
            try { return await interaction.followUp({ ...opts, fetchReply: false }); } catch {}
        }
    }

    await send({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [new ContainerBuilder()
            .setAccentColor(colours.onyx)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Logging in… :hourglass:\nContacting ${platform}…`))],
    });

    let authToken, cookies, sessionResults = {};

    try {
        if (!loginDetails.cookie) {
            sessionResults = await loginWrapper(() => login(loginDetails));
            authToken = sessionResults.authToken;
            cookies   = sessionResults.cookies;
        } else {
            authToken = await getTokenRequest(loginDetails.cookie);
            cookies   = loginDetails.cookie;
        }
    } catch (err) {
        await send({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [new ContainerBuilder()
                .setAccentColor(colours.light_red)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### ❌ Login Error\n\`${err.message}\``
                ))],
        });
        return;
    }

    if (sessionResults.status === 'error' && sessionResults.message === 'No School Found') {
        await send({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [new ContainerBuilder()
                .setAccentColor(colours.light_red)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### ❌ School Not Found\n` +
                    `Go to https://selectschool.sparx-learning.com/?app=sparx_learning and search for your school. ` +
                    `Use the exact text you searched with. Remove any \`'\` from the name.`
                ))],
        });
        return;
    }

    if (!authToken || authToken.length < 50) {
        // Try with log attachment, fall back to plain text
        const logs = sessionResults?.logs ?? 'No logs available.';
        try {
            const attachment = new AttachmentBuilder(Buffer.from(logs, 'utf8'), { name: 'logs.txt' });
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [new ContainerBuilder()
                    .setAccentColor(colours.light_red)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `### ❌ Login Failed\nCheck your credentials and try again. Logs attached.`
                    ))
                    .addFileComponents(new FileBuilder().setURL('attachment://logs.txt'))],
                files: [attachment],
            });
        } catch {
            // Attachment failed — send plain text error
            await send({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [new ContainerBuilder()
                    .setAccentColor(colours.light_red)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `### ❌ Login Failed\nCheck your credentials and try again.\n\n` +
                        `**Logs:**\n\`\`\`\n${logs.slice(0, 1800)}\n\`\`\``
                    ))],
            });
        }
        return;
    }

    await userSessions.createNewSession(interaction, loginDetails, authToken, cookies);

    await send({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [new ContainerBuilder()
            .setAccentColor(colours.light_green)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ✅ Login Successful\nLoading your session…`))],
    });

    const userSession = userSessions.get(interaction.user.id);
    await menu(userSession);
}

module.exports = processLogin;
