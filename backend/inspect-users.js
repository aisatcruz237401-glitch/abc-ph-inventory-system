const { supabase, isSupabaseEnabled } = require('./config/supabase');

(async () => {
  if (!isSupabaseEnabled) {
    console.log('Supabase NOT enabled');
    process.exit(0);
  }
  
  try {
    console.log('=== ANALYZING USER.BRANCH FIELD ===\n');
    
    // Get all users
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('username, role, branch, assigned_branch');
    
    if (usersErr) throw usersErr;
    
    // Get all branches (raw query to see all columns)
    const { data: branches, error: branchErr } = await supabase
      .from('branches')
      .select('*')
      .limit(1);
    
    if (branchErr) throw branchErr;
    
    console.log(`Users found: ${users.length}`);
    console.log('First branch record columns:', branches.length > 0 ? Object.keys(branches[0]).join(', ') : 'none');
    
    // Re-query with correct columns
    const { data: allBranches } = await supabase
      .from('branches')
      .select('*');
    
    console.log(`Branches found: ${allBranches?.length || 0}\n`);
    
    // Check if user.branch values exist as branch records
    console.log('User Branch Analysis:');
    users.forEach(user => {
      console.log(`\nUser: ${user.username} (role: ${user.role})`);
      console.log(`  branch: "${user.branch}"`);
      console.log(`  assigned_branch: "${user.assigned_branch}"`);
      
      if (allBranches && allBranches.length > 0) {
        // Determine the actual column name for branch name
        const sampleBranch = allBranches[0];
        const branchNameColumn = sampleBranch.branch_name ? 'branch_name' : sampleBranch.name ? 'name' : null;
        
        if (branchNameColumn) {
          const matchByName = allBranches.find(b => b[branchNameColumn] === user.branch);
          if (matchByName) {
            console.log(`  ✅ user.branch "${user.branch}" matches branch.${branchNameColumn}`);
          } else {
            console.log(`  ❌ user.branch "${user.branch}" does NOT match any branch.${branchNameColumn}`);
          }
        }
      }
    });
    
    console.log('\n\n=== CURRENT BRANCH NAMES IN SYSTEM ===');
    if (allBranches && allBranches.length > 0) {
      const branchNameColumn = allBranches[0].branch_name ? 'branch_name' : allBranches[0].name ? 'name' : null;
      if (branchNameColumn) {
        allBranches.slice(0, 10).forEach(b => {
          console.log(`  - "${b[branchNameColumn]}" [${b.branch_code || 'no code'}]`);
        });
        console.log(`  ... and ${allBranches.length - 10} more`);
      }
    }
    
    process.exit(0);
  } catch (e) {
    console.error('Exception:', e.message);
    process.exit(1);
  }
})();
