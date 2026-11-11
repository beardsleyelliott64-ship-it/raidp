require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

let client = null;

function getSupabase() {
  const url = process.env.SUPABASEURL;
  const key = process.env.SUPABASEKEY;
  if (!url || !key) {
    throw new Error('Supabase is not configured. Set SUPABASEURL and SUPABASEKEY in Render environment variables before using database features.');
  }
  if (!client) client = createClient(url, key);
  return client;
}

// Lazy proxy: importing command files never creates a Supabase client.
// Database access only requires Supabase variables when a database method is actually used.
function lazySupabase() {
  return new Proxy({}, {
    get(_target, property) {
      const value = getSupabase()[property];
      return typeof value === 'function' ? value.bind(getSupabase()) : value;
    }
  });
}

module.exports = { getSupabase, lazySupabase };
