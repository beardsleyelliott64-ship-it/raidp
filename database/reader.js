require('dotenv').config();
const { lazySupabase } = require('./supabase');
const { updateDB, appendToDB } = require('./general');
const withRetry = require('../utils/withRetry');

const supabase = lazySupabase();

async function addToDb(id, correct_answer, incorrect_answers=[]) {
    // The answer-cache table is optional. If it has not been created in
    // Supabase yet, never let it stop the Reader completer from answering.
    let data;
    try {
        ({ data } = await supabase
            .from('sparx_reader')
            .select('*')
            .eq('question_hash', String(id))
            .maybeSingle()
            .throwOnError());
    } catch (err) {
        if (err?.code === 'PGRST205' || /sparx_reader/i.test(String(err?.message || ''))) {
            return;
        }
        throw err;
    }
        
    if (!data) {
        try {
            await supabase
            .from('sparx_reader')
            .insert([
                { question_hash: String(id), correct_answer: correct_answer, incorrect_answers: incorrect_answers },
            ])
            .throwOnError();
        } catch (err) {
            if (err?.code === 'PGRST205' || /sparx_reader/i.test(String(err?.message || ''))) return;
            throw err;
        }
    } else {
        let incorrectAnswers = Array.isArray(data.incorrect_answers) ? data.incorrect_answers : [];

        for (const answer of incorrect_answers) {
            if (!incorrectAnswers.includes(answer)) {
                incorrectAnswers.push(answer);
            }
        }

        await supabase
        .from('sparx_reader')
        .update({ correct_answer: correct_answer, incorrect_answers: incorrectAnswers })
        .eq('question_hash', String(id))
        .throwOnError();
    }
}

async function checkAnswer(id, questionObj) {
    let data = null;
    try {
        ({ data } = await supabase
            .from('sparx_reader')
            .select('*')
            .eq('question_hash', String(id))
            .maybeSingle()
            .throwOnError());
    } catch (err) {
        // Missing optional cache table must not prevent the AI completer
        // from answering the current question.
        if (err?.code !== 'PGRST205' && !/sparx_reader/i.test(String(err?.message || ''))) {
            throw err;
        }
        return null;
    }

    if (questionObj?.questionText && questionObj?.questionOptions && (!data?.text || !data?.options)) {
        if (data) {
            updateDB('sparx_reader', {text: questionObj.questionText, options: questionObj.questionOptions}, 'question_hash', String(id));
        } else {
            appendToDB('sparx_reader', {question_hash: String(id), text: questionObj.questionText, options: questionObj.questionOptions});
        }
    }
    
    if (data) {
        if (data.correct_answer) {
            return data.correct_answer;
        } else if (Array.isArray(data.incorrect_answers) && data.incorrect_answers.length) {
            return data.incorrect_answers;
        }
    } 
        
    return null;
}

module.exports = { 
    addToDb: withRetry(addToDb), 
    checkAnswer: withRetry(checkAnswer)
};