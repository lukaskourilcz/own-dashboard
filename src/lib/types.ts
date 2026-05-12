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
  created_at: string;
};

export type StreakLog = {
  id: string;
  streak_id: string;
  user_id: string;
  log_date: string;
  created_at: string;
};
