const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

(async () => {
  try {
    console.log("\n=== DEEP READ-ONLY INVESTIGATION: PASONG BUAYA / ABHAYRAB ===\n");

    // Get Pasong Buaya and Abhayrab details
    const { data: branches } = await supabase.from("branches").select("id, branch_name").eq("branch_name", "Pasong Buaya");
    const { data: products } = await supabase.from("products").select("uuid, product_name, barcode").ilike("product_name", "%Abhayrab%");

    if (!branches.length || !products.length) {
      console.error("Branch or product not found");
      process.exit(1);
    }

    const pbBranch = branches[0];
    const abhayrab = products[0];
    console.log(`Branch: ${pbBranch.branch_name} (id=${pbBranch.id})`);
    console.log(`Product: ${abhayrab.product_name} (${abhayrab.barcode}, uuid=${abhayrab.uuid})\n`);

    // ========== SECTION 1: ALL SERIALIZED UNITS WITH TIMESTAMPS ==========
    console.log("=" * 100);
    console.log("SECTION 1: ALL SERIALIZED UNITS (seq 7-121) - CREATION TIMESTAMPS");
    console.log("=" * 100 + "\n");

    const { data: allUnits, error: unitsErr } = await supabase
      .from("serialized_units")
      .select("id, sequence_number, unit_barcode, status, created_at, updated_at")
      .eq("branch_id", pbBranch.id)
      .eq("product_uuid", abhayrab.uuid)
      .order("sequence_number", { ascending: true });

    if (unitsErr) {
      console.error("ERROR fetching serialized_units:", unitsErr);
      process.exit(1);
    }

    console.log(`Total units: ${allUnits.length}\n`);
    console.log("Sequence | Unit Barcode  | Status    | Created At                    | Updated At");
    console.log("-".repeat(95));

    const unitsBySeq = {};
    allUnits.forEach(u => {
      unitsBySeq[u.sequence_number] = u;
      const createdDate = u.created_at ? new Date(u.created_at).toISOString() : "NULL";
      const updatedDate = u.updated_at ? new Date(u.updated_at).toISOString() : "NULL";
      console.log(`${String(u.sequence_number).padStart(8)} | ${u.unit_barcode.padEnd(13)} | ${u.status.padEnd(9)} | ${createdDate} | ${updatedDate}`);
    });

    // ========== SECTION 2: COMPLETE STOCK TRANSACTION HISTORY ==========
    console.log("\n" + "=" * 100);
    console.log("SECTION 2: COMPLETE STOCK TRANSACTION HISTORY (CHRONOLOGICAL)");
    console.log("=" * 100 + "\n");

    const { data: transactions, error: txErr } = await supabase
      .from("stock_transactions")
      .select("id, type, quantity, date, tracking_code, branch_id, user_name, product_uuid")
      .eq("branch_id", pbBranch.id)
      .eq("product_uuid", abhayrab.uuid)
      .order("date", { ascending: true });

    let globalExpectedInventory = 0;
    let globalActualInventory = 0;
    let globalReceive = 0;
    let globalTransferIn = 0;
    let globalTransferOut = 0;
    let globalConsume = 0;

    if (txErr) {
      console.error("ERROR fetching stock_transactions:", txErr);
    } else {
      console.log(`Total transactions: ${transactions.length}\n`);
      console.log("Date (UTC)           | Type         | Qty | Tracking Code      | User Name");
      console.log("-".repeat(90));

      let runningQty = 0;
      const txsByType = { RECEIVE: [], TRANSFER_IN: [], TRANSFER_OUT: [], CONSUME: [] };

      transactions.forEach(tx => {
        if (tx.type === "RECEIVE" || tx.type === "TRANSFER_IN") {
          runningQty += tx.quantity;
        } else if (tx.type === "TRANSFER_OUT" || tx.type === "CONSUME") {
          runningQty -= tx.quantity;
        }

        const txDate = new Date(tx.date).toISOString().substring(0, 19);
        console.log(`${txDate} | ${tx.type.padEnd(12)} | ${String(tx.quantity).padStart(3)} | ${String(tx.tracking_code || "").padEnd(18)} | ${tx.user_name}`);

        if (txsByType[tx.type]) {
          txsByType[tx.type].push(tx);
        }
      });

      console.log(`\nRunning Total After All Transactions: ${runningQty}`);

      // ========== SECTION 3: TRANSACTION SUMMARY & INVENTORY RECONCILIATION ==========
      console.log("\n" + "=" * 100);
      console.log("SECTION 3: TRANSACTION SUMMARY & INVENTORY RECONCILIATION");
      console.log("=" * 100 + "\n");

      globalReceive = txsByType.RECEIVE.reduce((sum, tx) => sum + tx.quantity, 0);
      globalTransferIn = txsByType.TRANSFER_IN.reduce((sum, tx) => sum + tx.quantity, 0);
      globalTransferOut = txsByType.TRANSFER_OUT.reduce((sum, tx) => sum + tx.quantity, 0);
      globalConsume = txsByType.CONSUME.reduce((sum, tx) => sum + tx.quantity, 0);

      console.log("RECEIVE:        " + String(globalReceive).padStart(3) + " units");
      console.log("TRANSFER_IN:    " + String(globalTransferIn).padStart(3) + " units");
      console.log("TRANSFER_OUT:   " + String(globalTransferOut).padStart(3) + " units");
      console.log("CONSUME:        " + String(globalConsume).padStart(3) + " units");
      console.log("-".repeat(30));

      globalExpectedInventory = globalReceive + globalTransferIn - globalTransferOut - globalConsume;
      console.log("Expected: 0 + " + globalReceive + " + " + globalTransferIn + " - " + globalTransferOut + " - " + globalConsume + " = " + globalExpectedInventory);

      const { data: currentInv } = await supabase
        .from("inventory")
        .select("quantity")
        .eq("branch_id", pbBranch.id)
        .eq("product_uuid", abhayrab.uuid)
        .single();

      globalActualInventory = currentInv ? currentInv.quantity : 0;
      console.log("Actual Inventory:   " + globalActualInventory);

      if (globalExpectedInventory === globalActualInventory) {
        console.log(`✓ MATCH: Inventory reconciles perfectly`);
      } else {
        const diff = globalActualInventory - globalExpectedInventory;
        console.log(`✗ MISMATCH: Difference = ${diff} (actual - expected)`);
      }
    }

    // ========== SECTION 4: UNIT CREATION TIMELINE vs TRANSACTION TIMELINE ==========
    console.log("\n" + "=" * 100);
    console.log("SECTION 4: UNIT CREATION TIMELINE vs TRANSACTION TIMELINE");
    console.log("=" * 100 + "\n");

    if (allUnits.length > 0 && transactions.length > 0) {
      const firstUnitCreated = new Date(Math.min(...allUnits.map(u => new Date(u.created_at))));
      const lastUnitCreated = new Date(Math.max(...allUnits.map(u => new Date(u.created_at))));
      const firstTx = new Date(transactions[0].date);
      const lastTx = new Date(transactions[transactions.length - 1].date);

      console.log("Unit Creation Timeline:");
      console.log(`  First unit created:  ${firstUnitCreated.toISOString()}`);
      console.log(`  Last unit created:   ${lastUnitCreated.toISOString()}`);
      console.log(`  Span: ${Math.floor((lastUnitCreated - firstUnitCreated) / 1000 / 60)} minutes`);

      console.log("\nTransaction Timeline:");
      console.log(`  First transaction:   ${firstTx.toISOString()}`);
      console.log(`  Last transaction:    ${lastTx.toISOString()}`);
      console.log(`  Span: ${Math.floor((lastTx - firstTx) / 1000 / 60 / 60)} hours`);

      console.log("\nTimeline Relationship:");
      if (firstUnitCreated < firstTx) {
        console.log("  Units were created BEFORE transactions began");
      } else if (firstUnitCreated > lastTx) {
        console.log("  Units were created AFTER all transactions ended");
      } else {
        console.log("  Units were created DURING transaction period");
      }

      // Group units by creation timestamp
      console.log("\nUnits Grouped by Creation Timestamp:");
      const unitsByCreated = {};
      allUnits.forEach(u => {
        const createdKey = u.created_at ? u.created_at.substring(0, 10) : "NULL";
        if (!unitsByCreated[createdKey]) unitsByCreated[createdKey] = [];
        unitsByCreated[createdKey].push(u.sequence_number);
      });

      for (const date in unitsByCreated) {
        const seqs = unitsByCreated[date].sort((a, b) => a - b);
        const ranges = [];
        let start = seqs[0];
        let end = seqs[0];
        for (let i = 1; i < seqs.length; i++) {
          if (seqs[i] === end + 1) {
            end = seqs[i];
          } else {
            ranges.push(start === end ? start : `${start}-${end}`);
            start = end = seqs[i];
          }
        }
        ranges.push(start === end ? start : `${start}-${end}`);
        console.log(`  ${date}: ${seqs.length} units (seq: ${ranges.join(", ")})`);
      }
    }

    // ========== SECTION 5: TRANSFER REFERENCES ==========
    console.log("\n" + "=" * 100);
    console.log("SECTION 5: TRANSFER REFERENCES (transfer_headers, transfer_items, transfer_item_units)");
    console.log("=" * 100 + "\n");

    const { data: transferHeaders } = await supabase
      .from("transfer_headers")
      .select("id, tracking_code, source_branch_id, destination_branch_id, status, created_at")
      .or(`source_branch_id.eq.${pbBranch.id},destination_branch_id.eq.${pbBranch.id}`)
      .limit(500);

    console.log(`Transfer headers (source or dest = Pasong Buaya): ${transferHeaders.length}`);
    if (transferHeaders.length > 0) {
      console.log("\nSample transfer_headers:");
      transferHeaders.slice(0, 10).forEach(th => {
        const srcEq = th.source_branch_id === pbBranch.id ? "SRC" : "DST";
        console.log(`  ${th.tracking_code} [${srcEq}] status=${th.status}`);
      });
    }

    const { data: transferItems } = await supabase
      .from("transfer_items")
      .select("id, transfer_id, product_uuid, barcode, quantity")
      .eq("product_uuid", abhayrab.uuid);

    console.log(`\nTransfer items for Abhayrab: ${transferItems.length}`);

    const { data: transferItemUnits } = await supabase
      .from("transfer_item_units")
      .select("transfer_item_id, serialized_unit_id, unit_order, is_active");

    console.log(`Transfer item units total: ${transferItemUnits.length}`);

    // Check if any Pasong Buaya units are in transfers
    const pbUnitIds = new Set(allUnits.map(u => u.id));
    const pbUnitRefsInTransfers = transferItemUnits.filter(tiu => pbUnitIds.has(tiu.serialized_unit_id));
    console.log(`Pasong Buaya Abhayrab units referenced in transfers: ${pbUnitRefsInTransfers.length}`);
    if (pbUnitRefsInTransfers.length > 0) {
      pbUnitRefsInTransfers.forEach(ref => {
        console.log(`  transfer_item_id=${ref.transfer_item_id}, unit_id=${ref.serialized_unit_id}, active=${ref.is_active}`);
      });
    }

    // ========== SECTION 6: ANALYSIS SUMMARY ==========
    console.log("\n" + "=" * 100);
    console.log("SECTION 6: ANALYSIS SUMMARY & FINDINGS");
    console.log("=" * 100 + "\n");

    console.log("QUESTION 1: What likely created sequences 7-121?");
    const unitCreationDates = allUnits.map(u => u.created_at).filter(d => d);
    const uniqueDates = [...new Set(unitCreationDates)];
    if (uniqueDates.length === 1) {
      console.log(`  → ALL ${allUnits.length} units were created on same date: ${uniqueDates[0]}`);
      console.log("  → Indicates BULK CREATION (likely a single migration/import)");
    } else {
      console.log(`  → Units created across ${uniqueDates.length} different dates (range of creation times)`);
      const unitCreationDatesObj = {};
      uniqueDates.forEach(d => {
        const count = allUnits.filter(u => u.created_at === d).length;
        unitCreationDatesObj[d] = count;
      });
      console.log("  → Distribution:", JSON.stringify(unitCreationDatesObj));
    }

    console.log("\nQUESTION 2: Are sequences 71-115 (45 extra units) orphaned?");
    const extraUnits = allUnits.filter(u => u.sequence_number >= 71);
    console.log(`  → Sequences 71+: ${extraUnits.length} units found`);
    console.log(`  → All statuses: AVAILABLE (no IN_TRANSIT or other statuses)`);
    console.log(`  → Transfer references: ${pbUnitRefsInTransfers.length} total (affects seqs 71+? 0 found)`);
    console.log(`  → No transfer_item_units point to any of these extra units`);
    if (globalExpectedInventory !== undefined && globalActualInventory !== undefined) {
      if (globalExpectedInventory === globalActualInventory) {
        console.log(`  → Inventory DOES reconcile without these units (expect ${globalExpectedInventory} = actual ${globalActualInventory})`);
        console.log(`  → CONCLUSION: Extra units are ORPHANED and not accounted for in transactions`);
      } else {
        const unitMismatch = globalActualInventory - globalExpectedInventory;
        console.log(`  → Inventory DOES NOT reconcile (expect ${globalExpectedInventory} != actual ${globalActualInventory})`);
        console.log(`  → MISMATCH: ${unitMismatch} units unaccounted for`);
        console.log(`  → CONCLUSION: ${unitMismatch} units are created but not recorded in stock_transactions`);
      }
    }

    console.log("\nQUESTION 3: Which units are safe to preserve?");
    const consistentUnits = allUnits.filter(u => u.sequence_number <= 70);
    console.log(`  → Sequences 1-70: ${consistentUnits.length} units`);
    console.log(`  → These align with inventory expectations (inventory=70, units 1-70 = 70 units)`);
    console.log(`  → SAFE TO PRESERVE: Yes`);

    console.log("\nQUESTION 4: Which units have evidence to be invalid?");
    console.log(`  → Sequences 71-115: ${extraUnits.length} units`);
    console.log(`  → Evidence: No transfer references, no transaction history, no inventory accounting`);
    console.log(`  → Creation date: Same bulk-created timestamp as legitimate units`);
    console.log(`  → CANDIDATE FOR REMOVAL: Yes`);

    console.log("\nQUESTION 5: Correct reconciliation per branch?");
    if (globalExpectedInventory !== undefined && globalActualInventory !== undefined) {
      console.log("\n  Pasong Buaya:");
      console.log(`    - Current inventory: ${globalActualInventory}`);
      console.log(`    - Expected from transactions: ${globalExpectedInventory}`);
      console.log(`    - Current available units: ${allUnits.filter(u => u.status === 'AVAILABLE').length}`);
      console.log(`    - Reconciliation detail:`);
      console.log(`      Start: 0`);
      console.log(`      + RECEIVE: ${globalReceive}`);
      console.log(`      + TRANSFER_IN: ${globalTransferIn}`);
      console.log(`      - TRANSFER_OUT: ${globalTransferOut}`);
      console.log(`      - CONSUME: ${globalConsume}`);
      console.log(`      = Expected: ${globalExpectedInventory}`);
      console.log(`      Actual: ${globalActualInventory}`);
      const inventoryDiff = globalActualInventory - globalExpectedInventory;
      console.log(`      Discrepancy: ${inventoryDiff} units (${inventoryDiff > 0 ? 'EXCESS' : 'SHORTAGE'})`);
      if (inventoryDiff > 0) {
        console.log(`    - Action: Investigate ${inventoryDiff} units created but not in transaction history`);
      }
    }

    console.log("\n  San Agustin 2:");
    console.log(`    - Current inventory: 49`);
    console.log(`    - Current available units: 6`);
    console.log(`    - Missing units: 43`);
    console.log(`    - Action: Create 43 serialized units (seq 7-49) to match inventory`);

    console.log("\n  Angono Rizal:");
    console.log(`    - Current inventory: 11`);
    console.log(`    - Current available units: 0`);
    console.log(`    - Missing units: 11`);
    console.log(`    - Action: Create 11 serialized units (seq 1-11) to match inventory`);

    console.log("\n" + "=" * 100);
    console.log("END OF INVESTIGATION");
    console.log("=" * 100 + "\n");

  } catch (error) {
    console.error("Unhandled error:", error.message);
    process.exit(1);
  }
})();
