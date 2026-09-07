// Frontend Supabase client configuration.
// This file uses the public anon key only and never exposes the server-side service role key.
const SUPABASE_URL = 'https://tlhxdsccrlcfoyyubnxq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_YPHqmwdj2DnMiIOApzH0eA_OLNvgXPH';

if (typeof window !== 'undefined') {
  const createClientFn = typeof createClient === 'function'
    ? createClient
    : window.supabase?.createClient;

  if (typeof createClientFn !== 'function') {
    console.error('Supabase client is not available. Make sure the CDN script is loaded before supabaseClient.js.');
  } else {
    window.supabaseClient = createClientFn(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
}
