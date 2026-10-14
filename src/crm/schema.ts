import type { CrmRecord, FieldDef, ModuleDef, ModuleKey } from "./model.ts";

export const moduleKeys: ModuleKey[] = [
  "Leads",
  "Contacts",
  "Accounts",
  "Deals",
  "Campaigns",
  "Tasks",
  "Meetings",
  "Calls",
  "Products",
  "Price Books",
  "Quotes",
  "Sales Orders",
  "Purchase Orders",
  "Invoices",
  "Vendors",
  "Cases",
  "Solutions",
];

const leadStatuses = [
  "New",
  "Attempted to Contact",
  "Contact in Future",
  "Contacted",
  "Pre-Qualified",
  "Not Qualified",
  "Junk Lead",
  "Lost Lead",
  "Converted",
];

const leadSources = ["Website", "Referral", "LinkedIn", "Cold outreach", "Partner", "Event", "Other"];
const industries = [
  "Technology",
  "Professional services",
  "Real estate",
  "Healthcare",
  "E-commerce",
  "Education",
  "Manufacturing",
  "Media",
  "Other",
];
const owners = ["You", "Growth team"];
const yesNo = ["Yes", "No"];

const field = (key: string, label: string, options?: Partial<FieldDef>): FieldDef => ({ key, label, ...options });
const select = (key: string, label: string, options: string[], optionsOverride: Partial<FieldDef> = {}): FieldDef =>
  field(key, label, { type: "select", options, ...optionsOverride });
const lookup = (key: string, label: string, module: ModuleKey, options: Partial<FieldDef> = {}): FieldDef =>
  field(key, label, { type: "lookup", lookup: module, ...options });

const leadFields: FieldDef[] = [
  field("firstName", "First Name"),
  field("lastName", "Last Name", { required: true }),
  field("company", "Company", { required: true }),
  field("title", "Title"),
  field("email", "Email", { type: "email" }),
  field("secondaryEmail", "Secondary Email", { type: "email" }),
  field("phone", "Phone"),
  field("mobile", "Mobile"),
  field("fax", "Fax"),
  field("website", "Website", { type: "url" }),
  select("source", "Lead Source", leadSources),
  select("status", "Lead Status", leadStatuses),
  select("industry", "Industry", industries),
  select("rating", "Rating", ["Hot", "Warm", "Cold"]),
  select("owner", "Lead Owner", owners),
  lookup("campaignId", "Campaign Source", "Campaigns"),
  field("street", "Street"),
  field("city", "City"),
  field("state", "State"),
  field("zipCode", "Zip Code"),
  field("country", "Country"),
  field("employees", "Employees"),
  field("revenue", "Annual Revenue"),
  field("skypeId", "Skype ID"),
  field("preferredContactMethod", "Preferred Contact Method", { type: "select", options: ["Email", "Phone", "Mobile", "Any"] }),
  field("description", "Description", { type: "textarea" }),
  field("optOutEmail", "Email Opt Out", { type: "checkbox" }),
  field("optOutCall", "Call Opt Out", { type: "checkbox" }),
];

const contactFields: FieldDef[] = [
  field("firstName", "First Name"),
  field("lastName", "Last Name", { required: true }),
  lookup("accountId", "Account Name", "Accounts"),
  field("accountName", "Account Name (legacy display)"),
  field("title", "Title"),
  field("email", "Email", { type: "email" }),
  field("secondaryEmail", "Secondary Email", { type: "email" }),
  field("phone", "Phone"),
  field("mobile", "Mobile"),
  field("department", "Department"),
  select("leadSource", "Lead Source", leadSources),
  select("owner", "Contact Owner", owners),
  field("dateOfBirth", "Date of Birth", { type: "date" }),
  field("assistant", "Assistant"),
  field("asstPhone", "Assistant Phone"),
  lookup("reportingTo", "Reporting To", "Contacts"),
  field("mailingStreet", "Mailing Street"),
  field("mailingCity", "Mailing City"),
  field("mailingState", "Mailing State"),
  field("mailingZip", "Mailing Zip"),
  field("mailingCountry", "Mailing Country"),
  field("otherStreet", "Other Street"),
  field("otherCity", "Other City"),
  field("otherState", "Other State"),
  field("otherZip", "Other Zip"),
  field("otherCountry", "Other Country"),
  field("skypeId", "Skype ID"),
  field("description", "Description", { type: "textarea" }),
  field("optOutEmail", "Email Opt Out", { type: "checkbox" }),
  field("optOutCall", "Call Opt Out", { type: "checkbox" }),
];

const accountFields: FieldDef[] = [
  field("accountName", "Account Name", { required: true }),
  field("accountNumber", "Account Number"),
  field("phone", "Phone"),
  field("website", "Website", { type: "url" }),
  select("industry", "Industry", industries),
  select("type", "Account Type", ["Prospect", "Customer", "Partner", "Reseller", "Other"]),
  field("annualRevenue", "Annual Revenue", { type: "number" }),
  // Legacy Zoho-style records commonly store employee bands such as 11–25.
  field("employees", "Employees"),
  select("rating", "Rating", ["Hot", "Warm", "Cold"]),
  select("owner", "Account Owner", owners),
  field("billingStreet", "Billing Street"),
  field("billingCity", "Billing City"),
  field("billingState", "Billing State"),
  field("billingCode", "Billing Code"),
  field("billingCountry", "Billing Country"),
  field("shippingStreet", "Shipping Street"),
  field("shippingCity", "Shipping City"),
  field("shippingState", "Shipping State"),
  field("shippingCode", "Shipping Code"),
  field("shippingCountry", "Shipping Country"),
  field("description", "Description", { type: "textarea" }),
];

const dealStages = ["Qualification", "Needs Analysis", "Value Proposition", "Negotiation/Review", "Closed Won", "Closed Lost"];
const dealFields: FieldDef[] = [
  field("dealName", "Deal Name", { required: true }),
  lookup("accountId", "Account Name", "Accounts"),
  field("accountName", "Account Name (legacy display)"),
  lookup("contactId", "Contact Name", "Contacts"),
  field("contactName", "Contact Name (legacy display)"),
  field("amount", "Amount", { type: "number" }),
  select("stage", "Stage", dealStages, { required: true }),
  field("probability", "Probability (%)", { type: "number" }),
  field("closingDate", "Closing Date", { type: "date", required: true }),
  select("type", "Type", ["New Business", "Existing Business"]),
  field("nextStep", "Next Step"),
  select("owner", "Deal Owner", owners),
  lookup("campaignId", "Campaign Source", "Campaigns"),
  field("expectedRevenue", "Expected Revenue", { type: "number" }),
  field("reasonForLoss", "Reason For Loss"),
  field("description", "Description", { type: "textarea" }),
];

const campaignFields: FieldDef[] = [
  field("campaignName", "Campaign Name", { required: true }),
  select("type", "Type", ["Email", "Webinar", "Event", "Social", "Other"]),
  select("status", "Status", ["Planning", "Active", "Completed", "Aborted"]),
  field("startDate", "Start Date", { type: "date" }),
  field("endDate", "End Date", { type: "date" }),
  field("expectedRevenue", "Expected Revenue", { type: "number" }),
  field("actualCost", "Actual Cost", { type: "number" }),
  field("budgetedCost", "Budgeted Cost", { type: "number" }),
  field("expectedResponse", "Expected Response", { type: "number" }),
  select("owner", "Campaign Owner", owners),
  field("description", "Description", { type: "textarea" }),
];

const taskFields: FieldDef[] = [
  field("subject", "Subject", { required: true }),
  field("dueDate", "Due Date", { type: "date" }),
  select("status", "Status", ["Not Started", "In Progress", "Completed", "Deferred", "Waiting"]),
  select("priority", "Priority", ["High", "Normal", "Low"]),
  select("owner", "Task Owner", owners),
  lookup("contactId", "Contact Name", "Contacts"),
  field("relatedId", "Related To"),
  select("relatedModule", "Related Module", ["Leads", "Contacts", "Accounts", "Deals", "Campaigns"]),
  field("reminder", "Reminder", { type: "datetime-local" }),
  field("recurrence", "Repeat"),
  field("description", "Description", { type: "textarea" }),
];

const meetingFields: FieldDef[] = [
  field("title", "Title", { required: true }),
  field("from", "From", { type: "datetime-local", required: true }),
  field("to", "To", { type: "datetime-local", required: true }),
  lookup("contactId", "Contact Name", "Contacts"),
  field("relatedId", "Related To"),
  select("relatedModule", "Related Module", ["Leads", "Contacts", "Accounts", "Deals", "Campaigns"]),
  select("host", "Host", owners),
  field("location", "Meeting Venue"),
  select("allDay", "All day", yesNo),
  field("description", "Description", { type: "textarea" }),
];

const callFields: FieldDef[] = [
  field("subject", "Subject", { required: true }),
  select("callType", "Call Type", ["Inbound", "Outbound"]),
  field("callStart", "Call Start Time", { type: "datetime-local" }),
  field("callDuration", "Call Duration"),
  field("purpose", "Call Purpose"),
  field("result", "Call Result"),
  lookup("contactId", "Contact Name", "Contacts"),
  field("relatedId", "Related To"),
  select("relatedModule", "Related Module", ["Leads", "Contacts", "Accounts", "Deals", "Campaigns"]),
  select("owner", "Call Owner", owners),
  field("callAgenda", "Call Agenda", { type: "textarea" }),
];

const productFields: FieldDef[] = [
  field("productName", "Product Name", { required: true }),
  field("productCode", "Product Code"),
  select("productActive", "Product Active", yesNo),
  field("unitPrice", "Unit Price", { type: "number" }),
  field("productCategory", "Product Category"),
  field("usageUnit", "Usage Unit"),
  field("manufacturer", "Manufacturer"),
  lookup("vendorId", "Vendor Name", "Vendors"),
  field("commissionRate", "Commission Rate", { type: "number" }),
  field("quantityInStock", "Quantity in Stock", { type: "number" }),
  field("reorderLevel", "Reorder Level", { type: "number" }),
  field("qtyOrdered", "Qty Ordered", { type: "number" }),
  field("salesEndDate", "Sales End Date", { type: "date" }),
  field("supportEndDate", "Support End Date", { type: "date" }),
  field("tax", "Tax", { type: "number" }),
  select("owner", "Product Owner", owners),
];

const priceBookFields: FieldDef[] = [
  field("priceBookName", "Price Book Name", { required: true }),
  select("active", "Active", yesNo),
  // Zoho exposes several pricing strategies; the local model keeps them as inferred choices.
  select("pricingModel", "Pricing Model", ["Flat", "Markup", "Discount"]),
  field("description", "Description", { type: "textarea" }),
  select("owner", "Price Book Owner", owners),
];

const quoteFields: FieldDef[] = [
  field("quoteName", "Quote Name", { required: true }),
  field("subject", "Subject"),
  lookup("accountId", "Account Name", "Accounts"),
  field("accountName", "Account Name (legacy display)"),
  lookup("contactId", "Contact Name", "Contacts"),
  field("contactName", "Contact Name (legacy display)"),
  lookup("dealId", "Deal Name", "Deals"),
  select("stage", "Stage", ["Draft", "Sent", "Accepted", "Declined", "Expired"]),
  field("amount", "Grand Total", { type: "number" }),
  field("validUntil", "Valid Until", { type: "date" }),
  select("owner", "Quote Owner", owners),
  field("description", "Description", { type: "textarea" }),
];

const salesOrderFields: FieldDef[] = [
  field("subject", "Subject", { required: true }),
  lookup("accountId", "Account Name", "Accounts"),
  field("accountName", "Account Name (legacy display)"),
  lookup("contactId", "Contact Name", "Contacts"),
  field("contactName", "Contact Name (legacy display)"),
  select("status", "Status", ["Created", "Approved", "In Progress", "Completed", "Cancelled"]),
  field("dueDate", "Due Date", { type: "date" }),
  field("amount", "Grand Total", { type: "number" }),
  lookup("quoteId", "Quote", "Quotes"),
  select("owner", "Sales Order Owner", owners),
  field("description", "Description", { type: "textarea" }),
];

const purchaseOrderFields: FieldDef[] = [
  field("subject", "Subject", { required: true }),
  lookup("vendorId", "Vendor Name", "Vendors"),
  lookup("accountId", "Account Name", "Accounts"),
  select("status", "Status", ["Created", "Approved", "In Progress", "Completed", "Cancelled"]),
  field("dueDate", "Due Date", { type: "date" }),
  field("amount", "Grand Total", { type: "number" }),
  select("owner", "Purchase Order Owner", owners),
  field("description", "Description", { type: "textarea" }),
];

const invoiceFields: FieldDef[] = [
  field("subject", "Subject", { required: true }),
  lookup("accountId", "Account Name", "Accounts"),
  field("accountName", "Account Name (legacy display)"),
  lookup("contactId", "Contact Name", "Contacts"),
  field("invoiceDate", "Invoice Date", { type: "date" }),
  field("dueDate", "Due Date", { type: "date" }),
  select("status", "Status", ["Draft", "Sent", "Paid", "Overdue", "Void"]),
  field("amount", "Grand Total", { type: "number" }),
  lookup("salesOrderId", "Sales Order", "Sales Orders"),
  select("owner", "Invoice Owner", owners),
];

const vendorFields: FieldDef[] = [
  field("vendorName", "Vendor Name", { required: true }),
  field("phone", "Phone"),
  field("email", "Email", { type: "email" }),
  field("website", "Website", { type: "url" }),
  field("category", "Category"),
  select("owner", "Vendor Owner", owners),
  field("street", "Street"),
  field("city", "City"),
  field("state", "State"),
  field("zipCode", "Zip Code"),
  field("country", "Country"),
];

const caseFields: FieldDef[] = [
  field("subject", "Subject", { required: true }),
  field("caseNumber", "Case Number"),
  lookup("accountId", "Account Name", "Accounts"),
  lookup("contactId", "Contact Name", "Contacts"),
  select("status", "Status", ["Open", "Pending", "Closed"]),
  select("priority", "Priority", ["High", "Normal", "Low"]),
  select("origin", "Case Origin", ["Email", "Web", "Phone"]),
  field("category", "Category"),
  lookup("productId", "Product", "Products"),
  select("owner", "Case Owner", owners),
  field("description", "Description", { type: "textarea" }),
  field("resolution", "Resolution", { type: "textarea" }),
];

const solutionFields: FieldDef[] = [
  field("solutionTitle", "Solution Title", { required: true }),
  field("question", "Question"),
  select("status", "Status", ["Draft", "Published", "Archived"]),
  lookup("productId", "Product", "Products"),
  field("product", "Product (legacy display)"),
  select("owner", "Solution Owner", owners),
  field("answer", "Answer", { type: "textarea" }),
  field("description", "Description", { type: "textarea" }),
];

const related = (...keys: ModuleKey[]): ModuleKey[] => keys;
const definition = (
  key: ModuleKey,
  singular: string,
  titleField: string,
  fields: FieldDef[],
  columns: string[],
  relatedModules: ModuleKey[],
  options: Pick<ModuleDef, "groupField" | "stages" | "inventory"> = {},
): ModuleDef => ({ key, singular, titleField, fields, columns, related: relatedModules, ...options });

export const moduleDefs: Record<ModuleKey, ModuleDef> = {
  Leads: definition("Leads", "Lead", "company", leadFields, ["company", "lastName", "email", "status", "owner", "source"], related("Contacts", "Accounts", "Deals", "Campaigns", "Tasks", "Meetings", "Calls")),
  Contacts: definition("Contacts", "Contact", "firstName", contactFields, ["firstName", "lastName", "accountId", "email", "phone", "owner"], related("Accounts", "Leads", "Deals", "Tasks", "Meetings", "Calls")),
  Accounts: definition("Accounts", "Account", "accountName", accountFields, ["accountName", "phone", "website", "industry", "owner"], related("Contacts", "Leads", "Deals", "Tasks", "Meetings", "Calls", "Quotes", "Sales Orders", "Invoices")),
  Deals: definition("Deals", "Deal", "dealName", dealFields, ["dealName", "stage", "amount", "accountId", "closingDate"], related("Accounts", "Contacts", "Leads", "Campaigns", "Tasks", "Meetings", "Calls", "Quotes", "Sales Orders"), { groupField: "stage", stages: dealStages }),
  Campaigns: definition("Campaigns", "Campaign", "campaignName", campaignFields, ["campaignName", "type", "status", "startDate", "endDate", "owner"], related("Leads", "Contacts", "Deals", "Tasks", "Meetings", "Calls"), { groupField: "status" }),
  Tasks: definition("Tasks", "Task", "subject", taskFields, ["subject", "dueDate", "status", "priority", "owner"], related("Leads", "Contacts", "Accounts", "Deals", "Campaigns", "Meetings", "Calls"), { groupField: "status" }),
  Meetings: definition("Meetings", "Meeting", "title", meetingFields, ["title", "from", "to", "contactId", "host"], related("Leads", "Contacts", "Accounts", "Deals", "Tasks")),
  Calls: definition("Calls", "Call", "subject", callFields, ["subject", "callType", "callStart", "callDuration", "contactId", "owner"], related("Leads", "Contacts", "Accounts", "Deals", "Tasks")),
  Products: definition("Products", "Product", "productName", productFields, ["productName", "productCode", "unitPrice", "productActive", "owner"], related("Accounts", "Contacts", "Deals", "Quotes", "Sales Orders", "Purchase Orders", "Cases"), { inventory: true }),
  "Price Books": definition("Price Books", "Price Book", "priceBookName", priceBookFields, ["priceBookName", "active", "pricingModel", "owner"], related("Products", "Deals", "Quotes"), { inventory: true }),
  Quotes: definition("Quotes", "Quote", "quoteName", quoteFields, ["quoteName", "accountId", "stage", "amount", "validUntil", "owner"], related("Accounts", "Contacts", "Deals", "Products", "Tasks", "Sales Orders"), { inventory: true, groupField: "stage" }),
  "Sales Orders": definition("Sales Orders", "Sales Order", "subject", salesOrderFields, ["subject", "accountId", "status", "dueDate", "amount", "owner"], related("Accounts", "Contacts", "Deals", "Quotes", "Products", "Invoices"), { inventory: true, groupField: "status" }),
  "Purchase Orders": definition("Purchase Orders", "Purchase Order", "subject", purchaseOrderFields, ["subject", "vendorId", "status", "dueDate", "amount", "owner"], related("Vendors", "Accounts", "Products"), { inventory: true, groupField: "status" }),
  Invoices: definition("Invoices", "Invoice", "subject", invoiceFields, ["subject", "accountId", "invoiceDate", "dueDate", "status", "amount"], related("Accounts", "Contacts", "Sales Orders"), { inventory: true, groupField: "status" }),
  Vendors: definition("Vendors", "Vendor", "vendorName", vendorFields, ["vendorName", "phone", "email", "website", "owner"], related("Products", "Purchase Orders"), { inventory: true }),
  Cases: definition("Cases", "Case", "subject", caseFields, ["subject", "accountId", "contactId", "status", "priority", "owner"], related("Accounts", "Contacts", "Products", "Tasks")),
  Solutions: definition("Solutions", "Solution", "solutionTitle", solutionFields, ["solutionTitle", "status", "productId", "owner"], related("Products", "Cases")),
};

export function recordTitle(record: CrmRecord): string {
  const values = record.values;
  const preferred = values[moduleDefs[record.module].titleField]?.trim();
  if (preferred) {
    if (record.module === "Contacts" && values.lastName?.trim()) return `${preferred} ${values.lastName.trim()}`;
    return preferred;
  }

  const combinations: string[][] = [
    ["firstName", "lastName"],
    ["dealName"],
    ["subject"],
    ["title"],
    ["accountName"],
    ["productName"],
    ["vendorName"],
    ["solutionTitle"],
    ["priceBookName"],
    ["campaignName"],
  ];
  for (const keys of combinations) {
    const text = keys.map((key) => values[key]?.trim()).filter(Boolean).join(" ");
    if (text) return text;
  }
  return `${moduleDefs[record.module].singular} ${record.id}`;
}

export function fieldLabel(module: ModuleKey, fieldKey: string): string {
  const definitionForModule = moduleDefs[module];
  const found = definitionForModule?.fields.find((candidate) => candidate.key === fieldKey);
  if (found) return found.label;
  if (fieldKey === "relatedId") return "Related To";
  if (fieldKey === "contactId") return "Contact Name";
  if (fieldKey === "accountId") return "Account Name";
  if (fieldKey === "vendorId") return "Vendor Name";
  return fieldKey
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

export function requiredFields(module: ModuleKey): FieldDef[] {
  return moduleDefs[module].fields.filter((candidate) => candidate.required);
}

export function fieldDefinition(module: ModuleKey, key: string): FieldDef | undefined {
  return moduleDefs[module].fields.find((candidate) => candidate.key === key);
}
