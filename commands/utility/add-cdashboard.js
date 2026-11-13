'use strict';
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const customizer = require('../../handlers/dashboardCustomizer');
module.exports={ data:new SlashCommandBuilder().setName('add-cdashboard').setDescription('Enable public dashboard customisation (owner only)'), async execute(i){ if(i.user.id!==customizer.OWNER_ID)return i.reply({content:'Owner only.',flags:MessageFlags.Ephemeral}); const state=customizer.setPublicCustomization(i.client,true); return i.reply({content:state?'Public dashboard customisation enabled.':'Enabled, but the saved dashboard message could not be refreshed; run /dashboard.',flags:MessageFlags.Ephemeral}); }};
