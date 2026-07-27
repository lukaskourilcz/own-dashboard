/**
 * Deterministic demo data for the two fixture-backed dashboard surfaces:
 * `/dev-preview` (development and E2E only) and `/guest` (the public read-only
 * tour). Dates are computed relative to "now" so the hero, "due today",
 * upcoming dates, and charts all populate with lifelike content.
 *
 * Every person, company, address and bank detail here is invented: "Jan Novák"
 * and `example.com` are placeholders, "Acme s.r.o." is a stand-in client, and
 * the IBAN is the documentation example value. The repository names are public
 * GitHub repositories. Nothing in this file is owner data, which is what makes
 * `/guest` safe to serve publicly — keep it that way when editing.
 */
import type {
  Account,
  AgentTask,
  AppNotification,
  ClientOpportunity,
  AiCategory,
  AiLink,
  CoverLetterTemplate,
  Cron,
  ImportantDate,
  Invoice,
  InvoiceItem,
  InvoiceSettings,
  JobApplication,
  JobApplicationEvent,
  JobListing,
  JobScrapeRun,
  JobUserState,
  Note,
  Organization,
  Plan,
  Project,
  ProjectCommunication,
  ProjectCost,
  Prompt,
  ReferenceRow,
  RepoLink,
  RepoNote,
  Shortcut,
  Subscription,
  Todo,
  Transaction,
  InboxItem,
  WeeklyReview,
} from "@/lib/types";
import type { EventsResult } from "@/lib/calendar";

const UID = "preview-user";
const NOW = new Date();
const TS = NOW.toISOString();

function ymd(dayOffset = 0): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}
function at(hour: number, minute = 0, dayOffset = 0): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export const user = {
  id: UID,
  email: "jan.novak@example.com",
  name: "Jan Novák",
  avatar_url: null as string | null,
};

export const subscriptions: Subscription[] = [
  { id: "s1", user_id: UID, name: "Netflix", amount: 279, currency: "CZK", billing_cycle: "monthly", category: "Entertainment", category_group: "entertainment", importance: "optional", next_billing_date: ymd(8), is_active: true, created_at: TS, updated_at: TS },
  { id: "s2", user_id: UID, name: "Spotify", amount: 169, currency: "CZK", billing_cycle: "monthly", category: "Music", category_group: "entertainment", importance: "optional", next_billing_date: ymd(3), is_active: true, created_at: TS, updated_at: TS },
  { id: "s3", user_id: UID, name: "iCloud+", amount: 25, currency: "CZK", billing_cycle: "monthly", category: "Storage", category_group: "infrastructure", importance: "essential", next_billing_date: ymd(20), is_active: true, created_at: TS, updated_at: TS },
  { id: "s4", user_id: UID, name: "Figma", amount: 1440, currency: "CZK", billing_cycle: "yearly", category: "Work", category_group: "development", importance: "useful", next_billing_date: ymd(120), is_active: true, created_at: TS, updated_at: TS },
];

// Manual tasks carry null repo/source context; NEEDED-sourced ones (t5/t6)
// carry the full task-card context + a 7-day timer (due_date = generated + 7).
const MANUAL = {
  source: null,
  repo_id: null,
  repo_full_name: null,
  repo_owner: null,
  repo_name: null,
  repo_url: null,
  needed_raw: null,
  generated_at: null,
  importance: null,
} as const;

export const todos: Todo[] = [
  { id: "t1", user_id: UID, title: "Submit Q2 invoice", done: false, due_date: ymd(0), category: null, created_at: TS, ...MANUAL, importance: 4 },
  { id: "t2", user_id: UID, title: "Reply to landlord", done: false, due_date: ymd(-1), category: null, created_at: TS, ...MANUAL, importance: 3 },
  { id: "t3", user_id: UID, title: "Buy running shoes", done: false, due_date: ymd(2), category: null, created_at: TS, ...MANUAL },
  { id: "t4", user_id: UID, title: "Book dentist", done: true, due_date: null, category: null, created_at: TS, ...MANUAL },
  { id: "t5", user_id: UID, title: "Add UPSTASH_REDIS_REST_URL in Vercel", done: false, due_date: ymd(5), category: "own-dashboard", created_at: TS, source: "github", repo_id: "1001", repo_full_name: "lukaskourilcz/own-dashboard", repo_owner: "lukaskourilcz", repo_name: "own-dashboard", repo_url: "https://github.com/lukaskourilcz/own-dashboard", needed_raw: "- [ ] Add UPSTASH_REDIS_REST_URL in Vercel", generated_at: ymd(-2), importance: 3 },
  { id: "t6", user_id: UID, title: "Generate real app icons with Recraft", done: false, due_date: ymd(1), category: "react-express-app", created_at: TS, source: "github", repo_id: "1002", repo_full_name: "lukaskourilcz/react-express-app", repo_owner: "lukaskourilcz", repo_name: "react-express-app", repo_url: "https://github.com/lukaskourilcz/react-express-app", needed_raw: "- [ ] Generate real app icons with Recraft", generated_at: ymd(-6), importance: 5 },
  { id: "t7", user_id: UID, title: "Review the weekly operating plan", done: false, due_date: ymd(0), category: null, created_at: at(8, 0, -12), ...MANUAL, importance: 6, is_global: true },
  { id: "t8", user_id: UID, title: "Verify project deployment", done: false, due_date: ymd(1), category: "aifirst", created_at: at(9, 0, -4), ...MANUAL, importance: 4, project_id: "proj-aifirst", is_global: false },
  { id: "t9", user_id: UID, title: "Review dashboard accessibility report", done: false, due_date: ymd(3), category: "own-dashboard", created_at: at(10, 0, -3), ...MANUAL, importance: 2, project_id: "proj-dashboard", is_global: false },
  { id: "t10", user_id: UID, title: "Review the ingestion retry policy", done: false, due_date: ymd(4), category: "aifirst", created_at: at(11, 0, -5), ...MANUAL, importance: 3, project_id: "proj-aifirst", is_global: false },
  { id: "t11", user_id: UID, title: "Document the release migration", done: false, due_date: ymd(5), category: "own-dashboard", created_at: at(12, 0, -7), ...MANUAL, importance: 2, project_id: "proj-dashboard", is_global: false },
  { id: "t12", user_id: UID, title: "Verify integration reconnect states", done: false, due_date: ymd(6), category: "own-dashboard", created_at: at(13, 0, -8), ...MANUAL, importance: 1, project_id: "proj-dashboard", is_global: false },
];

export const accounts: Account[] = [
  { id: "a1", user_id: UID, name: "Checking", balance: 48250, currency: "CZK", external_ref: null, created_at: TS, updated_at: TS },
  { id: "a2", user_id: UID, name: "Savings", balance: 152000, currency: "CZK", external_ref: null, created_at: TS, updated_at: TS },
];

export const transactions: Transaction[] = [
  { id: "tx1", user_id: UID, account_id: "a1", kind: "income", amount: 62000, currency: "CZK", category: "Salary", note: "June", occurred_on: ymd(-5), external_id: null, created_at: TS },
  { id: "tx2", user_id: UID, account_id: "a1", kind: "expense", amount: 14500, currency: "CZK", category: "Rent", note: null, occurred_on: ymd(-4), external_id: null, created_at: TS },
  { id: "tx3", user_id: UID, account_id: "a1", kind: "expense", amount: 3200, currency: "CZK", category: "Groceries", note: null, occurred_on: ymd(-3), external_id: null, created_at: TS },
  { id: "tx4", user_id: UID, account_id: "a1", kind: "expense", amount: 890, currency: "CZK", category: "Transport", note: null, occurred_on: ymd(-2), external_id: null, created_at: TS },
  { id: "tx5", user_id: UID, account_id: "a1", kind: "expense", amount: 1240, currency: "CZK", category: "Dining", note: "Dinner", occurred_on: ymd(-1), external_id: null, created_at: TS },
  { id: "tx6", user_id: UID, account_id: "a2", kind: "income", amount: 5000, currency: "CZK", category: "Interest", note: null, occurred_on: ymd(0), external_id: null, created_at: TS },
];

export const plans: Plan[] = [
  { id: "p1", user_id: UID, title: "Launch side project", target_date: ymd(45), status: "active", recurrence: "none", last_completed_at: null, notes: "Ship the MVP first.", linked_calendar_event_id: null, created_at: TS, updated_at: TS },
  { id: "p2", user_id: UID, title: "Run a half marathon", target_date: ymd(90), status: "idea", recurrence: "none", last_completed_at: null, notes: null, linked_calendar_event_id: null, created_at: TS, updated_at: TS },
  { id: "p3", user_id: UID, title: "Weekly review", target_date: null, status: "active", recurrence: "weekly", last_completed_at: null, notes: "Plan the week ahead.", linked_calendar_event_id: null, created_at: TS, updated_at: TS },
  { id: "p4", user_id: UID, title: "Pay rent", target_date: null, status: "active", recurrence: "monthly", last_completed_at: null, notes: null, linked_calendar_event_id: null, created_at: TS, updated_at: TS },
  { id: "p5", user_id: UID, title: "Deep-clean flat", target_date: null, status: "active", recurrence: "biweekly", last_completed_at: TS, notes: null, linked_calendar_event_id: null, created_at: TS, updated_at: TS },
];

export const notes: Note[] = [
  { id: "n1", user_id: UID, title: "Project ideas", content: [], plain_text: "Brainstorm for the new app", tags: ["work", "ideas"], is_pinned: true, sort_order: 2, created_at: TS, updated_at: TS },
  { id: "n2", user_id: UID, title: "Grocery list", content: [], plain_text: "Milk, eggs, bread", tags: ["home"], is_pinned: false, sort_order: 1, created_at: TS, updated_at: TS },
];

export const prompts: Prompt[] = [
  { id: "pr1", user_id: UID, name: "Code review", description: "Reviews a pull request for correctness, security, and clarity.", body: "Review this pull request for correctness, security, and clarity. Flag risky changes and suggest concrete fixes with short examples.", created_at: TS, updated_at: TS },
  { id: "pr2", user_id: UID, name: "Commit message", description: "Writes a conventional-commit message from the staged diff.", body: "Write a concise conventional-commit message for the staged diff. Imperative mood, a short subject, then a body explaining why.", created_at: TS, updated_at: TS },
  { id: "pr3", user_id: UID, name: "Explain code", description: "Explains a function step by step and lists its edge cases.", body: "Explain what this function does step by step, then list its edge cases and one way it could break.", created_at: TS, updated_at: TS },
];

// Repo notes attach to live GitHub repos, which aren't available in the
// auth-less preview (the Repos panel shows the Connect CTA), so this stays empty.
export const repoNotes: RepoNote[] = [];
export const repoLinks: RepoLink[] = [];

export const projects: Project[] = [
  {
    id: "proj-aifirst",
    user_id: "u1",
    name: "aifirst",
    slug: "aifirst",
    repo_full_name: "lukaskourilcz/aifirst",
    url: "https://aifirst.example.com",
    notes: "Daily AI magazine. Watch the FLUX image bill.",
    color: null,
    sort_order: 0,
    is_active: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "proj-dashboard",
    user_id: "u1",
    name: "own-dashboard",
    slug: "own-dashboard",
    repo_full_name: "lukaskourilcz/own-dashboard",
    url: null,
    notes: "",
    color: null,
    sort_order: 1,
    is_active: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
];

export const projectCommunications: ProjectCommunication[] = [
  {
    id: "comm-1",
    user_id: UID,
    project_id: "proj-aifirst",
    occurred_at: TS,
    channel: "meeting",
    direction: "outbound",
    contact: "Editorial partner",
    subject: "Launch scope",
    summary: "Confirmed the first release scope and the weekly review cadence.",
    next_action: "Send the revised launch checklist.",
    created_at: TS,
    updated_at: TS,
  },
];

export const agentTasks: AgentTask[] = [
  {
    id: "agent-task-1",
    user_id: UID,
    project_id: "proj-dashboard",
    title: "Validate the dashboard release",
    instructions: "Run lint, TypeScript, unit tests, and report any failures without changing production data.",
    agent_name: "codex-vps-1",
    priority: 4,
    status: "queued",
    result: null,
    claimed_at: null,
    completed_at: null,
    created_at: TS,
    updated_at: TS,
  },
];

export const projectCosts: ProjectCost[] = [
  {
    id: "pc-1",
    user_id: "u1",
    project_id: "proj-aifirst",
    label: "Supabase",
    amount: 25,
    currency: "USD",
    note: "Pro plan",
    sort_order: 0,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "pc-2",
    user_id: "u1",
    project_id: "proj-aifirst",
    label: "Vercel",
    amount: 20,
    currency: "USD",
    note: "",
    sort_order: 1,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
];

export const crons: Cron[] = [
  {
    id: "cron-1",
    user_id: "u1",
    project_id: "proj-aifirst",
    name: "Daily article generation",
    schedule: "0 6 * * *",
    description: "Scrape, curate, write + illustrate the daily issue.",
    endpoint: "/api/cron/generate-daily",
    is_ai_call: true,
    cost_per_run: 0.35,
    currency: "USD",
    runs_per_month: 30,
    enabled: true,
    last_run_at: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
];

export const shortcuts: Shortcut[] = [
  { id: "sc1", user_id: UID, command: "sudo docker compose up -d seaweedfs-s3", description: "Starts the S3 server.", sort_order: 1, created_at: TS, updated_at: TS },
  { id: "sc2", user_id: UID, command: "git push -u origin HEAD", description: "Push the current branch and set its upstream.", sort_order: 2, created_at: TS, updated_at: TS },
  { id: "sc3", user_id: UID, command: "npm run dev", description: "Start the local dev server.", sort_order: 3, created_at: TS, updated_at: TS },
  { id: "sc4", user_id: UID, command: "kubectl get pods -A", description: "List pods across all namespaces.", sort_order: 4, created_at: TS, updated_at: TS },
];

export const referenceRows: ReferenceRow[] = [
  { id: "rr1", user_id: UID, kind: "git", c1: "git fetch origin", c2: "Download new commits from the remote without touching your files.", c3: null, sort_order: 1, created_at: TS, updated_at: TS },
  { id: "rr2", user_id: UID, kind: "git", c1: "git pull --rebase", c2: "Fetch, then replay your commits on top of the updated branch.", c3: null, sort_order: 2, created_at: TS, updated_at: TS },
  { id: "rr3", user_id: UID, kind: "subst", c1: "Ctrl", c2: "Command (Cmd ⌘)", c3: null, sort_order: 1, created_at: TS, updated_at: TS },
  { id: "rr4", user_id: UID, kind: "subst", c1: "Alt", c2: "Option (Opt ⌥)", c3: null, sort_order: 2, created_at: TS, updated_at: TS },
  { id: "rr5", user_id: UID, kind: "translated", c1: "Command Palette", c2: "Ctrl + Shift + P", c3: "Cmd + Shift + P", sort_order: 1, created_at: TS, updated_at: TS },
  { id: "rr6", user_id: UID, kind: "translated", c1: "Comment Line", c2: "Ctrl + K  Ctrl + C", c3: "Cmd + K  Cmd + C", sort_order: 2, created_at: TS, updated_at: TS },
];

export const aiCategories: AiCategory[] = [
  { id: "ac1", user_id: UID, name: "DESIGN", sort_order: 1, created_at: TS },
  { id: "ac2", user_id: UID, name: "SECURITY", sort_order: 2, created_at: TS },
  { id: "ac3", user_id: UID, name: "IDEAS", sort_order: 3, created_at: TS },
];

export const aiLinks: AiLink[] = [
  { id: "al1", user_id: UID, category_id: "ac1", title: "Midjourney", url: "https://www.midjourney.com", description: "AI image generation for moodboards and concepts.", pricing: "paid", created_at: TS, updated_at: TS },
  { id: "al2", user_id: UID, category_id: "ac2", title: "Have I Been Pwned", url: "https://haveibeenpwned.com", description: "Check if credentials appeared in a breach.", pricing: "free", created_at: TS, updated_at: TS },
  { id: "al3", user_id: UID, category_id: null, title: "Hugging Face", url: "https://huggingface.co", description: "Open models, datasets, and demos.", pricing: "freemium", created_at: TS, updated_at: TS },
];

export const importantDates: ImportantDate[] = [
  { id: "d1", user_id: UID, title: "Contract renewal", the_date: ymd(12), is_recurring: true, recurrence_unit: "yearly", emoji: "📄", notes: null, created_at: TS },
  { id: "d2", user_id: UID, title: "Conference CFP", the_date: ymd(25), is_recurring: false, recurrence_unit: null, emoji: "🎤", notes: null, created_at: TS },
];

export const invoiceSettings: InvoiceSettings = {
  user_id: UID,
  supplier_name: "Jan Novák",
  supplier_address: "Korunní 12",
  supplier_city: "Praha",
  supplier_zip: "120 00",
  supplier_country: "CZ",
  supplier_ico: "12345678",
  supplier_dic: "CZ12345678",
  is_vat_payer: true,
  bank_account: "123456789/0100",
  iban: "CZ6508000000192000145399",
  default_due_days: 14,
  default_currency: "CZK",
  footer_note: "Děkuji za platbu.",
  logo: null,
  updated_at: TS,
};

export const invoices: Invoice[] = [
  {
    id: "inv1", user_id: UID, number: "2026001", variable_symbol: "2026001", constant_symbol: null,
    issue_date: ymd(-7), due_date: ymd(7), taxable_supply_date: ymd(-7), payment_method: "bank",
    currency: "CZK", status: "issued", paid_on: null, round_total: true,
    buyer_name: "Acme s.r.o.", buyer_address: "Hlavní 1", buyer_city: "Brno", buyer_zip: "602 00",
    buyer_country: "CZ", buyer_ico: "87654321", buyer_dic: "CZ87654321",
    supplier_name: "Jan Novák", supplier_address: "Korunní 12", supplier_city: "Praha", supplier_zip: "120 00",
    supplier_country: "CZ", supplier_ico: "12345678", supplier_dic: "CZ12345678", supplier_is_vat_payer: true,
    bank_account: "123456789/0100", iban: "CZ6508000000192000145399", note: null,
    footer_note: "Děkuji za platbu.", created_at: TS, updated_at: TS,
  },
];

export const invoiceItems: InvoiceItem[] = [
  { id: "it1", invoice_id: "inv1", user_id: UID, description: "Web development", quantity: 20, unit: "h", unit_price: 1200, vat_rate: 21, position: 0, created_at: TS },
  { id: "it2", invoice_id: "inv1", user_id: UID, description: "Consulting", quantity: 5, unit: "h", unit_price: 1500, vat_rate: 21, position: 1, created_at: TS },
];

export const todayCalendar: EventsResult = {
  ok: true,
  events: [
    { id: "e1", summary: "Standup", start: { dateTime: at(9, 30) }, end: { dateTime: at(9, 45) } },
    { id: "e2", summary: "Lunch with Petr", start: { dateTime: at(12, 30) }, end: { dateTime: at(13, 30) }, location: "Café" },
    { id: "e3", summary: "Gym", start: { dateTime: at(18, 0) }, end: { dateTime: at(19, 0) } },
  ],
};

export const weekCalendar: EventsResult = {
  ok: true,
  events: [
    ...todayCalendar.events,
    { id: "e4", summary: "Dentist", start: { dateTime: at(10, 0, 2) }, end: { dateTime: at(10, 30, 2) } },
    { id: "e5", summary: "Team offsite", start: { date: ymd(3) }, end: { date: ymd(4) } },
  ],
};

export const selectedCalendarIds = ["primary"];
export const repoVisibleIds: string[] = [];

export const organizations: Organization[] = [{
  id: "org-acme", user_id: UID, name: "Acme s.r.o.", type: "client",
  website: "https://example.com", logo_url: null, email: "hello@example.com",
  phone: null, address: null, city: "Prague", zip: null, country: "CZ",
  company_id: "87654321", vat_id: "CZ87654321", notes: "Retained product client.",
  status: "active", created_at: TS, updated_at: TS,
}];

export const opportunities: ClientOpportunity[] = [{
  id: "opp-1", user_id: UID, organization_id: "org-acme", project_id: null,
  source: "tugedr", source_url: "https://tugedr.com", title: "Acme customer portal",
  description: "Discovery and implementation of a self-service portal.", status: "proposal_sent",
  budget_min: 90000, budget_max: 140000, currency: "CZK", rate_type: "fixed",
  deadline: ymd(30), next_follow_up_at: at(9, 0, 1), contact_name: "Eva",
  contact_email: "eva@example.com", notes: "", won_at: null, lost_at: null,
  created_at: TS, updated_at: TS,
}];

export const inboxItems: InboxItem[] = [{
  id: "inbox-1", user_id: UID, source_type: "manual", source_id: null,
  title: "Review Acme analytics request", summary: "Decide whether this belongs in the current scope.",
  payload: {}, suggested_destination: "task", status: "pending", snoozed_until: null,
  processed_at: null, created_at: TS, updated_at: TS,
}];

export const weeklyReviews: WeeklyReview[] = [];

export const notifications: AppNotification[] = [{
  id: "notice-1", user_id: UID, kind: "follow_up_due", source_type: "client_opportunity",
  source_id: "opp-1", title: "Acme follow-up is due tomorrow", body: "Review the proposal before contacting Eva.",
  action_url: "/opportunities", read_at: null, dismissed_at: null, snoozed_until: null, created_at: TS,
}];

export const jobListings: JobListing[] = [
  {
    id: "job-1",
    source: "startupjobs",
    external_id: "102781",
    title: "Senior Frontend Engineer (React)",
    company: "Ecomail.cz",
    url: "https://www.startupjobs.cz/nabidka/102781/senior-frontend-engineer",
    location: "Praha",
    role: "frontend",
    remote: true,
    salary: "90 000 – 120 000 Kč",
    tags: ["react", "typescript"],
    seniority: "senior",
    description:
      "Build our marketing platform's UI with React, TypeScript and Next.js. Tailwind, testing with Playwright. GraphQL a plus.",
    posted_at: TS,
    first_seen_at: TS,
    last_seen_at: TS,
  },
  {
    id: "job-2",
    source: "remotive",
    external_id: "2091062",
    title: "Product Engineer (Fullstack)",
    company: "Clipster",
    url: "https://remotive.com/remote-jobs/software-development/x",
    location: "Europe, UK",
    role: "fullstack",
    remote: true,
    salary: null,
    tags: ["golang", "react"],
    seniority: null,
    description:
      "Join a small team shipping a Go backend with a React frontend. Experience with AWS and Docker required.",
    posted_at: TS,
    first_seen_at: TS,
    last_seen_at: TS,
  },
];

export const jobUserStates: JobUserState[] = [];

export const jobApplications: JobApplication[] = [
  {
    id: "app-1",
    user_id: UID,
    listing_id: "job-2",
    title: "Product Engineer (Fullstack)",
    company: "Clipster",
    url: "https://remotive.com/remote-jobs/software-development/x",
    source: "remotive",
    location: "Europe, UK",
    cover_letter: "Dear team, …",
    status: "applied",
    applied_on: ymd(0),
    notes: null,
    created_at: TS,
    updated_at: TS,
  },
];

export const jobApplicationEvents: JobApplicationEvent[] = [
  {
    id: "appev-1",
    user_id: UID,
    application_id: "app-1",
    kind: "applied",
    detail: null,
    created_at: TS,
  },
];

export const coverLetterTemplates: CoverLetterTemplate[] = [
  {
    id: "tpl-1",
    user_id: UID,
    name: "Frontend — English",
    body: "Dear Hiring Manager,\n\nI am applying for {{position}} at {{company}}.",
    created_at: TS,
    updated_at: TS,
  },
];

export const jobLastRun: JobScrapeRun = {
  id: "run-1",
  started_at: TS,
  finished_at: TS,
  ok: true,
  inserted: 2,
  refreshed: 14,
  pruned: 3,
  // Covers every branch the sources panel renders: healthy boards, boards that
  // removed filled offers, and one that failed.
  sources: {
    startupjobs: { count: 6, pruned: 1 },
    jobscz: { count: 4 },
    pracecz: { count: 3, pruned: 1 },
    remoteok: { count: 9, pruned: 1 },
    remotive: { count: 5 },
    arbeitnow: { count: 2 },
    jobicy: { count: 0, error: "jobicy.com responded 503" },
    weworkremotely: { count: 3 },
  },
};
