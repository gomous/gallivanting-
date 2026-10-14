const architecture = {
  layers: [
    {
      id: "shell", className: "layer-shell", number: "01", title: "Application shell", description: "Persistent chrome that remains around each CRM module.",
      cards: [
        { id: "product", title: "Product switcher", type: "shell", description: "Zoho CRM application identity and Manage Apps entry point.", qa: "apps-dropdown", observed: "Zoho CRM" },
        { id: "teamspace", title: "Teamspace switcher", type: "shell", description: "Active CRM Teamspace with avatar, name, and teamspace menu.", qa: "tsOpenTeamspaceList", observed: "CRM Teamspace" },
        { id: "topbar", title: "Global top bar", type: "shell", description: "Breadcrumbs, Search records, notifications, profile, and utility access.", qa: "searchTpBnd", observed: "Search records" },
        { id: "collapse", title: "Collapsible app menu", type: "shell", description: "Left navigation can be hidden while the active workspace remains visible.", qa: "collapseAppMenu", observed: "Hide Menu" },
      ],
    },
    {
      id: "navigation", className: "layer-navigation", number: "02", title: "Workspace navigation", description: "Module families organize the CRM into persistent navigation groups.",
      cards: [
        { id: "workspace", title: "Workspace shortcuts", type: "navigation", description: "Home, Workqueue, Reports, Analytics, Agents, and MCP Server.", route: "/tab/Home/begin" },
        { id: "sales", title: "Sales group", type: "navigation", description: "Leads, Contacts, Accounts, Deals, Forecasts, Documents, and Campaigns.", qa: "tsLeftMenuFolder_Sales", observed: "Sales" },
        { id: "activities", title: "Activities group", type: "navigation", description: "Tasks, Meetings, and Calls are grouped as activity modules.", qa: "tsLeftMenuFolder_Activities", observed: "Activities" },
        { id: "inventory", title: "Inventory group", type: "navigation", description: "Inventory modules are a separate expandable family.", qa: "tsLeftMenuFolder_Inventory", observed: "Inventory" },
        { id: "module-search", title: "Module search", type: "navigation", description: "Searches the left navigation module catalog before opening a workspace.", qa: "leftMenuSearch_modules", observed: "Search" },
      ],
    },
    {
      id: "workspace", className: "layer-workspace", number: "03", title: "Module workspace", description: "Each module has a repeatable list, view, and toolbar composition.",
      cards: [
        { id: "route", title: "Module route", type: "workspace", description: "Org-scoped route identifies the module, custom view, mode, and page.", route: "/crm/org…/tab/Leads/custom-view/…/list?page=1" },
        { id: "custom-view", title: "Custom-view selector", type: "workspace", description: "All Leads, personal/public views, New Custom View, and Manage Custom View.", qa: "cxCVButton", observed: "All Leads" },
        { id: "view-mode", title: "View-mode selector", type: "workspace", description: "List, Kanban, Sheet, Chart, Timeline, Split, and Map modes.", qa: "viewSelector", observed: "ListView · KanbanView" },
        { id: "record-search", title: "Module record search", type: "workspace", description: "Searches records within the active module view.", qa: "searchTpBnd", observed: "Search records" },
        { id: "summary", title: "List summary", type: "workspace", description: "Current custom-view record count and visible range are shown at the list boundary.", qa: "lv_summaryArea", observed: "Total Records 10" },
      ],
    },
    {
      id: "surface", className: "layer-surface", number: "04", title: "Module surfaces", description: "The active module composes data surfaces and state-changing entry points.",
      cards: [
        { id: "list", title: "Record list", type: "surface", description: "Rows expose record names, links, selection, and per-module fields.", route: "/tab/Leads/custom-view/…/list" },
        { id: "filter", title: "Filter builder", type: "surface", description: "System-defined, field, and related-module filter groups with search.", qa: "lv_filterStatus · lv_filter_srch_input", observed: "Filter Leads by" },
        { id: "sort", title: "Sort surface", type: "surface", description: "Sort By and order controls are opened from the list toolbar.", qa: "sortView", observed: "Sort" },
        { id: "create", title: "Create/edit form", type: "surface", description: "Create Lead opens a dedicated form with Save, Save and New, and Cancel paths.", qa: "cv_createbtn", observed: "Create Lead" },
        { id: "detail", title: "Record detail", type: "surface", description: "A record route becomes a detail surface with information, timeline, related lists, and edit actions.", route: "/tab/Contacts/{recordId}" },
        { id: "actions", title: "Mass actions", type: "surface", description: "Selection enables Actions such as Mass Update, Mass Convert, Export, and Manage Tags.", qa: "cv_tools", observed: "Actions" },
      ],
    },
    {
      id: "utility", className: "layer-utility", number: "05", title: "Global utilities and overlays", description: "Cross-module utilities sit outside the active record surface.",
      cards: [
        { id: "more", title: "More menu", type: "utility", description: "Import Leads and advertising sync actions are exposed from the module toolbar.", qa: "importButton", observed: "More" },
        { id: "quick-create", title: "Quick create", type: "utility", description: "A global create entry point is present in the shell in addition to module create buttons.", qa: "createNewTpBnd", observed: "Create" },
        { id: "zia", title: "Ask Zia", type: "utility", description: "Assistant entry point is registered as a global navigation utility.", qa: "ziaMenu", observed: "Ask Zia" },
        { id: "utility-bar", title: "Utility bar", type: "utility", description: "Pins, Chats, Contacts, Announcements, Motivator, Sticky Notes, reminders, recent items, and Help.", observed: "My Pins · Chats · Help" },
        { id: "setup", title: "Setup / integrations", type: "utility", description: "Marketplace and Setup are global surfaces, observed as shell entries rather than fully inspected pages.", observed: "Marketplace · Setup" },
      ],
    },
  ],
};

const app = document.querySelector("#architecture-app");
let selectedId = "workspace";
let activeLayer = "all";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function cardMarkup(card) {
  const meta = [card.qa ? `<code>${escapeHtml(card.qa)}</code>` : "", card.route ? `<code>${escapeHtml(card.route)}</code>` : "", card.observed ? `<span>${escapeHtml(card.observed)}</span>` : ""].filter(Boolean).join("");
  return `<button class="architecture-card" data-card-id="${escapeHtml(card.id)}" data-layer-id="${escapeHtml(card.layerId)}" type="button"><span class="card-type">${escapeHtml(card.type)}</span><span class="evidence-status">observed UI</span><h4>${escapeHtml(card.title)}</h4><p>${escapeHtml(card.description)}</p><span class="card-meta">${meta}</span></button>`;
}

function layerMarkup(layer) {
  const cards = layer.cards.map((card) => cardMarkup({ ...card, layerId: layer.id })).join("");
  return `<section class="architecture-layer ${layer.className}" data-layer-id="${layer.id}"><div class="layer-heading"><div><h3>${escapeHtml(layer.title)}</h3><p>${escapeHtml(layer.description)}</p></div><span class="layer-number">${layer.number}</span></div><div class="layer-grid">${cards}</div></section>`;
}

function render() {
  const cardCount = architecture.layers.reduce((total, layer) => total + layer.cards.length, 0);
  app.innerHTML = `<header class="architecture-header"><div><div class="eyebrow">Observed UI architecture</div><h1>Zoho CRM interface map</h1><p>A static architecture atlas built from the authenticated Zoho CRM shell and visible Leads / Contacts surfaces. It shows how the UI is layered and where functions live; it does not connect to Zoho or change records.</p></div><div class="source-badge">Zoho observations · static reference</div></header><div class="architecture-toolbar"><input id="architecture-search" aria-label="Search UI architecture" placeholder="Search shell, workspace, filter, form…" /><button id="clear-search" type="button">Clear</button><span class="toolbar-note">Observed labels and locators are evidence; uninspected areas remain marked.</span></div><main class="architecture-main"><aside class="architecture-rail"><div class="rail-header"><strong>Architecture layers</strong><span>Start with the shell, then follow the active module workspace.</span></div><div class="rail-list">${architecture.layers.map((layer) => `<button class="rail-item" data-layer-jump="${layer.id}" data-tone="${layer.id === "shell" ? "purple" : layer.id === "navigation" ? "teal" : layer.id === "surface" ? "amber" : "blue"}" type="button"><span class="rail-icon">${layer.number}</span><span>${escapeHtml(layer.title)}</span><small>${layer.cards.length}</small></button>`).join("")}</div></aside><section class="architecture-canvas"><div class="canvas-heading"><div><div class="eyebrow">Function placement</div><h2>How the CRM UI is composed</h2></div><p id="result-count">${cardCount} architecture cards shown</p></div><div class="layer-tabs" role="toolbar" aria-label="Architecture layer filter"><button class="layer-tab" data-layer-tab="all" aria-pressed="true" type="button">All layers</button>${architecture.layers.map((layer) => `<button class="layer-tab" data-layer-tab="${layer.id}" aria-pressed="false" type="button">${escapeHtml(layer.title)}</button>`).join("")}</div><div class="coverage-note" id="coverage-note"><strong>Coverage boundary:</strong> partial evidence from passive authenticated Zoho inspection. Shell, navigation, and visible Leads / Contacts surfaces are observed; hidden, lazy-loaded, and unvisited CRM areas are not inferred.</div><div class="architecture-layers">${architecture.layers.map(layerMarkup).join("")}</div><div class="no-results" id="no-results">No observed UI cards match that search.</div></section><aside class="architecture-inspector"><div class="inspector-header"><strong>Observation inspector</strong><span>Choose a card to see its UI responsibility and observed locator or route.</span></div><div class="inspector-body" id="inspector-body"><p class="inspector-empty">Select a card. This page is an architecture reference, not an executable CRM.</p></div></aside></main>`;
  bindEvents();
}

function findCard(id) {
  for (const layer of architecture.layers) {
    const card = layer.cards.find((candidate) => candidate.id === id);
    if (card) return { ...card, layer };
  }
  return null;
}

function selectCard(id) {
  const found = findCard(id);
  if (!found) return;
  selectedId = id;
  document.querySelectorAll(".architecture-card").forEach((card) => card.classList.toggle("is-selected", card.dataset.cardId === id));
  document.querySelectorAll(".architecture-layer").forEach((layer) => layer.classList.toggle("is-highlighted", layer.dataset.layerId === found.layer.id));
  const evidence = [found.qa ? `<dt>Observed locator</dt><dd><span class="inspector-code">${escapeHtml(found.qa)}</span></dd>` : "", found.route ? `<dt>Observed route</dt><dd><span class="inspector-code">${escapeHtml(found.route)}</span></dd>` : "", found.observed ? `<dt>Observed text</dt><dd>${escapeHtml(found.observed)}</dd>` : ""].filter(Boolean).join("");
  document.querySelector("#inspector-body").innerHTML = `<h3>${escapeHtml(found.title)}</h3><p>${escapeHtml(found.description)}</p><dl><dt>Layer</dt><dd>${escapeHtml(found.layer.title)}</dd><dt>Role</dt><dd>${escapeHtml(found.type)}</dd><dt>Coverage</dt><dd>Observed visible UI</dd><dt>Evidence source</dt><dd>Authenticated Zoho CRM passive inspection</dd>${evidence}</dl>${found.id === "setup" ? `<div class="coverage-note">This surface was observed in the shell but its destination page was not inspected in this pass.</div>` : ""}`;
}

function applyFilters() {
  const query = document.querySelector("#architecture-search").value.trim().toLowerCase();
  let visibleCount = 0;
  document.querySelectorAll(".architecture-card").forEach((card) => {
    const found = findCard(card.dataset.cardId);
    const text = `${found.title} ${found.description} ${found.type} ${found.qa ?? ""} ${found.route ?? ""} ${found.observed ?? ""}`.toLowerCase();
    const visible = (activeLayer === "all" || found.layer.id === activeLayer) && (!query || text.includes(query));
    card.classList.toggle("is-search-hidden", !visible);
    if (visible) visibleCount += 1;
  });
  document.querySelectorAll(".architecture-layer").forEach((layer) => {
    const hasVisibleCard = [...layer.querySelectorAll(".architecture-card")].some((card) => !card.classList.contains("is-search-hidden"));
    layer.classList.toggle("is-dimmed", !hasVisibleCard);
  });
  document.querySelector("#result-count").textContent = `${visibleCount} architecture cards shown`;
  document.querySelector("#no-results").classList.toggle("is-visible", visibleCount === 0);
  document.querySelectorAll(".architecture-layer").forEach((layer) => layer.classList.toggle("is-hidden", ![...layer.querySelectorAll(".architecture-card")].some((card) => !card.classList.contains("is-search-hidden"))));
  const firstVisible = [...document.querySelectorAll(".architecture-card")].find((card) => !card.classList.contains("is-search-hidden"));
  if (firstVisible) selectCard(firstVisible.dataset.cardId);
  else {
    document.querySelectorAll(".architecture-card").forEach((card) => card.classList.remove("is-selected"));
    document.querySelectorAll(".architecture-layer").forEach((layer) => layer.classList.remove("is-highlighted"));
    document.querySelector("#inspector-body").innerHTML = "";
  }
}

function bindEvents() {
  document.querySelectorAll(".architecture-card").forEach((card) => card.addEventListener("click", () => selectCard(card.dataset.cardId)));
  document.querySelectorAll("[data-layer-jump]").forEach((button) => button.addEventListener("click", () => {
    const layerId = button.dataset.layerJump;
    document.querySelector(`[data-layer-tab="${layerId}"]`).click();
    document.querySelector(`[data-layer-id="${layerId}"]`).scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  document.querySelectorAll("[data-layer-tab]").forEach((button) => button.addEventListener("click", () => {
    activeLayer = button.dataset.layerTab;
    document.querySelectorAll("[data-layer-tab]").forEach((tab) => tab.setAttribute("aria-pressed", String(tab === button)));
    applyFilters();
  }));
  document.querySelector("#architecture-search").addEventListener("input", applyFilters);
  document.querySelector("#clear-search").addEventListener("click", () => { document.querySelector("#architecture-search").value = ""; applyFilters(); });
  selectCard(selectedId);
}

render();
