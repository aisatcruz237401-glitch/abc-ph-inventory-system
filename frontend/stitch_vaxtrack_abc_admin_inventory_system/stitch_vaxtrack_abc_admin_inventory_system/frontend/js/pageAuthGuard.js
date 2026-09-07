// Shared page authentication guard for legacy pages
(function () {
  async function isSupabaseAuthenticated() {
    try {
      if (!window.supabaseClient) return false;
      const res = await window.supabaseClient.auth.getSession();
      return !!res?.data?.session;
    } catch (e) {
      return false;
    }
  }

  async function checkAuth() {
    try {
      const supabaseSession = await isSupabaseAuthenticated();
      const legacy = !!localStorage.getItem('token') || !!localStorage.getItem('user');
      const authenticated = !!supabaseSession || legacy;
      if (!authenticated) {
        // Replace history entry so Back cannot return to protected page
          window.location.replace('/login.html');
      }
    } catch (err) {
      window.location.replace('/login.html');
    }
  }

  // Run check immediately so it executes before other page scripts
checkAuth();

function applyRoleBasedNavigation() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');

  if (user?.role !== 'admin') {
    // Hide Reports for Staff
    document.querySelectorAll('a').forEach(link => {
      const text = link.textContent.trim();
      const href = link.getAttribute('href') || '';

      if (
        text === 'Reports' ||
        href === 'reports.html' ||
        href.endsWith('/reports.html')
      ) {
        link.remove();
      }
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyRoleBasedNavigation);
} else {
  applyRoleBasedNavigation();
}

})();