require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const withRetry = require('../utils/withRetry');

let supabase = null;
function getSupabase() {
    const url = process.env.SUPABASEURL;
    const key = process.env.SUPABASEKEY;
    if (!url || !key) throw new Error('Supabase is not configured. Set SUPABASEURL and SUPABASEKEY in environment variables.');
    if (!supabase) supabase = createClient(url, key);
    return supabase;
}

function isMissingRelation(err) {
    const code = err?.code || err?.error?.code;
    const msg = String(err?.message || err || '');
    return code === 'PGRST205' || code === 'PGRST204' || code === '42P01' || /Could not find the table/i.test(msg) || /Could not find the .* column/i.test(msg) || /relation .* does not exist/i.test(msg);
}

function isMissingRpc(err) {
    const code = err?.code || err?.error?.code;
    const msg = String(err?.message || err || '');
    return code === 'PGRST202' || /Could not find the function/i.test(msg);
}

async function getSparxQuestion(canonicalizedContent, sparx) {
    try {
        const { data, error } = await getSupabase().rpc('get_sparx_answer', {
            table_name: sparx,
            search_content: canonicalizedContent,
        });
        if (error) {
            if (isMissingRpc(error) || isMissingRelation(error)) {
                console.error(`[db] get_sparx_answer unavailable (${error.message}) — continuing without cache`);
                return null;
            }
            console.error('RPC Error:', error);
            return null;
        }
        return data;
    } catch (err) {
        if (isMissingRpc(err) || isMissingRelation(err)) {
            console.error(`[db] getSparxQuestion soft-fail: ${err.message}`);
            return null;
        }
        throw err;
    }
}

async function updateSparxAnswerRPC(table, content, updateData) {
    try {
        const { error } = await getSupabase().rpc('update_sparx_answer', {
            table_name: table,
            search_content: typeof content === 'string' ? content : JSON.stringify(content),
            new_answer: updateData.answer || null,
            new_incorrect_answers: updateData.incorrect_answers || null,
            new_ai_model: updateData.ai_model || null,
        });
        if (error) {
            if (isMissingRpc(error) || isMissingRelation(error)) {
                console.error(`[db] update_sparx_answer unavailable — skipping cache write`);
                return;
            }
            throw error;
        }
    } catch (err) {
        if (isMissingRpc(err) || isMissingRelation(err)) {
            console.error(`[db] updateSparxAnswerRPC soft-fail: ${err.message}`);
            return;
        }
        throw err;
    }
}

async function getFromDB(table, matchColumn, matchValue, returnProperty) {
    try {
        const { data, error } = await getSupabase()
            .from(table)
            .select(returnProperty ?? '*')
            .eq(matchColumn, matchValue)
            .maybeSingle();
        if (error) {
            if (isMissingRelation(error)) {
                console.error(`[db] table ${table} missing — getFromDB returns null`);
                return null;
            }
            throw error;
        }
        return data;
    } catch (err) {
        if (isMissingRelation(err)) {
            console.error(`[db] getFromDB soft-fail (${table}): ${err.message}`);
            return null;
        }
        throw err;
    }
}

async function appendToDB(table_name, insertData) {
    try {
        await getSupabase().from(table_name).insert([insertData]).throwOnError();
    } catch (err) {
        if (isMissingRelation(err)) {
            console.error(`[db] table ${table_name} missing — appendToDB skipped`);
            return;
        }
        throw err;
    }
}

async function updateDB(table_name, updateData, matchColumn, matchData) {
    try {
        await getSupabase().from(table_name).update(updateData).eq(matchColumn, matchData).throwOnError();
    } catch (err) {
        if (isMissingRelation(err)) {
            console.error(`[db] table ${table_name} missing — updateDB skipped`);
            return;
        }
        throw err;
    }
}

async function deleteEntryDB(table_name, matchColumn, matchData) {
    try {
        await getSupabase().from(table_name).delete().eq(matchColumn, matchData).throwOnError();
    } catch (err) {
        if (isMissingRelation(err)) {
            console.error(`[db] table ${table_name} missing — deleteEntryDB skipped`);
            return;
        }
        throw err;
    }
}

module.exports = {
    appendToDB: withRetry(appendToDB),
    updateDB: withRetry(updateDB),
    getFromDB: withRetry(getFromDB),
    deleteEntryDB: withRetry(deleteEntryDB),
    getSparxQuestion: withRetry(getSparxQuestion),
    updateSparxAnswerRPC: withRetry(updateSparxAnswerRPC),
};
