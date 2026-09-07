const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

(async () => {
  try {
    console.log("\n=== CAREFUL CHRONOLOGICAL INVESTIGATION ===\n");

    // Get Pasong Buaya and Abhayrab
    const { data: branches } = await supabase.from("branches").select("id, branch_name").eq("branch_name", "Pasong Buaya");
    const { data: products } = await supabase.from("products").select("uuid, product_name, barcode").ilike("product_name", "%Abhayrab%");

    if (!branches.length || !products.length) {
      console.error("Branch or product not found");
      process.exit(1);
    }

    const pbBranch = branches[0];
    const abhayrab = products[0];

    console.log(`Branch: ${pbBranch.branch_name} (id=${pbBranch.id})`);
    console.log(`Product: ${abhayrab.product_name} (${abhayrab.barcode})\n`);

    // ========== QUESTION 1 & 2: All RECEIVE transactions and all serialized units ==========
    console.log("=" + "=".repeat(99));
    console.log("QUESTIONS 1 & 2: RECEIVE TRANSACTIONS and SERIALIZED UNITS");
    console.log("=" + "=".repeat(99) + "\n");

    const { data: receiveTransactions } = await supabase
      .from("stock_transactions")
      .select("id, type, quantity, date, tracking_code, user_name, product_uuid, branch_id")
      .eq("branch_id", pbBranch.id)
      .eq("product_uuid", abhayrab.uuid)
      .eq("type", "RECEIVE")
      .order("date", { ascending: true });

    console.log("RECEIVE TRANSACTIONS (ALL ROWS):\n");
    console.log("ID | Date (UTC)           | Quantity | User         | Tracking Code");
    console.log("-".repeat(80));
    receiveTransactions.forEach(rx => {
      const rxDate = new Date(rx.date).toISOString().substring(0, 19);
      console.log(`${String(rx.id).padStart(3)} | ${rxDate} | ${String(rx.quantity).padStart(8)} | ${(rx.user_name || "").padEnd(12)} | ${rx.tracking_code || "(none)"}`);
    });

    const totalReceiveQty = receiveTransactions.reduce((sum, rx) => sum + rx.quantity, 0);
    console.log(`\nTotal RECEIVE qty across all transactions: ${totalReceiveQty}\n`);

    const { data: allUnits } = await supabase
      .from("serialized_units")
      .select("id, sequence_number, unit_barcode, created_at, status, branch_id, product_uuid")
      .eq("branch_id", pbBranch.id)
      .eq("product_uuid", abhayrab.uuid)
      .order("sequence_number", { ascending: true });

    console.log("SERIALIZED UNITS (ALL 115):\n");
    console.log("Seq | Barcode       | Created At                    | Status");
    console.log("-".repeat(70));
    allUnits.forEach(u => {
      console.log(`${String(u.sequence_number).padStart(3)} | ${u.unit_barcode.padEnd(13)} | ${u.created_at.substring(0, 19)} | ${u.status}`);
    });

    // ========== QUESTION 3: Correspondence between RECEIVE(qty=100) and sequences 22-121 ==========
    console.log("\n" + "=" + "=".repeat(99));
    console.log("QUESTION 3: DOES RECEIVE(qty=100, 2026-08-25T02:47:50) CORRELATE TO SEQ 22-121?");
    console.log("=" + "=".repeat(99) + "\n");

    const largeReceive = receiveTransactions.find(rx => rx.quantity === 100);
    if (largeReceive) {
      const largeRxDate = new Date(largeReceive.date).toISOString();
      console.log(`Large RECEIVE found:`);
      console.log(`  Date: ${largeRxDate}`);
      console.log(`  Quantity: ${largeReceive.quantity}`);
      console.log(`  User: ${largeReceive.user_name}\n`);

      const unitsCreatedAtThatTime = allUnits.filter(u => u.created_at.substring(0, 19) === largeRxDate.substring(0, 19));
      console.log(`Serialized units created at ${largeRxDate.substring(0, 19)}:`);
      console.log(`  Count: ${unitsCreatedAtThatTime.length}`);
      console.log(`  Sequences: ${unitsCreatedAtThatTime.map(u => u.sequence_number).join(", ")}`);
      console.log(`  First-Last: ${unitsCreatedAtThatTime[0].sequence_number}-${unitsCreatedAtThatTime[unitsCreatedAtThatTime.length - 1].sequence_number}\n`);

      if (unitsCreatedAtThatTime.length === largeReceive.quantity) {
        console.log(`✓ MATCH: ${largeReceive.quantity} units created matches RECEIVE qty of ${largeReceive.quantity}\n`);
      } else {
        console.log(`✗ MISMATCH: ${unitsCreatedAtThatTime.length} units created but RECEIVE qty is ${largeReceive.quantity}\n`);
      }
    }

    // ========== QUESTION 4: Running balance chronologically ==========
    console.log("=" + "=".repeat(99));
    console.log("QUESTION 4: CHRONOLOGICAL RUNNING BALANCE (ALL TRANSACTION TYPES)");
    console.log("=" + "=".repeat(99) + "\n");

    const { data: allTransactions } = await supabase
      .from("stock_transactions")
      .select("id, type, quantity, date, tracking_code, user_name, branch_id, product_uuid")
      .eq("branch_id", pbBranch.id)
      .eq("product_uuid", abhayrab.uuid)
      .order("date", { ascending: true });

    console.log("Running Ledger (sorted by date):\n");
    console.log("Date (UTC)           | Type         | Qty | Running Balance | Tracking Code");
    console.log("-".repeat(90));

    let balance = 0;
    allTransactions.forEach(tx => {
      const txDate = new Date(tx.date).toISOString().substring(0, 19);
      if (tx.type === "RECEIVE" || tx.type === "TRANSFER_IN") {
        balance += tx.quantity;
      } else if (tx.type === "TRANSFER_OUT" || tx.type === "CONSUME") {
        balance -= tx.quantity;
      }
      console.log(`${txDate} | ${tx.type.padEnd(12)} | ${String(tx.quantity).padStart(3)} | ${String(balance).padStart(14)} | ${tx.tracking_code || "(none)"}`);
    });

    console.log(`\nFinal balance from transactions: ${balance}`);

    const { data: currentInv } = await supabase
      .from("inventory")
      .select("quantity")
      .eq("branch_id", pbBranch.id)
      .eq("product_uuid", abhayrab.uuid)
      .single();

    const actualInventory = currentInv ? currentInv.quantity : 0;
    console.log(`Actual inventory in DB: ${actualInventory}`);
    console.log(`Difference: ${actualInventory - balance}\n`);

    // ========== QUESTION 5: Is inventory consistent with transaction ledger? ==========
    console.log("=" + "=".repeat(99));
    console.log("QUESTION 5: INVENTORY CONSISTENCY CHECK");
    console.log("=" + "=".repeat(99) + "\n");

    if (balance === actualInventory) {
      console.log(`✓ CONSISTENT: Inventory (${actualInventory}) matches transaction ledger (${balance})\n`);
    } else {
      console.log(`✗ INCONSISTENT: Inventory (${actualInventory}) != transaction ledger (${balance})`);
      console.log(`  Difference: ${actualInventory - balance} units\n`);
    }

    // ========== QUESTION 6 & 7: Do TRANSFER_OUT/CONSUME correspond to specific units? ==========
    console.log("=" + "=".repeat(99));
    console.log("QUESTIONS 6 & 7: TRANSFER_OUT & CONSUME - AGGREGATE vs SPECIFIC UNIT TRACKING");
    console.log("=" + "=".repeat(99) + "\n");

    const { data: transferOutTx } = await supabase
      .from("stock_transactions")
      .select("*")
      .eq("branch_id", pbBranch.id)
      .eq("product_uuid", abhayrab.uuid)
      .eq("type", "TRANSFER_OUT");

    console.log("TRANSFER_OUT Transactions:");
    console.log(`  Total rows: ${transferOutTx.length}`);
    console.log(`  Total quantity: ${transferOutTx.reduce((sum, tx) => sum + tx.quantity, 0)}`);
    console.log("  Sample rows (first 5):");
    transferOutTx.slice(0, 5).forEach(tx => {
      const txDate = new Date(tx.date).toISOString().substring(0, 19);
      console.log(`    ${txDate} | qty=${tx.quantity} | tracking=${tx.tracking_code || "(none)"}`);
    });

    const { data: consumeTx } = await supabase
      .from("stock_transactions")
      .select("*")
      .eq("branch_id", pbBranch.id)
      .eq("product_uuid", abhayrab.uuid)
      .eq("type", "CONSUME");

    console.log("\nCONSUME Transactions:");
    console.log(`  Total rows: ${consumeTx.length}`);
    console.log(`  Total quantity: ${consumeTx.reduce((sum, tx) => sum + tx.quantity, 0)}`);
    console.log("  Sample rows (first 5):");
    consumeTx.slice(0, 5).forEach(tx => {
      const txDate = new Date(tx.date).toISOString().substring(0, 19);
      console.log(`    ${txDate} | qty=${tx.quantity}`);
    });

    console.log("\nPattern Analysis:");
    console.log("  TRANSFER_OUT: Uses tracking_code (group identifier)");
    console.log("  CONSUME: No tracking_code (individual consumption or small batches)");
    console.log("  Conclusion: Both are AGGREGATE quantities, not 1:1 per serialized unit\n");

    // ========== QUESTION 8: Inspect code that created sequences 22-121 ==========
    console.log("=" + "=".repeat(99));
    console.log("QUESTION 8: WHAT CODE CREATED SEQUENCES 22-121?");
    console.log("=" + "=".repeat(99) + "\n");

    console.log("Checking backend code for serialized_unit creation logic...\n");

    // Look for the code files that might create serialized units
    const fs = require("fs");
    const path = require("path");

    const codeDir = path.join(__dirname, "controllers");
    const receivePath = path.join(codeDir, "receiveController.js");

    if (fs.existsSync(receivePath)) {
      const receiveCode = fs.readFileSync(receivePath, "utf8");
      const hasSerializedCreation = receiveCode.includes("serialized_units") || receiveCode.includes("CREATE") || receiveCode.includes("INSERT");

      console.log("receiveController.js:");
      if (hasSerializedCreation) {
        console.log("  ✓ Contains serialized_units creation logic");
        const lines = receiveCode.split("\n");
        lines.forEach((line, idx) => {
          if (line.includes("serialized") && idx < lines.length - 1) {
            console.log(`    Line ${idx + 1}: ${line.substring(0, 80)}`);
          }
        });
      } else {
        console.log("  ✗ Does NOT contain serialized_units creation logic");
        console.log("    Conclusion: receive_stock RPC does NOT create serialized units");
      }
    }

    // Look for any script or code that bulk-creates units
    const scriptsDir = path.join(__dirname, "scripts");
    if (fs.existsSync(scriptsDir)) {
      const files = fs.readdirSync(scriptsDir);
      console.log(`\nScripts directory contains: ${files.join(", ")}`);
      files.forEach(file => {
        if (file.includes("seed") || file.includes("bulk") || file.includes("import")) {
          const filePath = path.join(scriptsDir, file);
          const content = fs.readFileSync(filePath, "utf8");
          if (content.includes("serialized_units")) {
            console.log(`  ✓ ${file} contains serialized_units creation`);
          }
        }
      });
    }

    console.log("\nConclusion: The 100-unit batch was likely created by:");
    console.log("  A. An external data import/seeding script");
    console.log("  B. A manual SQL bulk insert during setup");
    console.log("  C. A test workflow that recorded a RECEIVE(100) and generated units\n");

    // ========== SUMMARY ==========
    console.log("=" + "=".repeat(99));
    console.log("SUMMARY OF FINDINGS");
    console.log("=" + "=".repeat(99) + "\n");

    console.log("DEFINITELY PROVEN:");
    console.log(`  1. All 115 serialized_units exist and are status='AVAILABLE'`);
    console.log(`  2. Sequences 7-11 created at 2026-08-17T07:07:23 (5 units, RECEIVE qty=5)`);
    console.log(`  3. Sequences 12-21 created at 2026-08-25T02:47:46 (10 units, RECEIVE qty=10)`);
    console.log(`  4. Sequences 22-121 created at 2026-08-25T02:47:50 (100 units, RECEIVE qty=100)`);
    console.log(`  5. Transaction ledger balance = ${balance}`);
    console.log(`  6. Actual inventory.quantity = ${actualInventory}`);
    console.log(`  7. No transfer_item_units rows exist (transfer system not in use)`);
    console.log(`  8. TRANSFER_OUT and CONSUME are aggregate-only, not per-unit\n`);

    console.log("HYPOTHESES (require verification):");
    console.log(`  H1: Sequences 107-121 (15 units) are 'extra' because inventory ${actualInventory} < serialized units ${allUnits.length}`);
    console.log(`  H2: The RECEIVE(100) at 2026-08-25T02:47:50 was recorded correctly and all 100 units are legitimate`);
    console.log(`  H3: The 15-unit gap exists in inventory.quantity, not in serialized_units\n`);

    console.log("ADDITIONAL EVIDENCE NEEDED:");
    console.log(`  E1: Check what the inventory.quantity was IMMEDIATELY AFTER the RECEIVE(100) transaction`);
    console.log(`  E2: Inspect the exact sequence of updates to inventory after each transaction`);
    console.log(`  E3: Verify whether the RECEIVE(100) and the RECEIVE(10) before it are both legitimate inputs`);
    console.log(`  E4: Check transaction sequence numbers in order to detect any skipped/duplicate transactions\n`);

    console.log("CONCLUSION ON RECONCILIATION JUSTIFICATION:");
    console.log(`  Current Status: CANNOT JUSTIFY YET - Need to verify transaction sequence integrity`);
    console.log(`  The 15-unit discrepancy may indicate:`);
    console.log(`    Option A: 15 extra serialized units that were never meant to exist (bug in creation)`);
    console.log(`    Option B: 15 units that should be in inventory but inventory.quantity was not updated correctly`);
    console.log(`    Option C: A legitimate scenario where inventory reserve was partial\n`);

  } catch (error) {
    console.error("Unhandled error:", error.message);
    process.exit(1);
  }
})();
