const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://jrvdyfxguhmysntpoaek.supabase.co', 'sb_secret_mY-IpmFnbPhs_6HvI_QdAg_THjBLMw0', { auth: { persistSession: false } });

(async () => {
  // Find Main warehouse
  const { data: branches, error: brError } = await supabase
    .from('branches')
    .select('*')
    .ilike('branch_name', '%main%');
  
  console.log('=== BRANCHES ===');
  if (brError) console.log('Error:', brError.message);
  else {
    console.log('Found branches matching "main":');
    branches.forEach(b => console.log(`  ID: ${b.id}, Code: ${b.branch_code}, Name: ${b.branch_name}, Status: ${b.status}`));
  }

  // Get a sample product
  const { data: products, error: pError } = await supabase
    .from('products')
    .select('*')
    .limit(1);
  
  console.log('\n=== PRODUCTS ===');
  if (pError) console.log('Error:', pError.message);
  else {
    console.log('Sample product:');
    console.log(JSON.stringify(products[0], null, 2));
  }
})();
