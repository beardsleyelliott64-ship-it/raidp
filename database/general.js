require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const withRetry = require('../utils/withRetry');

let supabase = null;
function getSupabase() {
    const url = process.env.SUPABASEURL;
    const key = process.env.SUPABASEKEY;
    if (!url || !key) throw new Error('Supabase is not configured. Set SUPABASEURL and SUPABASEKEY in Render environment variables.');
    if (!supabase) supabase = createClient(url, key);
    return supabase;
}
async function getSparxQuestion(canonicalizedContent, sparx) {
    const { data, error } = await getSupabase().rpc('get_sparx_answer', { table_name: sparx, search_content: canonicalizedContent });
    if (error) { console.error('RPC Error:', error); return null; }
    return data;
}
async function updateSparxAnswerRPC(table, content, updateData) {
    const { error } = await getSupabase().rpc('update_sparx_answer', {
        table_name: table,
        search_content: typeof content === 'string' ? content : JSON.stringify(content),
        new_answer: updateData.answer || null,
        new_incorrect_answers: updateData.incorrect_answers || null,
        new_ai_model: updateData.ai_model || null
    });
    if (error) throw error;
}
async function getFromDB(table, matchColumn, matchValue, returnProperty) {
    const { data, error } = await getSupabase().from(table).select(returnProperty ?? '*').eq(matchColumn, matchValue).maybeSingle();
    if (error) throw error; return data;
}
async function appendToDB(table_name, insertData) { await getSupabase().from(table_name).insert([insertData]).throwOnError(); }
async function updateDB(table_name, updateData, matchColumn, matchData) { await getSupabase().from(table_name).update(updateData).eq(matchColumn, matchData).throwOnError(); }
async function deleteEntryDB(table_name, matchColumn, matchData) { await getSupabase().from(table_name).delete().eq(matchColumn, matchData).throwOnError(); }
module.exports = { appendToDB: withRetry(appendToDB), updateDB: withRetry(updateDB), getFromDB: withRetry(getFromDB), deleteEntryDB: withRetry(deleteEntryDB), getSparxQuestion: withRetry(getSparxQuestion), updateSparxAnswerRPC: withRetry(updateSparxAnswerRPC) };
