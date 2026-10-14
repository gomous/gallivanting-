# Local backend service requirements

This is the living implementation backlog for the local backend. It is based
on behavior observed in the live Zoho CRM session and on capabilities already
present in Gallivanting. A requirement is marked as observed only when the live
session exposed it; unobserved write behavior remains open until a safe probe is
performed.

## Foundation implemented now

- Browser-local persistence fallback.
- Browser-local collections for the legacy Leads, Tasks, and module workspaces.
- Electron-local JSON persistence mirror in the packaged app.
- Versioned workspace envelope.
- Bounded local audit log.
- Existing CRM validation, migration, backup, soft-delete, timeline, view,
  report, dashboard, and relationship logic remain the domain layer.

## Service backlog

| Service | Local responsibilities | Live Zoho evidence | Next reverse-engineering work |
| --- | --- | --- | --- |
| Workspace and persistence | Store, version, recover, and report storage health | Org-scoped `/crm/org60091604256` routes | Map account/user settings boundaries |
| Module metadata and layouts | Fields, types, layouts, required rules, lookups | `ModuleCache.do`, `v2.2/settings/modules`, `v8/settings/canvas/views` | Capture every module schema and conditional layout rule |
| Records | CRUD, bulk operations, lifecycle, references | `POST /crm/v2.2/Contacts/bulk`, Contacts create route, and `/tab/Contacts/{recordId}` detail route | Observe safe create/update/delete calls |
| Views and filters | Custom views, filtering, sorting, pagination, view preferences | `v9/settings/custom_views`, filters, view preferences | Capture button-specific request deltas |
| Relationships | Lookups, related lists, child relationships | `v9/settings/child_relationships` and related filter catalog | Map cardinalities and related-list actions |
| Activities | Tasks, meetings, calls, notes, timelines | Activities navigation and related modules | Probe each activity create/edit flow |
| Search | Global and module search | Search controls visible in live shell | Identify endpoint, debounce, ranking, and navigation |
| Automation | Workflows, blueprints, approvals, webhooks, cadences | Actions and MCP automation surfaces | Map settings and execution payloads |
| Analytics | Reports, dashboards, forecasts, aggregations | Reports, Analytics, Forecasts navigation | Capture builder and widget data requests |
| Files | Documents, attachments, import/export | Documents/WorkDrive and local backup | Map upload/download and permissions |
| Integrations | Email, phone, calendar, MCP, external adapters | MCP Server and utility surfaces | Map auth, callbacks, and scopes |
| Audit and permissions | Audit events, notices, profiles, permissions, tracing | `v9/__internal/client_tracking` and live notices | Map users, roles, sharing, and audit APIs |

## Guardrails for future live probes

1. Use the authenticated live session only.
2. Observe navigation, metadata, and read-only requests first.
3. Do not submit, delete, or mutate real Zoho data without an explicit test
   record and user approval.
4. Record route, method, path, query shape, body shape, redirect, and UI state.
5. Mark behavior as observed, inferred, or unknown in the service ledger.

## Newly observed Contact detail requests

Opening a live Contact detail route loaded these read-only contracts:

```text
GET /crm/v2.2/Contacts/{recordId}
GET /crm/v2.2/Contacts/{recordId}/actions/available_actions
GET /crm/v5/settings/related_lists?module=Contacts&layout_id={layoutId}
GET /crm/v9/__features/status?module=Contacts&group=zia
GET /crm/v9/settings/custom_buttons?module=Contacts
GET /crm/v9/settings/layout_rules?module=Contacts&include=conditions
GET /crm/v2.2/Contacts/{recordId}/actions/get_feature_specific_info?features=layout_rules
GET /crm/v6/Contacts/{recordId}/actions/get_feature_specific_info?features=blocked_emails,unsubscribed_emails
```

## Newly observed live navigation routes

```text
Home       /crm/org60091604256/tab/Home/begin
Workqueue  /crm/org60091604256/tab/Workqueue/1458063000000547107/queue/1458063000000547108
Reports    /crm/org60091604256/tab/Reports
Analytics  /crm/org60091604256/tab/Dashboards
Agents     /crm/org60091604256/tab/Agents
MCP Server /crm/org60091604256/tab/mcp
Leads      /crm/org60091604256/tab/Leads
Contacts   /crm/org60091604256/tab/Contacts
Accounts   /crm/org60091604256/tab/Accounts
Deals      /crm/org60091604256/tab/Potentials
Forecasts  /crm/org60091604256/tab/Forecasts
Documents  /crm/org60091604256/tab/Documents
Campaigns  /crm/org60091604256/tab/Campaigns
Tasks      /crm/org60091604256/tab/Tasks
Meetings   /crm/org60091604256/tab/Events
Calls      /crm/org60091604256/tab/Calls
```

The Contacts link resolves into the custom-view list route after loading, and
the local app now preserves the same route family for list, create, and detail
states.

## Probe tooling notes

- Zoho list controls such as Filter, Sort, More, and Actions may be rendered as
  custom elements (`lyte-button`, `lyte-dropdown`, and elements carrying
  `data-zcqa`) rather than native buttons. The bounded probe in
  `scripts/probe-live.mjs` includes those elements and strips decorative icon
  prefixes before matching labels.
- Browser target IDs are ephemeral. Always rediscover the authenticated Zoho
  target immediately before a probe and verify its exact origin. A target that
  changes to another site or disappears is treated as unavailable evidence.
- The probe records visible controls and method/path/query request metadata only;
  it does not capture credentials, response bodies, or submit record mutations.

## Latest live Contacts list observations

Observed on the authenticated Contacts custom-view list at
`/crm/org60091604256/tab/Contacts/custom-view/1458063000000029537/list?page=1`:

| Surface | Stable marker | Observed behavior | Request observation |
| --- | --- | --- | --- |
| Filter | `data-zcqa="lv_filterStatus"` | Handler metadata identifies `showHideFilters(this)`. Opening changes the control class to `activeLabel` and exposes `lv_filter_srch_input`, `System Defined Filters`, `Filter By Fields`, and `Filter By Related Modules`. | No new request in the short attached probe window. |
| Sort | `data-zcqa="sortView"` | Opens a sort surface with `Sort By`, `sortFieldDropdown` initially `None`, `sortOrderDropdown` initially `Ascending`, `cancelSort`, and `applySort`. Cancel was used; no sort was applied. | No new request in the short attached probe window. |
| Refresh Custom View | `data-zcqa="fetchdate_title"` | `aria-label="Refresh Custom View"`; handler metadata identifies `refreshview()`. | No new request observed in the attached window; cached/local refresh behavior remains unresolved. |
| Actions | `data-zcqa="cv_tools"` / `id="moreTools"` | `aria-controls="moreToolsPopup"`, `aria-haspopup="menu"`, and `aria-expanded="false"` were observed. A synthetic pointer click did not produce an observed open menu, so menu contents remain unknown. | No new request observed. |
| View Settings | `data-zcqa="listView_addColumn"` | A visible `View Settings` control was present in the post-filter DOM snapshot. Its opened state and column-setting behavior remain unprobed. | Unknown. |

The list contained 10 Contacts and exposed row links such as
`/crm/org60091604256/tab/Contacts/1458063000000478805`. No record was created,
edited, deleted, or otherwise mutated during these probes.

## Latest local route smoke result

The local Contacts flow was exercised through the live local renderer target:

```text
/crm/org60091604256/tab/Contacts/custom-view/1458063000000029537/list?page=1
/crm/org60091604256/tab/Contacts/1458063000000478808
/crm/org60091604256/tab/Contacts/custom-view/1458063000000029537/list?page=1
/crm/org60091604256/tab/Contacts/create
/crm/org60091604256/tab/Contacts/custom-view/1458063000000029537/list?page=1
```

This confirms local list, detail, close, create, and cancel navigation using
the observed Zoho Contact record identifier.

## Contacts detail implementation pass

The local Contact detail route now provides a persistent local detail surface
with:

- Contact Information and Address sections.
- Overview, Timeline, and Related Lists tabs.
- Persisted notes and timeline events.
- Related-list categories for activities, notes, attachments, emails, calls,
  meetings, deals, and cases.
- Related local record links where matching module records exist.
- Edit, delete-to-recycle-bin, and local lifecycle metadata.
- Browser history synchronization for Contacts list/detail navigation.

The local module repository validates saved records, preserves existing records
instead of replacing them with seed fixtures, writes before route transitions,
and fails closed when persisted records are malformed.

## Latest detail probe boundary

REA target discovery found a fresh authenticated Contact detail target at
`/crm/org60091604256/tab/Contacts/1458063000000478808`, but the page remained at
`Loading` and the bounded REA browser scenario ended with `MCP error -32000:
Connection closed`. No new detail DOM or screenshot claim was made from that
attempt. The local detail implementation remains based on the prior read-only
Contact detail contracts until a fully loaded live detail page is available.

## Loaded Contact detail observation

The authenticated Edge tab was then brought into the foreground before the
detail capture. The loaded page at
`/crm/org60091604256/tab/Contacts/1458063000000478808` exposed these observed
surfaces:

- Header actions: `Add Tags`, `Send Email`, `Edit`, and `Related List`.
- Detail tabs: `Overview` and `Timeline`.
- Summary values: `Contact Owner`, `Email`, `Phone`, `Mobile`, and
  `Department`.
- A `Next Action` area with two activity links.
- `Contact Information`, `Address Information`, `Description Information`,
  and `Notes` sections.
- Related lists including `Notes`, `Connected Records`, `Cadences`,
  `Attachments`, `Deals`, `Open Activities`, `Closed Activities`, `Invited
  Meetings`, `Products`, `Cases`, `Quotes`, `Sales Orders`, `Purchase Orders`,
  `Emails`, `Invoices`, `Campaigns`, `Social`, and `Reporting Contacts`.
- Observed related counts included `Deals: 1` and `Open Activities: 2`.

This loaded inspection is recorded as
`ev_17ab48a0912474c112735c0c82700ed047dfc5c39ef6bfdf380fda212bce27d1`.

## Contact detail button inventory and local implementation

The loaded Contact detail was explored without submitting a record mutation.
The observed header controls were `Add Tags`, `Send Email`, `Edit`, and
`More Options`. The original More Options menu exposed:

```text
Clone
Delete
Print Preview
Find and Merge Duplicates
Mail Merge
Run Macro
Customize Business Card
Organize Contact Details
Add Related List
Review History
Enroll to Cadence
Add Kiosk
Create Button
Create Client Script
```

The related-list controls were also inventoried. The local Contact detail now
implements equivalent local-only interactions for tag editing, email compose,
draft/save/send states, edit, delete, clone/action dialogs, detail collapse and
restore, related-list selection, and related actions for Notes, Connected
Records, Cadences, Attachments, Deals, Open/Closed Activities, Products, Cases,
Quotes, Sales Orders, Purchase Orders, Emails, Invoices, Campaigns, Social, and
Reporting Contacts. Actions append auditable local timeline events rather than
calling Zoho or sending external messages.

The original Add Tags editor probe is retained as
`ev_30357a74c3f968143692433fa99e99b5358f379507ec65720ec401e0bc849798`.

## Zoho CRM UI architecture

The authenticated Leads custom view was inspected at
`/crm/org60091604256/tab/Leads/custom-view/1458063000000029342/list?page=1`.
The inventory includes the toolbar, filter-builder groups and choices, sort
dialog, custom-view selector, alternate view modes, create form, More menu,
Actions menu, View Settings menu, row links, selection controls, alpha search,
pagination, and visible shell utilities.

The local CRM no longer contains the Button Graph control or graph modal.

The standalone page `zoho-ui-architecture.html` is a plain JavaScript reference
page, separate from the React CRM. It has no links to Zoho or to local CRM routes,
does not execute CRM actions, and does not create records. It presents the
observed UI architecture as five stable layers:

1. Application shell — product switcher, Teamspace, top bar, and collapsible menu.
2. Workspace navigation — Home/Workqueue/Reports/Analytics/Agents/MCP plus Sales,
   Activities, Inventory, and module search.
3. Module workspace — org-scoped route, custom-view selector, view modes, search,
   and list summary.
4. Module surfaces — record list, filter builder, sort, create/edit form, detail,
   and mass actions.
5. Global utilities and overlays — More, quick create, Ask Zia, utility bar,
   Marketplace, and Setup.

The page uses observed Zoho labels, `data-zcqa` locators, route shapes, and the
observed Leads/Contacts surface structure. Items not opened during the passive
inspection are explicitly marked as shell-observed or not fully inspected.
Run `node scripts/smoke-zoho-ui-architecture.mjs <local-target-id>` while the
local renderer is available to check the standalone page, layer filtering,
search, card inspection, no-link behavior, and runtime errors.

The primary Leads inspection evidence is
`ev_d32d61ff1e0684c073dc57dd252f8ea7358aa08a52ea901207c2a67118e2e5fc`.

## REA MCP provenance and visual parity pass

The current implementation pass used REA MCP directly for live browser
discovery and passive inspection. The local renderer was then inspected through
the same CDP endpoint for side-by-side structural comparison.

Recorded Evidence IDs:

- `ev_b03ccd40ed2e1b73c9e412a438d6f43ca78e62159e8bdfb5d7b9b744df069b4e` —
  authenticated Zoho target discovery.
- `ev_d08a34baf143efcdd8a79a03a80b93ae368adfb1324c00fe8b87af84715e470d` —
  passive live Zoho page inspection.
- `ev_58ba36f8469458b93d8a63664afb6e6ad5ce8b0d01c567c787e36dd35d9e4f54` —
  side-by-side target discovery for live Zoho and the local renderer.
- Local Contacts page inspection was retained by the REA CLI transport for
  structural comparison; its large response was intentionally summarized
  rather than copied into this document.

The local shell now exposes an **REA evidence** panel in the top bar. It shows
the live Zoho routes, observation kinds, and Evidence IDs used for the current
implementation. The local UI remains offline; the panel is provenance, not a
live Zoho synchronization layer.

The visual parity pass aligned the local shell and Contacts view with observed
Zoho facts: Zoho CRM branding, CRM Teamspace identity, dense CRM navigation,
Contacts custom-view route, 10 observed Contacts sample rows, the observed
Contact owner value, and the live toolbar labels. The local inspection reported
the same Contacts table header family and toolbar semantics. Pixel-perfect
comparison remains unavailable because the REA screenshot operation timed out
for both targets; structure and accessibility evidence were captured instead.
