require('dotenv').config();
const crypto = require('crypto');
const { lazySupabase } = require('./supabase');
const withRetry = require('../utils/withRetry');
const supabase = lazySupabase();

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = SALT_LENGTH + IV_LENGTH + TAG_LENGTH;

function encrypt(plaintext, password) {
    if (typeof password !== 'string' || !password.length) throw new Error('A master password is required.');
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = crypto.scryptSync(password, salt, 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

function decrypt(payloadB64, password) {
    try {
        if (typeof payloadB64 !== 'string' || typeof password !== 'string' || !password.length) return null;
        const data = Buffer.from(payloadB64, 'base64');
        if (data.length < HEADER_LENGTH) return null;
        const salt = data.subarray(0, SALT_LENGTH);
        const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
        const tag = data.subarray(SALT_LENGTH + IV_LENGTH, HEADER_LENGTH);
        const ciphertext = data.subarray(HEADER_LENGTH);
        const key = crypto.scryptSync(password, salt, 32);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch { return null; }
}

async function getAccountRow(discord_id) {
    const { data, error } = await supabase.from('accounts')
        .select('discord_id, saved_accounts').eq('discord_id', discord_id).maybeSingle();
    if (error) throw error;
    return data;
}

async function saveEncryptedAccounts(discord_id, accounts, master_password) {
    if (!Array.isArray(accounts)) throw new TypeError('Saved accounts must be an array.');
    const row = await getAccountRow(discord_id);
    if (!row) throw new Error('Discord account not found. Set up your bot account before saving logins.');
    const saved_accounts = encrypt(JSON.stringify(accounts), master_password);
    const { data, error } = await supabase.from('accounts').update({ saved_accounts })
        .eq('discord_id', discord_id).select('discord_id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Saved accounts were not written to the database.');
    return true;
}

async function deleteAccounts(discord_id) {
    const { error } = await supabase.from('accounts').update({ saved_accounts: null }).eq('discord_id', discord_id);
    if (error) throw error;
    return true;
}

async function updateSavedAccounts(discord_id, newAccounts, master_password) {
    return saveEncryptedAccounts(discord_id, newAccounts, master_password);
}

async function checkAccounts(discord_id, master_password) {
    const row = await getAccountRow(discord_id);
    if (!row || !row.saved_accounts) return null;
    const plaintext = decrypt(row.saved_accounts, master_password);
    if (plaintext === null) return false;
    try {
        const parsed = JSON.parse(plaintext);
        return Array.isArray(parsed) ? parsed : false;
    } catch { return false; }
}

async function addAccount(discord_id, login_details, master_password) {
    if (!login_details || typeof login_details !== 'object') throw new TypeError('Invalid login details.');
    const existing = await checkAccounts(discord_id, master_password);
    if (existing === false) return false;
    const accounts = existing || [];
    accounts.push(login_details);
    await saveEncryptedAccounts(discord_id, accounts, master_password);
    return true;
}

module.exports = {
    addAccount: withRetry(addAccount),
    checkAccounts: withRetry(checkAccounts),
    deleteAccounts: withRetry(deleteAccounts),
    updateSavedAccounts: withRetry(updateSavedAccounts)
};
