const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

(async () => {
  try {
    console.log("\n=== AUDIT: INVENTORY vs SERIALIZED_UNITS RECONCILIATION ===\n");

    // Step 1: Get Abhayrab product info
    console.log("STEP 1: Fetching Abhayrab products...");
    const { data: products, error: prodErr } = await supabase.from("products").select("uuid, product_name, barcode, is_active").ilike("product_name", "%Abhayrab%").limit(20);
    if (prodErr) {
      console.error("ERROR fetching products:", prodErr);
      process.exit(1);
    }
    console.log(`Found ${products.length} Abhayrab product(s)`);
    products.forEach(p => console.log(`  - ${p.product_name} (${p.barcode}) uuid=${p.uuid}`));

    const productUuids = products.map(p => p.uuid);
    if (!productUuids.length) {
      console.log("NO PRODUCTS FOUND");
      process.exit(0);
    }

    // Step 2: Get target branches
    console.log("\nSTEP 2: Fetching target branches...");
    const { data: branches, error: branchErr } = await supabase.from("branches").select("id, branch_name, branch_code").in("branch_name", ["San Agustin 2", "Pasong Buaya", "Angono Rizal"]);
    if (branchErr) {
      console.error("ERROR fetching branches:", branchErr);
      process.exit(1);
    }
    console.log(`Found ${branches.length} target branches`);
    branches.forEach(b => console.log(`  - ${b.branch_name} (${b.branch_code}) id=${b.id}`));

    const branchMap = {};
    branches.forEach(b => branchMap[b.id] = b.branch_name);

    // Step 3: Inventory summary
    console.log("\nSTEP 3: Inventory summary for Abhayrab at target branches...");
    const { data: inventory, error: invErr } = await supabase.from("inventory").select("product_uuid, branch_id, quantity, branch").in("product_uuid", productUuids).in("branch_id", branches.map(b => b.id));
    if (invErr) {
      console.error("ERROR fetching inventory:", invErr);
    } else {
      const invByKey = {};
      inventory.forEach(inv => {
        const key = `${inv.product_uuid}_${inv.branch_id}`;
        invByKey[key] = inv.quantity;
        console.log(`  inventory[${branchMap[inv.branch_id]} / ${inv.product_uuid}] = ${inv.quantity}`);
      });
    }

    // Step 4: Serialized units summary by status
    console.log("\nSTEP 4: Serialized units summary by status...");
    const { data: allUnits, error: unitsErr } = await supabase.from("serialized_units").select("id, product_uuid, branch_id, sequence_number, unit_barcode, status, created_at, updated_at").in("product_uuid", productUuids).in("branch_id", branches.map(b => b.id)).order("sequence_number", { ascending: true });
    if (unitsErr) {
      console.error("ERROR fetching serialized_units:", unitsErr);
    } else {
      console.log(`Total serialized_units found: ${allUnits.length}\n`);

      const unitsByBranchProduct = {};
      const unitsByStatus = {};

      allUnits.forEach(u => {
        const branchKey = `${branchMap[u.branch_id]}`;
        const prodKey = `${u.product_uuid}`;
        const statusKey = `${branchKey}_${prodKey}_${u.status}`;
        const fullKey = `${branchKey}_${prodKey}`;

        if (!unitsByBranchProduct[fullKey]) unitsByBranchProduct[fullKey] = { AVAILABLE: [], IN_TRANSIT: [], OTHER: [] };
        if (!unitsByStatus[statusKey]) unitsByStatus[statusKey] = [];

        unitsByBranchProduct[fullKey][u.status] = unitsByBranchProduct[fullKey][u.status] || [];
        unitsByBranchProduct[fullKey][u.status].push(u);
        unitsByStatus[statusKey].push(u);
      });

      console.log("Serialized units by branch/product/status:");
      for (const key in unitsByBranchProduct) {
        const [branch, prodId] = key.split("_");
        const { AVAILABLE = [], IN_TRANSIT = [], OTHER = [] } = unitsByBranchProduct[key];
        console.log(`  ${branch} / Abhayrab [${prodId}]:`);
        console.log(`    AVAILABLE: ${AVAILABLE.length}`);
        if (AVAILABLE.length > 0 && AVAILABLE.length <= 10) {
          AVAILABLE.forEach(u => console.log(`      - ${u.unit_barcode} (seq=${u.sequence_number})`));
        } else if (AVAILABLE.length > 10) {
          console.log(`      [first 5 of ${AVAILABLE.length}]:`, AVAILABLE.slice(0, 5).map(u => u.unit_barcode).join(", "));
          console.log(`      [last 5 of ${AVAILABLE.length}]:`, AVAILABLE.slice(-5).map(u => u.unit_barcode).join(", "));
        }
        console.log(`    IN_TRANSIT: ${IN_TRANSIT.length}`);
        if (IN_TRANSIT.length > 0 && IN_TRANSIT.length <= 10) {
          IN_TRANSIT.forEach(u => console.log(`      - ${u.unit_barcode} (seq=${u.sequence_number})`));
        }
        console.log(`    OTHER: ${OTHER.length}`);
      }
    }

    // Step 5: Check transfer_item_units for references to our serialized units
    console.log("\nSTEP 5: Transfer item units - which serialized units are reserved?...");
    const { data: transferItems, error: tiErr } = await supabase.from("transfer_item_units").select("transfer_item_id, serialized_unit_id, unit_order, is_active").limit(500);
    if (tiErr) {
      console.error("ERROR fetching transfer_item_units:", tiErr);
    } else {
      const referenceCount = transferItems.length;
      console.log(`Total transfer_item_units rows: ${referenceCount}`);
      if (referenceCount > 0) {
        console.log(`Sample references (first 10):`);
        transferItems.slice(0, 10).forEach(ti => {
          console.log(`  transfer_item_id=${ti.transfer_item_id}, unit_id=${ti.serialized_unit_id}, active=${ti.is_active}`);
        });
      }
    }

    // Step 6: Check transfer_headers status
    console.log("\nSTEP 6: Transfer headers - what is the status of transfers?...");
    const { data: transferHeaders, error: thErr } = await supabase.from("transfer_headers").select("id, uuid, tracking_code, source_branch_id, destination_branch_id, status, created_at").limit(100);
    if (thErr) {
      console.error("ERROR fetching transfer_headers:", thErr);
    } else {
      console.log(`Total transfer_headers: ${transferHeaders.length}`);
      const statusCounts = {};
      transferHeaders.forEach(th => {
        statusCounts[th.status] = (statusCounts[th.status] || 0) + 1;
      });
      console.log("Transfer status distribution:");
      for (const status in statusCounts) {
        console.log(`  ${status}: ${statusCounts[status]}`);
      }
    }

    // Step 7: Stock transactions for Abhayrab
    console.log("\nSTEP 7: Stock transactions for Abhayrab at target branches...");
    const { data: transactions, error: txErr } = await supabase.from("stock_transactions").select("id, product_uuid, branch_id, type, quantity, date, tracking_code").in("product_uuid", productUuids).in("branch_id", branches.map(b => b.id)).order("date", { ascending: false }).limit(200);
    if (txErr) {
      console.error("ERROR fetching stock_transactions:", txErr);
    } else {
      console.log(`Total stock_transactions: ${transactions.length}`);
      const txByType = {};
      transactions.forEach(tx => {
        if (!txByType[tx.type]) txByType[tx.type] = [];
        txByType[tx.type].push(tx);
      });
      console.log("Transaction types:");
      for (const type in txByType) {
        console.log(`  ${type}: ${txByType[type].length} rows`);
      }
      console.log("\nRecent transactions (last 20):");
      transactions.slice(0, 20).forEach(tx => {
        const branch = branchMap[tx.branch_id] || tx.branch_id;
        console.log(`  ${new Date(tx.date).toISOString().split('T')[0]} | ${branch} | ${tx.type} | qty=${tx.quantity} | tracking=${tx.tracking_code || 'none'}`);
      });
    }

    // Step 8: Detailed reconciliation for each branch/product
    console.log("\n=== RECONCILIATION MATRIX ===\n");
    console.log("Format: BRANCH / PRODUCT | inventory | AVAILABLE | IN_TRANSIT | DIFFERENCE | FLAGGED");
    console.log("-".repeat(100));

    for (const branch of branches) {
      for (const product of products) {
        const invRow = inventory.find(i => i.product_uuid === product.uuid && i.branch_id === branch.id);
        const invQty = invRow ? invRow.quantity : 0;

        const unitsForBranch = (allUnits || []).filter(u => u.branch_id === branch.id && u.product_uuid === product.uuid);
        const availableCount = unitsForBranch.filter(u => u.status === "AVAILABLE").length;
        const inTransitCount = unitsForBranch.filter(u => u.status === "IN_TRANSIT").length;
        const otherCount = unitsForBranch.filter(u => u.status !== "AVAILABLE" && u.status !== "IN_TRANSIT").length;

        const totalSerializedCount = unitsForBranch.length;
        const diff = invQty - availableCount;

        let flagged = "";
        if (diff > 0 && availableCount === 0) {
          flagged = "CRITICAL: inventory>0 but zero available units";
        } else if (availableCount > invQty) {
          flagged = "MISMATCH: available units exceed inventory";
        } else if (inTransitCount > 0) {
          flagged = "IN_TRANSIT: units reserved for transfer";
        } else if (diff !== 0) {
          flagged = "DIFF: inventory != available units";
        }

        console.log(`${branch.branch_name.padEnd(20)} / ${product.barcode.padEnd(12)} | inv=${String(invQty).padStart(3)} | avail=${String(availableCount).padStart(3)} | transit=${String(inTransitCount).padStart(3)} | diff=${String(diff).padStart(3)} | ${flagged}`);
      }
    }

    // Step 9: Pasong Buaya extra units analysis
    console.log("\n=== DETAILED: PASONG BUAYA / ABHAYRAB EXTRA UNITS ANALYSIS ===\n");
    const pbBranch = branches.find(b => b.branch_name === "Pasong Buaya");
    const abhayrab = products[0];
    if (pbBranch && abhayrab) {
      const pbUnits = (allUnits || []).filter(u => u.branch_id === pbBranch.id && u.product_uuid === abhayrab.uuid);
      console.log(`Total serialized_units at Pasong Buaya for Abhayrab: ${pbUnits.length}`);
      console.log(`  AVAILABLE: ${pbUnits.filter(u => u.status === "AVAILABLE").length}`);
      console.log(`  IN_TRANSIT: ${pbUnits.filter(u => u.status === "IN_TRANSIT").length}`);
      console.log(`  Other statuses: ${pbUnits.filter(u => u.status !== "AVAILABLE" && u.status !== "IN_TRANSIT").length}`);

      const availableUnits = pbUnits.filter(u => u.status === "AVAILABLE").sort((a, b) => a.sequence_number - b.sequence_number);
      if (availableUnits.length > 0) {
        console.log(`\nSequence range: ${availableUnits[0].sequence_number} - ${availableUnits[availableUnits.length - 1].sequence_number}`);
        console.log(`First 5 available: ${availableUnits.slice(0, 5).map(u => u.unit_barcode).join(", ")}`);
        console.log(`Last 5 available: ${availableUnits.slice(-5).map(u => u.unit_barcode).join(", ")}`);
      }

      // Check if any Pasong Buaya units are referenced in transfers
      const pbUnitIds = new Set(pbUnits.map(u => u.id));
      const pbTransferRefs = (transferItems || []).filter(ti => pbUnitIds.has(ti.serialized_unit_id));
      console.log(`\nTransfer references to Pasong Buaya Abhayrab units: ${pbTransferRefs.length}`);
      if (pbTransferRefs.length > 0 && pbTransferRefs.length <= 20) {
        pbTransferRefs.forEach(tr => {
          console.log(`  transfer_item_id=${tr.transfer_item_id}, is_active=${tr.is_active}`);
        });
      }

      // Check stock transactions for Pasong Buaya
      const pbTx = (transactions || []).filter(tx => tx.branch_id === pbBranch.id && tx.product_uuid === abhayrab.uuid);
      console.log(`\nStock transactions for Pasong Buaya Abhayrab: ${pbTx.length}`);
      const pbTxByType = {};
      pbTx.forEach(tx => {
        if (!pbTxByType[tx.type]) pbTxByType[tx.type] = [];
        pbTxByType[tx.type].push(tx);
      });
      for (const type in pbTxByType) {
        console.log(`  ${type}: ${pbTxByType[type].length}`);
      }
    }

    console.log("\n=== AUDIT COMPLETE ===\n");

  } catch (error) {
    console.error("Unhandled error:", error);
    process.exit(1);
  }
})();
