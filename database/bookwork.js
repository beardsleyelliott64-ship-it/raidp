require('dotenv').config();
const { lazySupabase } = require('./supabase');
const withRetry = require('../utils/withRetry');

const supabase = lazySupabase();

async function addToDbBookwork(package_id, bookworks) {

    const existingBookwork = await getBookworks(package_id); // package_id; timestamp; answers

    const updatedBookworks = JSON.parse(existingBookwork.bookworks);

    // Merge objects (obj1 takes precedence if keys overlap)
    const mergedObj = { ...bookworks, ...updatedBookworks }; // obj1 overwrites obj2 on duplicates

    // Sort keys
    const sortedKeys = Object.keys(mergedObj).sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)[0], 10);
    const numB = parseInt(b.match(/\d+/)[0], 10);

    const charA = a.match(/[A-Z]+/)[0];
    const charB = b.match(/[A-Z]+/)[0];

    if (numA !== numB) return numA - numB;
    return charA.localeCompare(charB);
    });

    // Build sorted object
    const finalObj = {};
    sortedKeys.forEach(key => {
    finalObj[key] = mergedObj[key];
    });

    if (!existingBookwork.timestamp) {
        await supabase
            .from('bookworks')
            .insert([
                { package_id: package_id, bookworks: JSON.stringify(finalObj), timestamp: new Date()},
            ])
            .throwOnError();
    } else {
        await supabase
            .from('bookworks')
            .update([
                { package_id: package_id, bookworks: JSON.stringify(finalObj), timestamp: new Date()},
            ])
            .eq('package_id', package_id)
            .throwOnError();
    }
}


async function getBookworks(package_id) {
    const { data } = await supabase
        .from('bookworks')
        .select('*')
        .eq('package_id', package_id)
        .maybeSingle()
        .throwOnError();

    if (data) {
        return data;
    } else {
        return { bookworks: '{}', timestamp: null};
    }
}

module.exports = { 
    addToDbBookwork: withRetry(addToDbBookwork), 
    getBookworks: withRetry(getBookworks)
};