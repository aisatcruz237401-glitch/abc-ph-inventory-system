// Notification helper for live update alerts
function showNotification(message) {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }

  if (Notification.permission === 'granted') {
    new Notification('Inventory Update', { body: message });
  }
}

window.showNotification = showNotification;
