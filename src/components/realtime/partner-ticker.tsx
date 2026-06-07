"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

type Tracked = {
  table: string;
  label: (count: number) => string;
};

const TRACKED: Tracked[] = [
  { table: "todos", label: (n) => `${n === 1 ? "a task" : `${n} tasks`}` },
  { table: "streak_logs", label: (n) => `${n === 1 ? "a habit check-in" : `${n} habit check-ins`}` },
  { table: "transactions", label: (n) => `${n === 1 ? "a transaction" : `${n} transactions`}` },
  { table: "plans", label: (n) => `${n === 1 ? "a plan" : `${n} plans`}` },
  { table: "books", label: (n) => `${n === 1 ? "a book" : `${n} books`}` },
  { table: "book_pages", label: (n) => `${n === 1 ? "a reading session" : `${n} reading sessions`}` },
  { table: "important_dates", label: (n) => `${n === 1 ? "a date" : `${n} dates`}` },
  { table: "accounts", label: (n) => `${n === 1 ? "an account" : `${n} accounts`}` },
  { table: "subscriptions", label: (n) => `${n === 1 ? "a subscription" : `${n} subscriptions`}` },
];

const COALESCE_MS = 2500;

/**
 * Subscribes to Postgres changes on shared tables where user_id = partnerId.
 * Supabase Realtime respects RLS — we only receive rows the SELECT policy
 * already allows. Bursts within COALESCE_MS get bundled into one toast.
 */
export function PartnerTicker({
  partnerId,
  partnerName,
}: {
  partnerId: string;
  partnerName: string;
}) {
  const toast = useToast();
  const supabase = createClient();
  const pendingRef = useRef<Map<string, number>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function flush() {
      const counts = pendingRef.current;
      pendingRef.current = new Map();
      timerRef.current = null;
      if (counts.size === 0) return;

      const parts = TRACKED.map((t) => {
        const n = counts.get(t.table) ?? 0;
        return n > 0 ? t.label(n) : null;
      }).filter(Boolean);

      if (parts.length === 0) return;

      // Join with commas + "and" for natural reading. Keep it short.
      let summary: string;
      if (parts.length === 1) summary = parts[0]!;
      else if (parts.length === 2) summary = `${parts[0]} and ${parts[1]}`;
      else
        summary = `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

      toast.info(`${partnerName} added ${summary}.`);
    }

    function schedule() {
      if (timerRef.current) return;
      timerRef.current = setTimeout(flush, COALESCE_MS);
    }

    const channel = supabase
      .channel(`partner-activity-${partnerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          // We don't filter by table here — we attach one handler per table
          // below so the closure has access to the table name. Supabase
          // requires the filter in each .on() call.
        },
        () => {
          /* unreachable — see per-table .on calls */
        },
      );

    // One subscription per tracked table, all filtered by user_id=partnerId.
    for (const t of TRACKED) {
      channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: t.table,
          filter: `user_id=eq.${partnerId}`,
        },
        () => {
          const prev = pendingRef.current.get(t.table) ?? 0;
          pendingRef.current.set(t.table, prev + 1);
          schedule();
        },
      );
    }

    channel.subscribe();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
    // partnerId/partnerName are stable per session render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, partnerName]);

  return null;
}
