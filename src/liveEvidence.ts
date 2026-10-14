export type LiveEvidenceItem = {
  id: string;
  kind: string;
  route: string;
  finding: string;
};

/** Human-visible pointers to observations captured through REA MCP. */
export const liveEvidence: LiveEvidenceItem[] = [
  {
    id: "ev_b03ccd40ed2e1b73c9e412a438d6f43ca78e62159e8bdfb5d7b9b744df069b4e",
    kind: "REA target discovery",
    route: "https://crm.zoho.in/crm/org60091604256/tab/Leads/custom-view/1458063000000029342/list?page=1",
    finding: "Authenticated Zoho CRM target discovered through REA MCP.",
  },
  {
    id: "ev_d08a34baf143efcdd8a79a03a80b93ae368adfb1324c00fe8b87af84715e470d",
    kind: "REA passive page inspection",
    route: "https://crm.zoho.in/crm/org60091604256/tab/Contacts/custom-view/1458063000000029537/list?page=1",
    finding: "Zoho shell, Contacts list, toolbar markers, and live DOM/accessibility structure observed.",
  },
  {
    id: "ev_13bb740198a9dce505a51e539e4081d5b5521377880d7d86b00538d44a3cc1fa",
    kind: "REA target comparison",
    route: "https://crm.zoho.in/crm/org60091604256/tab/Leads/custom-view/1458063000000029342/list?page=1",
    finding: "Live Zoho and local browser targets were confirmed side by side.",
  },
  {
    id: "ev_576779c3314244e6d39a78dc90c12562680566d61273e68d6bb79c5ed7d04e46",
    kind: "REA Contact detail target",
    route: "https://crm.zoho.in/crm/org60091604256/tab/Contacts/1458063000000478808",
    finding: "Earlier authenticated Contact detail attempt remained Loading before the tab was brought into view.",
  },
  {
    id: "ev_17ab48a0912474c112735c0c82700ed047dfc5c39ef6bfdf380fda212bce27d1",
    kind: "REA loaded Contact detail inspection",
    route: "https://crm.zoho.in/crm/org60091604256/tab/Contacts/1458063000000478808",
    finding: "After the Edge tab was brought into view, the loaded Contact detail exposed Contact Information, Address Information, Description Information, Notes, Overview/Timeline tabs, Next Action entries, and related-list counts including Deals 1 and Open Activities 2.",
  },
  {
    id: "ev_1dd2958f556f0a4c65b70b5141c2714672b5d86b353351f16d812cbab144f8fb",
    kind: "REA Edge target inventory",
    route: "https://crm.zoho.in/crm/org60091604256/tab/Contacts/1458063000000478808",
    finding: "The debug-enabled Edge window now contains exactly the authenticated Zoho Contact detail and the local Contact detail page.",
  },
  {
    id: "ev_30357a74c3f968143692433fa99e99b5358f379507ec65720ec401e0bc849798",
    kind: "REA Contact button probe",
    route: "https://crm.zoho.in/crm/org60091604256/tab/Contacts/1458063000000478808",
    finding: "The safe Add Tags probe opened the original tag editor with Cancel and Save controls; the complete scenario evidence was retained by REA.",
  },
  {
    id: "ev_b9218e203dedbc144d6a592796866b3b965adb47f1bc95f5d59fff955e63e8b6",
    kind: "REA button listener inspection",
    route: "https://crm.zoho.in/crm/org60091604256/tab/Contacts/1458063000000478808",
    finding: "Direct native listeners were not exposed on the first matching button; delegated/framework handlers remain part of the original UI behavior boundary.",
  },
  {
    id: "ev_d32d61ff1e0684c073dc57dd252f8ea7358aa08a52ea901207c2a67118e2e5fc",
    kind: "REA Leads page inspection",
    route: "https://crm.zoho.in/crm/org60091604256/tab/Leads/custom-view/1458063000000029342/list?page=1",
    finding: "The authenticated Leads custom view exposed list controls, filter groups, custom-view choices, sort controls, create form entry, import/actions menus, view settings, view modes, row links, selection, pagination, and shell utilities.",
  },
  {
    id: "ev_253f0d6d07ef6937be4996dd32dbe26ff50b69a041a0d5448c7a0a1bf30c6a99",
    kind: "REA Leads target inventory",
    route: "https://crm.zoho.in/crm/org60091604256/tab/Leads/custom-view/1458063000000029342/list?page=1",
    finding: "The debug-enabled Edge session contains the original Leads page and the local app target.",
  },
];
