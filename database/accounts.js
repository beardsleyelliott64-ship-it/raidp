require('dotenv').config();
const { lazySupabase } = require('./supabase');
const config = require('../config.json');
const hashCompare = require('../utils/hashCompare');
const { updateDB } = require('./general');
const withRetry = require('../utils/withRetry');

const supabase = lazySupabase();

async function addToDb(discord_id, master_password, license) {

    if ( (await checkAccount(discord_id)) !== null) return false;

    await supabase
        .from('accounts')
        .insert([
            { discord_id, master_password, license, slots: config.slots[license] ?? 0},
        ])
        .throwOnError();

    return true;
}

async function resetAllUses() {
    const { data } = await supabase
        .from('accounts')
        .update({ uses: {} })
        .not('discord_id', 'is', null)  // effectively updates all rows
        .select()
        .throwOnError();

    return data;
}

async function getAudit() {
    const { data } = await supabase
    .from('accounts')
    .select('discord_id, license, free_trial_start')
    .throwOnError();

    return data;
}

async function removeMainAccount(discordId, platform) {
    // Get the current accounts for this specific Discord ID
    const { data } = await supabase
        .from('accounts')
        .select('main_accounts')
        .eq('discord_id', discordId)
        .maybeSingle()
        .throwOnError();

    if (!data) {
        return false;
    }

    const currentAccounts = data.main_accounts;

    // Check if the platform exists, then delete it
    if (currentAccounts && currentAccounts[platform]) {
        delete currentAccounts[platform]; // Remove the key

        await supabase
            .from('accounts')
            .update({ main_accounts: currentAccounts })
            .eq('discord_id', discordId)
            .throwOnError();

        return true;
    }

    return false;
}

async function checkDuplicatesMainAccounts(platform, accountId, discordId, checkSelf = false) {
    const { data } = await supabase
        .from('accounts')
        .select('discord_id, main_accounts')
        .throwOnError();

    let matchDiscordId = null;

    for (const row of data) {
        // Check if platform exists AND (we are checking self OR it belongs to someone else)
        if (row.main_accounts[platform] && (checkSelf || (row.discord_id !== discordId))) {
            
            const isMatch = await hashCompare(accountId, row.main_accounts[platform]);
            
            if (isMatch) {
                matchDiscordId = row.discord_id; // Store the ID
                break;
            }
        }
    }
    return matchDiscordId; // Returns the ID string or null
}

async function addMainAccount(discord_id, platform, accountId) {
    const mainAccounts = (await checkAccount(discord_id)).main_accounts;
    if ( mainAccounts[platform]) return false;
    mainAccounts[platform] = accountId;

    await supabase
        .from('accounts')
        .update({ main_accounts: mainAccounts })
        .eq('discord_id', discord_id)
        .throwOnError();

    return true;
}

async function activateFreeTrial(discord_id) {
    if ( (await checkAccount(discord_id)).free_trial_start !== null) return false;
    const { error } = await supabase
    .from('accounts')
    .update({ free_trial_start: new Date() })
    .eq('discord_id', discord_id);

    if (error) {
       throw new Error(`Failed to activate free trial: ${error.message}`);
    }
    return true;
}

async function clearSpecificService(service) {
  // Fetch only ID and the JSON column
  const { data: accounts, error: fetchError } = await supabase
    .from('accounts')
    .select('discord_id, main_accounts');

  if (fetchError) {
    console.error('Error fetching accounts:', fetchError);
    return;
  }

  // Prepare update promises
  const updates = accounts.map(async (account) => {
    const jsonData = account.main_accounts;

    // Check if the service exists in this row's JSON
    if (jsonData && jsonData[service]) {
      
      // Delete the specific key
      delete jsonData[service];

      // Update the specific row
      await supabase
        .from('accounts')
        .update({ main_accounts: jsonData })
        .eq('discord_id', account.discord_id)
        .throwOnError();
    }
  });

  // Execute all updates
  await Promise.all(updates);
}

async function checkAccount(discord_id, license) {
    const { data } = await supabase
        .from('accounts')
        .select('*')
        .eq('discord_id', discord_id)
        .maybeSingle()
        .throwOnError();

    if (data) {
        if (license !== undefined && data.license !== license) {
            const dataToChange = {license: license};
            if (!data.custom_slots && (data.slots !== config.slots[license])) dataToChange.slots = config.slots[license];
            await updateDB('accounts', dataToChange, 'discord_id', discord_id);
            if (Number.isFinite(dataToChange.slots)) data.slots = dataToChange.slots;
            data.license = license;
        };
        return data;
    } else {
        return null;
    }
}

async function updateStats(discord_id, platform, time_saved) {
    const account = await checkAccount(discord_id);
    if (!account.total_usage[platform]) {
        account.total_usage[platform] = {total_uses: 0, time_saved: 0};
    }
    account.total_usage[platform].total_uses += 1;
    account.total_usage[platform].time_saved += time_saved;
    await updateDB('accounts', account, 'discord_id', discord_id);
}

async function setDefault(table, column) {
  const { error } = await supabase.rpc('set_column_to_default', {
    table_name: table,
    column_name: column,
  });

  if (error) throw error;
}

module.exports = { 
    addToDb: withRetry(addToDb), 
    setDefault: withRetry(setDefault), 
    updateStats: withRetry(updateStats), 
    removeMainAccount: withRetry(removeMainAccount), 
    getAudit: withRetry(getAudit), 
    clearSpecificService: withRetry(clearSpecificService), 
    resetAllUses: withRetry(resetAllUses), 
    checkDuplicatesMainAccounts: withRetry(checkDuplicatesMainAccounts), 
    checkAccount: withRetry(checkAccount), 
    addMainAccount: withRetry(addMainAccount), 
    activateFreeTrial: withRetry(activateFreeTrial)
};