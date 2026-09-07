const { supabase, isSupabaseEnabled } = require('./config/supabase');

(async () => {
  if (!isSupabaseEnabled) {
    console.log('Supabase NOT enabled');
    process.exit(0);
  }
  
  try {
    // Get information_schema for stock_transactions
    console.log('=== STOCK_TRANSACTIONS TABLE SCHEMA ===');
    const { data: schema, error: schemaErr } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable, column_default')
      .eq('table_name', 'stock_transactions')
      .order('ordinal_position', { ascending: true });
    
    if (!schemaErr && schema) {
      schema.forEach(col => {
        console.log(`${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable}, default: ${col.column_default})`);
      });
    } else {
      // Fallback: query sample and describe
      const { data: sample } = await supabase
        .from('stock_transactions')
        .select('*')
        .limit(1);
      if (sample && sample.length) {
        console.log('Sample transaction fields:');
        Object.keys(sample[0]).forEach(key => {
          console.log(`  - ${key}: ${typeof sample[0][key]}`);
        });
      }
    }
    
    // Check for any trigger or constraint info
    console.log('\n=== CHECKING RPC AVAILABILITY ===');
    // Try to list functions from pg_proc (if accessible)
    const { data: rpcList, error: rpcErr } = await supabase
      .rpc('get_rpc_info', {});
    
    if (rpcErr) {
      console.log('Custom RPC get_rpc_info not available (expected)');
      console.log('Testing known RPCs...');
      
      // Test receive_stock with dry run (empty params - expect error)
      const { error: receiveErr } = await supabase.rpc('receive_stock', {
        p_barcode: '',
        p_branch_id: '00000000-0000-0000-0000-000000000000',
        p_qty: 0,
        p_note: ''
      });
      console.log(`receive_stock RPC: ${receiveErr ? 'EXISTS (error expected on empty input)' : 'CALLABLE'}`);
      
      // Test consume_stock
      const { error: consumeErr } = await supabase.rpc('consume_stock', []);
      console.log(`consume_stock RPC: ${consumeErr && consumeErr.message.includes('arguments') ? 'EXISTS (parameter mismatch expected)' : 'EXISTS'}`);
      
      // Test deliver_stock
      const { error: deliverErr } = await supabase.rpc('deliver_stock', {
        p_from_branch_id: '00000000-0000-0000-0000-000000000000',
        p_to_branch_id: '00000000-0000-0000-0000-000000000000',
        p_barcode: '',
        p_qty: 0,
        p_user: ''
      });
      if (deliverErr && deliverErr.message.includes('does not exist')) {
        console.log('deliver_stock RPC: DOES NOT EXIST');
      } else {
        console.log(`deliver_stock RPC: EXISTS (error on empty: ${deliverErr?.message})`);
      }
    }
    
    process.exit(0);
  } catch (e) {
    console.error('Exception:', e.message);
    process.exit(1);
  }
})();
