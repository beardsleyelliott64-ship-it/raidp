const { SeparatorSpacingSize, SeparatorBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { emojis, colours } = require('../config.json');
const { validAccount } = require('../handlers/accountHandler.js');
const loginHandler = require('../generic/loginHandler.js');
const getFunctionParams = require('../utils/getFunctionParams.js');
const getChildrenFromId = require('../utils/getChildrenFromId.js');
const getFile = require('../utils/getFile.js');

async function collector(message_sent, platform) {
    const loginPath = await getFile(platform, 'login.js');
    const login = require(loginPath);
    const loginParameters = getFunctionParams(login);

    const collector = message_sent.createMessageComponentCollector({
        componentType: ComponentType.Button,
    });

    collector.on('collect', async (interaction) => {
        try {
            if (interaction.customId.endsWith('_login')) {
                if (await validAccount(interaction, platform)) return;
            const children = getChildrenFromId(interaction.customId);
            const childLabel = children.length ? `(${children})` : '';

            const loginBtn = new ButtonBuilder()
                .setCustomId("login")
                .setLabel('Login')
                .setEmoji(emojis.login)
                .setStyle(ButtonStyle.Success);

            const cookieBtn = new ButtonBuilder()
                .setCustomId("login_cookies")
                .setLabel('Login')
                .setEmoji(emojis.cookies)
                .setStyle(ButtonStyle.Success);

            const savedBtn = new ButtonBuilder()
                .setCustomId(`${platform}${childLabel}_savedAccounts_view`)
                .setLabel('Saved Accounts')
                .setEmoji(emojis.accounts)
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(loginBtn, cookieBtn, savedBtn);

            const seperator = new SeparatorBuilder({
                spacing: SeparatorSpacingSize.Small
            });

            const container = new ContainerBuilder()
                .setAccentColor(colours.onyx)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`### Login\nLogin by simply inputting your username and password or choosing a saved account!`)
                )
                .addSeparatorComponents(
                    seperator
                )
                .addActionRowComponents(
                    row
                );

            await loginHandler(interaction, container, `${platform}${childLabel}`, loginParameters.includes('school'), loginParameters.includes('type'));
            } else if (interaction.customId.startsWith('check_queue')) {
                const queueCollector = require('../queues/queueCollecting.js');
                await queueCollector(interaction);
            }
        } catch (error) {
            console.error(`[panel:${platform}]`, error);
            try {
                const payload = { content: `Panel error: ${error.message || 'Unknown error'}`, ephemeral: true };
                if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
                else await interaction.reply(payload);
            } catch {}
        }
    });
}

module.exports = collector;