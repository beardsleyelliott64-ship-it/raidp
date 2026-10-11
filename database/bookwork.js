require('dotenv').config();
const { lazySupabase } = require('./supabase');
const withRetry = require('../utils/withRetry');

const supabase = lazySupabase();

function isMissingTable(err) {
  const msg = String(err?.message || err || '');
  const code = err?.code || err?.error?.code;
  return code === 'PGRST205' || /Could not find the table.*bookworks/i.test(msg);
}

async function addToDbBookwork(package_id, bookworks) {
  try {
    const existingBookwork = await getBookworks(package_id);

    let updatedBookworks = {};
    try {
      updatedBookworks = JSON.parse(existingBookwork.bookworks || '{}');
    } catch {
      updatedBookworks = {};
    }

    const mergedObj = { ...bookworks, ...updatedBookworks };

    const sortedKeys = Object.keys(mergedObj).sort((a, b) => {
      const numA = parseInt((a.match(/\d+/) || ['0'])[0], 10);
      const numB = parseInt((b.match(/\d+/) || ['0'])[0], 10);
      const charA = (a.match(/[A-Z]+/) || [''])[0];
      const charB = (b.match(/[A-Z]+/) || [''])[0];
      if (numA !== numB) return numA - numB;
      return charA.localeCompare(charB);
    });

    const finalObj = {};
    sortedKeys.forEach((key) => {
      finalObj[key] = mergedObj[key];
    });

    if (!existingBookwork.timestamp) {
      await supabase
        .from('bookworks')
        .insert([{ package_id, bookworks: JSON.stringify(finalObj), timestamp: new Date() }])
        .throwOnError();
    } else {
      await supabase
        .from('bookworks')
        .update({ package_id, bookworks: JSON.stringify(finalObj), timestamp: new Date() })
        .eq('package_id', package_id)
        .throwOnError();
    }
  } catch (err) {
    if (isMissingTable(err)) {
      console.error('[bookwork] public.bookworks missing — skipping store. Run supabase-bookworks.sql in Supabase SQL editor.');
      return;
    }
    throw err;
  }
}

async function getBookworks(package_id) {
  try {
    const { data } = await supabase
      .from('bookworks')
      .select('*')
      .eq('package_id', package_id)
      .maybeSingle()
      .throwOnError();

    if (data) return data;
    return { bookworks: '{}', timestamp: null };
  } catch (err) {
    if (isMissingTable(err)) {
      console.error('[bookwork] public.bookworks missing — returning empty. Run supabase-bookworks.sql in Supabase SQL editor.');
      return { bookworks: '{}', timestamp: null };
    }
    throw err;
  }
}

module.exports = {
  addToDbBookwork: withRetry(addToDbBookwork),
  getBookworks: withRetry(getBookworks),
};
