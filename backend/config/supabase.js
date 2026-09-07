const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANNON_KEY;
const isSupabaseEnabled =
  String(process.env.USE_SUPABASE || '').toLowerCase() === 'true' &&
  Boolean(SUPABASE_URL) &&
  Boolean(SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY)
    ? true
    : false;

let supabase = null;
if (isSupabaseEnabled) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

module.exports = {
  supabase,
  isSupabaseEnabled,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
};
