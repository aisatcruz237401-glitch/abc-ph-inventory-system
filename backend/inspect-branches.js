const { supabase, isSupabaseEnabled } = require('./config/supabase');

(async () => {
  if (!isSupabaseEnabled) {
    console.log('Supabase NOT enabled');
    process.exit(0);
  }
  
  try {
    // Get all branches
    const { data: branches, error } = await supabase.from('branches').select('*');
    if (error) {
      console.log('Error:', error.message);
      process.exit(1);
    }
    
    console.log('=== ALL BRANCHES (' + branches.length + ') ===');
    branches.forEach((b, i) => {
      console.log((i+1) + '. ' + b.branch_name + ' [' + b.branch_code + '] ID: ' + b.id);
    });
    
    // Search for warehouse-related branches
    console.log('\n=== SEARCHING FOR WAREHOUSE BRANCHES ===');
    const warehouseKeywords = ['warehouse', 'main', 'central', 'distribution', 'head', 'depot', 'hub'];
    let found = false;
    branches.forEach(b => {
      const name = (b.branch_name || '').toLowerCase();
      const code = (b.branch_code || '').toLowerCase();
      warehouseKeywords.forEach(kw => {
        if (name.includes(kw) || code.includes(kw)) {
          console.log('MATCH: ' + b.branch_name + ' [' + b.branch_code + '] ID: ' + b.id);
          found = true;
        }
      });
    });
    if (!found) {
      console.log('No warehouse-related branches found');
    }
    
    // Check users table
    console.log('\n=== USERS TABLE SCHEMA ===');
    const { data: users, error: userErr } = await supabase.from('users').select('*').limit(3);
    if (!userErr && users && users.length) {
      console.log('Sample user:');
      console.log(JSON.stringify(users[0], null, 2));
    } else {
      console.log('No users found or error:', userErr?.message);
    }
  } catch (e) {
    console.error('Exception:', e.message);
  }
})();
