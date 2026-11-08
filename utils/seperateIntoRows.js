const { ActionRowBuilder, ComponentType } = require('discord.js');

/**
 * Splits components into valid Discord action rows.
 * @param {Array} components - Array of ButtonBuilder, SelectMenuBuilder, etc.
 * @returns {ActionRowBuilder[]}
 */
function seperateIntoRows(components) {
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (const component of components) {
    const type = component.data?.type ?? component.type;

    const isSingleRowComponent =
      type === ComponentType.StringSelect ||
      type === ComponentType.UserSelect ||
      type === ComponentType.RoleSelect ||
      type === ComponentType.ChannelSelect ||
      type === ComponentType.MentionableSelect ||
      type === ComponentType.TextInput;

    // If it's a select/text input, it must be alone in its row
    if (isSingleRowComponent) {
      if (currentRow.components.length > 0) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder();
      }

      rows.push(new ActionRowBuilder().addComponents(component));
      continue;
    }

    // If adding this button would overflow the row, start a new row
    if (currentRow.components.length >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }

    currentRow.addComponents(component);
  }

  // Push last row if it has anything
  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  if (rows.length > 5) {
    throw new Error('Too many components! Discord allows max 5 action rows.');
  }

  return rows;
}

module.exports = seperateIntoRows;