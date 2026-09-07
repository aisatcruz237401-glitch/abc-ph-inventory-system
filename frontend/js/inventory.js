// Inventory page auto-refresh on live updates
function refreshInventoryOnUpdate() {
  setupSocket(() => {
    loadInventory();
  });
}

if (document.body.contains(document.getElementById('inventoryTable'))) {
  refreshInventoryOnUpdate();
}
