const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host: 'aws-0-us-east-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.jrvdyfxguhmysntpoaek',
  password: 'sb_secret_mY-IpmFnbPhs_6HvI_QdAg_THjBLMw0',
  ssl: {
    rejectUnauthorized: false
  },
});

async function deployDeliveryRPC() {
  const client = await pool.connect();
  try {
    // Read the corrected SQL
    const sqlPath = './database/migrations/supabase_delivery_corrected.sql';
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    console.log('=== DEPLOYING DELIVERY RPC TO LIVE SUPABASE ===\n');

    // Execute the entire SQL script as one transaction
    const result = await client.query(sqlContent);

    console.log('SQL execution completed');
    console.log('Result:', result);

    console.log('\n\n=== VERIFYING RPC DEPLOYMENT ===');

    // Test the RPC with an invalid barcode (should fail with product_not_found, not function not found)
    try {
      const verifyResult = await client.query(
        'SELECT * FROM public.deliver_stock($1, $2, $3, $4, $5)',
        [
          '88a91c0b-8366-4b8f-ae30-bbe9ff2b7583',
          '68ed9487-959f-4406-90e9-548fdbbc4f70',
          'VERIFY_ONLY',
          0,
          'verify'
        ]
      );

      console.log('RPC FOUND - Test result:', verifyResult.rows);
    } catch (err) {
      if (err.message.includes('does not exist')) {
        console.log('ERROR: RPC function still does not exist after deployment');
        console.log('Error:', err.message);
      } else {
        console.log('RPC EXISTS - Error from test call:', err.message);
      }
    }

    // Get the RPC signature
    console.log('\n\n=== RETRIEVING DEPLOYED RPC SIGNATURE ===');
    const signatureResult = await client.query(`
      SELECT 
        n.nspname as schema,
        p.proname as function_name,
        pg_get_functiondef(p.oid) as function_def,
        pg_get_function_identity_arguments(p.oid) as arguments,
        pg_get_function_result(p.oid) as return_type
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'deliver_stock'
      LIMIT 1
    `);

    if (signatureResult.rows.length > 0) {
      const sig = signatureResult.rows[0];
      console.log('Function Name:', sig.function_name);
      console.log('Schema:', sig.schema);
      console.log('Arguments:', sig.arguments);
      console.log('Return Type:', sig.return_type);
      console.log('\nFull Definition (first 500 chars):');
      console.log(sig.function_def.substring(0, 500));
    } else {
      console.log('ERROR: Could not retrieve RPC signature - function may not exist');
    }
  } catch (err) {
    console.error('\n\nFATAL ERROR:', err.message);
    console.error('Code:', err.code);
  } finally {
    await client.end();
    await pool.end();
  }
}

deployDeliveryRPC();
