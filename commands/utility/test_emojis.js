const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, MessageFlags, ComponentType } = require('discord.js');
const { emojis, colours } = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('test_emojis')
        .setDescription('Tests rendering of all configured emojis'),
    async execute(interaction) {
        await interaction.deferReply({});

        const emojiEntries = Object.entries(emojis);

        if (emojiEntries.length === 0) {
            return interaction.editReply({ content: 'No emojis found in config.' });
        }

        // Discord's absolute limit is 25 buttons per message
        const chunkSize = 25;
        const totalPages = Math.ceil(emojiEntries.length / chunkSize);
        let page = 1;

        // Process emojis in chunks of 25
        for (let i = 0; i < emojiEntries.length; i += chunkSize) {
            const chunk = emojiEntries.slice(i, i + chunkSize);
            
            const embedLines = [];
            const buttonRows = [];
            let currentRow = new ActionRowBuilder();

            for (const [name, value] of chunk) {
                let displayForEmbed = value;
                let emojiForButton = value;

                // Support both standard (<:name:id>) and animated (<a:name:id>) emojis
                if (value.startsWith('<')) {
                    const match = value.match(/<a?:([^:]+):(\d+)>/);
                    if (match) {
                        const emojiName = match[1];
                        const emojiId = match[2];
                        displayForEmbed = `:${emojiName}: (ID: \`${emojiId}\`)`;
                        emojiForButton = emojiId; // DiscordJS button prefers just the ID
                    }
                } else if (/^\d+$/.test(value)) {
                    displayForEmbed = `(ID: \`${value}\`)`; 
                }
                
                embedLines.push(`**${name}**: ${displayForEmbed}`);

                // Try to create the button (wrapped in try/catch in case of invalid emoji strings)
                try {
                    // Discord customIds are limited to 100 chars, so we truncate the name if necessary
                    const safeId = `test_emoji_${name.substring(0, 80)}`;
                    
                    const button = new ButtonBuilder()
                        .setCustomId(safeId)
                        .setLabel(name.length > 80 ? name.substring(0, 77) + '...' : name)
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji(emojiForButton);

                    currentRow.addComponents(button);

                    // If row is full, push it and start a new one
                    if (currentRow.components.length === 5) {
                        buttonRows.push(currentRow);
                        currentRow = new ActionRowBuilder();
                    }
                } catch (e) {
                    console.error(`Failed to create button for emoji ${name}:`, e);
                    embedLines[embedLines.length - 1] += ' *(Failed to load button)*';
                }
            }

            // Push any remaining buttons in the final row
            if (currentRow.components.length > 0) {
                buttonRows.push(currentRow);
            }

            const testEmbed = new EmbedBuilder()
                .setTitle(`Emoji Rendering Test (Part ${page}/${totalPages})`)
                .setDescription(embedLines.length > 0 ? 'Here are the configured emojis:\n\n' + embedLines.join('\n') : 'No emojis to render.')
                .setColor(colours.bright_green);

            const payload = { embeds: [testEmbed], components: buttonRows };
            
            let response;
            // First chunk uses editReply, subsequent chunks use followUp
            if (page === 1) {
                response = await interaction.editReply(payload);
            } else {
                response = await interaction.followUp(payload);
            }

            // Create a collector specifically bound to this message chunk (valid for 5 mins)
            try {
                const collector = response.createMessageComponentCollector({ 
                    componentType: ComponentType.Button, 
                    time: 300000 
                });

                collector.on('collect', async i => {
                    if (i.customId.startsWith('test_emoji_')) {
                        const clickedId = i.customId.replace('test_emoji_', '');
                        
                        // Find original name in case we had to truncate it for the customId limit
                        const originalEntry = chunk.find(([n]) => n.substring(0, 80) === clickedId);
                        const realName = originalEntry ? originalEntry[0] : clickedId;
                        const emojiValue = emojis[realName] || 'Unknown';
                        
                        let msg = `Config Key: \`${realName}\`\nValue from Config: ${emojiValue}`;
                        
                        await i.reply({ content: msg, flags: MessageFlags.Ephemeral });
                    }
                });
            } catch (err) {
                console.error('Failed to attach collector:', err);
            }

            page++;
        }
    },
};