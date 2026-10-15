import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { initialLeads, initialTasks } from "./data";
import { useAuth } from "./cloudflare/AuthContext";
import { SettingsDialog } from "./cloudflare/SettingsDialog";
import { LandingPage } from "./cloudflare/LandingPage";
import { CrmModuleWorkspace, CrmSystemWorkspace, type CrmModuleKey, type CrmRoute } from "./crmModules";
import {
  industries,
  leadSources,
  leadStatuses,
  type Lead,
  type LeadDraft,
  type LeadRating,
  type LeadStatus,
  taskStatuses,
  type Task,
  type TaskDraft,
  type TaskStatus,
} from "./types";

type NavKey = "Home" | "Workqueue" | "Reports" | "Analytics" | "Leads" | "Pipeline" | "Tasks" | CrmModuleKey;
type FilterGroup = "fields" | "system" | "related";
type FilterField = "status" | "source" | "industry" | "rating" | "city" | "owner";
type FilterOperator = "is" | "is_not" | "contains";
type FilterRule = { id: string; field: FilterField; operator: FilterOperator; value: string };

const filterFieldOptions: { value: FilterField; label: string; values: string[] }[] = [
  { value: "status", label: "Lead status", values: leadStatuses },
  { value: "source", label: "Lead source", values: leadSources },
  { value: "industry", label: "Industry", values: industries },
  { value: "rating", label: "Rating", values: ["Hot", "Warm", "Cold"] },
  { value: "city", label: "City", values: ["Bengaluru", "Mumbai", "New Delhi", "Chennai", "Ahmedabad", "Kolkata"] },
  { value: "owner", label: "Lead owner", values: ["You", "Growth team"] },
];

const systemFilterOptions = [
  { value: "Activities", label: "Has activities" },
  { value: "Campaigns", label: "In a campaign" },
  { value: "Latest Email Status", label: "Has email activity" },
  { value: "Touched Records", label: "Touched records" },
  { value: "Untouched Records", label: "Untouched records" },
  { value: "Cadences", label: "In a cadence" },
];

const relatedFilterOptions = [
  { value: "Tasks", label: "Tasks", key: "taskCount" as const },
  { value: "Notes", label: "Notes", key: "notes" as const },
  { value: "Emails", label: "Emails", key: "emailCount" as const },
  { value: "Calls", label: "Calls", key: "callCount" as const },
  { value: "Campaigns", label: "Campaigns", key: "campaignCount" as const },
  { value: "Deals", label: "Deals", key: "dealCount" as const },
];

type NavItem = { label: NavKey; icon: string; count?: string };

const workspaceNav: NavItem[] = [
  { label: "Home", icon: "⌂" },
  { label: "Workqueue", icon: "▤" },
  { label: "Reports", icon: "▥" },
  { label: "Analytics", icon: "◒" },
];

const salesNav: NavItem[] = [
  { label: "Leads", icon: "◎" },
  { label: "Contacts", icon: "◌" },
  { label: "Accounts", icon: "▱" },
  { label: "Deals", icon: "◈" },
  { label: "Forecasts", icon: "⌁" },
  { label: "Documents", icon: "▤" },
  { label: "Campaigns", icon: "✧" },
];

const activityNav: NavItem[] = [
  { label: "Tasks", icon: "✓" },
  { label: "Meetings", icon: "◷" },
  { label: "Calls", icon: "⌕" },
];

const inventoryNav: NavItem[] = [
  { label: "Products", icon: "▦" },
  { label: "Price Books", icon: "▧" },
  { label: "Quotes", icon: "▤" },
  { label: "Sales Orders", icon: "↗" },
  { label: "Purchase Orders", icon: "↙" },
  { label: "Invoices", icon: "▥" },
  { label: "Vendors", icon: "◫" },
];

const supportNav: NavItem[] = [
  { label: "Cases", icon: "!" },
  { label: "Solutions", icon: "?" },
];

const toolNav: NavItem[] = [
  { label: "Pipeline", icon: "◈" },
];

const navItems: NavItem[] = [...workspaceNav, ...salesNav, ...activityNav, ...inventoryNav, ...supportNav, ...toolNav];

const crmModuleKeys: CrmModuleKey[] = ["Contacts", "Accounts", "Deals", "Forecasts", "Documents", "Campaigns", "Meetings", "Calls", "Products", "Price Books", "Quotes", "Sales Orders", "Purchase Orders", "Invoices", "Vendors", "Cases", "Solutions"];

const localZohoOrg = "org60091604256";
const localZohoCustomViews: Partial<Record<NavKey, string>> = {
  Leads: "1458063000000029342",
  Contacts: "1458063000000029537",
};

const zohoNavSegments: Record<NavKey, string> = {
  Home: "Home/begin",
  Workqueue: "Workqueue/1458063000000547107/queue/1458063000000547108",
  Reports: "Reports",
  Analytics: "Dashboards",
  Leads: "Leads",
  Contacts: "Contacts",
  Accounts: "Accounts",
  Deals: "Potentials",
  Forecasts: "Forecasts",
  Documents: "Documents",
  Campaigns: "Campaigns",
  Tasks: "Tasks",
  Meetings: "Events",
  Calls: "Calls",
  Products: "Products",
  "Price Books": "PriceBooks",
  Quotes: "Quotes",
  "Sales Orders": "SalesOrders",
  "Purchase Orders": "PurchaseOrders",
  Invoices: "Invoices",
  Vendors: "Vendors",
  Cases: "Cases",
  Solutions: "Solutions",
  Pipeline: "Pipeline",
};

const zohoSegmentToNav: Record<string, NavKey> = Object.fromEntries(Object.entries(zohoNavSegments).map(([key, segment]) => [segment.split("/")[0], key])) as Record<string, NavKey>;
zohoSegmentToNav.Potentials = "Deals";
zohoSegmentToNav.Dashboards = "Analytics";
zohoSegmentToNav.Events = "Meetings";

const emptyDraft: LeadDraft = {
  firstName: "",
  lastName: "",
  company: "",
  title: "",
  email: "",
  phone: "",
  website: "",
  source: "Website",
  owner: "You",
  status: "New",
  industry: "Technology",
  rating: "Warm",
  city: "",
  country: "India",
  employees: "",
  revenue: "",
};

const emptyTaskDraft: TaskDraft = {
  subject: "",
  dueDate: "",
  status: "Not Started",
  priority: "High",
  owner: "You",
  contact: "",
  relatedTo: "",
  description: "",
};

function initials(lead: Lead): string {
  return `${lead.firstName.slice(0, 1)}${lead.lastName.slice(0, 1)}`.toUpperCase();
}

function statusTone(status: LeadStatus): string {
  if (status === "Pre-Qualified" || status === "Contacted") return "positive";
  if (status === "Attempted to Contact" || status === "Contact in Future") return "progress";
  if (status === "Not Qualified" || status === "Junk Lead" || status === "Lost Lead") return "muted";
  return "new";
}

function ratingTone(rating: LeadRating): string {
  return rating.toLowerCase();
}

function getLeadFilterValue(lead: Lead, field: FilterField): string {
  if (field === "status") return lead.status;
  if (field === "source") return lead.source;
  if (field === "industry") return lead.industry;
  if (field === "rating") return lead.rating;
  if (field === "city") return lead.city;
  return lead.owner;
}

function routeFromLocation(): { activeNav: NavKey; route: CrmRoute | null } {
  const match = window.location.pathname.match(/^\/crm\/org[^/]+\/tab\/([^/]+)(?:\/create|\/custom-view\/[^/]+\/list|\/[^/]+)?/);
  if (!match) return { activeNav: "Leads", route: null };
  const moduleName = decodeURIComponent(match[1]);
  const mappedNav = zohoSegmentToNav[moduleName];
  if (mappedNav && !crmModuleKeys.includes(mappedNav as CrmModuleKey)) return { activeNav: mappedNav, route: null };
  if (moduleName === "Leads") return { activeNav: "Leads", route: null };
  const localModuleName = mappedNav ?? moduleName;
  if (!crmModuleKeys.includes(localModuleName as CrmModuleKey)) return { activeNav: mappedNav ?? "Leads", route: null };
  const module = localModuleName as CrmModuleKey;
  const parts = window.location.pathname.split("/").filter(Boolean);
  const last = parts.at(-1) ?? "";
  return { activeNav: module, route: window.location.pathname.endsWith("/create") ? { module, mode: "create" } : parts.length > 4 && last !== "list" ? { module, mode: "detail", recordId: last } : { module, mode: "list" } };
}

function App() {
  const initialRoute = useMemo(routeFromLocation, []);
  const { leads, tasks, setLeads, setTasks, authenticated, syncStatus, login, logout, refreshFromDrive, saveNow } = useAuth();
  const [showSettings, setShowSettings] = useState(false);

  const [activeNav, setActiveNav] = useState<NavKey>(initialRoute.activeNav);
  const [globalSearch, setGlobalSearch] = useState("");
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterGroup, setFilterGroup] = useState<FilterGroup>("fields");
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [systemFilters, setSystemFilters] = useState<string[]>([]);
  const [relatedFilters, setRelatedFilters] = useState<string[]>([]);
  const [sortNewest, setSortNewest] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showTaskCreate, setShowTaskCreate] = useState(false);
  const [draft, setDraft] = useState<LeadDraft>(emptyDraft);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(emptyTaskDraft);
  const [formError, setFormError] = useState("");
  const [taskFormError, setTaskFormError] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [detailTab, setDetailTab] = useState<"Overview" | "Timeline">("Overview");
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [route, setRoute] = useState<CrmRoute | null>(initialRoute.route);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = `${activeNav} - Gallivanter`;
  }, [activeNav]);

  useEffect(() => {
    const syncRouteFromHistory = () => {
      const next = routeFromLocation();
      setActiveNav(next.activeNav);
      setRoute(next.route);
    };
    window.addEventListener("popstate", syncRouteFromHistory);
    return () => window.removeEventListener("popstate", syncRouteFromHistory);
  }, []);

  useEffect(() => {
    if (selectedLeadId && leads.length > 0 && !leads.some((lead) => lead.id === selectedLeadId)) {
      setSelectedLeadId(leads[0].id);
    }
  }, [leads, selectedLeadId]);

  const filteredLeads = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const result = leads.filter((lead) => {
      const matchesSearch =
        !normalizedSearch ||
        [lead.firstName, lead.lastName, lead.company, lead.email, lead.industry, lead.tags.join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesRules = filterRules.every((rule) => {
        const fieldValue = getLeadFilterValue(lead, rule.field).toLowerCase();
        const expectedValue = rule.value.toLowerCase();
        if (rule.operator === "is_not") return fieldValue !== expectedValue;
        if (rule.operator === "contains") return fieldValue.includes(expectedValue);
        return fieldValue === expectedValue;
      });
      const matchesSystemFilters = systemFilters.every((filter) => {
        if (filter === "Activities" || filter === "Touched Records") return lead.activityCount > 0;
        if (filter === "Untouched Records") return lead.activityCount === 0;
        if (filter === "Campaigns" || filter === "Cadences") return lead.campaignCount > 0;
        if (filter === "Latest Email Status") return lead.emailCount > 0;
        return true;
      });
      const matchesRelatedFilters = relatedFilters.every((filter) => {
        const option = relatedFilterOptions.find((candidate) => candidate.value === filter);
        if (!option) return true;
        if (option.key === "notes") return lead.notes.length > 0;
        return lead[option.key] > 0;
      });
      return matchesSearch && matchesRules && matchesSystemFilters && matchesRelatedFilters;
    });

    return [...result].sort((a, b) => {
      if (!sortNewest) return a.company.localeCompare(b.company);
      return b.id.localeCompare(a.id);
    });
  }, [filterRules, leads, relatedFilters, search, sortNewest, systemFilters]);

  const selectedLead = selectedLeadId ? leads.find((lead) => lead.id === selectedLeadId) : undefined;
  const activeFilterCount = filterRules.length + systemFilters.length + relatedFilters.length;

  const metrics = useMemo(
    () => [
      { label: "Total leads", value: leads.length.toString(), change: "+12%", tone: "blue" },
      { label: "Needs follow-up", value: leads.filter((lead) => ["New", "Attempted to Contact"].includes(lead.status)).length.toString(), change: "Today", tone: "amber" },
      { label: "Qualified", value: leads.filter((lead) => lead.status === "Pre-Qualified").length.toString(), change: "+1 this week", tone: "green" },
      { label: "Pipeline value", value: "₹8.4L", change: "Estimated", tone: "purple" },
    ],
    [leads],
  );

  function updateDraft(field: keyof LeadDraft, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateTaskDraft(field: keyof TaskDraft, value: string): void {
    setTaskDraft((current) => ({ ...current, [field]: value }));
  }

  function handleCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!draft.company.trim() || !draft.lastName.trim()) {
      setFormError("Company and last name are required to create a lead.");
      return;
    }

    if (editingLeadId) {
      setLeads((current) => current.map((lead) => lead.id === editingLeadId ? { ...lead, ...draft, lastActivity: "Just now", activityCount: lead.activityCount + 1 } : lead));
      setDraft(emptyDraft);
      setEditingLeadId(null);
      setFormError("");
      setShowCreate(false);
      setWorkspaceMessage("Lead updated and saved locally.");
      return;
    }

    const newLead: Lead = {
      ...draft,
      id: `lead-${Date.now()}`,
      createdAt: "Just now",
      lastActivity: "Just now",
      activityCount: 0,
      taskCount: 0,
      emailCount: 0,
      callCount: 0,
      campaignCount: 0,
      dealCount: 0,
      notes: [],
      tags: ["New lead"],
    };

    setLeads((current) => [newLead, ...current]);
    setSelectedLeadId(newLead.id);
    setDraft(emptyDraft);
    setFormError("");
    setShowCreate(false);
    setWorkspaceMessage("Lead added to the workspace.");
  }

  function handleCreateTask(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!taskDraft.subject.trim()) {
      setTaskFormError("A task subject is required.");
      return;
    }

    const newTask: Task = {
      ...taskDraft,
      id: `task-${Date.now()}`,
      dueDate: taskDraft.dueDate || "No due date",
    };

    setTasks((current) => [newTask, ...current]);
    if (taskDraft.relatedTo.trim()) {
      setLeads((current) => current.map((lead) => lead.company.toLowerCase() === taskDraft.relatedTo.trim().toLowerCase() ? { ...lead, taskCount: lead.taskCount + 1, activityCount: lead.activityCount + 1, lastActivity: "Just now" } : lead));
    }
    setTaskDraft(emptyTaskDraft);
    setTaskFormError("");
    setShowTaskCreate(false);
    setWorkspaceMessage("Task added to the workspace.");
  }

  function updateLeadStatus(leadId: string, status: LeadStatus): void {
    setLeads((current) => current.map((lead) => lead.id === leadId ? { ...lead, status, lastActivity: "Just now", activityCount: lead.activityCount + 1 } : lead));
    setWorkspaceMessage("Pipeline stage updated.");
  }

  function handleExport(): void {
    const payload = {
      schema: "gallivanting.workspace",
      version: 1,
      exportedAt: new Date().toISOString(),
      leads,
      tasks,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gallivanter-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setWorkspaceMessage("Workspace export downloaded.");
  }

  function showWorkspaceMessage(message: string): void {
    setWorkspaceMessage(message);
  }

  function handleCrmRouteChange(next: CrmRoute | null): void {
    const module = next?.module ?? route?.module ?? (crmModuleKeys.includes(activeNav as CrmModuleKey) ? activeNav as CrmModuleKey : "Contacts");
    setRoute(next);
    const path = next?.mode === "create"
      ? `/crm/${localZohoOrg}/tab/${module}/create`
      : next?.mode === "detail"
        ? `/crm/${localZohoOrg}/tab/${module}/${next.recordId ?? ""}`
      : `/crm/${localZohoOrg}/tab/${module}/custom-view/${localZohoCustomViews[module] ?? "local"}/list?page=1`;
    window.history.pushState({}, "", path);
  }

  function handleImport(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    file.text().then((text) => {
      const payload = JSON.parse(text) as { schema?: string; version?: number; leads?: Lead[]; tasks?: Task[] };
      if (payload.schema !== "gallivanting.workspace" || payload.version !== 1 || !Array.isArray(payload.leads) || !Array.isArray(payload.tasks)) {
        throw new Error("This file is not a Gallivanter workspace export.");
      }
      setLeads(() => payload.leads ?? []);
      setTasks(() => payload.tasks ?? []);
      setSelectedLeadId(payload.leads[0]?.id ?? "");
      setWorkspaceMessage("Workspace imported and saved locally.");
    }).catch((error: unknown) => {
      setWorkspaceMessage(error instanceof Error ? error.message : "Could not import that workspace file.");
    }).finally(() => {
      input.value = "";
    });
  }

  function openLeadEditor(): void {
    if (!selectedLead) return;
    setDraft({
      firstName: selectedLead.firstName,
      lastName: selectedLead.lastName,
      company: selectedLead.company,
      title: selectedLead.title,
      email: selectedLead.email,
      phone: selectedLead.phone,
      website: selectedLead.website,
      source: selectedLead.source,
      owner: selectedLead.owner,
      status: selectedLead.status,
      industry: selectedLead.industry,
      rating: selectedLead.rating,
      city: selectedLead.city,
      country: selectedLead.country,
      employees: selectedLead.employees,
      revenue: selectedLead.revenue,
    });
    setEditingLeadId(selectedLead.id);
    setFormError("");
    setShowCreate(true);
  }

  function addNote(): void {
    const note = noteDraft.trim();
    if (!note || !selectedLead) return;
    setLeads((current) =>
      current.map((lead) => (lead.id === selectedLead.id ? { ...lead, notes: [note, ...lead.notes], lastActivity: "Just now", activityCount: lead.activityCount + 1 } : lead)),
    );
    setNoteDraft("");
    setWorkspaceMessage("Note added to the lead.");
  }

  function addFilterRule(): void {
    const firstField = filterFieldOptions[0];
    setFilterRules((current) => [
      ...current,
      { id: `rule-${Date.now()}`, field: firstField.value, operator: "is", value: firstField.values[0] },
    ]);
  }

  function updateFilterRule(id: string, patch: Partial<FilterRule>): void {
    setFilterRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  }

  function removeFilterRule(id: string): void {
    setFilterRules((current) => current.filter((rule) => rule.id !== id));
  }

  function resetFilters(): void {
    setSearch("");
    setFilterRules([]);
    setSystemFilters([]);
    setRelatedFilters([]);
    setFilterGroup("fields");
  }

  function renderNavItems(items: NavItem[], ariaLabel: string): ReactNode {
    return <nav className="primary-nav" aria-label={ariaLabel}>{items.map((item) => {
      const count = item.label === "Leads" ? leads.length : item.label === "Tasks" ? tasks.filter((task) => task.status !== "Completed").length : item.count;
      return <button className={`nav-item ${activeNav === item.label ? "active" : ""}`} key={item.label} onClick={() => {
        setActiveNav(item.label);
        setSidebarOpen(false);
        const module = item.label as CrmModuleKey;
        const segment = zohoNavSegments[item.label];
        if (crmModuleKeys.includes(module) && segment) {
          setRoute({ module, mode: "list" });
          const customView = localZohoCustomViews[item.label];
          window.history.pushState({}, "", customView ? `/crm/${localZohoOrg}/tab/${segment}/custom-view/${customView}/list?page=1` : `/crm/${localZohoOrg}/tab/${segment}`);
        } else if (segment) {
          setRoute(null);
          window.history.pushState({}, "", `/crm/${localZohoOrg}/tab/${segment}`);
        } else {
          setRoute(null);
          if (window.location.pathname.startsWith("/crm/")) window.history.pushState({}, "", "/");
        }
      }} type="button"><span className="nav-icon">{item.icon}</span><span>{item.label}</span>{count !== undefined ? <span className="nav-count">{count}</span> : null}</button>;
    })}</nav>;
  }

  function handleGlobalSearchKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter") return;
    const query = globalSearch.trim();
    if (!query) return;
    openLeads();
    setSearch(query);
  }

  function openLeads(leadId?: string): void {
    if (leadId !== undefined) setSelectedLeadId(leadId);
    setActiveNav("Leads");
    setRoute(null);
    setSidebarOpen(false);
    window.history.pushState({}, "", `/crm/${localZohoOrg}/tab/Leads`);
  }

  return (
    <div className="app-shell">
      {!authenticated ? (
        <LandingPage />
      ) : (
        <>
          <div className={`mobile-sidebar-backdrop ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark">G</div>
          <div>
            <div className="brand-name">Gallivanter</div>
            <div className="brand-caption">local CRM</div>
          </div>
        </div>

        <div className="sidebar-label">Workspace</div>
        {renderNavItems(workspaceNav, "Workspace navigation")}
        <div className="sidebar-label secondary-label">Sales</div>
        {renderNavItems(salesNav, "Sales navigation")}
        <div className="sidebar-label secondary-label">Activities</div>
        {renderNavItems(activityNav, "Activities navigation")}
        <div className="sidebar-label secondary-label">Inventory</div>
        {renderNavItems(inventoryNav, "Inventory navigation")}
        <div className="sidebar-label secondary-label">Support</div>
        {renderNavItems(supportNav, "Support navigation")}
        <div className="sidebar-label secondary-label">Tools</div>
        {renderNavItems(toolNav, "Tools navigation")}
        <nav className="primary-nav" aria-label="Backup navigation">
          <button className="nav-item" onClick={() => { handleExport(); setSidebarOpen(false); }} type="button">
            <span className="nav-icon">⇩</span>
            <span>Backup workspace</span>
          </button>
          <button className="nav-item" onClick={() => { importInputRef.current?.click(); setSidebarOpen(false); }} type="button">
            <span className="nav-icon">⇧</span>
            <span>Import workspace</span>
          </button>
          <button className="nav-item" onClick={() => { setShowSettings(true); setSidebarOpen(false); }} type="button">
            <span className="nav-icon">⚙</span>
            <span>Settings</span>
          </button>
          <input accept="application/json,.json" hidden onChange={handleImport} ref={importInputRef} type="file" />
        </nav>

        <div className="sidebar-footer">
          <div className="sync-status">
            <span className={`sync-dot ${authenticated ? "connected" : "disconnected"}`} />
            {authenticated ? "Google Drive connected" : "Local only"}
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu-button" aria-label="Toggle navigation" onClick={() => setSidebarOpen(true)} type="button">
              <span />
              <span />
              <span />
            </button>
            <div className="breadcrumbs"><span>Gallivanter</span><span className="slash">/</span><strong>{activeNav}</strong></div>
          </div>
          <div className="topbar-actions">
            {authenticated ? (
              <>
                <button className="icon-button sync-indicator" aria-label="Sync status" title={`Sync: ${syncStatus}`} onClick={refreshFromDrive} type="button">
                  <span className={syncStatus === "syncing" ? "syncing" : syncStatus === "synced" ? "synced" : syncStatus === "error" ? "error" : ""}>
                    {syncStatus === "syncing" ? "↻" : syncStatus === "synced" ? "✓" : syncStatus === "error" ? "!" : "◌"}
                  </span>
                </button>
                <button className="icon-button" aria-label="Logout" title="Disconnect from Google Drive" onClick={logout} type="button">
                  <span>↦</span>
                </button>
              </>
            ) : (
              <button className="icon-button" aria-label="Connect to Google Drive" title="Connect to Google Drive" onClick={login} type="button">
                <span>⇄</span>
              </button>
            )}
             <label className="global-search"><span>⌕</span><input aria-label="Search records" onChange={(event) => setGlobalSearch(event.target.value)} onKeyDown={handleGlobalSearchKey} placeholder="Search records" value={globalSearch} /></label>
             <button className="icon-button" aria-label="Settings" title="Settings" onClick={() => setShowSettings(true)} type="button"><span>⚙</span></button>
          </div>
        </header>

        {activeNav === "Leads" ? (
          <div className="content-wrap">
            <section className="page-heading">
              <div>
                <h1>Leads</h1>
              </div>
            </section>

            <section className="leads-card">
              <div className="list-toolbar">
                <div className="view-title"><div className="view-symbol">◎</div><div><strong>All Leads</strong><span>{filteredLeads.length} visible records</span></div></div>
                <div className="toolbar-actions">
                  <label className="search-box"><span>⌕</span><input aria-label="Search leads" onChange={(event) => setSearch(event.target.value)} placeholder="Search leads..." value={search} /></label>
                  <button aria-label="Filter" className={`toolbar-button ${filterOpen ? "selected" : ""}`} onClick={() => setFilterOpen((open) => !open)} type="button"><span>☷</span> Filter{activeFilterCount > 0 ? <b>{activeFilterCount}</b> : null}</button>
                  <button aria-label="Sort leads" className="toolbar-button" onClick={() => setSortNewest((current) => !current)} type="button"><span>↕</span> {sortNewest ? "Recent" : "Company"}</button>
                   <button className="toolbar-button toolbar-refresh" onClick={() => showWorkspaceMessage("Lead view refreshed.")} type="button">↻ Refresh Custom View</button>
                  <button aria-label="Create Lead" className="toolbar-button create-toolbar-button" onClick={() => { setEditingLeadId(null); setDraft(emptyDraft); setFormError(""); setShowCreate(true); }} type="button">＋ Create Lead</button>
                    <button className="toolbar-button toolbar-more" onClick={() => showWorkspaceMessage("More lead actions opened.")} type="button">More</button>
                    <button className="toolbar-button toolbar-actions-menu" onClick={() => showWorkspaceMessage("Lead actions opened.")} type="button">Actions</button>
                </div>
              </div>

              {filterOpen ? (
                <div className="filter-panel advanced-filter-panel">
                   <div className="filter-panel-heading"><div><strong>Lead filters {activeFilterCount > 0 ? <span className="active-filter-count">{activeFilterCount} active</span> : null}</strong><span>Focus on the records that need attention.</span></div><div className="filter-heading-actions"><button className="text-button" onClick={resetFilters} type="button">Reset filters</button><button className="text-button" onClick={() => setFilterOpen(false)} type="button">Done</button></div></div>
                  <div className="filter-builder">
                    <div className="filter-nav" aria-label="Filter groups">
                      <button className={filterGroup === "fields" ? "active" : ""} onClick={() => setFilterGroup("fields")} type="button"><span>⌗</span><div><strong>Lead fields</strong><small>{filterRules.length ? `${filterRules.length} rules` : "Status, source, fit"}</small></div></button>
                      <button className={filterGroup === "system" ? "active" : ""} onClick={() => setFilterGroup("system")} type="button"><span>◌</span><div><strong>Activity signals</strong><small>{systemFilters.length ? `${systemFilters.length} selected` : "Touched and active"}</small></div></button>
                      <button className={filterGroup === "related" ? "active" : ""} onClick={() => setFilterGroup("related")} type="button"><span>↗</span><div><strong>Related records</strong><small>{relatedFilters.length ? `${relatedFilters.length} selected` : "Tasks, notes, deals"}</small></div></button>
                    </div>
                    <div className="filter-content">
                      {filterGroup === "fields" ? <>
                        <div className="builder-heading"><div><strong>Filter by lead fields</strong><span>All rules must match.</span></div><button className="small-button" onClick={addFilterRule} type="button">＋ Add rule</button></div>
                        {filterRules.length === 0 ? <div className="filter-empty"><span className="filter-empty-icon">⌗</span><strong>No field rules yet</strong><p>Add a rule to find leads by status, source, industry, or fit.</p><button className="text-button" onClick={addFilterRule} type="button">Add your first rule</button></div> : <div className="rule-list">{filterRules.map((rule) => { const field = filterFieldOptions.find((option) => option.value === rule.field) ?? filterFieldOptions[0]; return <div className="rule-row" key={rule.id}><select aria-label="Filter field" onChange={(event) => { const next = filterFieldOptions.find((option) => option.value === event.target.value) ?? filterFieldOptions[0]; updateFilterRule(rule.id, { field: next.value, value: next.values[0] }); }} value={rule.field}>{filterFieldOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><select aria-label="Filter operator" onChange={(event) => updateFilterRule(rule.id, { operator: event.target.value as FilterOperator })} value={rule.operator}><option value="is">is</option><option value="is_not">is not</option><option value="contains">contains</option></select><select aria-label="Filter value" onChange={(event) => updateFilterRule(rule.id, { value: event.target.value })} value={rule.value}>{field.values.map((value) => <option key={value}>{value}</option>)}</select><button aria-label="Remove filter rule" className="remove-rule" onClick={() => removeFilterRule(rule.id)} type="button">×</button></div>; })}</div>}
                      </> : null}
                      {filterGroup === "system" ? <>
                        <div className="builder-heading"><div><strong>System-defined signals</strong><span>Prioritize records by engagement.</span></div></div>
                        <div className="check-option-grid">{systemFilterOptions.map((option) => <label className="check-option" key={option.value}><input checked={systemFilters.includes(option.value)} onChange={() => setSystemFilters((current) => current.includes(option.value) ? current.filter((value) => value !== option.value) : [...current, option.value])} type="checkbox" /><span><strong>{option.label}</strong><small>{option.value}</small></span></label>)}</div>
                      </> : null}
                      {filterGroup === "related" ? <>
                        <div className="builder-heading"><div><strong>Filter by related records</strong><span>Find leads with useful context already attached.</span></div></div>
                        <div className="check-option-grid">{relatedFilterOptions.map((option) => <label className="check-option" key={option.value}><input checked={relatedFilters.includes(option.value)} onChange={() => setRelatedFilters((current) => current.includes(option.value) ? current.filter((value) => value !== option.value) : [...current, option.value])} type="checkbox" /><span><strong>{option.label}</strong><small>{option.value === "Notes" ? "Has at least one note" : `Has linked ${option.value.toLowerCase()}`}</small></span></label>)}</div>
                      </> : null}
                    </div>
                  </div>
                  <div className="filter-footer"><span><strong>{filteredLeads.length}</strong> matching leads</span><span>Filters update the queue instantly</span></div>
                </div>
              ) : null}

              <div className="table-layout">
                <div className="table-wrap">
                  <table>
                     <thead><tr><th className="check-cell"><input aria-label="Select all visible leads" type="checkbox" /></th><th>Lead Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Lead Source</th><th>Lead Owner</th></tr></thead>
                    <tbody>
                      {filteredLeads.map((lead) => (
                        <tr className={selectedLead?.id === lead.id ? "selected-row" : ""} key={lead.id} onClick={() => setSelectedLeadId(lead.id)}>
                          <td className="check-cell" onClick={(event) => event.stopPropagation()}><input aria-label={`Select ${lead.company}`} type="checkbox" /></td>
                           <td data-label="Lead name"><div className="lead-cell"><div className={`lead-avatar ${ratingTone(lead.rating)}`}>{initials(lead)}</div><div><strong>{lead.firstName} {lead.lastName}</strong><span>{lead.title}</span></div></div></td>
                           <td data-label="Company"><strong className="company-name">{lead.company}</strong><span className="cell-subtext">{lead.industry}</span></td>
                            <td data-label="Email"><span className="source-text">{lead.email || "—"}</span></td>
                            <td data-label="Phone"><span className="source-text">{lead.phone || "—"}</span></td>
                            <td data-label="Source"><span className="source-text">{lead.source}</span></td>
                            <td data-label="Owner"><div className="owner-cell"><span className="mini-avatar">{lead.owner.slice(0, 1)}</span>{lead.owner}</div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredLeads.length === 0 ? <div className="empty-state"><div className="empty-icon">⌕</div><strong>No leads match these filters</strong><span>Try resetting the filters or changing your search.</span><button className="text-button" onClick={resetFilters} type="button">Clear filters</button></div> : null}
                </div>
                  {selectedLead ? <LeadDetail lead={selectedLead} noteDraft={noteDraft} onAction={showWorkspaceMessage} onAddNote={addNote} onChangeNote={setNoteDraft} onClose={() => setSelectedLeadId("")} onEdit={openLeadEditor} tab={detailTab} onTabChange={setDetailTab} /> : null}
              </div>
            </section>
          </div>
        ) : activeNav === "Tasks" ? (
          <TasksWorkspace tasks={tasks} onAction={showWorkspaceMessage} onCreate={() => setShowTaskCreate(true)} onStatusChange={(taskId, status) => setTasks((current) => current.map((task) => task.id === taskId ? { ...task, status } : task))} />
        ) : activeNav === "Pipeline" ? (
          <PipelineWorkspace leads={leads} onAction={showWorkspaceMessage} onStatusChange={updateLeadStatus} onSelectLead={openLeads} />
        ) : activeNav === "Home" || activeNav === "Workqueue" || activeNav === "Reports" || activeNav === "Analytics" ? (
          <CrmSystemWorkspace activeLeadCount={leads.filter((lead) => !["Lost Lead", "Junk Lead", "Not Qualified"].includes(lead.status)).length} leadCount={leads.length} onAction={showWorkspaceMessage} openTaskCount={tasks.filter((task) => task.status !== "Completed").length} section={activeNav} />
        ) : route ? (
          <CrmModuleWorkspace key={`${route.module}:${route.mode}:${route.recordId ?? ""}`} moduleKey={route.module} initialMode={route.mode} initialRecordId={route.recordId} onAction={showWorkspaceMessage} onRouteChange={handleCrmRouteChange} />
        ) : crmModuleKeys.includes(activeNav as CrmModuleKey) ? (
          <CrmModuleWorkspace key={activeNav} moduleKey={activeNav as CrmModuleKey} onAction={showWorkspaceMessage} onRouteChange={handleCrmRouteChange} />
        ) : (
          <div className="placeholder-page"><div className="placeholder-icon">{navItems.find((item) => item.label === activeNav)?.icon}</div><div className="eyebrow">Coming next</div><h1>{activeNav}</h1><p>We’ll shape this view after the lead workflow is solid.</p><button className="primary-button" onClick={() => openLeads()} type="button">Back to leads</button></div>
        )}
      </main>

         {workspaceMessage ? <div className="workspace-toast" role="status"><span>✓</span>{workspaceMessage}<button aria-label="Dismiss message" onClick={() => setWorkspaceMessage("")} type="button">×</button></div> : null}
      {showCreate ? <CreateLeadModal draft={draft} editing={Boolean(editingLeadId)} error={formError} onChange={updateDraft} onClose={() => { setShowCreate(false); setEditingLeadId(null); setFormError(""); }} onSubmit={handleCreate} /> : null}
      {showTaskCreate ? <CreateTaskModal draft={taskDraft} error={taskFormError} onChange={updateTaskDraft} onClose={() => { setShowTaskCreate(false); setTaskFormError(""); }} onSubmit={handleCreateTask} /> : null}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
        </>
      )}
    </div>
  );
}

function LeadDetail({ lead, noteDraft, onAction, onAddNote, onChangeNote, onClose, onEdit, tab, onTabChange }: { lead: Lead; noteDraft: string; onAction: (message: string) => void; onAddNote: () => void; onChangeNote: (value: string) => void; onClose: () => void; onEdit: () => void; tab: "Overview" | "Timeline"; onTabChange: (tab: "Overview" | "Timeline") => void }) {
  const [informationOpen, setInformationOpen] = useState(true);

  return (
    <aside className="detail-panel" aria-label="Lead details">
      <div className="detail-topbar"><span className="detail-kicker">Lead record</span><button className="close-button" onClick={onClose} type="button">×</button></div>
      <div className="detail-identity"><div className={`detail-avatar ${ratingTone(lead.rating)}`}>{initials(lead)}</div><div><h2>{lead.firstName} {lead.lastName}</h2><p>{lead.title} · {lead.company}</p></div></div>
      <div className="detail-actions"><button className="small-primary" onClick={() => onAction(lead.email ? `Email draft ready for ${lead.email}.` : "This lead does not have an email address yet.")} type="button">Send email</button><button className="small-button" onClick={onEdit} type="button">Edit</button><button className="small-button" onClick={() => onAction("Lead actions opened.")} type="button">•••</button></div>
      <div className="detail-tabs"><button className={tab === "Overview" ? "active" : ""} onClick={() => onTabChange("Overview")} type="button">Overview</button><button className={tab === "Timeline" ? "active" : ""} onClick={() => onTabChange("Timeline")} type="button">Timeline</button></div>
      {tab === "Overview" ? <>
        <div className="detail-status-row"><span className={`status-pill ${statusTone(lead.status)}`}><i />{lead.status}</span><span className={`rating-badge ${ratingTone(lead.rating)}`}>{lead.rating} fit</span></div>
         <div className="detail-section"><div className="section-title"><strong>Lead information</strong><button aria-expanded={informationOpen} onClick={() => setInformationOpen((current) => !current)} type="button">⌄</button></div>{informationOpen ? <div className="detail-fields"><DetailField label="Email" value={lead.email} /><DetailField label="Phone" value={lead.phone} /><DetailField label="Source" value={lead.source} /><DetailField label="Industry" value={lead.industry} /><DetailField label="Location" value={`${lead.city}, ${lead.country}`} /><DetailField label="Website" value={lead.website} /></div> : null}</div>
        <div className="detail-section"><div className="section-title"><strong>Notes</strong><span className="section-count">{lead.notes.length}</span></div><div className="note-composer"><textarea aria-label="Add a note" onChange={(event) => onChangeNote(event.target.value)} placeholder="Add a note for your next action..." value={noteDraft} /><button className="note-submit" disabled={!noteDraft.trim()} onClick={onAddNote} type="button">Add note</button></div>{lead.notes.slice(0, 2).map((note, index) => <div className="note-item" key={`${note}-${index}`}><div className="note-marker">✦</div><div><p>{note}</p><span>{index === 0 ? "Latest note" : "Earlier note"}</span></div></div>)}</div>
         <div className="detail-section related-section"><div className="section-title"><strong>Related records</strong><button onClick={() => onAction("Related record creation is ready from this lead.")} type="button">＋</button></div><div className="related-grid"><span>Tasks <b>{lead.taskCount}</b></span><span>Notes <b>{lead.notes.length}</b></span><span>Emails <b>{lead.emailCount}</b></span><span>Calls <b>{lead.callCount}</b></span></div></div>
      </> : <div className="timeline"><TimelineItem title="Lead created" meta={lead.createdAt} detail="Record added to the workspace" color="blue" /><TimelineItem title="Research reviewed" meta={lead.lastActivity} detail="Fit score and source details updated" color="purple" /><TimelineItem title="Next step" meta="Pending" detail="Choose an outreach action" color="amber" /></div>}
    </aside>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return <div className="detail-field"><span>{label}</span><strong>{value || "—"}</strong></div>;
}

function TimelineItem({ title, meta, detail, color }: { title: string; meta: string; detail: string; color: string }) {
  return <div className="timeline-item"><span className={`timeline-dot ${color}`} /><div><div className="timeline-heading"><strong>{title}</strong><span>{meta}</span></div><p>{detail}</p></div></div>;
}

function TasksWorkspace({ tasks, onAction, onCreate, onStatusChange }: { tasks: Task[]; onAction: (message: string) => void; onCreate: () => void; onStatusChange: (taskId: string, status: TaskStatus) => void }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("all");
  const [sortAscending, setSortAscending] = useState(false);
  const visibleTasks = tasks
    .filter((task) => [task.subject, task.contact, task.relatedTo, task.description].join(" ").toLowerCase().includes(search.trim().toLowerCase()))
    .filter((task) => statusFilter === "all" || task.status === statusFilter)
    .sort((left, right) => sortAscending ? left.subject.localeCompare(right.subject) : right.subject.localeCompare(left.subject));
  const activeTasks = tasks.filter((task) => task.status !== "Completed").length;

  function cycleStatusFilter(): void {
    const currentIndex = statusFilter === "all" ? -1 : taskStatuses.indexOf(statusFilter);
    const next = currentIndex >= taskStatuses.length - 1 ? "all" : taskStatuses[currentIndex + 1];
    setStatusFilter(next);
    onAction(next === "all" ? "Showing all tasks." : `Showing ${next.toLowerCase()} tasks.`);
  }

  return <div className="content-wrap tasks-wrap">
     <section className="page-heading"><div><h1>Tasks</h1></div></section>
    <section className="task-summary-row"><div className="task-summary"><span>Open tasks</span><strong>{activeTasks}</strong><small>Across your pipeline</small></div><div className="task-summary"><span>Due today</span><strong>{tasks.filter((task) => task.dueDate === "Today").length}</strong><small>Prioritize these first</small></div><div className="task-summary"><span>Completed</span><strong>{tasks.filter((task) => task.status === "Completed").length}</strong><small>This workspace</small></div></section>
    <section className="tasks-card">
         <div className="tasks-toolbar"><div className="view-title"><div className="view-symbol">✓</div><div><strong>All Tasks</strong><span>{statusFilter === "all" ? "Kanban by status" : `${statusFilter} tasks`}</span></div></div><div className="toolbar-actions"><label className="search-box"><span>⌕</span><input aria-label="Search tasks" onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks..." value={search} /></label><button className="toolbar-button" onClick={cycleStatusFilter} type="button">Tasks by Status⌄</button><button className="toolbar-button" onClick={cycleStatusFilter} type="button">☷ Filter</button><button className="toolbar-button" onClick={() => setSortAscending((current) => !current)} type="button">↕ Sort</button><button className="toolbar-button toolbar-refresh" onClick={() => { setSearch(""); setStatusFilter("all"); setSortAscending(false); onAction("Task view refreshed."); }} type="button">↻ Refresh Custom View</button><button aria-label="Create Task" className="toolbar-button create-toolbar-button" onClick={onCreate} type="button">＋ Create Task</button><button className="toolbar-button toolbar-more" onClick={() => onAction("More task actions opened.")} type="button">More</button><button className="toolbar-button toolbar-actions-menu" onClick={() => onAction("Task actions opened.")} type="button">Actions</button></div></div>
       <div className="kanban-grid">{taskStatuses.map((status) => <div className="kanban-column" key={status}><div className="kanban-heading"><div><strong>{status}</strong><span>{visibleTasks.filter((task) => task.status === status).length}</span></div><button onClick={() => onAction(`${status} task options opened.`)} type="button">•••</button></div><div className="task-stack">{visibleTasks.filter((task) => task.status === status).map((task) => <article className="task-card" key={task.id}><div className="task-card-top"><span className={`priority-dot ${task.priority.toLowerCase()}`} /> <span className="task-priority">{task.priority} priority</span><button onClick={() => onAction(`Actions for “${task.subject}” opened.`)} type="button">•••</button></div><h3>{task.subject}</h3><p>{task.description}</p><div className="task-related"><span>↗ {task.relatedTo || "Unlinked"}</span><span>◷ {task.dueDate}</span></div><div className="task-card-footer"><span className="mini-avatar">{task.owner.slice(0, 1)}</span><span>{task.owner}</span><select aria-label={`Change status for ${task.subject}`} onChange={(event) => onStatusChange(task.id, event.target.value as TaskStatus)} value={task.status}>{taskStatuses.map((option) => <option key={option}>{option}</option>)}</select></div></article>)}{visibleTasks.filter((task) => task.status === status).length === 0 ? <div className="empty-column">No tasks here</div> : null}</div></div>)}</div>
    </section>
  </div>;
}

const pipelineStages: { status: LeadStatus; label: string; helper: string }[] = [
  { status: "New", label: "New", helper: "Needs first touch" },
  { status: "Attempted to Contact", label: "Attempted", helper: "Touch in progress" },
  { status: "Contact in Future", label: "Follow up", helper: "Waiting for timing" },
  { status: "Contacted", label: "Contacted", helper: "Conversation started" },
  { status: "Pre-Qualified", label: "Qualified", helper: "Ready for proposal" },
  { status: "Lost Lead", label: "Lost", helper: "Closed for now" },
];

function PipelineWorkspace({ leads, onAction, onStatusChange, onSelectLead }: { leads: Lead[]; onAction: (message: string) => void; onStatusChange: (leadId: string, status: LeadStatus) => void; onSelectLead: (leadId: string) => void }) {
  const activeLeads = leads.filter((lead) => lead.status !== "Not Qualified" && lead.status !== "Junk Lead");
  const qualified = leads.filter((lead) => lead.status === "Pre-Qualified").length;
  const activeConversations = leads.filter((lead) => ["Attempted to Contact", "Contacted"].includes(lead.status)).length;

  return <div className="content-wrap pipeline-wrap">
    <section className="page-heading">
      <div><div className="eyebrow">Revenue workspace</div><h1>Pipeline</h1><p>See where every conversation stands and choose the next move.</p></div>
      <div className="heading-actions"><button className="secondary-button" onClick={() => onAction("Pipeline view link copied.")} type="button">↗ Share view</button><button className="primary-button" onClick={() => onSelectLead(leads[0]?.id ?? "")} type="button">＋ Review next lead</button></div>
    </section>
    <section className="pipeline-summary"><div className="pipeline-summary-card"><span>Active opportunities</span><strong>{activeLeads.length}</strong><small>Excludes disqualified records</small></div><div className="pipeline-summary-card"><span>Active conversations</span><strong>{activeConversations}</strong><small>Attempted or contacted</small></div><div className="pipeline-summary-card"><span>Ready for proposal</span><strong>{qualified}</strong><small>Pre-qualified leads</small></div><div className="pipeline-summary-card"><span>Estimated value</span><strong>₹8.4L</strong><small>Based on current fit</small></div></section>
    <section className="pipeline-card">
      <div className="pipeline-toolbar"><div className="view-title"><div className="view-symbol">◈</div><div><strong>Lead pipeline</strong><span>{activeLeads.length} records in motion</span></div></div><span className="pipeline-tip">Move a lead when the next meaningful signal arrives</span></div>
      <div className="pipeline-board">
        {pipelineStages.map((stage) => {
          const stageLeads = activeLeads.filter((lead) => lead.status === stage.status);
          return <div className="pipeline-column" key={stage.status}>
            <div className="pipeline-heading"><div><span className="pipeline-stage-dot" /><strong>{stage.label}</strong><b>{stageLeads.length}</b></div><small>{stage.helper}</small></div>
            <div className="pipeline-stack">
              {stageLeads.map((lead) => <article className="pipeline-lead-card" key={lead.id}>
                <button className="pipeline-card-link" onClick={() => onSelectLead(lead.id)} type="button"><div className="pipeline-card-top"><span className={`lead-avatar ${ratingTone(lead.rating)}`}>{initials(lead)}</span><span><strong>{lead.company}</strong><small>{lead.firstName} {lead.lastName}</small></span></div><p>{lead.title} · {lead.industry}</p><div className="pipeline-card-meta"><span className={`rating-badge ${ratingTone(lead.rating)}`}>{lead.rating} fit</span><span>◷ {lead.lastActivity}</span></div></button>
                <select aria-label={`Move ${lead.company}`} onChange={(event) => onStatusChange(lead.id, event.target.value as LeadStatus)} onClick={(event) => event.stopPropagation()} value={lead.status}>{leadStatuses.map((status) => <option key={status}>{status}</option>)}</select>
              </article>)}
              {stageLeads.length === 0 ? <div className="pipeline-empty">No leads here</div> : null}
            </div>
          </div>;
        })}
      </div>
    </section>
  </div>;
}

function ReportsWorkspace({ leads, tasks, onAction = () => undefined }: { leads: Lead[]; tasks: Task[]; onAction?: (message: string) => void }) {
  const maxStatusCount = Math.max(...leadStatuses.map((status) => leads.filter((lead) => lead.status === status).length), 1);
  const sourceCounts = leadSources.map((source) => ({ source, count: leads.filter((lead) => lead.source === source).length })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
  const completedTasks = tasks.filter((task) => task.status === "Completed").length;
  const openTasks = tasks.length - completedTasks;

  return <div className="content-wrap reports-wrap">
    <section className="page-heading"><div><div className="eyebrow">Operating rhythm</div><h1>Reports</h1><p>See what is moving, what is stuck, and where the next hour should go.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => window.print()} type="button">⤓ Export report</button><button className="primary-button" onClick={() => onAction("Report saved to the workspace.")} type="button">＋ Save report</button></div></section>
    <section className="report-metric-grid"><div className="report-metric"><span>Lead-to-qualified</span><strong>{leads.length ? Math.round((leads.filter((lead) => lead.status === "Pre-Qualified").length / leads.length) * 100) : 0}%</strong><small>Current workspace conversion</small></div><div className="report-metric"><span>Follow-up completion</span><strong>{tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0}%</strong><small>{completedTasks} of {tasks.length} tasks complete</small></div><div className="report-metric"><span>Active pipeline</span><strong>{leads.filter((lead) => !["Lost Lead", "Junk Lead", "Not Qualified"].includes(lead.status)).length}</strong><small>Leads still in motion</small></div><div className="report-metric"><span>Open actions</span><strong>{openTasks}</strong><small>Tasks needing attention</small></div></section>
    <section className="report-grid"><article className="report-card"><div className="section-toolbar"><div><strong>Pipeline distribution</strong><span>Records by lifecycle stage</span></div><span className="report-period">Current</span></div><div className="bar-list">{pipelineStages.map((stage) => { const count = leads.filter((lead) => lead.status === stage.status).length; return <div className="bar-row" key={stage.status}><div><span>{stage.label}</span><b>{count}</b></div><div className="bar-track"><span style={{ width: `${Math.max((count / maxStatusCount) * 100, count ? 10 : 0)}%` }} /></div></div>; })}</div></article><article className="report-card"><div className="section-toolbar"><div><strong>Lead sources</strong><span>Where your current records came from</span></div></div><div className="source-list">{sourceCounts.map((item, index) => <div className="source-row" key={item.source}><span className={`source-dot source-${index % 4}`} /><div><strong>{item.source}</strong><small>{Math.round((item.count / Math.max(leads.length, 1)) * 100)}% of leads</small></div><b>{item.count}</b></div>)}{sourceCounts.length === 0 ? <div className="empty-state"><strong>No source data yet</strong></div> : null}</div></article></section>
    <section className="report-card focus-card"><div className="section-toolbar"><div><strong>Recommended focus</strong><span>A simple operating view for the next work block.</span></div><span className="focus-badge">Today</span></div><div className="focus-list"><div><span className="focus-number">01</span><div><strong>Complete the {tasks.filter((task) => task.dueDate === "Today" && task.status !== "Completed").length} due-today task(s)</strong><p>Keep follow-up promises visible before adding more prospects.</p></div></div><div><span className="focus-number">02</span><div><strong>Review {leads.filter((lead) => lead.status === "New" && lead.rating === "Hot").length} hot new lead(s)</strong><p>Use Leads to capture context before the next follow-up.</p></div></div><div><span className="focus-number">03</span><div><strong>Move qualified conversations forward</strong><p>Turn the strongest signals into a proposal or discovery call.</p></div></div></div></section>
  </div>;
}

function CreateTaskModal({ draft, error, onChange, onClose, onSubmit }: { draft: TaskDraft; error: string; onChange: (field: keyof TaskDraft, value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" role="presentation"><div className="create-modal task-modal" role="dialog" aria-modal="true" aria-labelledby="create-task-title"><div className="modal-header"><div><div className="eyebrow">Activity record</div><h2 id="create-task-title">Create task</h2><p>Give the next follow-up a clear owner and due date.</p></div><button className="close-button" onClick={onClose} type="button">×</button></div><form onSubmit={onSubmit}><div className="form-section"><div className="form-section-heading"><strong>Task information</strong><span>Subject, ownership, relationship, and status.</span></div><div className="form-grid"><Field label="Task owner"><select aria-label="Task owner" onChange={(event) => onChange("owner", event.target.value)} value={draft.owner}><option>You</option><option>Growth team</option></select></Field><Field label="Subject" required><input aria-label="Task subject" onChange={(event) => onChange("subject", event.target.value)} value={draft.subject} /></Field><Field label="Due date"><input aria-label="Due date" onChange={(event) => onChange("dueDate", event.target.value)} placeholder="e.g. Tomorrow" value={draft.dueDate} /></Field><Field label="Contact"><input aria-label="Contact" onChange={(event) => onChange("contact", event.target.value)} value={draft.contact} /></Field><Field label="Account"><input aria-label="Account" onChange={(event) => onChange("relatedTo", event.target.value)} value={draft.relatedTo} /></Field><Field label="Status"><select aria-label="Task status" onChange={(event) => onChange("status", event.target.value)} value={draft.status}>{taskStatuses.map((status) => <option key={status}>{status}</option>)}</select></Field><Field label="Priority"><select aria-label="Task priority" onChange={(event) => onChange("priority", event.target.value)} value={draft.priority}><option>High</option><option>Normal</option><option>Low</option></select></Field></div></div><div className="form-section"><div className="form-section-heading"><strong>Description information</strong><span>Keep the handoff useful for future follow-up.</span></div><label className="form-field"><span>Description</span><textarea aria-label="Task description" className="task-description-input" onChange={(event) => onChange("description", event.target.value)} value={draft.description} /></label></div>{error ? <div className="form-error">{error}</div> : null}<div className="modal-footer"><span className="form-hint"><span className="required-star">*</span> Required fields</span><div><button className="secondary-button" onClick={onClose} type="button">Cancel</button><button className="primary-button" type="submit">Save task</button></div></div></form></div></div>;
}

function CreateLeadModal({ draft, editing, error, onChange, onClose, onSubmit }: { draft: LeadDraft; editing: boolean; error: string; onChange: (field: keyof LeadDraft, value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-lead-title">
        <div className="modal-header"><div><div className="eyebrow">{editing ? "Update record" : "New record"}</div><h2 id="create-lead-title">{editing ? "Edit lead" : "Create lead"}</h2><p>{editing ? "Keep the qualification context current." : "Add a prospect to your CRM."}</p></div><button className="close-button" onClick={onClose} type="button">×</button></div>
        <form onSubmit={onSubmit}>
          <div className="form-section"><div className="form-section-heading"><strong>Lead information</strong><span>Core contact and qualification details.</span></div><div className="form-grid">
            <Field label="First name"><input aria-label="First name" onChange={(event) => onChange("firstName", event.target.value)} value={draft.firstName} /></Field>
            <Field label="Last name" required><input aria-label="Last name" onChange={(event) => onChange("lastName", event.target.value)} value={draft.lastName} /></Field>
            <Field label="Company" required><input aria-label="Company" onChange={(event) => onChange("company", event.target.value)} value={draft.company} /></Field>
            <Field label="Title"><input aria-label="Title" onChange={(event) => onChange("title", event.target.value)} value={draft.title} /></Field>
            <Field label="Email"><input aria-label="Email" onChange={(event) => onChange("email", event.target.value)} type="email" value={draft.email} /></Field>
            <Field label="Phone"><input aria-label="Phone" onChange={(event) => onChange("phone", event.target.value)} value={draft.phone} /></Field>
            <Field label="Website"><input aria-label="Website" onChange={(event) => onChange("website", event.target.value)} value={draft.website} /></Field>
            <Field label="Industry"><select aria-label="Industry" onChange={(event) => onChange("industry", event.target.value)} value={draft.industry}>{industries.map((industry) => <option key={industry}>{industry}</option>)}</select></Field>
            <Field label="Lead source"><select aria-label="Lead source" onChange={(event) => onChange("source", event.target.value)} value={draft.source}>{leadSources.map((source) => <option key={source}>{source}</option>)}</select></Field>
            <Field label="Lead status"><select aria-label="Lead status" onChange={(event) => onChange("status", event.target.value)} value={draft.status}>{leadStatuses.map((status) => <option key={status}>{status}</option>)}</select></Field>
            <Field label="Rating"><select aria-label="Rating" onChange={(event) => onChange("rating", event.target.value)} value={draft.rating}><option>Hot</option><option>Warm</option><option>Cold</option></select></Field>
            <Field label="Owner"><select aria-label="Owner" onChange={(event) => onChange("owner", event.target.value)} value={draft.owner}><option>You</option><option>Growth team</option></select></Field>
          </div></div>
          <div className="form-section"><div className="form-section-heading"><strong>Address information</strong><span>Optional location context for qualification.</span></div><div className="form-grid">
            <Field label="City"><input aria-label="City" onChange={(event) => onChange("city", event.target.value)} value={draft.city} /></Field>
            <Field label="Country / region"><input aria-label="Country / region" onChange={(event) => onChange("country", event.target.value)} value={draft.country} /></Field>
            <Field label="Employees"><input aria-label="Employees" onChange={(event) => onChange("employees", event.target.value)} placeholder="e.g. 11–25" value={draft.employees} /></Field>
            <Field label="Annual revenue"><input aria-label="Annual revenue" onChange={(event) => onChange("revenue", event.target.value)} placeholder="e.g. ₹50L–₹1Cr" value={draft.revenue} /></Field>
          </div></div>
          {error ? <div className="form-error">{error}</div> : null}
           <div className="modal-footer"><span className="form-hint"><span className="required-star">*</span> Required fields</span><div><button className="secondary-button" onClick={onClose} type="button">Cancel</button><button aria-label={editing ? "Save lead" : "Create lead"} className="primary-button" type="submit">{editing ? "Save changes" : "Create lead"}</button></div></div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <label className="form-field"><span>{label}{required ? <em>*</em> : null}</span>{children}</label>;
}

export default App;
