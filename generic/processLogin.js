// language: JavaScript, file: generic/processLogin.js
const { MessageFlags, AttachmentBuilder, FileBuilder, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const loginWrapper = require('../utils/loginWrapper.js');
const { colours } = require('../config.json');

function getIfExists(fields, id) {
    return fields.fields.has(id)
        ? fields.getTextInputValue(id)
        : undefined;
}

async function processLogin(interaction, platform, login, getTokenRequest, userSessions, menu) {
    // Modal submits must use deferReply; message components use deferUpdate.
    if (interaction.isModalSubmit()) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
        await interaction.deferUpdate();
    }

    let loginDetails = { app: platform };

    if (interaction.customId.endsWith('_login')) {
        const school    = getIfExists(interaction.fields, 'school');
        const username  = interaction.fields.getTextInputValue('username');
        const password  = interaction.fields.getTextInputValue('password');

        // type_value = pre-filled TextInput from loginHandler (legacy path)
        // type       = TextInput from dashboard.js (new path)
        let type;
        if (interaction.fields.fields.has('type_value')) {
            type = interaction.fields.getTextInputValue('type_value') || undefined;
        } else if (interaction.fields.fields.has('type')) {
            // Dashboard sends 'type' as a TextInput (not SelectMenu) — read as text
            const typeRaw = interaction.fields.getTextInputValue('type');
            type = typeRaw || undefined;
        }

        loginDetails = {
            app: platform,
            username,
            password,
            ...(school && { school }),
            ...(type  && { type }),
        };

    } else if (interaction.customId.endsWith('_loginSaved')) {
        const { school, username, password, type } = interaction.loginDetails;
        loginDetails = {
            app: platform,
            username,
            password,
            ...(school && { school }),
            ...(type   && { type }),
        };

    } else if (interaction.customId.endsWith('_loginCookie')) {
        const cookie = interaction.fields.getTextInputValue('cookie');
        loginDetails = { app: platform, cookie };
    }

    const loadingContainer = new ContainerBuilder()
        .setAccentColor(colours.onyx)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### Logging In... :hourglass:\nAttempting to log in to your account...`)
        );

    // Use followUp when deferred via deferReply (modal path), editReply when via deferUpdate
    async function send(opts) {
        if (interaction.isModalSubmit()) {
            return interaction.editReply(opts);
        }
        return interaction.editReply(opts);
    }

    await send({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

    let authToken;
    let cookies;
    let sessionResults = {};

    if (!loginDetails.cookie) {
        sessionResults = await loginWrapper(() => login(loginDetails));
        authToken = sessionResults.authToken;
        cookies   = sessionResults.cookies;
    } else {
        authToken = await getTokenRequest(loginDetails.cookie);
        cookies   = loginDetails.cookie;
    }

    if (sessionResults.status === 'error' && sessionResults.message === 'No School Found') {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### ❌ Login Failed\nUnable to find your school.\n\n> Go to https://selectschool.sparx-learning.com/?app=sparx_learning and search for your school. Copy the exact text you used — the bot picks the first result. Remove any \`'\` and check spelling.`
                )
            );
        await send({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] });
        return;
    }

    if (!authToken || authToken.length < 50) {
        const attachment = new AttachmentBuilder(
            Buffer.from(sessionResults?.logs ?? '', 'utf8'),
            { name: 'sessionResults.txt' }
        );

        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### ❌ Login Failed\nCheck your credentials and try again.`
                )
            )
            .addFileComponents(new FileBuilder().setURL('attachment://sessionResults.txt'));

        try {
            await send({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container], files: [attachment] });
        } catch {
            try {
                const fb = new AttachmentBuilder(Buffer.from('Could not attach logs.', 'utf8'), { name: 'sessionResults.txt' });
                await send({
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    components: [
                        new ContainerBuilder()
                            .setAccentColor(colours.light_red)
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ❌ Login Failed\nCheck your credentials and try again. (Log unavailable)`))
                            .addFileComponents(new FileBuilder().setURL('attachment://sessionResults.txt'))
                    ],
                    files: [fb],
                });
            } catch {}
        }
        return;
    }

    await userSessions.createNewSession(interaction, loginDetails, authToken, cookies);

    await send({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [
            new ContainerBuilder()
                .setAccentColor(colours.light_green)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ✅ Login Successful\nLogged in — loading your session...`))
        ]
    });

    const userSession = userSessions.get(interaction.user.id);
    await menu(userSession);
}

module.exports = processLogin;
