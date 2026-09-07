window.addEventListener('DOMContentLoaded', async () => {
  await ensureAuthenticatedPage();

  const logoutBtn = document.getElementById('logoutBtn') || document.querySelector('[data-action="logout"]');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      await signOutFromApp();
    });
  }
});
