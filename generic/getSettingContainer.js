const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { emojis, colours } = require('../config.json');

function getContainer(data, userSetting, disabled=false) {
    userSetting = userSetting && typeof userSetting === 'object' ? userSetting : {};
    const buttons = [];
    for (const [id, info] of Object.entries(data.settings)) {
        const button = new ButtonBuilder()
            .setCustomId(id)
            .setLabel(info.label)
            .setEmoji(emojis[info.emoji])
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled);
        buttons.push(button);
    }

    let formattedText = data.text;
    try {
        // 1. Escape any backticks in the JSON so they don't break our template
        const safeText = data.text.replace(/`/g, '\\`');
        
        // 2. Create a dynamic function that processes the string as a template literal
        const evaluator = new Function('userSetting', `return \`${safeText}\`;`);
        
        // 3. Execute it and pass in our userSetting object
        formattedText = evaluator(userSetting);
    } catch (error) {
        console.error("Failed to parse dynamic JSON text:", error);
    }

    const settingsRow = new ActionRowBuilder()
        .addComponents(buttons);
    const Embed = new ContainerBuilder()
        .setAccentColor(colours[data.colour])
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(formattedText)
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(settingsRow);

    return Embed;
}

module.exports = getContainer;