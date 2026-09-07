document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const DEFAULT_BACKEND_ORIGIN = 'http://localhost:3000';
  const BACKEND_ORIGINS = [DEFAULT_BACKEND_ORIGIN, 'http://127.0.0.1:3000'];
  const apiBase = typeof window !== 'undefined' && window.location?.origin && BACKEND_ORIGINS.includes(window.location.origin)
    ? `${window.location.origin}/api`
    : `${DEFAULT_BACKEND_ORIGIN}/api`;

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const loginMessage = document.getElementById('loginMessage');

    try {
      const response = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: usernameInput.value,
          password: passwordInput.value
        })
      });

      const data = await response.json();

      if (response.ok && data.token) {
        // 1. SAVE TOKEN & USER DATA
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));

        // 2. Try to restore a Supabase session if possible, but preserve legacy state if not.
        if (typeof signInSupabaseWithCredentials === 'function') {
          await signInSupabaseWithCredentials(usernameInput.value, passwordInput.value).catch(() => null);
        }

        // 3. REDIRECT TO DASHBOARD (legacy pages served under /legacy)
        window.location.href = '/legacy/dashboard.html';
      } else {
        if (loginMessage) {
          loginMessage.textContent = data.message || 'Login failed!';
        } else {
          alert(data.message || 'Login failed!');
        }
      }
    } catch (error) {
      console.error('Login error:', error);
      if (loginMessage) {
        loginMessage.textContent = 'Server connection failed.';
      } else {
        alert('Server connection failed.');
      }
    }
  });
});