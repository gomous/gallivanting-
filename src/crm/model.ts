export type ModuleKey =
  | "Leads"
  | "Contacts"
  | "Accounts"
  | "Deals"
  | "Campaigns"
  | "Tasks"
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

export type Values = Record<string, string>;

export type CrmNote = {
  id: string;
  text: string;
  createdAt: string;
};

export type TimelineEntry = {
  id: string;
  title: string;
  detail: string;
  at: string;
};

export type RecordLink = {
  module: ModuleKey;
  id: string;
};

export type LineItem = {
  id: string;
  productId: string;
  description: string;
  quantity: number;
  price: number;
  discount: number;
  tax: number;
};

export type ConvertedLead = {
  contactId: string;
  accountId?: string;
  dealId?: string;
};

export type CrmRecord = {
  id: string;
  module: ModuleKey;
  values: Values;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  notes: CrmNote[];
  timeline: TimelineEntry[];
  deletedAt?: string;
  convertedTo?: ConvertedLead;
  links: RecordLink[];
  lineItems: LineItem[];
};

export type FilterRule = {
  id: string;
  field: string;
  operator: string;
  value: string;
};

export type SavedView = {
  id: string;
  name: string;
  module: ModuleKey;
  rules: FilterRule[];
  match: "all" | "any";
  columns: string[];
};

export type ReportDefinition = {
  id: string;
  name: string;
  module: ModuleKey;
  groupBy: string;
  columns: string[];
  folder: string;
};

export type DashboardDefinition = {
  id: string;
  name: string;
  reportIds: string[];
};

export type CrmState = {
  version: 2;
  records: CrmRecord[];
  views: SavedView[];
  settings: Record<string, string>;
  reports: ReportDefinition[];
  dashboards: DashboardDefinition[];
};

export type FieldType =
  | "text"
  | "email"
  | "url"
  | "number"
  | "date"
  | "datetime-local"
  | "select"
  | "textarea"
  | "checkbox"
  | "lookup";

export type FieldDef = {
  key: string;
  label: string;
  type?: FieldType;
  options?: string[];
  required?: boolean;
  section?: string;
  lookup?: ModuleKey;
};

export type ModuleDef = {
  key: ModuleKey;
  singular: string;
  titleField: string;
  fields: FieldDef[];
  columns: string[];
  groupField?: string;
  stages?: string[];
  related: ModuleKey[];
  inventory?: boolean;
};
