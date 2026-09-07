const fs = require('fs');
const receiveCode = fs.readFileSync('./controllers/receiveController.js', 'utf8');
const consumeCode = fs.readFileSync('./controllers/consumeController.js', 'utf8');
const deliverCode = fs.readFileSync('./controllers/deliverController.js', 'utf8');
const schemaCode = fs.readFileSync('./database/migrations/supabase_schema.sql', 'utf8');

console.log('='.repeat(100));
console.log('CODE PATH AUDIT - SERIALIZED_UNITS CREATION');
console.log('='.repeat(100));

console.log('\n[RESULT 1] receiveController mentions serialized_units:',  receiveCode.includes('serialized_units'));
console.log('[RESULT 2] consumeController mentions serialized_units:', consumeCode.includes('serialized_units'));
console.log('[RESULT 3] deliverController mentions serialized_units:', deliverCode.includes('serialized_units'));

const stockIdx = schemaCode.indexOf('receive_stock');
const stockEnd = schemaCode.indexOf('$$;', stockIdx);
const receiveStockFunc = schemaCode.substring(stockIdx, stockEnd);

console.log('[RESULT 4] receive_stock RPC contains "inventory":', receiveStockFunc.includes('inventory'));
console.log('[RESULT 5] receive_stock RPC contains "stock_transactions":', receiveStockFunc.includes('stock_transactions'));
console.log('[RESULT 6] receive_stock RPC contains "serialized_units":', receiveStockFunc.includes('serialized_units'));

console.log('\n[INVENTORY OPERATIONS]');
const inventoryInserts = (schemaCode.match(/INSERT INTO[^;]*inventory/gi) || []).length;
const inventoryUpdates = (schemaCode.match(/UPDATE[^;]*inventory/gi) || []).length;
console.log('INSERT INTO inventory statements:', inventoryInserts);
console.log('UPDATE inventory statements:', inventoryUpdates);

console.log('\n[SERIALIZED_UNITS OPERATIONS]');
const serializedInserts = (schemaCode.match(/INSERT INTO[^;]*serialized_units/gi) || []).length;
console.log('INSERT INTO serialized_units statements:', serializedInserts);

console.log('\n[CRITICAL FINDING]');
if (!receiveCode.includes('serialized_units') && !schemaCode.substring(stockIdx, stockEnd).includes('serialized_units')) {
  console.log('✗ CRITICAL: receive_stock does NOT create serialized_units');
  console.log('✗ receiveController does NOT create serialized_units either');
  console.log('✗ This explains the mismatch: inventory updated but units never created');
}
