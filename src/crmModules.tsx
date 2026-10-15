import { useMemo, useState, type FormEvent } from "react";
import { loadModuleRecords, persistModuleRecords, recordEvent, restoreModuleRecord, saveModuleRecord, type ModuleRecord } from "./moduleRecords";
import { ContactDetailPanel } from "./ContactDetail";

export type CrmModuleKey =
  | "Contacts"
  | "Accounts"
  | "Deals"
  | "Forecasts"
  | "Documents"
  | "Campaigns"
  | "Meetings"
  | "Calls"
  | "Products"
  | "Price Books"
  | "Quotes"
  | "Sales Orders"
  | "Purchase Orders"
  | "Invoices"
  | "Vendors"
  | "Cases"
  | "Solutions";

export type CrmRoute = { module: CrmModuleKey; mode: "list" | "create" | "detail"; recordId?: string };

export type ModuleField = {
  key: string;
  label: string;
  type?: "text" | "date" | "number" | "select" | "textarea";
  options?: string[];
  required?: boolean;
};

type FilterGroup = {
  label: string;
  options: string[];
};

export type CrmRecord = ModuleRecord;

type ModuleConfig = {
  key: CrmModuleKey;
  label: string;
  description: string;
  view: "list" | "kanban" | "empty";
  columns: { key: string; label: string }[];
  fields: ModuleField[];
  filters: FilterGroup[];
  seed: CrmRecord[];
};

type ActionHandler = (message: string) => void;

const commonSystemFilters = ["Touched Records", "Untouched Records", "Record Action", "Related Records Action"];

const record = (id: string, values: Record<string, string>): CrmRecord => ({ id, values });

const contactRecords = [
  record("1458063000000478808", { firstName: "Kris", lastName: "Marrier (Sample)", accountName: "King (Sample)", email: "krismarrier@noemail.invalid", phone: "555-555-5555", mobile: "555-555-5555", department: "Engineering", title: "Quality Engineer", owner: "mukatte kuru no ka kaka", leadSource: "Trade Show", skypeId: "kris_marrier", twitter: "krismarrier_sample", mailingStreet: "228 Runamuck Pl #2808", city: "Baltimore", mailingState: "MD", mailingZip: "21224", mailingCountry: "United States" }),
  record("1458063000000478807", { firstName: "Sage", lastName: "Wieser (Sample)", accountName: "Truhlar And Truhlar (Sample)", email: "sage-wieser@noemail.invalid", phone: "555-555-5555", owner: "mukatte kuru no ka kaka", leadSource: "Website", city: "Mumbai" }),
  record("1458063000000478806", { firstName: "Leota", lastName: "Dilliard (Sample)", accountName: "Commercial Press (Sample)", email: "leota-dilliard@noemail.invalid", phone: "555-555-5555", owner: "mukatte kuru no ka kaka", leadSource: "Event", city: "New Delhi" }),
  record("1458063000000478805", { firstName: "Mitsue", lastName: "Tollner (Sample)", accountName: "Morlong Associates (Sample)", email: "tollner-morlong@noemail.invalid", phone: "555-555-5555", owner: "mukatte kuru no ka kaka", leadSource: "Partner", city: "Chennai" }),
  record("1458063000000478804", { firstName: "Simon", lastName: "Morasca (Sample)", accountName: "Chapman (Sample)", email: "simonm@noemail.invalid", phone: "555-555-5555", owner: "mukatte kuru no ka kaka", leadSource: "Cold outreach", city: "Ahmedabad" }),
  record("1458063000000478803", { firstName: "Donette", lastName: "Foller (Sample)", accountName: "Printing Dimensions (Sample)", email: "foller-donette@noemail.invalid", phone: "555-555-5555", owner: "mukatte kuru no ka kaka", leadSource: "Website", city: "Kolkata" }),
  record("1458063000000478802", { firstName: "Capla", lastName: "Paprocki (Sample)", accountName: "Feltz Printing Service (Sample)", email: "capla-paprocki@noemail.invalid", phone: "555-555-5555", owner: "mukatte kuru no ka kaka", leadSource: "Website", city: "Bengaluru" }),
  record("1458063000000478801", { firstName: "James", lastName: "Venere (Sample)", accountName: "Chemel (Sample)", email: "ljames-venere@noemail.invalid", phone: "555-555-5555", owner: "mukatte kuru no ka kaka", leadSource: "Event", city: "Mumbai" }),
  record("1458063000000478800", { firstName: "Josephine", lastName: "Darakjy (Sample)", accountName: "Chanay (Sample)", email: "joesphine-darakjy@noemail.invalid", phone: "555-555-5555", owner: "mukatte kuru no ka kaka", leadSource: "Referral", city: "New Delhi" }),
  record("1458063000000478799", { firstName: "John", lastName: "Butt (Sample)", accountName: "Benton (Sample)", email: "john-buttbenton@noemail.invalid", phone: "555-555-5555", owner: "mukatte kuru no ka kaka", leadSource: "Website", city: "Chennai" }),
];

const accountRecords = [
  record("account-001", { accountName: "King", phone: "555-555-5555", website: "kingmanufacturing.example", owner: "You", industry: "Manufacturing", type: "Customer", employees: "51–100", city: "Bengaluru" }),
  record("account-002", { accountName: "Truhlar And Truhlar", phone: "555-555-5555", website: "truhlarandtruhlar.example", owner: "You", industry: "Professional services", type: "Prospect", employees: "26–50", city: "Mumbai" }),
  record("account-003", { accountName: "Commercial Press", phone: "555-555-5555", website: "commercialpress.example", owner: "Growth team", industry: "Media", type: "Prospect", employees: "11–25", city: "New Delhi" }),
  record("account-004", { accountName: "Morlong Associates", phone: "555-555-5555", website: "morlongassociates.example", owner: "You", industry: "Professional services", type: "Customer", employees: "6–10", city: "Chennai" }),
  record("account-005", { accountName: "Chapman", phone: "555-555-5555", website: "chapman.example", owner: "You", industry: "Technology", type: "Prospect", employees: "26–50", city: "Ahmedabad" }),
  record("account-006", { accountName: "Printing Dimensions", phone: "555-555-5555", website: "printingdimensions.example", owner: "Growth team", industry: "Manufacturing", type: "Customer", employees: "101–250", city: "Kolkata" }),
];

const dealRecords = [
  record("deal-001", { dealName: "King", stage: "Id. Decision Makers", amount: "60000", probability: "60", accountName: "King (Sample)", contactName: "Kris Marrier (Sample)", closingDate: "2026-10-14", owner: "mukatte kuru no ka kaka", type: "New Business", nextStep: "Confirm discovery call" }),
  record("deal-002", { dealName: "Truhlar And Truhlar Attys", stage: "Needs Analysis", amount: "45000", probability: "20", accountName: "Truhlar And Truhlar", contactName: "Sage Wieser", closingDate: "2026-10-12", owner: "You", type: "Existing Business", nextStep: "Send workflow sample" }),
  record("deal-003", { dealName: "Chanay", stage: "Needs Analysis", amount: "55000", probability: "20", accountName: "Chanay", contactName: "Josephine Darakjy", closingDate: "2026-10-13", owner: "Growth team", type: "New Business", nextStep: "Review requirements" }),
  record("deal-004", { dealName: "Chemel", stage: "Value Proposition", amount: "70000", probability: "40", accountName: "Chemel", contactName: "James Venere", closingDate: "2026-10-12", owner: "You", type: "New Business", nextStep: "Prepare proposal" }),
];

const campaignRecords: CrmRecord[] = [];

const meetingRecords = [
  record("meeting-001", { title: "Demo", from: "2026-10-12 04:27", to: "2026-10-12 05:27", relatedTo: "Printing Dimensions", contactName: "Donette Foller", host: "You", location: "Video call", allDay: "No" }),
  record("meeting-002", { title: "Webinar", from: "2026-10-12 06:27", to: "2026-10-12 07:27", relatedTo: "Commercial Press", contactName: "Leota Dilliard", host: "You", location: "Online", allDay: "No" }),
  record("meeting-003", { title: "TradeShow", from: "2026-10-12", to: "2026-10-12", relatedTo: "Chemel", contactName: "James Venere", host: "Growth team", location: "Mumbai", allDay: "Yes" }),
];

const callRecords = [
  record("call-001", { subject: "Call Customer on Potential", callType: "Inbound", callStart: "2026-10-11 22:27", callDuration: "00:15", relatedTo: "King", contactName: "Sage Wieser", owner: "You", purpose: "Prospecting", result: "Interested" }),
  record("call-002", { subject: "Follow up with Lead", callType: "Outbound", callStart: "2026-10-12 02:27", callDuration: "", relatedTo: "", contactName: "Chau Kitzman", owner: "You", purpose: "Follow-up", result: "Left voicemail" }),
];

const quoteRecords = [
  record("quote-001", { quoteName: "Growth workflow proposal", subject: "Outbound workflow pilot", accountName: "King", contactName: "Kris Marrier", stage: "Draft", amount: "85000", validUntil: "2026-11-15", owner: "You" }),
  record("quote-002", { quoteName: "Research sprint proposal", subject: "Research and messaging sprint", accountName: "Commercial Press", contactName: "Leota Dilliard", stage: "Sent", amount: "55000", validUntil: "2026-11-02", owner: "Growth team" }),
];

const salesOrderRecords = [
  record("sales-order-001", { subject: "Website conversion sprint", accountName: "King", contactName: "Kris Marrier", status: "Created", dueDate: "2026-11-20", amount: "85000", owner: "You" }),
  record("sales-order-002", { subject: "Outbound pilot", accountName: "Commercial Press", contactName: "Leota Dilliard", status: "In Progress", dueDate: "2026-11-04", amount: "55000", owner: "Growth team" }),
];

const purchaseOrderRecords = [
  record("purchase-order-001", { subject: "Research tooling subscription", vendorName: "Growth tools", status: "Created", dueDate: "2026-10-25", amount: "12000", owner: "You" }),
  record("purchase-order-002", { subject: "Creative production support", vendorName: "Studio partner", status: "Approved", dueDate: "2026-11-01", amount: "30000", owner: "Growth team" }),
];

const invoiceRecords = [
  record("invoice-001", { subject: "Invoice #1001", accountName: "King", invoiceDate: "2026-10-10", dueDate: "2026-10-25", status: "Sent", amount: "85000", owner: "You" }),
  record("invoice-002", { subject: "Invoice #1002", accountName: "Commercial Press", invoiceDate: "2026-10-11", dueDate: "2026-10-26", status: "Paid", amount: "55000", owner: "Growth team" }),
];

const vendorRecords = [
  record("vendor-001", { vendorName: "Growth tools", phone: "555-0101", email: "hello@growth-tools.example", website: "growth-tools.example", owner: "You", category: "Software" }),
  record("vendor-002", { vendorName: "Studio partner", phone: "555-0102", email: "studio@example.com", website: "studio.example", owner: "Growth team", category: "Creative" }),
];

const caseRecords = [
  record("case-001", { subject: "Website form not routing", accountName: "King", contactName: "Kris Marrier", status: "Open", priority: "High", origin: "Email", owner: "You" }),
  record("case-002", { subject: "Campaign report access", accountName: "Commercial Press", contactName: "Leota Dilliard", status: "Pending", priority: "Normal", origin: "Web", owner: "Growth team" }),
];

const solutionRecords = [
  record("solution-001", { solutionTitle: "Improve first-touch response time", status: "Published", question: "How do I keep follow-ups consistent?", owner: "You", product: "Growth workspace" }),
  record("solution-002", { solutionTitle: "Route inbound enquiries", status: "Draft", question: "How should new enquiries be assigned?", owner: "Growth team", product: "Growth workspace" }),
];

const genericFilters = (fields: string[], related: string[] = ["Notes", "Tasks", "Emails"]): FilterGroup[] => [
  { label: "System Defined Filters", options: commonSystemFilters },
  { label: "Filter By Fields", options: fields },
  { label: "Filter By Related Modules", options: related },
];

const module = (config: Omit<ModuleConfig, "key"> & { key: CrmModuleKey }): ModuleConfig => config;

const contactFields: ModuleField[] = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name", required: true },
  { key: "accountName", label: "Account Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "mobile", label: "Mobile" },
  { key: "secondaryEmail", label: "Secondary Email" },
  { key: "department", label: "Department" },
  { key: "title", label: "Title" },
  { key: "leadSource", label: "Lead Source", type: "select", options: ["Website", "Referral", "Event", "Partner", "Cold outreach"] },
  { key: "owner", label: "Contact Owner", type: "select", options: ["mukatte kuru no ka kaka"] },
  { key: "salutation", label: "Salutation", type: "select", options: ["Mr.", "Ms.", "Mrs.", "Dr."] },
  { key: "assistant", label: "Assistant" },
  { key: "asstPhone", label: "Asst Phone" },
  { key: "homePhone", label: "Home Phone" },
  { key: "otherPhone", label: "Other Phone" },
  { key: "fax", label: "Fax" },
  { key: "dateOfBirth", label: "Date of Birth", type: "date" },
  { key: "mailingStreet", label: "Mailing Street" },
  { key: "city", label: "Mailing City" },
  { key: "mailingState", label: "Mailing State / Province" },
  { key: "mailingCountry", label: "Mailing Country / Region" },
  { key: "mailingZip", label: "Mailing Zip / Postal Code" },
  { key: "otherStreet", label: "Other Street" },
  { key: "otherCity", label: "Other City" },
  { key: "otherState", label: "Other State / Province" },
  { key: "otherCountry", label: "Other Country / Region" },
  { key: "otherZip", label: "Other Zip / Postal Code" },
  { key: "reportingTo", label: "Reporting To" },
  { key: "emailOptOut", label: "Email Opt Out", type: "select", options: ["No", "Yes"] },
  { key: "unsubscribedMode", label: "Unsubscribed Mode" },
  { key: "unsubscribedTime", label: "Unsubscribed Time" },
  { key: "skypeId", label: "Skype ID" },
  { key: "twitter", label: "Twitter" },
  { key: "vendorName", label: "Vendor Name" },
  { key: "tag", label: "Tag" },
];

const accountFields: ModuleField[] = [
  { key: "accountName", label: "Account Name", required: true }, { key: "phone", label: "Phone" }, { key: "website", label: "Website" }, { key: "industry", label: "Industry" }, { key: "type", label: "Account Type", type: "select", options: ["Prospect", "Customer", "Partner"] }, { key: "annualRevenue", label: "Annual Revenue", type: "number" }, { key: "employees", label: "Employees", type: "number" }, { key: "city", label: "Billing City" }, { key: "owner", label: "Account Owner", type: "select", options: ["You", "Growth team"] },
];

const dealFields: ModuleField[] = [
  { key: "dealName", label: "Deal Name", required: true }, { key: "stage", label: "Stage", type: "select", options: ["Qualification", "Needs Analysis", "Value Proposition", "Negotiation/Review", "Closed Won", "Closed Lost"] }, { key: "amount", label: "Amount", type: "number" }, { key: "probability", label: "Probability (%)", type: "number" }, { key: "closingDate", label: "Closing Date", type: "date" }, { key: "accountName", label: "Account Name" }, { key: "contactName", label: "Contact Name" }, { key: "type", label: "Type", type: "select", options: ["New Business", "Existing Business"] }, { key: "nextStep", label: "Next Step" }, { key: "owner", label: "Deal Owner", type: "select", options: ["You", "Growth team"] },
];

const moduleConfigs: Record<CrmModuleKey, ModuleConfig> = {
  Contacts: module({ key: "Contacts", label: "Contacts", description: "People connected to the accounts and opportunities you are working on.", view: "list", columns: [{ key: "firstName", label: "Contact Name" }, { key: "accountName", label: "Account Name" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "owner", label: "Contact Owner" }], fields: contactFields, filters: [
    { label: "System Defined Filters", options: ["Activities", "Campaigns", "Latest Email Status", "Locked", "Record Action", "Related Records Action", "Touched Records", "Untouched Records", "Cadences"] },
    { label: "Filter By Fields", options: ["Account Name", "Assistant", "Asst Phone", "Connected To", "Contact Name", "Contact Owner", "Created By", "Created Time", "Date of Birth", "Department", "Email", "Email Opt Out", "Fax", "First Name", "Home Phone", "Last Activity Time", "Last Name", "Lead Source", "Mailing Address", "Mailing Address - City", "Mailing Address - Country / Region", "Mobile", "Modified By", "Modified Time", "Other Address", "Other Address - City", "Other Address - Country / Region", "Other Phone", "Phone", "Reporting To", "Salutation", "Secondary Email", "Skype ID", "Tag", "Title", "Twitter", "Unsubscribed Mode", "Unsubscribed Time", "Vendor Name"] },
    { label: "Filter By Related Modules", options: ["Calls", "Cases", "Contact Product Relation (Products)", "Contacts (Reporting Contacts)", "Deal Contact Role (Contact Roles)", "Deals", "Emails", "Invitees (Invited Meetings)", "Invoices", "Leads (Connected Records)", "Leads (Converted Leads)", "Meetings", "Notes", "Purchase Orders", "Quotes", "Sales Orders", "Tasks"] },
  ], seed: contactRecords }),
  Accounts: module({ key: "Accounts", label: "Accounts", description: "Organizations and customer context behind your contacts, deals, and service work.", view: "list", columns: [{ key: "accountName", label: "Account Name" }, { key: "phone", label: "Phone" }, { key: "website", label: "Website" }, { key: "owner", label: "Account Owner" }], fields: accountFields, filters: genericFilters(["Account Name", "Account Number", "Account Owner", "Account Site", "Account Type", "Annual Revenue", "Billing Address", "Industry", "Employees", "Phone", "Rating", "Website"]), seed: accountRecords }),
  Deals: module({ key: "Deals", label: "Deals", description: "Track the commercial path from qualification to a won or lost opportunity.", view: "kanban", columns: [{ key: "dealName", label: "Deal Name" }, { key: "stage", label: "Stage" }, { key: "amount", label: "Amount" }, { key: "accountName", label: "Account Name" }, { key: "contactName", label: "Contact Name" }, { key: "closingDate", label: "Closing Date" }], fields: dealFields, filters: genericFilters(["Account Name", "Amount", "Campaign Source", "Closing Date", "Contact Name", "Deal Name", "Deal Owner", "Expected Revenue", "Next Step", "Probability (%)", "Reason For Loss", "Stage", "Type"], ["Calls", "Deals", "Emails", "Meetings", "Notes", "Quotes", "Sales Orders", "Tasks"]), seed: dealRecords }),
  Forecasts: module({ key: "Forecasts", label: "Forecasts", description: "Set sales targets, track achievement, and use current pipeline to plan the next period.", view: "empty", columns: [], fields: [], filters: [], seed: [] }),
  Documents: module({ key: "Documents", label: "Documents", description: "Keep team folders and shared work connected to your CRM context.", view: "empty", columns: [], fields: [], filters: [], seed: [] }),
  Campaigns: module({ key: "Campaigns", label: "Campaigns", description: "Coordinate marketing activities and connect them to leads, deals, and revenue.", view: "list", columns: [{ key: "campaignName", label: "Campaign Name" }, { key: "type", label: "Type" }, { key: "status", label: "Status" }, { key: "startDate", label: "Start Date" }, { key: "endDate", label: "End Date" }, { key: "owner", label: "Campaign Owner" }], fields: [{ key: "campaignName", label: "Campaign Name", required: true }, { key: "type", label: "Type", type: "select", options: ["Email", "Webinar", "Event", "Social"] }, { key: "status", label: "Status", type: "select", options: ["Planning", "Active", "Completed", "Aborted"] }, { key: "startDate", label: "Start Date", type: "date" }, { key: "endDate", label: "End Date", type: "date" }, { key: "expectedRevenue", label: "Expected Revenue", type: "number" }, { key: "owner", label: "Campaign Owner", type: "select", options: ["You", "Growth team"] }], filters: genericFilters(["Actual Cost", "Budgeted Cost", "Campaign Name", "Campaign Owner", "Created By", "Created Time", "End Date", "Expected Response", "Expected Revenue", "Start Date", "Status", "Type"], ["Calls", "Deals", "Meetings", "Notes", "Tasks"]), seed: campaignRecords }),
  Meetings: module({ key: "Meetings", label: "Meetings", description: "Plan customer conversations, demos, webinars, and internal follow-ups.", view: "list", columns: [{ key: "title", label: "Title" }, { key: "from", label: "From" }, { key: "to", label: "To" }, { key: "relatedTo", label: "Related To" }, { key: "contactName", label: "Contact Name" }, { key: "host", label: "Host" }], fields: [{ key: "title", label: "Title", required: true }, { key: "from", label: "From", type: "date" }, { key: "to", label: "To", type: "date" }, { key: "relatedTo", label: "Related To" }, { key: "contactName", label: "Contact Name" }, { key: "host", label: "Host", type: "select", options: ["You", "Growth team"] }, { key: "location", label: "Meeting Venue" }, { key: "allDay", label: "All day", type: "select", options: ["No", "Yes"] }], filters: genericFilters(["All day", "Contact Name", "From", "Host", "Location", "Meeting Venue", "Related To", "Title", "To", "Zip Code"], ["Invitees (Invited Event)", "Notes"]), seed: meetingRecords }),
  Calls: module({ key: "Calls", label: "Calls", description: "Log inbound and outbound calls, outcomes, and the next follow-up.", view: "list", columns: [{ key: "subject", label: "Subject" }, { key: "callType", label: "Call Type" }, { key: "callStart", label: "Call Start Time" }, { key: "callDuration", label: "Call Duration" }, { key: "relatedTo", label: "Related To" }, { key: "contactName", label: "Contact Name" }, { key: "owner", label: "Call Owner" }], fields: [{ key: "subject", label: "Subject", required: true }, { key: "callType", label: "Call Type", type: "select", options: ["Inbound", "Outbound"] }, { key: "callStart", label: "Call Start Time", type: "date" }, { key: "callDuration", label: "Call Duration" }, { key: "relatedTo", label: "Related To" }, { key: "contactName", label: "Contact Name" }, { key: "owner", label: "Call Owner", type: "select", options: ["You", "Growth team"] }, { key: "purpose", label: "Call Purpose" }, { key: "result", label: "Call Result" }], filters: genericFilters(["Call Agenda", "Call Duration", "Call Owner", "Call Purpose", "Call Result", "Call Start Time", "Call Type", "Contact Name", "Related To", "Subject", "Tag"], ["Notes"]), seed: callRecords }),
  Products: module({ key: "Products", label: "Products", description: "Keep the services and products that can be attached to deals, quotes, and orders.", view: "list", columns: [{ key: "productName", label: "Product Name" }, { key: "productCode", label: "Product Code" }, { key: "productActive", label: "Product Active" }, { key: "owner", label: "Product Owner" }], fields: [{ key: "productName", label: "Product Name", required: true }, { key: "productCode", label: "Product Code" }, { key: "productActive", label: "Product Active", type: "select", options: ["Yes", "No"] }, { key: "unitPrice", label: "Unit Price", type: "number" }, { key: "productCategory", label: "Product Category" }, { key: "usageUnit", label: "Usage Unit" }, { key: "owner", label: "Product Owner", type: "select", options: ["You", "Growth team"] }], filters: genericFilters(["Commission Rate", "Manufacturer", "Product Active", "Product Category", "Product Code", "Product Name", "Product Owner", "Qty Ordered", "Quantity in Stock", "Reorder Level", "Sales End Date", "Support End Date", "Tax", "Unit Price", "Usage Unit", "Vendor Name"], ["Accounts", "Calls", "Cases", "Contacts", "Deals", "Leads", "Meetings", "Notes", "Tasks"]), seed: [] }),
  "Price Books": module({ key: "Price Books", label: "Price Books", description: "Define active pricing models for the services and products you sell.", view: "list", columns: [{ key: "priceBookName", label: "Price Book Name" }, { key: "active", label: "Active" }, { key: "owner", label: "Price Book Owner" }], fields: [{ key: "priceBookName", label: "Price Book Name", required: true }, { key: "active", label: "Active", type: "select", options: ["Yes", "No"] }, { key: "pricingModel", label: "Pricing Model", type: "select", options: ["Flat", "Markup", "Discount"] }, { key: "owner", label: "Price Book Owner", type: "select", options: ["You", "Growth team"] }], filters: genericFilters(["Active", "Price Book Name", "Price Book Owner", "Pricing Model", "Tag"], ["Notes"]), seed: [] }),
  Quotes: module({ key: "Quotes", label: "Quotes", description: "Turn a qualified deal into a clear proposal with products, pricing, and validity dates.", view: "list", columns: [{ key: "quoteName", label: "Quote Name" }, { key: "accountName", label: "Account Name" }, { key: "stage", label: "Stage" }, { key: "amount", label: "Grand Total" }, { key: "validUntil", label: "Valid Until" }, { key: "owner", label: "Quote Owner" }], fields: [{ key: "quoteName", label: "Quote Name", required: true }, { key: "subject", label: "Subject" }, { key: "accountName", label: "Account Name" }, { key: "contactName", label: "Contact Name" }, { key: "stage", label: "Stage", type: "select", options: ["Draft", "Sent", "Accepted", "Declined", "Expired"] }, { key: "amount", label: "Grand Total", type: "number" }, { key: "validUntil", label: "Valid Until", type: "date" }, { key: "owner", label: "Quote Owner", type: "select", options: ["You", "Growth team"] }], filters: genericFilters(["Account Name", "Contact Name", "Created Time", "Grand Total", "Quote Name", "Stage", "Valid Until"], ["Deals", "Notes", "Products", "Tasks"]), seed: quoteRecords }),
  "Sales Orders": module({ key: "Sales Orders", label: "Sales Orders", description: "Track accepted work from order creation through delivery and completion.", view: "list", columns: [{ key: "subject", label: "Subject" }, { key: "accountName", label: "Account Name" }, { key: "status", label: "Status" }, { key: "dueDate", label: "Due Date" }, { key: "amount", label: "Grand Total" }, { key: "owner", label: "Sales Order Owner" }], fields: [{ key: "subject", label: "Subject", required: true }, { key: "accountName", label: "Account Name" }, { key: "contactName", label: "Contact Name" }, { key: "status", label: "Status", type: "select", options: ["Created", "Approved", "In Progress", "Completed", "Cancelled"] }, { key: "dueDate", label: "Due Date", type: "date" }, { key: "amount", label: "Grand Total", type: "number" }, { key: "owner", label: "Sales Order Owner", type: "select", options: ["You", "Growth team"] }], filters: genericFilters(["Account Name", "Contact Name", "Due Date", "Subject", "Status", "Grand Total"], ["Deals", "Invoices", "Notes", "Products", "Quotes"]), seed: salesOrderRecords }),
  "Purchase Orders": module({ key: "Purchase Orders", label: "Purchase Orders", description: "Manage external costs and delivery commitments attached to your work.", view: "list", columns: [{ key: "subject", label: "Subject" }, { key: "vendorName", label: "Vendor Name" }, { key: "status", label: "Status" }, { key: "dueDate", label: "Due Date" }, { key: "amount", label: "Grand Total" }, { key: "owner", label: "Purchase Order Owner" }], fields: [{ key: "subject", label: "Subject", required: true }, { key: "vendorName", label: "Vendor Name" }, { key: "status", label: "Status", type: "select", options: ["Created", "Approved", "In Progress", "Completed", "Cancelled"] }, { key: "dueDate", label: "Due Date", type: "date" }, { key: "amount", label: "Grand Total", type: "number" }, { key: "owner", label: "Purchase Order Owner", type: "select", options: ["You", "Growth team"] }], filters: genericFilters(["Created Time", "Due Date", "Purchase Order Owner", "Status", "Subject", "Grand Total", "Vendor Name"], ["Notes", "Products", "Vendors"]), seed: purchaseOrderRecords }),
  Invoices: module({ key: "Invoices", label: "Invoices", description: "Track billing, status, due dates, and revenue received from customer work.", view: "list", columns: [{ key: "subject", label: "Subject" }, { key: "accountName", label: "Account Name" }, { key: "invoiceDate", label: "Invoice Date" }, { key: "dueDate", label: "Due Date" }, { key: "status", label: "Status" }, { key: "amount", label: "Grand Total" }], fields: [{ key: "subject", label: "Subject", required: true }, { key: "accountName", label: "Account Name" }, { key: "invoiceDate", label: "Invoice Date", type: "date" }, { key: "dueDate", label: "Due Date", type: "date" }, { key: "status", label: "Status", type: "select", options: ["Draft", "Sent", "Paid", "Overdue", "Void"] }, { key: "amount", label: "Grand Total", type: "number" }, { key: "owner", label: "Invoice Owner", type: "select", options: ["You", "Growth team"] }], filters: genericFilters(["Account Name", "Due Date", "Invoice Date", "Invoice Owner", "Status", "Subject", "Grand Total"], ["Notes", "Sales Orders"]), seed: invoiceRecords }),
  Vendors: module({ key: "Vendors", label: "Vendors", description: "Keep the partners and suppliers that support delivery of your services.", view: "list", columns: [{ key: "vendorName", label: "Vendor Name" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "website", label: "Website" }, { key: "owner", label: "Vendor Owner" }], fields: [{ key: "vendorName", label: "Vendor Name", required: true }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "website", label: "Website" }, { key: "category", label: "Category" }, { key: "owner", label: "Vendor Owner", type: "select", options: ["You", "Growth team"] }], filters: genericFilters(["Vendor Name", "Phone", "Email", "Website", "Category", "Vendor Owner"], ["Notes", "Purchase Orders"]), seed: vendorRecords }),
  Cases: module({ key: "Cases", label: "Cases", description: "Capture customer issues, ownership, priority, and resolution status.", view: "list", columns: [{ key: "subject", label: "Subject" }, { key: "accountName", label: "Account Name" }, { key: "contactName", label: "Contact Name" }, { key: "status", label: "Status" }, { key: "priority", label: "Priority" }, { key: "owner", label: "Case Owner" }], fields: [{ key: "subject", label: "Subject", required: true }, { key: "accountName", label: "Account Name" }, { key: "contactName", label: "Contact Name" }, { key: "status", label: "Status", type: "select", options: ["Open", "Pending", "Closed"] }, { key: "priority", label: "Priority", type: "select", options: ["High", "Normal", "Low"] }, { key: "origin", label: "Case Origin", type: "select", options: ["Email", "Web", "Phone"] }, { key: "owner", label: "Case Owner", type: "select", options: ["You", "Growth team"] }], filters: genericFilters(["Account Name", "Case Owner", "Case Origin", "Contact Name", "Created Time", "Priority", "Status", "Subject"], ["Notes", "Products"]), seed: caseRecords }),
  Solutions: module({ key: "Solutions", label: "Solutions", description: "Build a searchable knowledge base for recurring customer questions and delivery guidance.", view: "list", columns: [{ key: "solutionTitle", label: "Solution Title" }, { key: "status", label: "Status" }, { key: "product", label: "Product" }, { key: "owner", label: "Solution Owner" }], fields: [{ key: "solutionTitle", label: "Solution Title", required: true }, { key: "question", label: "Question" }, { key: "status", label: "Status", type: "select", options: ["Draft", "Published", "Archived"] }, { key: "product", label: "Product" }, { key: "owner", label: "Solution Owner", type: "select", options: ["You", "Growth team"] }], filters: genericFilters(["Created By", "Created Time", "Modified By", "Solution Owner", "Solution Title", "Status"], ["Notes", "Products"]), seed: solutionRecords }),
};

function readModuleRecords(key: CrmModuleKey, fallback: CrmRecord[]): CrmRecord[] {
  return loadModuleRecords(window.localStorage, key, fallback);
}

export function getModuleConfig(key: CrmModuleKey): ModuleConfig {
  return moduleConfigs[key];
}

export function moduleHasData(key: CrmModuleKey): boolean {
  return moduleConfigs[key].seed.length > 0;
}

export function CrmModuleWorkspace({ moduleKey, initialMode = "list", initialRecordId, onAction, onRouteChange }: { moduleKey: CrmModuleKey; initialMode?: "list" | "create" | "detail"; initialRecordId?: string; onAction?: ActionHandler; onRouteChange?: (route: CrmRoute | null) => void }) {
  const config = moduleConfigs[moduleKey];
  const [initial] = useState(() => {
    try { return { records: readModuleRecords(moduleKey, config.seed), error: "" }; }
    catch (error) { return { records: [] as CrmRecord[], error: error instanceof Error ? error.message : "Could not load saved records." }; }
  });
  const [records, setRecords] = useState<CrmRecord[]>(initial.records);
  const [storageError, setStorageError] = useState(initial.error);
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterGroup, setFilterGroup] = useState(0);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [sortAscending, setSortAscending] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState(initialRecordId ?? "");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailTab, setDetailTab] = useState<"Overview" | "Timeline" | "Related">("Overview");
  const [showForm, setShowForm] = useState(initialMode === "create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>(() => initialMode === "create" ? Object.fromEntries(config.fields.map((field) => [field.key, field.options?.[0] ?? ""])) : {});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState<"more" | "actions" | "settings" | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);

  function commitRecords(next: CrmRecord[]): boolean {
    if (initial.error) return false;
    try {
      // Persist before any route transition can unmount this component.
      persistModuleRecords(window.localStorage, moduleKey, next);
      setRecords(next);
      setStorageError("");
      return true;
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Could not save records.");
      return false;
    }
  }

  const visibleRecords = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const result = records.filter((item) => {
      if (Boolean(item.deletedAt) !== showDeleted) return false;
      const haystack = Object.values(item.values).join(" ").toLowerCase();
      const matchesSearch = !normalized || haystack.includes(normalized);
      const matchesFilters = activeFilters.every((filter) => Object.values(item.values).some((value) => value.toLowerCase() === filter.toLowerCase()));
      return matchesSearch && matchesFilters;
    });
    if (sortAscending === null) return result;
    return [...result].sort((a, b) => {
      const left = Object.values(a.values)[0] ?? "";
      const right = Object.values(b.values)[0] ?? "";
      return sortAscending ? left.localeCompare(right) : right.localeCompare(left);
    });
  }, [activeFilters, records, search, sortAscending, showDeleted]);

  const selected = selectedId ? records.find((item) => item.id === selectedId) : undefined;

  function openCreate(): void {
    setEditingId(null);
    setDraft(Object.fromEntries(config.fields.map((field) => [field.key, field.options?.[0] ?? ""])));
    setFormError("");
    setShowForm(true);
    onRouteChange?.({ module: moduleKey, mode: "create" });
  }

  function openEdit(item: CrmRecord): void {
    setEditingId(item.id);
    setDraft(Object.fromEntries(config.fields.map((field) => [field.key, item.values[field.key] ?? ""])));
    setFormError("");
    setShowForm(true);
  }

  function saveRecord(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const required = config.fields.find((field) => field.required && !draft[field.key]?.trim());
    if (required) {
      setFormError(`${required.label} is required.`);
      return;
    }
    try {
      const result = saveModuleRecord(records, draft, editingId ?? undefined);
      if (!commitRecords(result.records)) return;
      const message = `${config.label.slice(0, -1) || config.label} ${editingId ? "updated" : "created"}.`;
      setNotice(message);
      onAction?.(message);
      if (moduleKey === "Contacts") {
        setShowForm(false);
        setEditingId(null);
        setSelectedId(result.record.id);
        onRouteChange?.({ module: moduleKey, mode: "detail", recordId: result.record.id });
        return;
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save this record.");
      return;
    }
    setShowForm(false);
    setEditingId(null);
    onRouteChange?.(null);
  }

  function removeRecord(): void {
    if (!selected) return;
    const at = new Date().toISOString();
    if (!commitRecords(records.map((item) => item.id === selected.id ? recordEvent({ ...item, deletedAt: at }, "Record deleted", "Moved to the recycle bin", at) : item))) return;
    setSelectedId("");
    setSelectedIds((current) => current.filter((id) => id !== selected.id));
    setNotice(`${config.label.slice(0, -1) || config.label} moved to the recycle bin.`);
    onAction?.(`${config.label.slice(0, -1) || config.label} moved to the recycle bin.`);
    onRouteChange?.(null);
  }

  function restoreRecord(id: string): void {
    try {
      const result = restoreModuleRecord(records, id);
      if (!commitRecords(result.records)) return;
      const message = `${config.label.slice(0, -1) || config.label} restored from the recycle bin.`;
      setNotice(message);
      onAction?.(message);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Could not restore this record.");
    }
  }

  function refreshRecords(): void {
    try { setRecords(readModuleRecords(moduleKey, config.seed)); setStorageError(""); } catch (error) { setStorageError(error instanceof Error ? error.message : "Could not refresh records."); return; }
    setSearch("");
    setActiveFilters([]);
    setSelectedId("");
    setSelectedIds([]);
    setNotice(`${config.label} view refreshed.`);
  }

  function toggleSelected(id: string, checked: boolean): void {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  }

  function toggleAllSelected(checked: boolean): void {
    setSelectedIds(checked ? visibleRecords.map((item) => item.id) : []);
  }

  function toggleFilter(option: string): void {
    setActiveFilters((current) => current.includes(option) ? current.filter((item) => item !== option) : [...current, option]);
  }

  function selectRecord(id: string): void {
    setSelectedId(id);
    onRouteChange?.({ module: moduleKey, mode: "detail", recordId: id });
  }

  const action = onAction ?? ((message: string) => setNotice(message));
  if (moduleKey === "Forecasts") return <ForecastModule onAction={action} />;
  if (moduleKey === "Documents") return <DocumentsModule onAction={action} />;
  if (initial.error) return <section className="content-wrap" role="alert"><h1>Saved records could not be loaded</h1><p>{initial.error}</p><p>The existing storage has been preserved.</p></section>;
  if (initialMode === "detail" && !selected) return <section className="content-wrap"><h1>Record not found</h1><p>This record is not in the local {config.label} collection.</p><button className="secondary-button" onClick={() => onRouteChange?.(null)} type="button">Back to {config.label}</button></section>;
  if (selected && moduleKey === "Contacts") return <div className="content-wrap crm-module-wrap contact-detail-page">
    {storageError ? <p className="form-error" role="alert">{storageError}</p> : null}
    <ContactDetailPanel
      record={selected}
      fields={config.fields}
      onClose={() => { setSelectedId(""); onRouteChange?.(null); }}
      onEdit={() => openEdit(selected)}
      onDelete={removeRecord}
      onUpdate={(record) => commitRecords(records.map((item) => item.id === record.id ? record : item))}
       relatedModules={Object.values(moduleConfigs).filter((relatedConfig) => relatedConfig.key !== "Contacts").map((relatedConfig) => {
         try { return { name: relatedConfig.key, records: readModuleRecords(relatedConfig.key, relatedConfig.seed) }; }
         catch { return { name: relatedConfig.key, records: [], error: "Saved related records could not be loaded." }; }
       })}
      onOpenRelated={(module, recordId) => onRouteChange?.({ module: module as CrmModuleKey, mode: "detail", recordId })}
    />
    {showForm ? <ModuleForm config={config} draft={draft} editing error={formError} onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))} onClose={() => { setShowForm(false); setEditingId(null); }} onSubmit={saveRecord} /> : null}
  </div>;

  return <div className="content-wrap crm-module-wrap">
    {storageError ? <p className="form-error" role="alert">{storageError}</p> : null}
    {moduleKey === "Contacts" ? <div className="contact-list-mode"><button className="text-button" type="button" onClick={() => { setShowDeleted(!showDeleted); setSelectedIds([]); }}>{showDeleted ? "Back to all Contacts" : `Recycle bin (${records.filter((record) => record.deletedAt).length})`}</button>{showDeleted ? <span>Deleted Contacts — open a record to restore it.</span> : null}</div> : null}
     <section className="page-heading"><div><h1>{config.label}</h1></div></section>
    <section className="crm-module-card">
       <div className="crm-module-toolbar"><div className="view-title"><div className="view-symbol">{config.view === "kanban" ? "◈" : "▦"}</div><div><strong>All {config.label}</strong><span>{visibleRecords.length} records</span></div></div><div className="toolbar-actions"><label className="search-box"><span>⌕</span><input aria-label={`Search ${config.label.toLowerCase()}`} onChange={(event) => setSearch(event.target.value)} placeholder="Search records" value={search} /></label><button className={`toolbar-button ${filterOpen ? "selected" : ""}`} onClick={() => setFilterOpen((current) => !current)} type="button">☷ Filter{activeFilters.length ? <b>{activeFilters.length}</b> : null}</button><button className="toolbar-button" onClick={() => setSortAscending((current) => current === null ? true : current ? false : null)} type="button">↕ Sort</button><button className={`toolbar-button ${menuOpen === "settings" ? "selected" : ""}`} onClick={() => setMenuOpen((current) => current === "settings" ? null : "settings")} type="button">☷ View Settings</button><button className="toolbar-button toolbar-refresh" onClick={refreshRecords} type="button">↻ Refresh</button><button aria-label={`Create ${config.label.slice(0, -1) || config.label}`} className="toolbar-button create-toolbar-button" onClick={openCreate} type="button">＋ Create {config.label.slice(0, -1) || config.label}</button><button className={`toolbar-button toolbar-more ${menuOpen === "more" ? "selected" : ""}`} onClick={() => setMenuOpen((current) => current === "more" ? null : "more")} type="button">More</button><button className={`toolbar-button toolbar-actions-menu ${menuOpen === "actions" ? "selected" : ""}`} onClick={() => setMenuOpen((current) => current === "actions" ? null : "actions")} type="button">Actions</button></div></div>
       {menuOpen ? <div className="crm-command-menu" role="menu"><strong>{menuOpen === "settings" ? "View Settings" : menuOpen === "more" ? "More" : "Actions"}</strong>{(menuOpen === "settings" ? ["Edit columns", "Freeze columns", "Reset view"] : menuOpen === "more" ? ["Export records", "Import records", "Print view"] : ["Mass update", "Mass delete", "Send email"]).map((item) => <button key={item} onClick={() => { setMenuOpen(null); setNotice(`${item} is ready for ${config.label}.`); }} role="menuitem" type="button">{item}</button>)}</div> : null}
      {filterOpen ? <div className="crm-filter-panel"><div className="crm-filter-header"><div><strong>Filter {config.label}</strong><span>Choose the signals that should remain in this custom view.</span></div><button className="text-button" onClick={() => setActiveFilters([])} type="button">Reset filters</button></div><div className="crm-filter-builder"><div className="crm-filter-tabs">{config.filters.map((group, index) => <button className={filterGroup === index ? "active" : ""} key={group.label} onClick={() => setFilterGroup(index)} type="button">{group.label}<small>{activeFilters.filter((item) => group.options.includes(item)).length || "All"}</small></button>)}</div><div className="crm-filter-options">{config.filters[filterGroup]?.options.map((option) => <label className="check-option" key={option}><input checked={activeFilters.includes(option)} onChange={() => toggleFilter(option)} type="checkbox" /><span><strong>{option}</strong><small>Include records matching this signal</small></span></label>)}</div></div></div> : null}
        <div className="crm-module-body">{config.view === "kanban" ? <ModuleKanban config={config} records={visibleRecords} onSelect={selectRecord} onEdit={openEdit} /> : <ModuleTable config={config} records={visibleRecords} selectedId={selected?.id ?? ""} selectedIds={selectedIds} showDeleted={showDeleted} onSelect={selectRecord} onRestore={restoreRecord} onToggleSelect={toggleSelected} onToggleSelectAll={toggleAllSelected} onRowAction={(message) => setNotice(message)} />}{visibleRecords.length === 0 ? <div className="empty-state"><div className="empty-icon">⌕</div><strong>No {config.label.toLowerCase()} found</strong><span>Try changing the filters or create the first record.</span><button className="text-button" onClick={openCreate} type="button">Create the first record</button></div> : null}</div>
      <div className="crm-pagination"><span>Total Records {visibleRecords.length}</span><span>1 to {visibleRecords.length}</span><button disabled type="button">Previous</button><button disabled type="button">Next</button></div>
    </section>
    {selected ? <aside className="crm-record-panel"><div className="crm-record-panel-heading"><div><span className="detail-kicker">{config.label.slice(0, -1) || config.label} record</span><h2>{Object.values(selected.values)[0] || "Untitled record"}</h2></div><button className="close-button" onClick={() => { setSelectedId(""); onRouteChange?.(null); }} type="button">×</button></div><div className="crm-record-actions"><button className="small-primary" onClick={() => openEdit(selected)} type="button">Edit</button><button className="small-button" onClick={removeRecord} type="button">Delete</button><button className="small-button" onClick={() => setNotice("Record actions opened.")} type="button">•••</button></div><div className="detail-tabs"><button className={detailTab === "Overview" ? "active" : ""} onClick={() => setDetailTab("Overview")} type="button">Overview</button><button className={detailTab === "Timeline" ? "active" : ""} onClick={() => setDetailTab("Timeline")} type="button">Timeline</button><button className={detailTab === "Related" ? "active" : ""} onClick={() => setDetailTab("Related")} type="button">Related</button></div>{detailTab === "Overview" ? <div className="detail-fields">{config.fields.map((field) => <div className="detail-field" key={field.key}><span>{field.label}</span><strong>{selected.values[field.key] || "—"}</strong></div>)}</div> : detailTab === "Timeline" ? <div className="timeline"><div className="timeline-item"><span className="timeline-dot blue" /><div><div className="timeline-heading"><strong>Record opened</strong><span>Just now</span></div><p>Review the record history and next action here.</p></div></div></div> : <div className="related-grid"><span>Notes <b>0</b></span><span>Tasks <b>0</b></span><span>Emails <b>0</b></span><span>Calls <b>0</b></span></div>}<div className="detail-section"><div className="section-title"><strong>Related records</strong><span className="section-count">{Math.max(0, Object.keys(selected.values).length - 2)}</span></div><div className="related-grid"><span>Notes <b>0</b></span><span>Tasks <b>0</b></span><span>Emails <b>0</b></span><span>Calls <b>0</b></span></div></div></aside> : null}
    {notice ? <div className="workspace-toast" role="status"><span>✓</span>{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")} type="button">×</button></div> : null}
     {showForm ? <ModuleForm config={config} draft={draft} editing={Boolean(editingId)} error={formError} onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))} onClose={() => { setShowForm(false); onRouteChange?.(null); }} onSubmit={saveRecord} /> : null}
  </div>;
}

function LegacyContactDetailPanel({ record, onClose, onEdit, onDelete, onNotice }: { record: CrmRecord; onClose: () => void; onEdit: () => void; onDelete: () => void; onNotice: (message: string) => void }) {
  const [tab, setTab] = useState<"Overview" | "Timeline" | "Related Lists">("Overview");
  const [section, setSection] = useState<"details" | "address">("details");
  const firstName = record.values.firstName ?? "";
  const lastName = record.values.lastName ?? "";
  const fullName = `${firstName} ${lastName}`.trim() || "Untitled Contact";
  const groups = section === "details"
    ? [["Contact Owner", record.values.owner], ["Account Name", record.values.accountName], ["Email", record.values.email], ["Phone", record.values.phone], ["Mobile", record.values.mobile], ["Department", record.values.department], ["Title", record.values.title], ["Lead Source", record.values.leadSource]]
    : [["Mailing Street", record.values.mailingStreet], ["Mailing City", record.values.city], ["Mailing State / Province", record.values.mailingState], ["Mailing Country / Region", record.values.mailingCountry], ["Mailing Zip / Postal Code", record.values.mailingZip], ["Other Street", record.values.otherStreet], ["Other City", record.values.otherCity], ["Other Country / Region", record.values.otherCountry]];
  const relatedLists = ["Open Activities", "Closed Activities", "Notes", "Attachments", "Emails", "Calls", "Meetings", "Deals", "Cases"];
  return <section className="zoho-contact-detail" aria-label="Contact details">
    <div className="zoho-detail-breadcrumb"><button onClick={onClose} type="button">Contacts</button><span>/</span><strong>{fullName}</strong></div>
    <div className="zoho-detail-header"><div className="zoho-contact-avatar">{`${firstName.slice(0, 1)}${lastName.slice(0, 1)}`.toUpperCase()}</div><div className="zoho-contact-heading"><span>Contact</span><h1>{fullName}</h1><p>{record.values.accountName || "—"}</p></div><div className="zoho-detail-header-actions"><button className="small-button" onClick={onNotice.bind(null, "Email composer opened.")} type="button">Send Email</button><button className="small-primary" onClick={onEdit} type="button">Edit</button><button className="small-button" onClick={onDelete} type="button">Delete</button><button className="small-button" onClick={onNotice.bind(null, "More contact actions opened.")} type="button">•••</button></div></div>
    <nav className="zoho-detail-tabs" aria-label="Contact detail tabs"><button className={tab === "Overview" ? "active" : ""} onClick={() => setTab("Overview")} type="button">Overview</button><button className={tab === "Timeline" ? "active" : ""} onClick={() => setTab("Timeline")} type="button">Timeline</button><button className={tab === "Related Lists" ? "active" : ""} onClick={() => setTab("Related Lists")} type="button">Related Lists</button></nav>
     {tab === "Related Lists" ? <div className="zoho-related-lists">{relatedLists.map((name) => <button key={name} onClick={() => onNotice(`${name} related list opened.`)} type="button"><span>{name}</span><b>0</b><i>›</i></button>)}</div> : tab === "Timeline" ? <div className="zoho-timeline"><div className="zoho-timeline-item"><span /><div><strong>Contact opened</strong><small>Just now</small><p>Record timeline events appear here.</p></div></div><div className="zoho-timeline-item"><span /><div><strong>Contact created</strong><small>Sample record</small><p>Created in the local Gallivanter workspace.</p></div></div></div> : <div className="zoho-detail-grid"><section className="zoho-detail-card"><div className="zoho-detail-card-heading"><strong>Contact Information</strong><div><button className={section === "details" ? "active" : ""} onClick={() => setSection("details")} type="button">Details</button><button className={section === "address" ? "active" : ""} onClick={() => setSection("address")} type="button">Address</button></div></div><div className="zoho-field-grid">{groups.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || "—"}</strong></div>)}</div></section><aside className="zoho-related-card"><div className="zoho-detail-card-heading"><strong>Related Lists</strong><button onClick={() => setTab("Related Lists")} type="button">View All</button></div>{relatedLists.slice(0, 5).map((name) => <button className="zoho-related-row" key={name} onClick={() => onNotice(`${name} related list opened.`)} type="button"><span>{name}</span><b>0</b><i>›</i></button>)}</aside></div>}
  </section>;
}

function ModuleTable({ config, records, selectedId, selectedIds, showDeleted, onSelect, onRestore, onToggleSelect, onToggleSelectAll, onRowAction }: { config: ModuleConfig; records: CrmRecord[]; selectedId: string; selectedIds: string[]; showDeleted: boolean; onSelect: (id: string) => void; onRestore: (id: string) => void; onToggleSelect: (id: string, checked: boolean) => void; onToggleSelectAll: (checked: boolean) => void; onRowAction: (message: string) => void }) {
  const allSelected = records.length > 0 && records.every((item) => selectedIds.includes(item.id));
  return <table className="crm-table"><thead><tr><th><input aria-label={`Select all ${config.label.toLowerCase()}`} checked={allSelected} onChange={(event) => onToggleSelectAll(event.target.checked)} type="checkbox" /></th>{config.columns.map((column) => <th key={column.key}>{column.label}</th>)}<th /></tr></thead><tbody>{records.map((item) => <tr className={selectedId === item.id ? "selected-row" : ""} key={item.id} onClick={() => onSelect(item.id)}><td className="crm-select-cell"><input aria-label={`Select ${item.values[config.columns[0]?.key] ?? "record"}`} checked={selectedIds.includes(item.id)} onChange={(event) => onToggleSelect(item.id, event.target.checked)} onClick={(event) => event.stopPropagation()} type="checkbox" /></td>{config.columns.map((column, index) => <td data-label={column.label} key={column.key}>{index === 0 ? <strong className="crm-primary-cell">{item.values[column.key] || "—"}</strong> : <span>{item.values[column.key] || "—"}</span>}</td>)}<td className="crm-row-actions" data-label="Actions">{showDeleted ? <button aria-label={`Restore ${item.values[config.columns[0]?.key] ?? "record"}`} onClick={(event) => { event.stopPropagation(); onRestore(item.id); }} type="button">Restore</button> : <button aria-label={`Actions for ${item.values[config.columns[0]?.key] ?? "record"}`} onClick={(event) => { event.stopPropagation(); onRowAction(`Actions for ${item.values[config.columns[0]?.key] ?? "record"} opened.`); }} type="button">•••</button>}</td></tr>)}</tbody></table>;
}

function ModuleKanban({ config, records, onSelect, onEdit }: { config: ModuleConfig; records: CrmRecord[]; onSelect: (id: string) => void; onEdit: (record: CrmRecord) => void }) {
  const stageField = config.fields.find((field) => field.key === "stage");
  const stages = stageField?.options ?? ["Qualification", "Needs Analysis", "Value Proposition", "Closed Won", "Closed Lost"];
  return <div className="crm-kanban">{stages.map((stage) => <div className="crm-kanban-column" key={stage}><div className="crm-kanban-heading"><strong>{stage}</strong><span>{records.filter((record) => record.values.stage === stage).length}</span></div><div className="crm-kanban-stack">{records.filter((record) => record.values.stage === stage).map((item) => <article className="crm-kanban-card" key={item.id}><button onClick={() => onSelect(item.id)} type="button"><strong>{item.values.dealName}</strong><small>{item.values.accountName}</small><p>₹{item.values.amount || "0"} · {item.values.probability || "0"}% probability</p><span>{item.values.closingDate || "No closing date"}</span></button><button className="crm-card-edit" onClick={() => onEdit(item)} type="button">Edit</button></article>)}</div></div>)}</div>;
}

function ModuleForm({ config, draft, editing, error, onChange, onClose, onSubmit }: { config: ModuleConfig; draft: Record<string, string>; editing: boolean; error: string; onChange: (key: string, value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" role="presentation"><div className="create-modal crm-form-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><div className="eyebrow">{editing ? "Update record" : "New record"}</div><h2>{editing ? `Edit ${config.label.slice(0, -1) || config.label}` : `Create ${config.label.slice(0, -1) || config.label}`}</h2><p>Keep the CRM record and its next action together.</p></div><button className="close-button" onClick={onClose} type="button">×</button></div><form onSubmit={onSubmit}><div className="form-section"><div className="form-section-heading"><strong>{config.label.slice(0, -1) || config.label} information</strong><span>Fields mirror the current module record surface.</span></div><div className="form-grid">{config.fields.map((field) => <label className="form-field" key={field.key}><span>{field.label}{field.required ? <em>*</em> : null}</span>{field.type === "textarea" ? <textarea aria-label={field.label} onChange={(event) => onChange(field.key, event.target.value)} value={draft[field.key] ?? ""} /> : field.type === "select" ? <select aria-label={field.label} onChange={(event) => onChange(field.key, event.target.value)} value={draft[field.key] ?? ""}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : <input aria-label={field.label} onChange={(event) => onChange(field.key, event.target.value)} type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} value={draft[field.key] ?? ""} />}</label>)}</div></div>{error ? <div className="form-error">{error}</div> : null}<div className="modal-footer"><span className="form-hint"><span className="required-star">*</span> Required fields</span><div><button className="secondary-button" onClick={onClose} type="button">Cancel</button><button className="primary-button" type="submit">{editing ? "Save changes" : `Create ${config.label.slice(0, -1) || config.label}`}</button></div></div></form></div></div>;
}

export function ForecastModule({ onAction }: { onAction: ActionHandler }) {
  return <div className="content-wrap utility-wrap"><section className="page-heading"><div><div className="eyebrow">Sales planning</div><h1>Forecasts</h1><p>Set sales targets, track achievement, and analyse the path to the next period.</p></div><button className="primary-button" onClick={() => onAction("Forecast configuration opened.")} type="button">Configure now</button></section><div className="forecast-intro"><button onClick={() => onAction("Sales target setup opened.")} type="button"><span className="utility-icon">◎</span><strong>Set Sales Target</strong><p>Set target to the users in your organization to motivate the sales.</p></button><button onClick={() => onAction("Forecast achievement opened.")} type="button"><span className="utility-icon">↗</span><strong>Track Achievement</strong><p>View all the user's achievements by the target allocated for the forecast period.</p></button><button onClick={() => onAction("Forecast analysis opened.")} type="button"><span className="utility-icon">▥</span><strong>Predict and Analyse</strong><p>Analyse the results and set better targets for forthcoming periods.</p></button></div><section className="utility-card"><div className="section-toolbar"><div><strong>Forecast setup</strong><span>Configure the period, hierarchy, targets, and rollup rules.</span></div><span className="queue-count">Not configured</span></div><div className="setup-list"><span>Forecast period <b>Monthly</b></span><span>Target owner <b>Your workspace</b></span><span>Pipeline rollup <b>Deals by closing date</b></span></div></section></div>;
}

export function DocumentsModule({ onAction }: { onAction: ActionHandler }) {
  const [folder, setFolder] = useState("My Folders");
  return <div className="content-wrap utility-wrap"><section className="page-heading"><div><div className="eyebrow">Shared files</div><h1>Documents</h1><p>Keep team folders and service collateral connected to your CRM.</p></div></section><section className="documents-card"><div className="documents-sidebar"><strong>Folders</strong><button className={folder === "My Folders" ? "active" : ""} onClick={() => setFolder("My Folders")} type="button">My Folders</button><button className={folder === "Team Folders" ? "active" : ""} onClick={() => setFolder("Team Folders")} type="button">Team Folders</button></div><div className="documents-empty"><div className="empty-icon">▤</div><strong>No documents in {folder.toLowerCase()} yet</strong><span>Add a proposal, audit, or delivery file so it stays close to the record.</span><button className="secondary-button" onClick={() => onAction(`Create a folder in ${folder.toLowerCase()} opened.`)} type="button">Create folder</button></div></section></div>;
}

export function CrmSystemWorkspace({ section, onAction, leadCount, activeLeadCount, openTaskCount }: { section: "Home" | "Workqueue" | "Reports" | "Analytics"; onAction: ActionHandler; leadCount: number; activeLeadCount: number; openTaskCount: number }) {
  if (section === "Home") return <HomeModule leadCount={leadCount} activeLeadCount={activeLeadCount} openTaskCount={openTaskCount} />;
  if (section === "Workqueue") return <WorkqueueModule onAction={onAction} />;
  if (section === "Reports") return <ReportsModule onAction={onAction} />;
  return <AnalyticsModule onAction={onAction} />;
}

function HomeModule({ leadCount, activeLeadCount, openTaskCount }: { leadCount: number; activeLeadCount: number; openTaskCount: number }) {
  return <div className="content-wrap utility-wrap">
    <section className="page-heading"><div><div className="eyebrow">Workspace home</div><h1>Gallivanter</h1><p>Your local CRM for customer records, sales, and follow-ups.</p></div></section>
    <section className="home-setup">
      <div className="utility-card"><div className="section-toolbar"><div><strong>Current workspace</strong><span>Start with your leads, pipeline, and open tasks.</span></div></div><div className="setup-list"><span>Total leads <b>{leadCount}</b></span><span>Active leads <b>{activeLeadCount}</b></span><span>Open tasks <b>{openTaskCount}</b></span></div></div>
      <aside className="home-welcome"><div className="eyebrow">Local CRM</div><h2>Keep the next action clear.</h2><p>Use Leads to update customer context, Pipeline to review lead stages, and Tasks to track follow-ups.</p><p>Backup workspace exports leads and tasks. Import workspace restores them from a saved export.</p></aside>
    </section>
  </div>;
}

function WorkqueueModule({ onAction }: { onAction: ActionHandler }) {
  const [activeTab, setActiveTab] = useState("Tasks");
  return <div className="content-wrap utility-wrap"><section className="page-heading"><div><div className="eyebrow">One place for today</div><h1>Workqueue</h1><p>Manage open activities, jobs, queues, and follow-ups without losing context.</p></div><button className="secondary-button" onClick={() => onAction("Queue customization opened.")} type="button">Customize queue</button></section><div className="workqueue-grid"><div className="utility-card"><div className="section-toolbar"><div><strong>My open activity</strong><span>Today & overdue</span></div><span className="queue-count">3 open</span></div><div className="workqueue-tabs">{["Tasks", "Meetings", "Calls"].map((tab) => <button className={activeTab === tab ? "active" : ""} key={tab} onClick={() => { setActiveTab(tab); onAction(`${tab} queue selected.`); }} type="button">{tab}</button>)}</div><div className="queue-item"><span className="queue-dot amber" /><div><strong>{activeTab === "Tasks" ? "Send the outbound workflow sample" : `${activeTab} follow-up`}</strong><small>Due today · Northstar Studio</small></div><b>High</b></div><div className="queue-item"><span className="queue-dot blue" /><div><strong>Follow up on first message</strong><small>Due tomorrow · Field & Form</small></div><b>Normal</b></div></div><div className="utility-card"><div className="section-toolbar"><div><strong>My workqueue</strong><span>Suggested queue</span></div><button className="small-button" onClick={() => onAction("New queue creation opened.")} type="button">＋ Add queue</button></div><div className="queue-groups"><div><strong>Leads</strong><span>My leads <b>4</b></span><span>Leads assigned recently <b>2</b></span></div><div><strong>Contacts</strong><span>My contacts <b>6</b></span><span>Contacts assigned recently <b>1</b></span></div><div><strong>Deals</strong><span>My deals <b>3</b></span><span>Deals closing this month <b>2</b></span></div><div><strong>Campaigns</strong><span>My active campaigns <b>0</b></span></div></div></div></div></div>;
}

const reportLibrary = ["Leads by Source", "Leads by Status", "Leads by Industry", "Converted Leads", "Lead Conversion Across Owners", "Sales Cycle Duration Across Owners", "Stage Vs Deal Type Report", "Quotes by Accounts", "Sales Orders by Status", "Invoices by Status", "Products by Category", "Campaigns Revenue Report", "Check-Ins for Leads", "Email Analytics"];

function ReportsModule({ onAction }: { onAction: ActionHandler }) {
  const [search, setSearch] = useState("");
  const visible = reportLibrary.filter((report) => report.toLowerCase().includes(search.toLowerCase()));
  return <div className="content-wrap utility-wrap"><section className="page-heading"><div><div className="eyebrow">Saved intelligence</div><h1>Reports</h1><p>Browse reusable views across leads, sales metrics, activities, inventory, campaigns, and email.</p></div><button className="primary-button" onClick={() => onAction("Report builder opened.")} type="button">＋ Create report</button></section><section className="reports-library"><div className="reports-library-toolbar"><label className="search-box"><span>⌕</span><input aria-label="Search all reports" onChange={(event) => setSearch(event.target.value)} placeholder="Search all reports" value={search} /></label><button className="toolbar-button" onClick={() => onAction("Report folder filter opened.")} type="button">All Reports⌄</button></div><div className="reports-table-head"><span>Report name</span><span>Description</span><span>Folder</span><span>Last accessed</span><span>Created by</span></div>{visible.map((report) => <div className="report-library-row" key={report}><input aria-label={`Select ${report}`} type="checkbox" /><strong>{report}</strong><span>Reusable CRM report for {report.toLowerCase()}.</span><span>Sales Metrics</span><span>—</span><span>—</span></div>)}{visible.length === 0 ? <div className="empty-state"><strong>No reports found</strong><span>Try another report name.</span></div> : null}</section></div>;
}

function AnalyticsModule({ onAction }: { onAction: ActionHandler }) {
  const cards = [{ label: "Leads this month", value: "10", note: "100% last month" }, { label: "Revenue this month", value: "₹35,000", note: "100% last month" }, { label: "Deals in pipeline", value: "8", note: "Current open deals" }, { label: "Accounts this month", value: "10", note: "100% last month" }];
  return <div className="content-wrap utility-wrap"><section className="page-heading"><div><div className="eyebrow">Dashboard</div><h1>Analytics</h1><p>Read the operating picture across pipeline, revenue, activity, and source.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => onAction("Analytics refreshed.")} type="button">↻ Refresh</button><button className="primary-button" onClick={() => onAction("Analytics component picker opened.")} type="button">＋ Add component</button></div></section><div className="analytics-toolbar"><button className="toolbar-button selected" onClick={() => onAction("Organization overview selected.")} type="button">Org Overview⌄</button><button className="toolbar-button" onClick={() => onAction("Analytics scope filter opened.")} type="button">All⌄</button></div><section className="analytics-grid">{cards.map((card) => <article className="analytics-card" key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></article>)}<article className="analytics-card analytics-wide"><div className="section-toolbar"><div><strong>Lead generation target — this year</strong><span>Progress against the current target</span></div><button className="small-button" onClick={() => onAction("Lead target refreshed.")} type="button">Refresh</button></div><div className="analytics-progress"><div><strong>10</strong><span>achieved</span></div><div className="progress-track"><span style={{ width: "12%" }} /></div><div><strong>1,000</strong><span>target</span></div></div></article><article className="analytics-card analytics-wide"><div className="section-toolbar"><div><strong>Leads by source</strong><span>Where current demand is coming from</span></div><button className="small-button" onClick={() => onAction("Lead source analytics refreshed.")} type="button">Refresh</button></div><div className="analytics-source-bars"><span><b>Website</b><i style={{ width: "78%" }} /></span><span><b>Referral</b><i style={{ width: "58%" }} /></span><span><b>LinkedIn</b><i style={{ width: "42%" }} /></span><span><b>Partner</b><i style={{ width: "28%" }} /></span></div></article></section></div>;
}
