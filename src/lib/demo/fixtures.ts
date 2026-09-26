/**
 * Deterministic demo data for the two fixture-backed dashboard surfaces:
 * `/dev-preview` (development and E2E only) and `/guest` (the public read-only
 * tour). Dates are computed relative to "now" so the hero, "due today",
 * upcoming dates, and charts all populate with lifelike content.
 *
 * Every person, company, address and bank detail here is invented: "Jan Novák"
 * and `example.com` are placeholders, "Acme s.r.o." is a stand-in client, and
 * the IBAN is the documentation example value. The repository names are public
 * GitHub repositories; a private repository, or the registry entry of a
 * product the owner has not announced, never belongs here. Each project
 * carries its own invented summary because the preview does not fall back to
 * the portfolio registry. Nothing in this file is owner data, which is what
 * makes `/guest` safe to serve publicly — keep it that way when editing.
 */
import type {
  Account,
  AppNotification,
  ClientOpportunity,
  AiCategory,
  AiLink,
  Competitor,
  CoverLetterTemplate,
  Cron,
  ImportantDate,
  Invoice,
  InvoiceItem,
  InvoiceSettings,
  JobApplication,
  SavedJobPosition,
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
  ProjectLink,
  Prompt,
  PromptLink,
  ReferenceRow,
  RepoLink,
  RepoNote,
  Shortcut,
  Subscription,
  SubscriptionAllocation,
  Todo,
  Tool,
  Transaction,
  InboxItem,
  WeeklyReview,
} from "@/lib/types";
import type { EventsResult } from "@/lib/calendar";
import { parseDateOnly, previousMondayKey } from "@/lib/date-keys";
import { mergeDetectedTools, toolKey, type DetectedToolsResponse, type ProjectStack, type StackEntry } from "@/lib/stack-detection";

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
  { id: "s4", user_id: UID, name: "Figma", amount: 1440, currency: "CZK", billing_cycle: "yearly", category: "Work", category_group: "development", importance: "useful", next_billing_date: ymd(120), is_active: true, created_at: TS, updated_at: TS, started_on: ymd(-245), plan: "Professional", notes: "" },
  { id: "s5", user_id: UID, name: "Vercel", amount: 20, currency: "USD", billing_cycle: "monthly", category: "Hosting", category_group: "development", importance: "essential", next_billing_date: ymd(12), is_active: true, created_at: TS, updated_at: TS, started_on: ymd(-60), plan: "Pro", vendor_url: "https://vercel.com", notes: "Shared by every deployed project.", amount_confirmed_on: ymd(-18) },
  { id: "s6", user_id: UID, name: "Supabase", amount: 25, currency: "USD", billing_cycle: "monthly", category: "Database", category_group: "development", importance: "essential", next_billing_date: ymd(12), is_active: true, created_at: TS, updated_at: TS, started_on: ymd(-60), plan: "Pro", notes: "", amount_confirmed_on: ymd(-47) },
  { id: "s7", user_id: UID, name: "Mobbin", amount: 45, currency: "USD", billing_cycle: "quarterly", category: "Design research", category_group: "development", importance: "useful", next_billing_date: ymd(70), is_active: true, created_at: TS, updated_at: TS, started_on: ymd(-20), plan: "Pro", notes: "Quarterly invoice; the amount comes from the renewal notice, not from the receipt." },
  { id: "s8", user_id: UID, name: "UptimeRobot", amount: 9.68, currency: "EUR", billing_cycle: "monthly", category: "Monitoring", category_group: "development", importance: "optional", next_billing_date: null, is_active: false, created_at: TS, updated_at: TS, started_on: ymd(-120), ended_on: ymd(-19), plan: "Solo", notes: "Downgraded to the free plan." },
];

export const subscriptionAllocations: SubscriptionAllocation[] = [
  { id: "sa1", user_id: UID, subscription_id: "s5", project_id: "proj-dneskai", share: 0.4, note: "", created_at: TS, updated_at: TS },
  { id: "sa2", user_id: UID, subscription_id: "s5", project_id: "proj-dashboard", share: 0.3, note: "", created_at: TS, updated_at: TS },
  { id: "sa3", user_id: UID, subscription_id: "s5", project_id: "proj-acme-portal", share: 0.3, note: "", created_at: TS, updated_at: TS },
  { id: "sa4", user_id: UID, subscription_id: "s6", project_id: "proj-dashboard", share: 0.5, note: "", created_at: TS, updated_at: TS },
  { id: "sa5", user_id: UID, subscription_id: "s6", project_id: "proj-acme-portal", share: 0.5, note: "", created_at: TS, updated_at: TS },
  { id: "sa6", user_id: UID, subscription_id: "s7", project_id: "proj-design-lab", share: 1, note: "", created_at: TS, updated_at: TS },
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
  { id: "t8", user_id: UID, title: "Verify project deployment", done: false, due_date: ymd(1), category: "DNESKAi", created_at: at(9, 0, -4), ...MANUAL, importance: 4, project_id: "proj-dneskai", is_global: false },
  { id: "t9", user_id: UID, title: "Review dashboard accessibility report", done: false, due_date: ymd(3), category: "own-dashboard", created_at: at(10, 0, -3), ...MANUAL, importance: 2, project_id: "proj-dashboard", is_global: false },
  { id: "t10", user_id: UID, title: "Review the ingestion retry policy", done: false, due_date: ymd(4), category: "DNESKAi", created_at: at(11, 0, -5), ...MANUAL, importance: 3, project_id: "proj-dneskai", is_global: false },
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
  { id: "tx7", user_id: UID, account_id: "a1", kind: "expense", amount: 24.2, currency: "USD", category: "Development", note: "Vercel Pro invoice", occurred_on: ymd(-48), external_id: null, created_at: TS, subscription_id: "s5" },
  { id: "tx8", user_id: UID, account_id: "a1", kind: "expense", amount: 65.48, currency: "USD", category: "Development", note: "Vercel Pro + usage invoice", occurred_on: ymd(-18), external_id: null, created_at: TS, subscription_id: "s5" },
  { id: "tx9", user_id: UID, account_id: "a1", kind: "expense", amount: 25, currency: "USD", category: "Development", note: "Supabase Pro invoice", occurred_on: ymd(-47), external_id: null, created_at: TS, subscription_id: "s6" },
  { id: "tx10", user_id: UID, account_id: "a1", kind: "expense", amount: 10, currency: "USD", category: "Development", note: "fal.ai credit top-up", occurred_on: ymd(-30), external_id: null, created_at: TS, project_id: "proj-boardlessai" },
  // Two leftovers for the unmatched-payments card, each a real reason rather
  // than a filler row: the first quotes invoice 2026001 but is 85 CZK short of
  // its 38 115 CZK total, the second quotes a symbol no open invoice asks for.
  { id: "tx11", user_id: UID, account_id: "a1", kind: "income", amount: 38030, currency: "CZK", category: null, note: "Platba VS 2026001", occurred_on: ymd(-2), external_id: null, created_at: TS, variable_symbol: "2026001" },
  { id: "tx12", user_id: UID, account_id: "a1", kind: "income", amount: 12000, currency: "CZK", category: null, note: "Úhrada VS 2025044", occurred_on: ymd(-1), external_id: null, created_at: TS, variable_symbol: "2025044" },
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
  { id: "pr1", user_id: UID, kind: "audit", name: "Code review", description: "Reviews a pull request for correctness, security, and clarity.", body: "Review this pull request for correctness, security, and clarity. Flag risky changes and suggest concrete fixes with short examples.", created_at: TS, updated_at: TS },
  { id: "pr2", user_id: UID, kind: "documentation", name: "Commit message", description: "Writes a conventional-commit message from the staged diff.", body: "Write a concise conventional-commit message for the staged diff. Imperative mood, a short subject, then a body explaining why.", created_at: TS, updated_at: TS },
  { id: "pr3", user_id: UID, kind: "analysis", name: "Explain code", description: "Explains a function step by step and lists its edge cases.", body: "Explain what this function does step by step, then list its edge cases and one way it could break.", created_at: TS, updated_at: TS },
  { id: "pr4", user_id: UID, kind: "seo", project_id: "proj-dneskai", is_public: true, name: "SEO check", description: "Checks indexing, metadata, structured data and Core Web Vitals.", body: "Run an SEO check of {{project.name}} at {{project.url}}. The code is in {{project.repo}}.\n\nCheck indexing, titles, structured data and Core Web Vitals. Use the tools under \"Links to consult\" and quote what each reported.", created_at: TS, updated_at: TS },
  { id: "pr5", user_id: UID, kind: "marketing", is_public: true, name: "Launch announcement", description: "Writes a short, factual launch post for each channel.", body: "Write a launch announcement for {{project.name}} ({{project.url}}). Lead with what the user can now do.", created_at: TS, updated_at: TS },
];

// The links a prompt tells an agent to open.
export const promptLinks: PromptLink[] = [
  { id: "prl1", user_id: UID, prompt_id: "pr4", ai_link_id: "al7", note: "Run it on the Today page first.", sort_order: 0, created_at: TS, updated_at: TS },
  { id: "prl2", user_id: UID, prompt_id: "pr1", ai_link_id: "al2", note: "Check leaked credentials.", sort_order: 0, created_at: TS, updated_at: TS },
];

// Repo notes attach to live GitHub repos, which aren't available in the
// auth-less preview (the Repos panel shows the Connect CTA), so this stays empty.
export const repoNotes: RepoNote[] = [];
export const repoLinks: RepoLink[] = [];

export const projects: Project[] = [
  {
    id: "proj-dneskai",
    user_id: "u1",
    name: "DNESKAi",
    summary: "Daily reader for the AI and technology news that mattered.",
    slug: "dneskai",
    previous_slugs: ["aifirst"],
    repo_full_name: "lukaskourilcz/aifirst",
    repo_id: 1003,
    previous_repo_full_names: [],
    engagement: "own",
    portfolio_key: "aifirst",
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
    summary: "The operating dashboard this tour shows.",
    slug: "own-dashboard",
    repo_full_name: "lukaskourilcz/own-dashboard",
    repo_id: 1001,
    previous_repo_full_names: [],
    engagement: "own",
    portfolio_key: "own-dashboard",
    url: null,
    notes: "",
    color: null,
    sort_order: 1,
    is_active: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "proj-devshark",
    user_id: "u1",
    name: "devShark",
    summary: "Developer-learning product with coding tasks graded on the server.",
    slug: "devshark",
    previous_slugs: ["react-express-app"],
    repo_full_name: "lukaskourilcz/react-express-app",
    repo_id: 1002,
    previous_repo_full_names: [],
    engagement: "own",
    portfolio_key: "react-express-app",
    url: null,
    notes: "Developer-learning product.",
    color: null,
    sort_order: 2,
    is_active: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "proj-boardlessai",
    user_id: "u1",
    name: "boardlessAI",
    summary: "Agent council that runs a small venture portfolio in git.",
    slug: "boardlessai",
    previous_slugs: ["quorum"],
    repo_full_name: "lukaskourilcz/quorum",
    repo_id: 1004,
    previous_repo_full_names: [],
    engagement: "own",
    portfolio_key: "quorum",
    url: null,
    notes: "",
    color: null,
    sort_order: 3,
    is_active: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  // Venture subsections: listed under boardlessAI, not on their own rows.
  {
    id: "proj-design-lab",
    user_id: "u1",
    name: "Design Lab",
    summary: "Layout renderer for the portfolio magazines' carousels and covers.",
    slug: "design-lab",
    repo_full_name: null,
    engagement: "own",
    parent_id: "proj-boardlessai",
    portfolio_key: "quorum-design-lab",
    url: null,
    notes: "",
    color: null,
    sort_order: 4,
    is_active: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "proj-goviral",
    user_id: "u1",
    name: "GoVIRAL",
    summary: "Weekly trend brief for the portfolio's ventures.",
    slug: "goviral",
    repo_full_name: null,
    engagement: "own",
    parent_id: "proj-boardlessai",
    portfolio_key: "quorum-goviral",
    url: null,
    notes: "",
    color: null,
    sort_order: 5,
    is_active: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  // An invented own product with no registry key and no repository: the
  // public tour shows no project the owner has not published.
  {
    id: "proj-recipe-box",
    user_id: "u1",
    name: "Recipe box app",
    slug: "recipe-box",
    repo_full_name: null,
    engagement: "own",
    summary: "Offline recipe collection with weekly shopping lists.",
    url: null,
    notes: "",
    color: null,
    sort_order: 6,
    is_active: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  // Freelance client work. The names are invented stand-ins, like Acme s.r.o.
  {
    id: "proj-acme-portal",
    user_id: "u1",
    name: "Acme customer portal",
    summary: "Customer portal for Acme's service team.",
    slug: "acme-portal",
    repo_full_name: null,
    engagement: "client",
    organization_id: "org-acme",
    url: null,
    notes: "",
    color: null,
    sort_order: 7,
    is_active: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "proj-harbor-bakery",
    user_id: "u1",
    name: "Harbor Bakery website",
    summary: "Ordering website for a neighbourhood bakery.",
    slug: "harbor-bakery",
    repo_full_name: null,
    engagement: "client",
    url: null,
    notes: "",
    color: null,
    sort_order: 8,
    is_active: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
];

export const competitors: Competitor[] = [
  {
    id: "comp-1", user_id: UID, project_id: "proj-dneskai", name: "TLDR AI", url: "https://tldr.tech/ai",
    summary: "Daily AI newsletter with three-sentence summaries and a sponsor slot at the top.",
    category: "direct", useful_features: ["Fixed section order every day", "Sponsor slot above the fold", "Public archive per issue"],
    social_content: "Posts one headline per day on X and LinkedIn linking back to the issue.",
    pricing_model: "Free for readers; sponsorship sold per send.", lessons: "Keep the daily structure identical so readers scan faster.",
    relevance_score: 5, score_rationale: "Closest format match for a daily briefing.", social_links: ["https://x.com/tldrnewsletter"], source_urls: ["https://tldr.tech/ai"],
    reviewed_at: ymd(-3), sort_order: 0, created_at: TS, updated_at: TS,
  },
  {
    id: "comp-2", user_id: UID, project_id: "proj-goviral", name: "Exploding Topics", url: "https://explodingtopics.com",
    summary: "Trend database that scores topic growth before it peaks.",
    category: "inspiration", useful_features: ["Growth percentage per topic", "Category filters", "Weekly trend email"],
    social_content: "Weekly newsletter plus short trend threads on X.", pricing_model: "Free browse; Pro from $39 per month.", lessons: "Show a growth number next to every trend, not just a name.",
    relevance_score: 4, score_rationale: "Trend scoring is the part GoVIRAL wants.", social_links: [], source_urls: ["https://explodingtopics.com/pro"],
    // Deliberately past the 90-day freshness marker so the preview shows one
    // fresh and one "needs refresh" competitor without adding a row.
    reviewed_at: ymd(-200), sort_order: 0, created_at: TS, updated_at: TS,
  },
];

export const projectCommunications: ProjectCommunication[] = [
  {
    id: "comm-1",
    user_id: UID,
    project_id: "proj-dneskai",
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

export const projectCosts: ProjectCost[] = [
  {
    id: "pc-1",
    user_id: "u1",
    project_id: "proj-dneskai",
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
    project_id: "proj-dneskai",
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
    project_id: "proj-dneskai",
    name: "Daily article generation",
    schedule: "0 6 * * *",
    description: "Scrape, curate, write + illustrate the daily issue.",
    endpoint: "/api/cron/generate-daily",
    is_ai_call: true,
    cost_per_run: 0.35,
    currency: "USD",
    runs_per_month: 30,
    enabled: true,
    last_run_at: at(6, 2),
    // Invented push-monitor URL; the demo cron reports on time so the tour
    // shows the healthy heartbeat state rather than an alarm.
    heartbeat_url: "https://uptime.example.com/api/push/demo",
    last_success_at: at(6, 2),
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
  { id: "ac4", user_id: UID, name: "HOSTING", sort_order: 4, created_at: TS },
  { id: "ac5", user_id: UID, name: "SEO", sort_order: 5, created_at: TS },
  { id: "ac6", user_id: UID, name: "DATABASE", sort_order: 6, created_at: TS },
];

export const aiLinks: AiLink[] = [
  { id: "al1", user_id: UID, category_id: "ac1", title: "Midjourney", url: "https://www.midjourney.com", description: "AI image generation for moodboards and concepts.", pricing: "paid", created_at: TS, updated_at: TS },
  { id: "al2", user_id: UID, category_id: "ac2", title: "Have I Been Pwned", url: "https://haveibeenpwned.com", description: "Check if credentials appeared in a breach.", pricing: "free", created_at: TS, updated_at: TS },
  { id: "al4", user_id: UID, category_id: "ac4", title: "Vercel", url: "https://vercel.com", description: "Hosting for Next.js and static sites with preview deployments.", pricing: "freemium", created_at: TS, updated_at: TS },
  { id: "al5", user_id: UID, category_id: "ac6", title: "Supabase", url: "https://supabase.com", description: "Postgres, Auth and row-level security as a managed service.", pricing: "freemium", created_at: TS, updated_at: TS },
  { id: "al6", user_id: UID, category_id: "ac5", title: "Google Search Console", url: "https://search.google.com/search-console", description: "Indexing, search queries and structured-data reports for a site.", pricing: "free", created_at: TS, updated_at: TS },
  { id: "al7", user_id: UID, category_id: "ac5", title: "PageSpeed Insights", url: "https://pagespeed.web.dev", description: "Core Web Vitals and Lighthouse checks for one URL.", pricing: "free", created_at: TS, updated_at: TS },
  { id: "al8", user_id: UID, category_id: "ac1", title: "Figma", url: "https://www.figma.com", description: "Interface design and prototyping.", pricing: "freemium", created_at: TS, updated_at: TS },
  { id: "al3", user_id: UID, category_id: null, title: "Hugging Face", url: "https://huggingface.co", description: "Open models, datasets, and demos.\n\nExample library note: compare a small prototype with the production requirements before adopting a new service, including the expected traffic, maintenance work, accessibility and the time needed to move away from it later.\n\nPricing: the free offering has limits, while compute and other services may be billed separately.\n\nExample reference: https://example.com/resources/a-long-reference-path-for-checking-readable-expanded-library-cards-on-narrow-screens", pricing: "freemium", created_at: TS, updated_at: TS },
  // IG TIPS: invented tips stored as idea records, like the owner's. The
  // Instagram addresses are placeholders. tip5 is left without a group or a
  // summary to show the fallbacks; tip2 carries a long title and summary.
  {
    id: "tip1", user_id: UID, category_id: "ac3", record_type: "idea", title: "Plan a month of posts around two topics",
    url: "https://www.instagram.com/p/EXAMPLE0001/", pricing: "free", created_at: TS, updated_at: TS,
    description: "Reel notes: outlining a month in one sitting kept a small account posting every week. The creator's follower numbers are not verified.",
    tip_group: "content",
    tip_summary: "Pick two topics your audience keeps asking about and outline a month of posts in one sitting. Record short examples from work you are doing anyway, so every post shows something real. Judge the plan by the enquiries it brings, not by views, before posting more often.",
    usefulness_rating: 4, rating_rationale: "A cheap habit with a clear measure.",
    project_relevance: [{ repository: "own-dashboard", reason: "Plan the build-in-public posts." }],
    source_urls: ["https://www.instagram.com/p/EXAMPLE0001/"],
  },
  {
    id: "tip2", user_id: UID, category_id: "ac3", record_type: "idea",
    title: "Design every carousel at the 4:5 portrait ratio and keep that one ratio for every slide of the post",
    url: "https://example.com/guides/carousel-sizes", pricing: null, created_at: TS, updated_at: TS,
    description: "Platform guide notes: one orientation applies to every slide; 1080 × 1350 is the recommended portrait size.",
    tip_group: "formats",
    tip_summary: "Instagram applies one orientation to every slide of a carousel, so a deck that mixes square and portrait slides gets cropped. Design at 1080 × 1350 pixels and make a square version only when a layout really needs one. Check the ratio before exporting, because a crop you notice after posting cannot be fixed without deleting the post. The same pages can go to LinkedIn as a PDF document.",
    source_urls: ["https://example.com/guides/carousel-sizes"],
  },
  {
    id: "tip3", user_id: UID, category_id: null, record_type: "idea", title: "Make the profile say what you offer and what to do next",
    url: "https://www.instagram.com/p/EXAMPLE0002/", pricing: "free", created_at: TS, updated_at: TS,
    description: "Reel notes: name, bio and pinned posts should answer offer, proof and next step.",
    tip_group: "reach",
    tip_summary: "Put your service and a searchable specialty in the name and bio, say who you help and with what result, and give one clear next step. Pin three posts: what you offer, a work story and real proof. Measure visits from the profile to your site rather than the creator's claims.",
    source_urls: ["https://www.instagram.com/p/EXAMPLE0002/", "https://www.instagram.com/p/EXAMPLE0003/"],
  },
  {
    id: "tip4", user_id: UID, category_id: "ac3", record_type: "idea", title: "Reward readers who bring a friend",
    url: "https://example.com/newsletters/referrals", pricing: null, created_at: TS, updated_at: TS,
    description: "Newsletter research: a referral perk grew lists more cheaply than a paid tier.",
    tip_group: "growth",
    tip_summary: "Give readers a real perk, such as early delivery or an ad-free edition, when a friend they invite subscribes. It only works once there is an email list, so start it after the newsletter launch.",
    rating_rationale: "Grows the list that sponsors and donations both depend on.",
  },
  {
    id: "tip5", user_id: UID, category_id: null, record_type: "idea", title: "Check a free resource before relying on it",
    url: "https://www.instagram.com/p/EXAMPLE0004/", pricing: "free", created_at: TS, updated_at: TS,
    description: "Open the provider's own page, tell a free resource from a trial or a paid export, and note the date you checked.",
  },
];

// Links the fixture projects really use. role "tool" rows double as the
// Tools section's per-project notes.
export const projectLinks: ProjectLink[] = [
  { id: "pl1", user_id: UID, project_id: "proj-dneskai", ai_link_id: "al6", role: "uses", note: "Checks that each daily edition is indexed.", sort_order: 0, created_at: TS, updated_at: TS },
  { id: "pl2", user_id: UID, project_id: "proj-dneskai", ai_link_id: "al7", role: "reference", note: "Core Web Vitals for the Today page.", sort_order: 1, created_at: TS, updated_at: TS },
  { id: "pl3", user_id: UID, project_id: "proj-dneskai", ai_link_id: "al4", role: "tool", note: "Hosts the static magazine.", sort_order: 2, created_at: TS, updated_at: TS },
  { id: "pl4", user_id: UID, project_id: "proj-devshark", ai_link_id: "al4", role: "tool", note: "Hosts the React client and the twelve API handlers.", sort_order: 0, created_at: TS, updated_at: TS },
  { id: "pl5", user_id: UID, project_id: "proj-dashboard", ai_link_id: "al5", role: "tool", note: "Stores every record behind own-only RLS.", sort_order: 0, created_at: TS, updated_at: TS },
  // IG tips a project uses.
  { id: "pl6", user_id: UID, project_id: "proj-dashboard", ai_link_id: "tip1", role: "reference", note: "Plan the build-in-public posts.", sort_order: 1, created_at: TS, updated_at: TS },
  { id: "pl7", user_id: UID, project_id: "proj-dneskai", ai_link_id: "tip4", role: "reference", note: "A perk for readers who invite a friend.", sort_order: 3, created_at: TS, updated_at: TS },
];

// Three tools: two in use across projects, one on trial with a
// subscription that supplies its monthly cost.
export const tools: Tool[] = [
  { id: "tool-vercel", user_id: UID, ai_link_id: "al4", name: null, what_it_does: "Builds and hosts the web apps with preview deployments.", status: "in_use", subscription_id: null, created_at: TS, updated_at: TS },
  { id: "tool-supabase", user_id: UID, ai_link_id: "al5", name: null, what_it_does: "Postgres database, Auth and row-level security.", status: "in_use", subscription_id: null, created_at: TS, updated_at: TS },
  { id: "tool-figma", user_id: UID, ai_link_id: "al8", name: null, what_it_does: "Screen designs and design-system components.", status: "trial", subscription_id: "s4", created_at: TS, updated_at: TS },
];

// What the Tools section finds in the fixture projects' repositories: a
// short, invented stack per project, merged by the same code the live route
// uses. Vercel and Supabase match hand-added tools above, so they appear on
// those cards instead of twice. DNESKAi shows the package.json fallback, and
// its `next` package merges with the "Next.js" the other projects name.
const stack = (...items: [name: string, whatItDoes: string][]): StackEntry[] =>
  items.map(([name, whatItDoes]) => ({ name, key: toolKey(name), whatItDoes, specificity: 1 }));

const fixtureStacks: ProjectStack[] = [
  { project: { id: "proj-dneskai", name: "DNESKAi" }, source: "package-json", entries: stack(["next", ""], ["react", ""], ["sharp", ""]) },
  {
    project: { id: "proj-dashboard", name: "own-dashboard" },
    source: "about-project",
    entries: stack(
      ["Next.js", "The app shell and its API routes"],
      ["Supabase", "Database, sign-in and row-level security"],
      ["TanStack Query", "The client-side data cache"],
      ["Vercel", "Hosting and the scheduled jobs"],
      ["Sentry", "Error monitoring"],
    ),
  },
  {
    project: { id: "proj-devshark", name: "devShark" },
    source: "about-project",
    entries: stack(
      ["React", "The learning client"],
      ["Vite", "Builds the client"],
      ["Supabase", "Scores and grading on the server"],
      ["Stripe", "Optional support payments"],
    ),
  },
  {
    project: { id: "proj-boardlessai", name: "boardlessAI" },
    source: "about-project",
    entries: stack(["Next.js", "The public site and the admin"], ["Vercel", "Hosting"], ["Resend", "The daily summary email"]),
  },
];

export const detectedTools: DetectedToolsResponse = {
  connected: true,
  checkedAt: TS,
  projects: [
    { projectId: "proj-dneskai", projectName: "DNESKAi", repo: "lukaskourilcz/aifirst", status: "ok", source: "package-json", toolCount: 3 },
    { projectId: "proj-dashboard", projectName: "own-dashboard", repo: "lukaskourilcz/own-dashboard", status: "ok", source: "about-project", toolCount: 5 },
    { projectId: "proj-devshark", projectName: "devShark", repo: "lukaskourilcz/react-express-app", status: "ok", source: "about-project", toolCount: 4 },
    { projectId: "proj-boardlessai", projectName: "boardlessAI", repo: "lukaskourilcz/quorum", status: "ok", source: "about-project", toolCount: 3 },
    { projectId: "proj-design-lab", projectName: "Design Lab", repo: null, status: "inherited", source: null, toolCount: 0, parentName: "boardlessAI" },
    { projectId: "proj-goviral", projectName: "GoVIRAL", repo: null, status: "inherited", source: null, toolCount: 0, parentName: "boardlessAI" },
    { projectId: "proj-recipe-box", projectName: "Recipe box app", repo: null, status: "no-repository", source: null, toolCount: 0 },
    { projectId: "proj-acme-portal", projectName: "Acme customer portal", repo: null, status: "no-repository", source: null, toolCount: 0 },
    { projectId: "proj-harbor-bakery", projectName: "Harbor Bakery website", repo: null, status: "no-repository", source: null, toolCount: 0 },
  ],
  tools: mergeDetectedTools(fixtureStacks),
};

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
    buyer_country: "CZ", buyer_ico: "12345679", buyer_dic: "CZ12345679",
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

/**
 * Last week's calendar for the weekly planning flow, anchored on the previous
 * Monday rather than on a fixed date so the preview always has a finished week
 * to measure. One event names the fixture client, one names a fixture project
 * and one names neither, so each channel is non-zero and the unmatched count is
 * honest rather than decorative.
 */
function lastWeekAt(dayOffset: number, hour: number, minute = 0): string {
  const day = parseDateOnly(previousMondayKey(NOW));
  day.setDate(day.getDate() + dayOffset);
  day.setHours(hour, minute, 0, 0);
  return day.toISOString();
}

export const lastWeekCalendar: EventsResult = {
  ok: true,
  events: [
    { id: "lw1", summary: "Acme portal review", start: { dateTime: lastWeekAt(0, 10) }, end: { dateTime: lastWeekAt(0, 11, 30) } },
    { id: "lw2", summary: "aifirst release check", start: { dateTime: lastWeekAt(1, 9) }, end: { dateTime: lastWeekAt(1, 10) } },
    { id: "lw3", summary: "Invoices and inbox", start: { dateTime: lastWeekAt(2, 8, 30) }, end: { dateTime: lastWeekAt(2, 9, 15) } },
    { id: "lw4", summary: "Conference", start: { date: previousMondayKey(NOW) }, end: { date: previousMondayKey(NOW) } },
  ],
};

export const selectedCalendarIds = ["primary"];
export const repoVisibleIds: string[] = [];

export const organizations: Organization[] = [{
  id: "org-acme", user_id: UID, name: "Acme s.r.o.", type: "client",
  website: "https://example.com", logo_url: null, email: "hello@example.com",
  phone: null, address: null, city: "Prague", zip: null, country: "CZ",
  // A checksum-valid placeholder IČO so the preview shows the registry actions
  // in their normal state rather than the invalid-number warning.
  company_id: "12345679", vat_id: "CZ12345679", notes: "Retained product client.",
  status: "active", ares_verified_at: TS, vat_verification_status: "valid",
  vat_verified_at: TS, vat_verified_id: "CZ12345679", vat_verified_name: "Acme s.r.o.",
  vat_verified_address: "Na Příkopě 1, 110 00 Praha 1",
  created_at: TS, updated_at: TS,
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

/**
 * One completed review, dated so the Work overview's "Shipped since last
 * review" block has a window to measure from. The week is a fixed date rather
 * than a relative one because the changelog it is compared against carries
 * fixed dates too — a relative week would drift past the newest entry and turn
 * the block into its empty state.
 */
export const weeklyReviews: WeeklyReview[] = [{
  id: "review-1", user_id: UID, week_start: "2026-09-07", status: "completed",
  items: {
    facts: ["Acme portal discovery finished", "Two invoices issued"],
    risks: ["Acme decision slipping past the deadline"],
    decisions: ["Keep the portal scope to self-service"],
    priorities: ["Send the Acme proposal follow-up"],
    followUps: ["Confirm the Acme contact for September"],
    sources: ["Discovery notes"],
    objectives: [
      { id: "obj-1", text: "Send the Acme proposal follow-up", done: true },
      { id: "obj-2", text: "Finish the invoice VAT review", done: false },
    ],
  },
  summary: "Send the Acme proposal follow-up",
  completed_at: TS, created_at: TS, updated_at: TS,
}];

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

export const savedJobPositions: SavedJobPosition[] = [{
  id: "00000000-0000-4000-8000-000000000099", user_id: UID, listing_id: null,
  title: "Frontend Engineer", company: "Example Studio", url: "https://example.com/careers/frontend",
  source: "manual", location: "Remote, Europe", description: "Build accessible React applications.",
  cover_letter: "Hello Example Studio team, this is a fictional preview letter.",
  cover_letter_url: "https://docs.google.com/document/d/example-preview-only/edit",
  readiness: "needs_review", notes: "Preview only. Check the posting before sending.", saved_at: TS, updated_at: TS,
}];

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
    contact_name: null,
    contact_email: null,
    created_at: TS,
    updated_at: TS,
  },
  // One fictional row per remaining stage board column, plus an overdue
  // follow-up, so the preview shows every column and the due state.
  {
    id: "app-2",
    user_id: UID,
    listing_id: null,
    title: "Senior React Engineer",
    company: "Harbour Systems",
    url: "https://example.com/careers/senior-react",
    source: "manual",
    location: "Prague",
    cover_letter: "Dear Example Studio team, …",
    status: "applied",
    applied_on: ymd(-18),
    notes: "Preview only. Asked about the team size; no answer yet.",
    contact_name: null,
    contact_email: null,
    next_follow_up_at: `${ymd(-3)}T09:00:00Z`,
    created_at: TS,
    updated_at: TS,
  },
  {
    id: "app-3",
    user_id: UID,
    listing_id: null,
    title: "Frontend Engineer",
    company: "Northwind Labs",
    url: null,
    source: "manual",
    location: "Remote, Europe",
    cover_letter: "",
    status: "interviewing",
    applied_on: ymd(-25),
    notes: "Preview only. Second round scheduled.",
    contact_name: "Preview Recruiter",
    contact_email: "careers@example.com",
    responded_on: ymd(-20),
    response_kind: "positive",
    next_follow_up_at: `${ymd(6)}T09:00:00Z`,
    created_at: TS,
    updated_at: TS,
  },
  {
    id: "app-4",
    user_id: UID,
    listing_id: null,
    title: "Product Engineer",
    company: "Meridian Tools",
    url: null,
    source: "manual",
    location: "Prague",
    cover_letter: "",
    status: "offer",
    applied_on: ymd(-40),
    notes: null,
    contact_name: null,
    contact_email: null,
    responded_on: ymd(-31),
    response_kind: "positive",
    created_at: TS,
    updated_at: TS,
  },
  {
    id: "app-5",
    user_id: UID,
    listing_id: null,
    title: "Fullstack Developer",
    company: "Atlas Retail",
    url: null,
    source: "manual",
    location: "Brno",
    cover_letter: "",
    status: "rejected",
    applied_on: ymd(-52),
    notes: null,
    contact_name: null,
    contact_email: null,
    responded_on: ymd(-44),
    response_kind: "negative",
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
  { id: "appev-2", user_id: UID, application_id: "app-2", kind: "applied", detail: null, created_at: TS },
  { id: "appev-3", user_id: UID, application_id: "app-3", kind: "applied", detail: null, created_at: TS },
  { id: "appev-4", user_id: UID, application_id: "app-3", kind: "status", detail: "interviewing", created_at: TS },
  { id: "appev-5", user_id: UID, application_id: "app-4", kind: "applied", detail: null, created_at: TS },
  { id: "appev-6", user_id: UID, application_id: "app-4", kind: "status", detail: "offer", created_at: TS },
  { id: "appev-7", user_id: UID, application_id: "app-5", kind: "applied", detail: null, created_at: TS },
  { id: "appev-8", user_id: UID, application_id: "app-5", kind: "status", detail: "rejected", created_at: TS },
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
