function updateSharedNavigationActiveState() {
  const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
  const links = document.querySelectorAll('#layout-shell a[href]');

  links.forEach((link) => {
    const targetPath = new URL(link.href, window.location.origin).pathname.replace(/\/$/, '') || '/';
    link.classList.toggle('nav-active', targetPath === currentPath);
  });
}

function injectSharedLayout() {
  const layoutShell = document.getElementById('layout-shell');
  if (layoutShell && typeof window.sharedNavMarkup === 'string') {
    layoutShell.innerHTML = window.sharedNavMarkup;
    updateSharedNavigationActiveState();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectSharedLayout);
} else {
  injectSharedLayout();
}