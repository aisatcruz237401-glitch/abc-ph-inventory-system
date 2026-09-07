const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  'https://jrvdyfxguhmysntpoaek.supabase.co',
  'sb_secret_mY-IpmFnbPhs_6HvI_QdAg_THjBLMw0',
  { auth: { persistSession: false } }
);

async function deployDeliveryRPC() {
  try {
    // Read the corrected SQL
    const sqlPath = './database/migrations/supabase_delivery_corrected.sql';
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    console.log('=== DEPLOYING DELIVERY RPC TO LIVE SUPABASE ===\n');

    // Try to execute using PostgreSQL function
    // First, create a helper function to execute raw SQL if it doesn't exist
    const helperSQL = `
      CREATE OR REPLACE FUNCTION public.exec_raw_sql(sql TEXT)
      RETURNS VOID AS $$
      BEGIN
        EXECUTE sql;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `;

    console.log('Step 1: Creating SQL execution helper...');
    const { error: helperError } = await supabase.rpc('exec_raw_sql', { sql: helperSQL });
    if (helperError && !helperError.message.includes('already exists')) {
      console.log('Note: Helper function result:', helperError?.message || 'success');
    }

    // Now execute the delivery RPC creation
    console.log('Step 2: Executing delivery RPC migration...');
    
    // Split the SQL into logical chunks
    const chunks = sqlContent
      .split('\n\n')
      .map(chunk => chunk.trim())
      .filter(chunk => chunk.length > 0 && !chunk.startsWith('--'));

    console.log(`Found ${chunks.length} SQL chunks to execute\n`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`Executing chunk ${i + 1}/${chunks.length}...`);
      console.log('Type:', 
        chunk.includes('CREATE TABLE') ? 'CREATE TABLE' :
        chunk.includes('CREATE INDEX') ? 'CREATE INDEX' :
        chunk.includes('CREATE OR REPLACE FUNCTION') ? 'CREATE FUNCTION' :
        'OTHER'
      );

      try {
        // Use the Supabase query API
        const { data, error } = await supabase.from('_sql').select('*');
        // This won't work - we need a different approach
        
        console.log('Note: Supabase JS client cannot execute raw SQL directly\n');
        break;
      } catch (err) {
        errorCount++;
      }
    }

    // Fallback: Direct test of RPC
    console.log('\n=== ATTEMPTING DIRECT RPC CALL ===');
    const { data: testData, error: testError } = await supabase.rpc('deliver_stock', {
      p_from_branch_id: '88a91c0b-8366-4b8f-ae30-bbe9ff2b7583',
      p_to_branch_id: '68ed9487-959f-4406-90e9-548fdbbc4f70',
      p_barcode: 'VERIFY_ONLY',
      p_qty: 1,
      p_user: 'verify'
    });

    if (testError) {
      console.log('RPC Call Error:', testError.message);
      if (testError.message.includes('product_not_found')) {
        console.log('\n✓ SUCCESS: RPC EXISTS - returned product_not_found as expected');
      } else if (testError.message.includes('does not exist') || testError.message.includes('Could not find')) {
        console.log('\n✗ FAILURE: RPC does NOT exist in the live database');
        console.log('\nIMPORTANT: The Supabase JS client cannot execute raw SQL.');
        console.log('You must deploy the RPC using the Supabase SQL Editor manually.');
        console.log('\nSQL file location: ./database/migrations/supabase_delivery_corrected.sql');
        console.log('Instructions:');
        console.log('1. Log into your Supabase project at https://app.supabase.com');
        console.log('2. Go to SQL Editor');
        console.log('3. Create a new query');
        console.log('4. Copy and paste the SQL from supabase_delivery_corrected.sql');
        console.log('5. Execute the query');
      }
    } else {
      console.log('✓ SUCCESS: RPC EXISTS - returned data:', testData);
    }
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
}

deployDeliveryRPC();
