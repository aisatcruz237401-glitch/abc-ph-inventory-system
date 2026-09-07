console.log('[authInit.js] File loaded');

window.addEventListener('DOMContentLoaded', async () => {
  console.log('[authInit.js] DOMContentLoaded event fired');
  console.log('[authInit.js] Calling ensureAuthenticatedPage()');
  
  await ensureAuthenticatedPage();
  
  console.log('[authInit.js] Auth check complete');
  
  let logoutBtn = document.getElementById('logoutBtn') || document.querySelector('[data-action="logout"]');
  if (!logoutBtn) {
    logoutBtn = Array.from(document.querySelectorAll('button, a')).find((el) => el.textContent.trim().toLowerCase() === 'logout');
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', (event) => {
      event.preventDefault();
      signOutFromApp();
    });
  }
});
