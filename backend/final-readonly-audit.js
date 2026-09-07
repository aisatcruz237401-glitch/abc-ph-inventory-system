const fs = require('fs');
const path = require('path');
const { supabase, isSupabaseEnabled } = require('./config/supabase');

const root = path.resolve(__dirname, '..');
const targets = {
  pasong: '68ed9487-959f-4406-90e9-548fdbbc4f70',
  sanAgustin: '88a91c0b-8366-4b8f-ae30-bbe9ff2b7583',
  angono: '565f7b4c-3798-4e9c-ba62-689c727f11dc',
};
const abhayrab = '00850591-1b9d-465c-905f-bbd8c7c10057';

function sourceFiles() {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (['.js', '.sql', '.html', '.json', '.bat', '.ps1'].includes(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  }
  walk(root);
  return files;
}

function staticAudit() {
  const patterns = {
    serializedUnitInserts: /INSERT\s+INTO\s+(?:public\.)?serialized_units|\.from\(\s*['"]serialized_units['"]\s*\)\s*\.insert/ig,
    serializedUnitWrites: /(?:INSERT\s+INTO|UPDATE)\s+(?:public\.)?serialized_units|\.from\(\s*['"]serialized_units['"]\s*\)\s*\.(?:insert|update|upsert)/ig,
    inventoryWrites: /(?:INSERT\s+INTO|UPDATE)\s+(?:public\.)?inventory|inventory\.quantity|quantity\s*=\s*quantity\s*[+-]|\.from\(\s*['"]inventory['"]\s*\)\s*\.(?:insert|update|upsert)/ig,
    stockTransactionWrites: /INSERT\s+INTO\s+(?:public\.)?stock_transactions|\.from\(\s*['"]stock_transactions['"]\s*\)\s*\.(?:insert|update|upsert)/ig,
    rpcCalls: /\.rpc\(\s*['"]([^'"]+)['"]/ig,
    triggers: /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER|CREATE\s+TRIGGER/ig,
    functions: /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/ig,
  };
  const result = {};
  for (const [name, pattern] of Object.entries(patterns)) result[name] = [];
  for (const file of sourceFiles()) {
    const content = fs.readFileSync(file, 'utf8');
    const relative = path.relative(root, file).replaceAll('\\', '/');
    for (const [name, pattern] of Object.entries(patterns)) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content))) {
        const line = content.slice(0, match.index).split('\n').length;
        result[name].push({ file: relative, line, text: content.split('\n')[line - 1].trim() });
      }
    }
  }
  return result;
}

async function readTable(table, columns = '*') {
  if (!supabase) return { table, error: 'Supabase disabled' };
  const response = await supabase.from(table).select(columns).limit(1000);
  return { table, count: response.data?.length || 0, data: response.data || [], error: response.error?.message || null };
}

function summarizeUnits(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.product_uuid}|${row.branch_id}`;
    if (!groups.has(key)) groups.set(key, { product_uuid: row.product_uuid, branch_id: row.branch_id, total: 0, statuses: {}, sequences: [], barcodes: [] });
    const group = groups.get(key);
    group.total++;
    group.statuses[row.status || 'NULL'] = (group.statuses[row.status || 'NULL'] || 0) + 1;
    if (Number.isFinite(Number(row.sequence_number))) group.sequences.push(Number(row.sequence_number));
    if (row.unit_barcode != null) group.barcodes.push(row.unit_barcode);
  }
  return [...groups.values()].map(group => ({
    ...group,
    min_sequence: group.sequences.length ? Math.min(...group.sequences) : null,
    max_sequence: group.sequences.length ? Math.max(...group.sequences) : null,
    duplicate_barcodes: group.barcodes.filter((value, index, all) => all.indexOf(value) !== index),
    duplicate_sequences: group.sequences.filter((value, index, all) => all.indexOf(value) !== index),
  }));
}

function summarizeTrfs(rows) {
  const values = [];
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if (typeof value === 'string' && value.startsWith('TRF-')) values.push({ column, value, row_id: row.id ?? row.uuid ?? null });
    }
  }
  const counts = {};
  for (const item of values) counts[item.value] = (counts[item.value] || 0) + 1;
  return { values, duplicates: Object.entries(counts).filter(([, count]) => count > 1) };
}

function ledger(rows, branchId, productUuid) {
  const selected = rows.filter(row => row.branch_id === branchId && row.product_uuid === productUuid).sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.id) - Number(b.id));
  let balance = 0;
  const entries = selected.map(row => {
    const incoming = ['RECEIVE', 'TRANSFER_IN'].includes(row.type);
    balance += incoming ? Number(row.quantity || 0) : -Number(row.quantity || 0);
    return { id: row.id, date: row.date, type: row.type, quantity: row.quantity, tracking_code: row.tracking_code, running_balance: balance };
  });
  return { entries, final_balance: balance };
}

async function main() {
  console.log('FINAL READ-ONLY AUDIT');
  console.log('NO business RPCs invoked; no database writes performed.');
  console.log('\nSTATIC REPOSITORY AUDIT');
  const staticResult = staticAudit();
  for (const [name, rows] of Object.entries(staticResult)) {
    console.log(`\n${name}: ${rows.length}`);
    for (const row of rows.slice(0, 100)) console.log(`  ${row.file}:${row.line}: ${row.text}`);
    if (rows.length > 100) console.log(`  ... ${rows.length - 100} more`);
  }

  if (!isSupabaseEnabled || !supabase) {
    console.log('\nLIVE DATABASE: Supabase disabled or unavailable from configuration.');
    return;
  }

  console.log('\nLIVE TABLE READS');
  const tableNames = ['products', 'branches', 'inventory', 'serialized_units', 'stock_transactions', 'transfer_headers', 'transfer_items', 'transfer_item_units', 'delivery_transactions'];
  const live = {};
  for (const table of tableNames) {
    live[table] = await readTable(table);
    console.log(`${table}: rows=${live[table].count ?? 'n/a'} error=${live[table].error || 'none'}`);
    if (live[table].data?.[0]) console.log(`  columns: ${Object.keys(live[table].data[0]).join(', ')}`);
  }

  console.log('\nABHAYRAB TARGET-BRANCH SUMMARY');
  const inventoryRows = live.inventory.data || [];
  const unitRows = (live.serialized_units.data || []).filter(row => row.product_uuid === abhayrab && Object.values(targets).includes(row.branch_id));
  const transactionRows = live.stock_transactions.data || [];
  for (const [branchName, branchId] of Object.entries(targets)) {
    const inventory = inventoryRows.find(row => row.product_uuid === abhayrab && row.branch_id === branchId);
    const units = unitRows.filter(row => row.branch_id === branchId);
    const txLedger = ledger(transactionRows, branchId, abhayrab);
    console.log(JSON.stringify({ branch: branchName, branch_id: branchId, inventory_quantity: inventory?.quantity ?? null, units: summarizeUnits(units), ledger: txLedger }, null, 2));
  }

  console.log('\nTRF VALUE SCAN');
  for (const [table, response] of Object.entries(live)) {
    if (response.data?.length) console.log(table, JSON.stringify(summarizeTrfs(response.data)));
  }

  console.log('\nCATALOG ACCESS CHECK (READ-ONLY)');
  for (const relation of ['pg_proc', 'pg_trigger', 'information_schema.columns']) {
    const response = await supabase.from(relation).select('*').limit(5);
    console.log(`${relation}: ${response.error ? `not exposed: ${response.error.message}` : `accessible rows=${response.data?.length || 0}`}`);
  }

  console.log('\nAUDIT LIMITATIONS');
  console.log('- Supabase PostgREST table reads do not expose function bodies or trigger definitions unless an approved read-only database view/RPC exists.');
  console.log('- No business RPC was invoked because known receive/transfer functions can mutate data.');
  console.log('- A matching timestamp can establish correlation, not the identity of the process that inserted a serialized unit.');
}

main().catch(error => {
  console.error('AUDIT ERROR:', error.message);
  process.exitCode = 1;
});
