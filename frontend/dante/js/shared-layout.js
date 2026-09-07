const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
const isAdmin = currentUser?.role === 'admin';

window.sharedNavMarkup = `
<!-- TopNavBar -->
<nav class="fixed top-0 w-full z-50 flex justify-between items-center px-lg h-16 max-w-container-max mx-auto bg-surface-container-lowest border-b border-outline-variant flat no shadows">
<div class="flex items-center gap-md">
<span class="font-headline-md text-headline-md font-bold text-primary">MedSupply Pro</span>
</div>
<div class="hidden md:flex items-center gap-lg">
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="dashboard.html">Dashboard</a>
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="inventory.html">Inventory</a>
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="products.html">Stations</a>
${isAdmin ? `
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="reports.html">Analytics</a>
` : ''}
<a class="text-primary border-b-2 border-primary pb-1 font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="scanner.html">Audit</a>
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
<img class="w-8 h-8 rounded-full border border-outline-variant object-cover ml-xs" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA54-cVgeQjbeGeHHIlfmj-kqzWNutXlz93_xr_wc-9c4IstqKvR5xofJ8DU_2KaEKCRarVRK32GJle6ptY9aFnHGrNXLO7tYbhYeURAVsscXCADJHhWz9HYuRKRSH6H5LjTB1hUs584-WEgZ8X081_mbvSi4_IsnURYaME5FASfvQqGjIxcvsbM9wxPLbFDhVn145Hjnwb_cVUi4xJ9zixdc4v3iDN0PBJTFUYZoLqKNd952nMcj4Kog" alt="user">
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
<h2 class="font-headline-sm text-headline-sm font-black text-primary">Central Medical</h2>
<p class="font-body-md text-body-md text-on-surface-variant">Stock Control</p>
</div>
</div>
<nav class="flex flex-col gap-xs flex-1">
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="dashboard.html"><span class="material-symbols-outlined">dashboard</span><span class="font-label-caps text-label-caps">Metrics</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="inventory.html"><span class="material-symbols-outlined">medical_services</span><span class="font-label-caps text-label-caps">Pharmacy</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="products.html"><span class="material-symbols-outlined">precision_manufacturing</span><span class="font-label-caps text-label-caps">Surgical</span></a>
<a class="flex items-center gap-md p-sm bg-secondary-container text-on-secondary-container font-bold rounded-lg cursor-pointer active:translate-x-1 duration-200" href="receive.html"><span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">input</span><span class="font-label-caps text-label-caps">Receiving</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="consume.html"><span class="material-symbols-outlined">output</span><span class="font-label-caps text-label-caps">Dispensing</span></a>
${isAdmin ? `
<a class="text-on-surface-variant font-label-caps text-label-caps hover:bg-surface-container-low transition-colors cursor-pointer active:scale-95 duration-150 py-sm px-md rounded-DEFAULT" href="reports.html">Analytics</a>
` : ''}
</nav>
<div class="mt-auto flex flex-col gap-xs pt-md border-t border-outline-variant">
<button class="w-full bg-tertiary text-on-tertiary font-label-caps text-label-caps py-sm px-md rounded-DEFAULT flex items-center justify-center gap-xs hover:bg-error transition-colors">Emergency Request</button>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg mt-xs" href="#"><span class="material-symbols-outlined">help</span><span class="font-label-caps text-label-caps">Support</span></a>
<a class="flex items-center gap-md p-sm text-on-surface-variant hover:bg-surface-container-highest transition-all cursor-pointer active:translate-x-1 duration-200 rounded-lg" href="#"><span class="material-symbols-outlined">logout</span><span class="font-label-caps text-label-caps">Logout</span></a>
</div>
</aside>
`;
