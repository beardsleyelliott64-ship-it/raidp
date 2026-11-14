'use strict';
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const customizer = require('../../handlers/dashboardCustomizer');
module.exports={ data:new SlashCommandBuilder().setName('remove-cdashboard').setDescription('Disable public dashboard customisation (owner only)'), async execute(i){ if(i.user.id!==customizer.OWNER_ID)return i.reply({content:'Owner only.',flags:MessageFlags.Ephemeral}); const state=customizer.setPublicCustomization(i.client,false); return i.reply({content:state?'Public dashboard customisation disabled. Published features were kept.':'Disabled, but the saved dashboard message could not be refreshed; run /dashboard.',flags:MessageFlags.Ephemeral}); }};
