export type LeadStatus =
  | "New"
  | "Attempted to Contact"
  | "Contact in Future"
  | "Contacted"
  | "Pre-Qualified"
  | "Not Qualified"
  | "Junk Lead"
  | "Lost Lead";

export type LeadRating = "Hot" | "Warm" | "Cold";

export type Lead = {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  email: string;
  phone: string;
  website: string;
  source: string;
  owner: string;
  status: LeadStatus;
  industry: string;
  rating: LeadRating;
  city: string;
  country: string;
  employees: string;
  revenue: string;
  lastActivity: string;
  createdAt: string;
  activityCount: number;
  taskCount: number;
  emailCount: number;
  callCount: number;
  campaignCount: number;
  dealCount: number;
  notes: string[];
  tags: string[];
};

export type LeadDraft = Pick<
  Lead,
  | "firstName"
  | "lastName"
  | "company"
  | "title"
  | "email"
  | "phone"
  | "website"
  | "source"
  | "owner"
  | "status"
  | "industry"
  | "rating"
  | "city"
  | "country"
  | "employees"
  | "revenue"
>;

export type TaskStatus = "Not Started" | "In Progress" | "Completed" | "Deferred";
export type TaskPriority = "High" | "Normal" | "Low";

export type Task = {
  id: string;
  subject: string;
  dueDate: string;
  status: TaskStatus;
  priority: TaskPriority;
  owner: string;
  contact: string;
  relatedTo: string;
  description: string;
};

export type TaskDraft = Omit<Task, "id">;

export const taskStatuses: TaskStatus[] = ["Not Started", "In Progress", "Completed", "Deferred"];

export const leadStatuses: LeadStatus[] = [
  "New",
  "Attempted to Contact",
  "Contact in Future",
  "Contacted",
  "Pre-Qualified",
  "Not Qualified",
  "Junk Lead",
  "Lost Lead",
];

export const leadSources = [
  "Website",
  "Referral",
  "LinkedIn",
  "Cold outreach",
  "Partner",
  "Event",
];

export const industries = [
  "Technology",
  "Professional services",
  "Real estate",
  "Healthcare",
  "E-commerce",
  "Education",
];
