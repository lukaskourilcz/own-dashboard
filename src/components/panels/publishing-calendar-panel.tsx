"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { EntityBadge, StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { useLang } from "@/lib/i18n";
import { publishingCalendar as strings } from "@/lib/i18n/sections/publishing-calendar";
import { qk } from "@/lib/queries/keys";
import {
  PUBLISHING_NETWORKS,
  PublishingCalendarSchema,
  publishingDays,
  publishingNetworkCounts,
  publishingTargetHref,
  type PublishingCalendar,
  type PublishingItem,
  type PublishingNetwork,
} from "@/lib/publishing-calendar";
import { cn } from "@/lib/utils";

type Lang = "en" | "cs";

async function fetchPublishingCalendar(): Promise<PublishingCalendar> {
  const response = await fetch("/api/publishing-calendar", { cache: "no-store" });
  if (!response.ok) throw new Error("publishing-calendar-unavailable");
  return PublishingCalendarSchema.parse(await response.json());
}

/** Sample plan for /dev-preview: the panel never calls the server there. */
export const PREVIEW_PUBLISHING: PublishingCalendar = {
  schemaVersion: "publishing-calendar/1", generatedAt: "2026-11-08T07:00:00.000Z", from: "2026-11-08", days: ["2026-11-08", "2026-11-09", "2026-11-10"],
  connected: { facebook: false, instagram: true, threads: true, linkedin: false }, unavailable: [],
  items: [
    { id: "p1", brand: "dneskai", channel: "instagram", date: "2026-11-08", time: "08:00", scheduledAt: "2026-11-08T07:00:00.000Z", title: "Nový model umí číst tabulky", status: "approved", thumbnail: null, target: { kind: "dneskai-lab", postId: "00000000-0000-4000-8000-0000000000c1" } },
    { id: "p2", brand: "dneskai", channel: "story", date: "2026-11-08", time: "08:10", scheduledAt: "2026-11-08T07:10:00.000Z", title: "Nový model umí číst tabulky", status: "approved", thumbnail: null, target: { kind: "dneskai-lab", postId: "00000000-0000-4000-8000-0000000000c1" } },
    { id: "p3", brand: "devshark", channel: "instagram", date: "2026-11-08", time: "12:00", scheduledAt: "2026-11-08T11:00:00.000Z", title: "typeof null", status: "ready", thumbnail: null, target: { kind: "devshark-studio", draftId: "00000000-0000-4000-8000-000000000001" } },
    { id: "p4", brand: "devshark", channel: "threads", date: "2026-11-08", time: "19:00", scheduledAt: "2026-11-08T18:00:00.000Z", title: "Array holes", status: "planned", thumbnail: null, target: { kind: "devshark-studio", draftId: "00000000-0000-4000-8000-000000000002" } },
    { id: "p5", brand: "dneskai", channel: "threads", date: "2026-11-09", time: "20:00", scheduledAt: "2026-11-09T19:00:00.000Z", title: "Proč roste cena čipů", status: "planned", thumbnail: null, target: null },
  ],
};

/** „Dnes · neděle 8. 11.“ / „Today · Sunday 8 Nov“: the date is already a Prague day, so it is formatted in UTC. */
function dayLabel(date: string, from: string, lang: Lang): string {
  const t = strings[lang];
  const at = new Date(`${date}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat(lang === "cs" ? "cs-CZ" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(at);
  const day = lang === "cs" ? `${weekday} ${at.getUTCDate()}. ${at.getUTCMonth() + 1}.` : `${weekday} ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(at)}`;
  const offset = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  return offset === 0 ? `${t.today} · ${day}` : offset === 1 ? `${t.tomorrow} · ${day}` : day;
}

/** Opens the post's detail in its project workspace without leaving the shell. */
function openTarget(target: NonNullable<PublishingItem["target"]>) {
  window.history.pushState(null, "", publishingTargetHref(target));
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.dispatchEvent(new Event("project-tab"));
}

function ItemCard({ item, lang, isPreview }: { item: PublishingItem; lang: Lang; isPreview: boolean }) {
  const t = strings[lang];
  const channel = t.channel[item.channel];
  const body = <>
    <span className="relative block h-[60px] w-12 shrink-0 overflow-hidden rounded border border-border bg-surface-inset">
      {item.thumbnail
        ? <Image unoptimized src={item.thumbnail.url} alt="" width={item.thumbnail.width} height={item.thumbnail.height} loading="lazy" sizes="3rem" className="h-full w-full object-cover" />
        : <span aria-hidden className="flex h-full items-center justify-center text-[10px] font-semibold text-foreground-subtle">{t.brand[item.brand].slice(0, 2)}</span>}
    </span>
    <span className="min-w-0 flex-1 space-y-1">
      <span className="flex flex-wrap items-center gap-1">
        <span className="text-xs font-semibold tabular-nums">{item.time}</span>
        <EntityBadge>{t.brand[item.brand]}</EntityBadge>
        <EntityBadge>{channel}</EntityBadge>
      </span>
      <span className="block text-sm font-medium break-words">{item.title}</span>
      <StatusBadge value={`publishing-${item.status}`} label={t.statuses[item.status] ?? item.status} />
    </span>
  </>;
  const className = "flex w-full min-w-0 items-start gap-3 rounded-md border border-border bg-surface p-2.5 text-left";
  if (!item.target) return <div className={cn(className, "opacity-80")} title={t.noDetail}>{body}</div>;
  const target = item.target;
  return <button type="button" className={cn(className, "hover:bg-surface-hover focus-ring")} aria-label={t.open(item.title, channel, item.time)} disabled={isPreview}
    onClick={() => openTarget(target)}>{body}</button>;
}

export function PublishingCalendarPanel({ isPreview = false }: { isPreview?: boolean }) {
  const { lang } = useLang();
  const t = strings[lang];
  const query = useQuery({ queryKey: qk.publishingCalendar, queryFn: fetchPublishingCalendar, enabled: !isPreview, staleTime: 60_000 });
  const calendar = isPreview ? PREVIEW_PUBLISHING : query.data;
  const [shown, setShown] = useState<ReadonlySet<PublishingNetwork>>(() => new Set(PUBLISHING_NETWORKS));
  const days = useMemo(() => calendar ? publishingDays(calendar, shown) : [], [calendar, shown]);
  const counts = useMemo(() => publishingNetworkCounts(calendar?.items ?? []), [calendar]);
  const toggle = (network: PublishingNetwork) => setShown((old) => { const next = new Set(old); if (next.has(network)) next.delete(network); else next.add(network); return next; });
  const anyShown = PUBLISHING_NETWORKS.some((network) => shown.has(network) && calendar?.connected[network]);

  return <section className="min-w-0" data-testid="publishing-calendar">
    <PageHeader title={t.title} description={t.description} />
    <div role="toolbar" aria-label={t.networks} className="mb-4 flex flex-wrap gap-2">
      {PUBLISHING_NETWORKS.map((network) => {
        const connected = calendar?.connected[network] ?? (network === "instagram" || network === "threads");
        const on = connected && shown.has(network);
        return <button key={network} type="button" aria-pressed={on} disabled={!connected}
          title={connected ? undefined : t.notConnected}
          onClick={() => toggle(network)}
          className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium focus-ring",
            on ? "border-border-strong bg-accent text-foreground" : "border-border bg-surface text-foreground-muted",
            connected ? "hover:bg-surface-hover" : "cursor-not-allowed opacity-60")}>
          {t.network[network]}
          {connected ? <span className="tabular-nums text-xs text-foreground-subtle">{counts[network]}</span> : <span className="text-xs text-foreground-subtle">· {t.notConnected}</span>}
        </button>;
      })}
    </div>
    {isPreview && <p className="mb-3 text-xs text-foreground-muted">{t.previewOnly}</p>}
    {!isPreview && query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>
      : !calendar ? <p role="alert" className="text-sm text-risk">{t.unavailable}</p>
      : <>
        {calendar.unavailable.map((brand) => <p key={brand} role="alert" className="mb-3 text-sm text-risk">{t.brandUnavailable(t.brand[brand])}</p>)}
        {!anyShown && <p className="mb-3 text-sm text-foreground-muted">{t.allHidden}</p>}
        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          {days.map((day) => <Card key={day.date} className="min-w-0 p-3">
            <h2 className="mb-3 text-sm font-semibold">{dayLabel(day.date, calendar.from, lang)}</h2>
            {day.items.length === 0 ? <p className="text-sm text-foreground-muted">{t.empty}</p>
              : <ul className="grid gap-2" aria-label={dayLabel(day.date, calendar.from, lang)}>
                {day.items.map((item) => <li key={item.id}><ItemCard item={item} lang={lang} isPreview={isPreview} /></li>)}
              </ul>}
          </Card>)}
        </div>
      </>}
  </section>;
}
