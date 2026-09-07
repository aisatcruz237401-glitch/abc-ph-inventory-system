const socket = io();

function setupSocket(onUpdate) {
  socket.on('connect', () => {
    console.log('Connected to inventory socket');
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  });

  socket.on('inventoryUpdated', (payload) => {
    if (onUpdate) onUpdate(payload);

    const message = payload.type === 'RECEIVE'
      ? `Received ${payload.quantity} units for ${payload.barcode} in ${payload.branch}`
      : `Consumed ${payload.quantity} units for ${payload.barcode} in ${payload.branch}`;

    if (typeof window.showNotification === 'function') {
      window.showNotification(message);
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });
}
