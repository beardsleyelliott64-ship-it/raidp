const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ThumbnailBuilder, SectionBuilder } = require('discord.js');
const { emojis, colours } = require('../../../../config.json');

const hero = new SectionBuilder()
    .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            '# Phantom Reader\n**Sparx Reader tools**\n\nA cleaner control panel for your Reader session, account and queue.'
        )
    )
    .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: 'https://i.postimg.cc/Y9j7vShY/0H0TBp3.png' } }));

const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
        .setCustomId('sparx(reader)_login')
        .setLabel('Login')
        .setStyle(ButtonStyle.Success)
        .setEmoji(emojis.login),
    new ButtonBuilder()
        .setCustomId('check_queue_sparx(reader)')
        .setLabel('Queue')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(emojis.queue)
);

module.exports = new ContainerBuilder()
    .setAccentColor(colours.sparx_reader)
    .addSectionComponents(hero)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            '### Reader\n`LOGIN`  Connect your account\n`QUEUE`  View your current position\n\n**Phantom** keeps the session controls compact and easy to read.'
        )
    )
    .addActionRowComponents(actions);
