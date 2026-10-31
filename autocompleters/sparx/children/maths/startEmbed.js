const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ThumbnailBuilder, SectionBuilder } = require('discord.js');
const { emojis, colours } = require('../../../../config.json');

const hero = new SectionBuilder()
    .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            '# Phantom Maths\n**Sparx Maths tools**\n\nAccount, homework and session controls in one compact panel.'
        )
    )
    .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: 'https://i.postimg.cc/Xvr3JJZg/C90k-XPO.png' } }));

const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
        .setCustomId('sparx(maths)_login')
        .setLabel('Login')
        .setStyle(ButtonStyle.Success)
        .setEmoji(emojis.login),
    new ButtonBuilder()
        .setCustomId('check_queue_sparx(maths)')
        .setLabel('Queue')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(emojis.queue)
);

module.exports = new ContainerBuilder()
    .setAccentColor(colours.sparx_maths)
    .addSectionComponents(hero)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            '### Maths\n`LOGIN`  Connect your account\n`QUEUE`  View your current position\n\n**Phantom** keeps the session controls compact and easy to read.'
        )
    )
    .addActionRowComponents(actions);
