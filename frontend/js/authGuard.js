async function waitForSupabaseSession(timeout = 1000) {
  if (typeof window === 'undefined' || !window.supabaseClient) {
    return null;
  }

  const { data } = await window.supabaseClient.auth.getSession();
  if (data?.session) {
    return data.session;
  }

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeout);

    const { data: subscription } = window.supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!settled && session) {
        settled = true;
        clearTimeout(timer);
        resolve(session);
        subscription?.subscription?.unsubscribe?.();
      }
    });
  });
}

async function getSupabaseSessionData() {
  if (typeof window === 'undefined' || !window.supabaseClient) {
    return { session: null, user: null, error: new Error('Supabase client unavailable') };
  }

  const session = await waitForSupabaseSession();
  if (session) {
    return { session, user: session.user, error: null };
  }

  const { data, error } = await window.supabaseClient.auth.getSession();
  return {
    session: data?.session || null,
    user: data?.session?.user || null,
    error,
  };
}

function hasLegacyAuth() {
  return !!localStorage.getItem('token') || !!localStorage.getItem('user');
}

async function ensureAuthenticatedPage({ redirectOnUnauthenticated = true } = {}) {
  console.log('[authGuard.js] ensureAuthenticatedPage called with redirectOnUnauthenticated:', redirectOnUnauthenticated);
  
  const { user } = await getSupabaseSessionData();
  console.log('[authGuard.js] Supabase session user:', user?.id || null);
  
  const hasToken = !!localStorage.getItem('token');
  const hasUser = !!localStorage.getItem('user');
  console.log('[authGuard.js] Legacy auth - token:', hasToken, 'user:', hasUser);
  
  const isAuthenticated = !!user || hasLegacyAuth();
  console.log('[authGuard.js] Final isAuthenticated:', isAuthenticated);

  if (!isAuthenticated && redirectOnUnauthenticated) {
    console.log('[authGuard.js] User not authenticated, redirecting to login');
    window.location.href = '/login.html';
    return { authenticated: false, source: null, user: null };
  }

  console.log('[authGuard.js] Auth check complete - user is authenticated');
  return {
    authenticated: isAuthenticated,
    source: user ? 'supabase' : 'legacy',
    user,
  };
}

async function signOutFromApp() {
  try {
    if (window.supabaseClient) {
      await window.supabaseClient.auth.signOut();
    }
  } catch (error) {
    console.warn('Supabase sign out failed', error?.message || error);
  }

  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login.html';
}

async function signInSupabaseWithCredentials(username, password) {
  if (!window.supabaseClient) return null;

  try {
    const { data, error } = await window.supabaseClient.auth.signInWithPassword({
      email: username,
      password,
    });

    if (error) {
      console.warn('Supabase sign in failed', error.message);
      return null;
    }

    return data?.session || null;
  } catch (error) {
    console.warn('Supabase sign in error', error?.message || error);
    return null;
  }
}

window.getSupabaseSessionData = getSupabaseSessionData;
window.ensureAuthenticatedPage = ensureAuthenticatedPage;
window.signOutFromApp = signOutFromApp;
window.signInSupabaseWithCredentials = signInSupabaseWithCredentials;
