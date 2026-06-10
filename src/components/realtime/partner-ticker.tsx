"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { useDict, type Dict } from "@/lib/i18n";

type Tracked = {
  table: string;
  label: (d: Dict, count: number) => string;
};

const TRACKED: Tracked[] = [
  { table: "todos", label: (d, n) => d.couple.task(n) },
  { table: "streak_logs", label: (d, n) => d.couple.habitCheckIn(n) },
  { table: "transactions", label: (d, n) => d.couple.transaction(n) },
  { table: "plans", label: (d, n) => d.couple.plan(n) },
  { table: "books", label: (d, n) => d.couple.book(n) },
  { table: "book_pages", label: (d, n) => d.couple.readingSession(n) },
  { table: "important_dates", label: (d, n) => d.couple.dateItem(n) },
  { table: "accounts", label: (d, n) => d.couple.account(n) },
  { table: "subscriptions", label: (d, n) => d.couple.subscription(n) },
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
  const t = useDict();
  const pendingRef = useRef<Map<string, number>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function flush() {
      const counts = pendingRef.current;
      pendingRef.current = new Map();
      timerRef.current = null;
      if (counts.size === 0) return;

      const parts = TRACKED.map((tr) => {
        const n = counts.get(tr.table) ?? 0;
        return n > 0 ? tr.label(t, n) : null;
      }).filter(Boolean);

      if (parts.length === 0) return;

      // Join with commas + "and" for natural reading. Keep it short.
      const and = t.couple.and;
      let summary: string;
      if (parts.length === 1) summary = parts[0]!;
      else if (parts.length === 2) summary = `${parts[0]} ${and} ${parts[1]}`;
      else
        summary = `${parts.slice(0, -1).join(", ")} ${and} ${parts[parts.length - 1]}`;

      toast.info(t.couple.partnerAdded(partnerName, summary));
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
    for (const tr of TRACKED) {
      channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: tr.table,
          filter: `user_id=eq.${partnerId}`,
        },
        () => {
          const prev = pendingRef.current.get(tr.table) ?? 0;
          pendingRef.current.set(tr.table, prev + 1);
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
