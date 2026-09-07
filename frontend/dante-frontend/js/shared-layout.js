window.sharedNavMarkup = `
<!-- TopNavBar -->
<nav class="fixed top-0 w-full z-50 flex justify-between items-center px-lg h-16 max-w-container-max mx-auto bg-surface-container-lowest border-b border-outline-variant flat no shadows">
<div class="flex items-center gap-md">
<span class="font-headline-md text-headline-md font-bold text-primary">ABC Admin</span>
</div>
<div class="hidden md:flex items-center gap-lg">
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="/legacy/pages/dashboard.html">Dashboard</a>
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="/legacy/pages/inventory.html">Inventory</a>
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="/legacy/pages/consumption.html">Consumption</a>
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="/legacy/pages/deliveries.html">Deliveries</a>
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="/pages/transfers.html">Transfers</a>
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="/legacy/pages/product.html">Products</a>
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="/legacy/pages/branches.html">Branches</a>
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="/legacy/pages/barcode.html">Barcode</a>
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="/pages/scanner.html">Scanner</a>
<a id="reports-nav-link" class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="/legacy/pages/reports.html">Reports</a>
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="/legacy/pages/users.html">Users</a>
</div>
<div class="flex items-center gap-md">
<button class="bg-primary text-on-primary font-label-caps text-label-caps px-md py-sm rounded-DEFAULT hover:bg-primary-container transition-colors shadow-sm hidden md:flex items-center gap-xs">
                Scan Item
            </button>
<div class="flex items-center gap-sm text-on-surface-variant">
<button class="p-xs hover:bg-surface-container-low rounded-full transition-colors">
<span class="material-symbols-outlined">notifications</span>
</button>
<button class="p-xs hover:bg-surface-container-low rounded-full transition-colors">
<span class="material-symbols-outlined">settings</span>
</button>
<img class="w-8 h-8 rounded-full border border-outline-variant object-cover ml-xs" data-alt="A small, professional headshot of a healthcare administrator in a clean, brightly lit modern clinic setting. The lighting is soft and neutral, conveying competence and hygiene." src="https://lh3.googleusercontent.com/aida-public/AB6AXuA54-cVgeQjbeGeHHIlfmj-kqzWNutXlz93_xr_wc-9c4IstqKvR5xofJ8DU_2KaEKCRarVRK32GJle6ptY9aFnHGrNXLO7tYbhYeURAVsscXCADJHhWz9HYuRKRSH6H5LjTB1hUs584-WEgZ8X081_mbvSi4_IsnURYaME5FASfvQqGjIxcvsbM9wxPLbFDhVn145Hjnwb_cVUi4xJ9zixdc4v3iDN0PBJTFUYZoLqKNd952nMcj4Kog">
</div>
</div>
</nav>

<div class="flex flex-1 pt-16 max-w-container-max mx-auto w-full">
<!-- SideNavBar -->
<aside class="hidden md:flex flex-col h-full py-md px-sm gap-xs bg-surface-container-low border-r border-outline-variant docked left-0 w-64 fixed top-16">
<div class="flex items-center gap-md p-sm mb-md">
<div class="w-10 h-10 bg-primary-container rounded-lg flex items-center justify-center text-on-primary-container">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">local_hospital</span>
</div>
<div>
<h2 class="font-headline-sm text-headline-sm font-black text-primary">ABC Admin</h2>
<p class="font-body-md text-body-md text-on-surface-variant">Clinical Inventory</p>
</div>
</div>
<nav class="flex flex-col gap-xs flex-1">
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="/legacy/pages/dashboard.html"><span class="material-symbols-outlined">dashboard</span><span class="font-label-caps text-label-caps">Dashboard</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="/legacy/pages/inventory.html"><span class="material-symbols-outlined">inventory_2</span><span class="font-label-caps text-label-caps">Inventory</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="/legacy/pages/consumption.html"><span class="material-symbols-outlined">vaccines</span><span class="font-label-caps text-label-caps">Consumption</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="/legacy/pages/deliveries.html"><span class="material-symbols-outlined">local_shipping</span><span class="font-label-caps text-label-caps">Deliveries</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="/pages/transfers.html"><span class="material-symbols-outlined">move_down</span><span class="font-label-caps text-label-caps">Transfers</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="/legacy/pages/product.html"><span class="material-symbols-outlined">medication</span><span class="font-label-caps text-label-caps">Products</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="/legacy/pages/branches.html"><span class="material-symbols-outlined">domain</span><span class="font-label-caps text-label-caps">Branches</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="/legacy/pages/barcode.html"><span class="material-symbols-outlined">barcode_scanner</span><span class="font-label-caps text-label-caps">Barcode</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="/pages/scanner.html"><span class="material-symbols-outlined">qr_code_scanner</span><span class="font-label-caps text-label-caps">Scanner</span></a>
<a id="reports-side-nav-link" class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="/legacy/pages/reports.html"><span class="material-symbols-outlined">analytics</span><span class="font-label-caps text-label-caps">Reports</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="/legacy/pages/users.html"><span class="material-symbols-outlined">group</span><span class="font-label-caps text-label-caps">Users</span></a>
</nav>
<div class="mt-auto flex flex-col gap-xs pt-md border-t border-outline-variant">
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg mt-xs" href="#"><span class="material-symbols-outlined">help</span><span class="font-label-caps text-label-caps">Support</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="#"><span class="material-symbols-outlined">logout</span><span class="font-label-caps text-label-caps">Logout</span></a>
</div>
</aside>
`;
