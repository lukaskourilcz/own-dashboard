export type Subscription = {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  currency: string;
  billing_cycle: "monthly" | "yearly" | "weekly";
  category: string | null;
  next_billing_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Todo = {
  id: string;
  user_id: string;
  title: string;
  done: boolean;
  due_date: string | null;
  created_at: string;
};

export type Streak = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  reminder_time: string | null;
  created_at: string;
};

export type StreakLog = {
  id: string;
  streak_id: string;
  user_id: string;
  log_date: string;
  created_at: string;
};

export type Account = {
  id: string;
  user_id: string;
  name: string;
  balance: number;
  currency: string;
  created_at: string;
  updated_at: string;
};

export type Transaction = {
  id: string;
  user_id: string;
  account_id: string | null;
  kind: "income" | "expense";
  amount: number;
  currency: string;
  category: string | null;
  note: string | null;
  occurred_on: string;
  created_at: string;
};

export type PlanStatus = "idea" | "active" | "done" | "dropped";

export type Plan = {
  id: string;
  user_id: string;
  title: string;
  target_date: string | null;
  status: PlanStatus;
  notes: string | null;
  linked_calendar_event_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  updated_at: string;
};

export type Couple = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
};

export type InviteStatus = "pending" | "accepted" | "declined";

export type CoupleInvite = {
  id: string;
  inviter_id: string;
  invitee_email: string;
  status: InviteStatus;
  created_at: string;
};

export type SharingCategory =
  | "subscriptions"
  | "todos"
  | "streaks"
  | "finances"
  | "plans"
  | "books";

export type SharingPrefs = {
  user_id: string;
  share_subscriptions: boolean;
  share_todos: boolean;
  share_streaks: boolean;
  share_finances: boolean;
  share_plans: boolean;
  share_books: boolean;
  updated_at: string;
};

export type BookStatus = "active" | "done" | "paused";

export type Book = {
  id: string;
  couple_id: string | null;
  user_id: string;
  title: string;
  target_pages: number | null;
  status: BookStatus;
  started_on: string | null;
  created_at: string;
};

export type BookPage = {
  id: string;
  book_id: string;
  user_id: string;
  log_date: string;
  pages: number;
  note: string | null;
  created_at: string;
};
