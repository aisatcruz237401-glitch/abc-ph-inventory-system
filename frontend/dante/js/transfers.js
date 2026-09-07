console.log("ACTIVE TRANSFERS.JS - TEST 123");

// ==========================================
// TRANSFER HISTORY
// ==========================================
// ==========================================
// 
// ==========================================

async function loadTransferHistory() {
    try {
        console.log("Loading transfer history...");

        const response = await fetch("/api/transfers/history");

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        console.log("Transfer history response:", data);

        const tableBody = document.getElementById("transfer-history-body");

        if (!tableBody) {
            console.warn("transfer-history-body not found.");
            return data;
        }

        tableBody.innerHTML = "";

        if (!Array.isArray(data) || data.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="px-6 py-8 text-center text-secondary">
                        No transfer history found.
                    </td>
                </tr>
            `;

            return data;
        }

       const transfers = [];

const transferOuts = data.filter(
    transaction => transaction.type === "TRANSFER_OUT"
);

const transferIns = data.filter(
    transaction => transaction.type === "TRANSFER_IN"
);

transferOuts.forEach(out => {

    const matchingIn = transferIns.find(
        incoming =>
            incoming.tracking_code &&
            incoming.tracking_code === out.tracking_code
    );

    console.log("TRANSFER MATCH:", {
    outId: out.id,
    outTracking: out.tracking_code,
    matchingBranch: matchingIn?.branch
});

    const productName =
        out.products?.product_name ||
        matchingIn?.products?.product_name ||
        out.barcode ||
        "Unknown Product";

    const date = out.date
        ? new Date(out.date).toLocaleString()
        : "—";

    const row = document.createElement("tr");

    row.className =
        "hover:bg-surface-container-low/50 transition-colors";

    row.innerHTML = `
        <td class="px-6 py-4 font-data-mono text-data-mono text-on-surface">
            TRX-${out.id}
        </td>

        <td class="px-6 py-4 text-body-md text-on-surface">
            ${out.branch}
        </td>

        <td class="px-6 py-4 text-body-md text-on-surface">
            ${matchingIn?.branch || "—"}
        </td>

        <td class="px-6 py-4 text-body-md text-on-surface font-medium">
            ${productName}
        </td>

        <td class="px-6 py-4 font-data-mono text-data-mono text-on-surface text-right">
            ${out.quantity}
        </td>

        <td class="px-6 py-4 text-body-sm text-secondary">
            ${date}
        </td>

        <td class="px-6 py-4">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-secondary-container/50 text-primary border border-primary/20">
                <span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
                Completed
            </span>
        </td>
    `;

    tableBody.appendChild(row);
});

        return data;

    } catch (error) {
        console.error("Failed to load transfer history:", error);

        const tableBody = document.getElementById("transfer-history-body");

        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="px-6 py-8 text-center text-error">
                        Failed to load transfer history.
                    </td>
                </tr>
            `;
        }

        return [];
    }
}

loadTransferHistory();