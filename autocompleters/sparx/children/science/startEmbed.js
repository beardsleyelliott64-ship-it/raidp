const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ThumbnailBuilder, SectionBuilder } = require('discord.js');
const { emojis, colours } = require('../../../../config.json');

const seperator = new SeparatorBuilder({
    spacing: SeparatorSpacingSize.Small
});

const section = new SectionBuilder()
.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# Sparx Science\nAutomate your Sparx Science homework with high accuracy and zero detection by your teacher. Simply press \`Login\` and follow the instructions to be on your way to acing your Sparx Science homework and never fearing of Sparx Science again in your life!\n## ✨ Features\n- ⏰ **Customisable Time** — Autocompletes your Sparx Science homework in whatever time you want to balance speed and detection!\n- 🎯 **High Accuracy** — Excellent accuracy of >90% at completing questions!\n- 🧠 **Easy To Use** — Simple and intuitive to use with the press of only a few buttons!`)
)
.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: 'https://i.postimg.cc/WpWDYDG2/c-Gt5SC5-Imgur.png' } }));
// 2. Create the buttons and the action row
const mathButtons = new ActionRowBuilder()
    .addComponents(
        new ButtonBuilder()
            .setCustomId('sparx(science)_login')
            .setLabel('Login')
            .setStyle(ButtonStyle.Success)
            .setEmoji(emojis.login),
        new ButtonBuilder()
            .setCustomId('check_queue_sparx(science)')
            .setLabel('Check Queue')
            .setStyle(ButtonStyle.Primary)
            .setEmoji(emojis.queue)
    );

// 3. Assemble everything into the main container
const container = new ContainerBuilder()
    .setAccentColor(colours.sparx_science)
    .addSectionComponents(
        section
    )
    .addSeparatorComponents(
        seperator
    )

    .addActionRowComponents(
        mathButtons
    );

module.exports = container;