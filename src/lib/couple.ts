import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Couple,
  CoupleInvite,
  Profile,
  SharingCategory,
  SharingPrefs,
} from "@/lib/types";

export type CoupleContext = {
  couple: Couple | null;
  partnerId: string | null;
  partnerProfile: Profile | null;
  partnerPrefs: SharingPrefs | null;
  myPrefs: SharingPrefs;
  incomingInvites: CoupleInvite[];
  sentInvites: CoupleInvite[];
};

const DEFAULT_PREFS = (userId: string): SharingPrefs => ({
  user_id: userId,
  share_subscriptions: false,
  share_todos: false,
  share_streaks: false,
  share_finances: false,
  share_plans: false,
  share_books: true,
  updated_at: new Date().toISOString(),
});

export function partnerSharesCategory(
  prefs: SharingPrefs | null,
  category: SharingCategory,
): boolean {
  if (!prefs) return false;
  switch (category) {
    case "subscriptions":
      return prefs.share_subscriptions;
    case "todos":
      return prefs.share_todos;
    case "streaks":
      return prefs.share_streaks;
    case "finances":
      return prefs.share_finances;
    case "plans":
      return prefs.share_plans;
    case "books":
      return prefs.share_books;
  }
}

export async function loadCoupleContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  userEmail: string | null,
): Promise<CoupleContext> {
  const [coupleRes, prefsRes, incomingRes, sentRes] = await Promise.all([
    supabase
      .from("couples")
      .select("*")
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .maybeSingle(),
    supabase.from("sharing_prefs").select("*").eq("user_id", userId).maybeSingle(),
    userEmail
      ? supabase
          .from("couple_invites")
          .select("*")
          .ilike("invitee_email", userEmail)
          .eq("status", "pending")
      : Promise.resolve({ data: [] as CoupleInvite[] }),
    supabase
      .from("couple_invites")
      .select("*")
      .eq("inviter_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  const couple = (coupleRes.data ?? null) as Couple | null;
  const myPrefs = (prefsRes.data ?? DEFAULT_PREFS(userId)) as SharingPrefs;
  const incomingInvites = (incomingRes.data ?? []) as CoupleInvite[];
  const sentInvites = (sentRes.data ?? []) as CoupleInvite[];

  if (!couple) {
    return {
      couple: null,
      partnerId: null,
      partnerProfile: null,
      partnerPrefs: null,
      myPrefs,
      incomingInvites,
      sentInvites,
    };
  }

  const partnerId =
    couple.user_a_id === userId ? couple.user_b_id : couple.user_a_id;

  const [partnerProfileRes, partnerPrefsRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", partnerId).maybeSingle(),
    supabase
      .from("sharing_prefs")
      .select("*")
      .eq("user_id", partnerId)
      .maybeSingle(),
  ]);

  return {
    couple,
    partnerId,
    partnerProfile: (partnerProfileRes.data ?? null) as Profile | null,
    partnerPrefs: (partnerPrefsRes.data ?? null) as SharingPrefs | null,
    myPrefs,
    incomingInvites,
    sentInvites,
  };
}

export type PartnerData = {
  subscriptions: unknown[];
  todos: unknown[];
  streaks: unknown[];
  streakLogs: unknown[];
  plans: unknown[];
  accounts: unknown[];
  transactions: unknown[];
};

export async function loadPartnerSharedData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  partnerId: string,
  partnerPrefs: SharingPrefs | null,
): Promise<PartnerData> {
  const empty: PartnerData = {
    subscriptions: [],
    todos: [],
    streaks: [],
    streakLogs: [],
    plans: [],
    accounts: [],
    transactions: [],
  };
  if (!partnerPrefs) return empty;

  // Fire off only the queries the partner has actually opted in for. RLS will
  // also filter, but skipping the round-trips entirely is cheaper.
  const tasks = await Promise.all([
    partnerPrefs.share_subscriptions
      ? supabase
          .from("subscriptions")
          .select("*")
          .eq("user_id", partnerId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    partnerPrefs.share_todos
      ? supabase
          .from("todos")
          .select("*")
          .eq("user_id", partnerId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    partnerPrefs.share_streaks
      ? supabase
          .from("streaks")
          .select("*")
          .eq("user_id", partnerId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    partnerPrefs.share_streaks
      ? supabase.from("streak_logs").select("*").eq("user_id", partnerId)
      : Promise.resolve({ data: [] }),
    partnerPrefs.share_plans
      ? supabase
          .from("plans")
          .select("*")
          .eq("user_id", partnerId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    partnerPrefs.share_finances
      ? supabase
          .from("accounts")
          .select("*")
          .eq("user_id", partnerId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    partnerPrefs.share_finances
      ? supabase
          .from("transactions")
          .select("*")
          .eq("user_id", partnerId)
          .order("occurred_on", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    subscriptions: tasks[0].data ?? [],
    todos: tasks[1].data ?? [],
    streaks: tasks[2].data ?? [],
    streakLogs: tasks[3].data ?? [],
    plans: tasks[4].data ?? [],
    accounts: tasks[5].data ?? [],
    transactions: tasks[6].data ?? [],
  };
}
