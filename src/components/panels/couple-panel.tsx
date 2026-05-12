"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Heart,
  Mail,
  Send,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type {
  CoupleInvite,
  SharingCategory,
  SharingPrefs,
} from "@/lib/types";
import type { CoupleContext } from "@/lib/couple";

const CATEGORIES: { key: SharingCategory; label: string; hint: string }[] = [
  { key: "subscriptions", label: "Subscriptions", hint: "Your recurring spend and pie chart" },
  { key: "todos", label: "Todos", hint: "Your open and completed tasks" },
  { key: "streaks", label: "Streaks", hint: "Your habits, heatmap, and check-ins" },
  { key: "finances", label: "Finances", hint: "Accounts, balances, transactions" },
  { key: "plans", label: "Plans", hint: "Long-horizon goals and timeline" },
  { key: "books", label: "Books", hint: "Pages written and book progress" },
];

type ShareField =
  | "share_subscriptions"
  | "share_todos"
  | "share_streaks"
  | "share_finances"
  | "share_plans"
  | "share_books";

const PREF_FIELDS: Record<SharingCategory, ShareField> = {
  subscriptions: "share_subscriptions",
  todos: "share_todos",
  streaks: "share_streaks",
  finances: "share_finances",
  plans: "share_plans",
  books: "share_books",
};

export function CouplePanel({
  ctx,
  userId,
  userEmail,
}: {
  ctx: CoupleContext;
  userId: string;
  userEmail: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const toast = useToast();

  const [inviteEmail, setInviteEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [prefs, setPrefs] = useState<SharingPrefs>(ctx.myPrefs);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    const target = inviteEmail.trim().toLowerCase();
    if (!target) return;
    if (target === userEmail.toLowerCase()) {
      toast.err("That's your own email.");
      return;
    }
    setSending(true);
    const { error } = await supabase
      .from("couple_invites")
      .insert({ inviter_id: userId, invitee_email: target });
    setSending(false);
    if (error) {
      toast.err(error.message);
      return;
    }
    setInviteEmail("");
    toast.ok(`Invite sent to ${target}.`);
    router.refresh();
  }

  async function cancelInvite(invite: CoupleInvite) {
    const { error } = await supabase
      .from("couple_invites")
      .delete()
      .eq("id", invite.id);
    if (error) {
      toast.err(error.message);
      return;
    }
    router.refresh();
  }

  async function respondToInvite(invite: CoupleInvite, accept: boolean) {
    if (!accept) {
      const { error } = await supabase
        .from("couple_invites")
        .update({ status: "declined" })
        .eq("id", invite.id);
      if (error) {
        toast.err(error.message);
        return;
      }
      toast.info("Invite declined.");
      router.refresh();
      return;
    }
    // Accept: sort the two user ids so the unique constraint is canonical.
    const [a, b] =
      invite.inviter_id < userId
        ? [invite.inviter_id, userId]
        : [userId, invite.inviter_id];
    const { error: coupleErr } = await supabase
      .from("couples")
      .insert({ user_a_id: a, user_b_id: b });
    if (coupleErr) {
      toast.err(coupleErr.message);
      return;
    }
    const { error: updateErr } = await supabase
      .from("couple_invites")
      .update({ status: "accepted" })
      .eq("id", invite.id);
    if (updateErr) {
      toast.err(updateErr.message);
      return;
    }
    toast.ok("You're paired. Reload to see shared data.");
    router.refresh();
  }

  async function unpair() {
    if (!ctx.couple) return;
    const ok = window.confirm(
      "Unpair? Your partner will lose access to anything you share.",
    );
    if (!ok) return;
    const { error } = await supabase
      .from("couples")
      .delete()
      .eq("id", ctx.couple.id);
    if (error) {
      toast.err(error.message);
      return;
    }
    toast.info("Unpaired.");
    router.refresh();
  }

  async function togglePref(category: SharingCategory) {
    const field = PREF_FIELDS[category];
    const next = !prefs[field];
    const updated: SharingPrefs = {
      ...prefs,
      [field]: next,
      updated_at: new Date().toISOString(),
    };
    setPrefs(updated);
    const { error } = await supabase
      .from("sharing_prefs")
      .upsert({
        user_id: userId,
        share_subscriptions: updated.share_subscriptions,
        share_todos: updated.share_todos,
        share_streaks: updated.share_streaks,
        share_finances: updated.share_finances,
        share_plans: updated.share_plans,
        share_books: updated.share_books,
        updated_at: updated.updated_at,
      });
    if (error) {
      setPrefs(prefs);
      toast.err(error.message);
    }
  }

  const partnerName =
    ctx.partnerProfile?.display_name ??
    ctx.partnerProfile?.email ??
    "your partner";

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <Heart className="h-4 w-4" />
              {ctx.couple ? "Paired" : "Pair up"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ctx.couple ? (
            <div className="space-y-3">
              <p className="text-sm">
                You&apos;re paired with{" "}
                <span className="font-medium">{partnerName}</span>.
              </p>
              {ctx.partnerProfile?.email &&
                ctx.partnerProfile.email !== partnerName && (
                  <p className="text-xs text-zinc-500">
                    {ctx.partnerProfile.email}
                  </p>
                )}
              <Button variant="outline" size="sm" onClick={unpair}>
                <Unlink className="h-4 w-4" />
                Unpair
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
                Invite your partner&apos;s email. They&apos;ll see the invite the next
                time they open their dashboard.
              </p>
              <form onSubmit={sendInvite} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="invite-email">Partner&apos;s email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="partner@example.com"
                  />
                </div>
                <Button type="submit" disabled={sending}>
                  <Send className="h-4 w-4" />
                  {sending ? "Sending…" : "Send invite"}
                </Button>
              </form>

              {ctx.incomingInvites.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-medium text-zinc-500 mb-2">
                    Incoming invites
                  </p>
                  <ul className="space-y-2">
                    {ctx.incomingInvites.map((inv) => (
                      <li
                        key={inv.id}
                        className="flex items-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 p-2"
                      >
                        <Mail className="h-3.5 w-3.5 text-zinc-400" />
                        <span className="text-sm flex-1 truncate">
                          From a partner who knows {inv.invitee_email}
                        </span>
                        <Button
                          size="sm"
                          onClick={() => respondToInvite(inv, true)}
                        >
                          <Check className="h-3.5 w-3.5" /> Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => respondToInvite(inv, false)}
                        >
                          <X className="h-3.5 w-3.5" />
                          Decline
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {ctx.sentInvites.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-medium text-zinc-500 mb-2">
                    Sent invites
                  </p>
                  <ul className="space-y-2">
                    {ctx.sentInvites.map((inv) => (
                      <li
                        key={inv.id}
                        className="flex items-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 p-2"
                      >
                        <span
                          className={cn(
                            "text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded shrink-0",
                            inv.status === "pending" &&
                              "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
                            inv.status === "accepted" &&
                              "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                            inv.status === "declined" &&
                              "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
                          )}
                        >
                          {inv.status}
                        </span>
                        <span className="text-sm flex-1 truncate">
                          {inv.invitee_email}
                        </span>
                        {inv.status === "pending" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => cancelInvite(inv)}
                            aria-label="Cancel invite"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What you share</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-500 mb-3">
            {ctx.couple
              ? `${partnerName} will see anything you toggle on. Changes save instantly.`
              : "Set what you'd like shared. These take effect once you pair up."}
          </p>
          <ul className="space-y-2">
            {CATEGORIES.map((c) => {
              const on = prefs[PREF_FIELDS[c.key]];
              return (
                <li
                  key={c.key}
                  className="flex items-start gap-3 rounded-md border border-zinc-200 dark:border-zinc-800 p-2.5"
                >
                  <button
                    type="button"
                    onClick={() => togglePref(c.key)}
                    aria-pressed={on}
                    className={cn(
                      "mt-0.5 h-5 w-9 rounded-full relative transition-colors shrink-0",
                      on ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                        on ? "translate-x-4" : "translate-x-0.5",
                      )}
                    />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-xs text-zinc-500">{c.hint}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          {ctx.couple && ctx.partnerPrefs && (
            <div className="mt-6">
              <p className="text-xs font-medium text-zinc-500 mb-2">
                What {partnerName} shares with you
              </p>
              <ul className="grid grid-cols-2 gap-1 text-sm">
                {CATEGORIES.map((c) => {
                  const on = ctx.partnerPrefs![PREF_FIELDS[c.key]];
                  return (
                    <li
                      key={c.key}
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs",
                        on
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-zinc-400",
                      )}
                    >
                      {on ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                      {c.label}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
