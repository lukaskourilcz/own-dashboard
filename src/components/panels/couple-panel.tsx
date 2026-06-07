"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
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
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type {
  CoupleInvite,
  SharingCategory,
  SharingPrefs,
} from "@/lib/types";
import {
  SHARE_FIELDS,
  partnerDisplayName,
  type CoupleContext,
} from "@/lib/couple";

const CATEGORIES: { key: SharingCategory; label: string; hint: string }[] = [
  {
    key: "subscriptions",
    label: "Subscriptions",
    hint: "Recurring spend and pie chart",
  },
  { key: "todos", label: "Tasks", hint: "Open and completed tasks" },
  { key: "streaks", label: "Habits", hint: "Habits, heatmap, and check-ins" },
  {
    key: "finances",
    label: "Finances",
    hint: "Accounts, balances, transactions",
  },
  { key: "plans", label: "Plans", hint: "Long-horizon goals and timeline" },
  { key: "books", label: "Books", hint: "Pages written and book progress" },
];

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
    const field = SHARE_FIELDS[category];
    const next = !prefs[field];
    const updated: SharingPrefs = {
      ...prefs,
      [field]: next,
      updated_at: new Date().toISOString(),
    };
    setPrefs(updated);
    const { error } = await supabase
      .from("sharing_prefs")
      .upsert({ ...updated, user_id: userId });
    if (error) {
      setPrefs(prefs);
      toast.err(error.message);
    }
  }

  const partnerName = partnerDisplayName(ctx.partnerProfile, "your partner");

  return (
    <div>
      <PageHeader
        title="Couple"
        description="Pair up and choose what to share."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Heart className="h-3 w-3" />
              {ctx.couple ? "Paired" : "Pair up"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ctx.couple ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-md border border-border p-3">
                  <div className="h-9 w-9 rounded-full bg-surface-muted flex items-center justify-center text-foreground-muted">
                    <Heart className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {partnerName}
                    </p>
                    {ctx.partnerProfile?.email &&
                      ctx.partnerProfile.email !== partnerName && (
                        <p className="text-xs text-foreground-subtle truncate">
                          {ctx.partnerProfile.email}
                        </p>
                      )}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={unpair}>
                  <Unlink className="h-3.5 w-3.5" />
                  Unpair
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-foreground-muted mb-3">
                  Invite your partner&apos;s email. They&apos;ll see the invite the next
                  time they sign in.
                </p>
                <form onSubmit={sendInvite} className="space-y-2">
                  <Label htmlFor="invite-email">Partner&apos;s email</Label>
                  <div className="flex gap-2">
                    <Input
                      id="invite-email"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="partner@example.com"
                    />
                    <Button type="submit" disabled={sending} size="default">
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </form>

                {ctx.incomingInvites.length > 0 && (
                  <div className="mt-6">
                    <SectionLabel className="mb-2">Incoming</SectionLabel>
                    <ul className="space-y-1.5">
                      {ctx.incomingInvites.map((inv) => (
                        <li
                          key={inv.id}
                          className="flex items-center gap-2 rounded-md border border-border bg-surface-muted/40 p-2"
                        >
                          <Mail className="h-3.5 w-3.5 text-foreground-subtle" />
                          <span className="text-sm flex-1 truncate">
                            Pair request waiting
                          </span>
                          <Button
                            size="sm"
                            onClick={() => respondToInvite(inv, true)}
                          >
                            <Check className="h-3 w-3" />
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => respondToInvite(inv, false)}
                          >
                            <X className="h-3 w-3" />
                            Decline
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {ctx.sentInvites.length > 0 && (
                  <div className="mt-6">
                    <SectionLabel className="mb-2">Sent</SectionLabel>
                    <ul className="space-y-1.5">
                      {ctx.sentInvites.map((inv) => (
                        <li
                          key={inv.id}
                          className="flex items-center gap-2 rounded-md border border-border p-2"
                        >
                          <StatusChip status={inv.status} />
                          <span className="text-sm flex-1 truncate">
                            {inv.invitee_email}
                          </span>
                          {inv.status === "pending" && (
                            <Tooltip content="Cancel invite">
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => cancelInvite(inv)}
                                aria-label="Cancel invite"
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </Tooltip>
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
            <p className="text-sm text-foreground-muted mb-3">
              {ctx.couple
                ? `${partnerName} sees anything you toggle on. Changes save instantly.`
                : "Set what you'd like shared. These take effect once you pair up."}
            </p>
            <ul className="space-y-1.5">
              {CATEGORIES.map((c) => {
                const on = prefs[SHARE_FIELDS[c.key]];
                return (
                  <li
                    key={c.key}
                    className="flex items-start gap-3 rounded-md border border-border p-3"
                  >
                    <Switch on={on} onClick={() => togglePref(c.key)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{c.label}</p>
                      <p className="text-xs text-foreground-subtle">
                        {c.hint}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            {ctx.couple && ctx.partnerPrefs && (
              <div className="mt-5">
                <SectionLabel className="mb-2">
                  What {partnerName} shares
                </SectionLabel>
                <ul className="grid grid-cols-2 gap-1.5">
                  {CATEGORIES.map((c) => {
                    const on = ctx.partnerPrefs![SHARE_FIELDS[c.key]];
                    return (
                      <li
                        key={c.key}
                        className={cn(
                          "inline-flex items-center gap-1.5 text-xs",
                          on
                            ? "text-success"
                            : "text-foreground-subtle line-through",
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
    </div>
  );
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-out focus-ring mt-0.5",
        on ? "bg-foreground" : "bg-border-strong",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="block h-4 w-4 rounded-full bg-background shadow-sm"
        style={{ marginLeft: on ? 18 : 2 }}
      />
    </button>
  );
}

function StatusChip({ status }: { status: "pending" | "accepted" | "declined" }) {
  const map = {
    pending: "bg-surface-muted text-foreground-subtle",
    accepted: "bg-success/10 text-success",
    declined: "bg-destructive/10 text-destructive",
  };
  return (
    <span
      className={cn(
        "text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded shrink-0",
        map[status],
      )}
    >
      {status}
    </span>
  );
}
