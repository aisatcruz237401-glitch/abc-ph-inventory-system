const { supabase, isSupabaseEnabled } = require('./config/supabase');

(async () => {
  if (!isSupabaseEnabled) {
    console.log('Supabase NOT enabled');
    process.exit(0);
  }
  
  try {
    // Check inventory table
    console.log('=== INVENTORY TABLE (SAMPLE) ===');
    const { data: inventory, error: invErr } = await supabase
      .from('inventory')
      .select('*')
      .limit(3);
    
    if (!invErr && inventory && inventory.length) {
      console.log(JSON.stringify(inventory[0], null, 2));
    } else {
      console.log('Error:', invErr?.message);
    }
    
    // Check stock_transactions table
    console.log('\n=== STOCK_TRANSACTIONS TABLE (SAMPLE) ===');
    const { data: trans, error: transErr } = await supabase
      .from('stock_transactions')
      .select('*')
      .limit(3);
    
    if (!transErr && trans && trans.length) {
      console.log(JSON.stringify(trans[0], null, 2));
      
      // Get all unique transaction types
      console.log('\n=== UNIQUE TRANSACTION TYPES ===');
      const { data: uniqueTypes, error: typeErr } = await supabase
        .from('stock_transactions')
        .select('type');
      
      if (!typeErr && uniqueTypes) {
        const types = [...new Set(uniqueTypes.map(t => t.type))];
        console.log('Found types:', types.join(', '));
      }
    } else {
      console.log('Error:', transErr?.message);
    }
    
    // Check products table
    console.log('\n=== PRODUCTS TABLE (SAMPLE) ===');
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('*')
      .limit(1);
    
    if (!prodErr && products && products.length) {
      console.log(JSON.stringify(products[0], null, 2));
    } else {
      console.log('Error:', prodErr?.message);
    }
  } catch (e) {
    console.error('Exception:', e.message);
  }
})();
