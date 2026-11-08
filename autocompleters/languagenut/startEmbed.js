const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ThumbnailBuilder, SectionBuilder } = require('discord.js');
const { emojis, colours } = require('../../config.json');

const seperator = new SeparatorBuilder({
    spacing: SeparatorSpacingSize.Small
});

const section = new SectionBuilder()
.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# LanguageNut\nAutomate your Languagenut homework with 100% Accuracy and a simulated time to mimic real completion time!\n## ✨ Features\n- ⏰ **Instant** — Instantly completed at the press of a button! \n- 🎯 **Customisable Accuracy** — Set your target accuracy score!\n- 🕵️‍♂️ **Simulated Time** — Simulate realistic completion time to mimic real effort!`)
)
.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: 'https://i.postimg.cc/tRnhvy7v/languagenut-png.webp' } }));
// 2. Create the buttons and the action row
const mathButtons = new ActionRowBuilder()
    .addComponents(
        new ButtonBuilder()
            .setCustomId('languagenut_login')
            .setLabel('Login')
            .setStyle(ButtonStyle.Success)
            .setEmoji(emojis.login)
    );

// 3. Assemble everything into the main container
const container = new ContainerBuilder()
    .setAccentColor(colours.languagenut)
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