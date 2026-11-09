"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import Image from "next/image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Check, ChevronLeft, ChevronRight, CircleAlert, CircleDashed, ExternalLink, ImageIcon, Link2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EntityBadge, StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { useLang } from "@/lib/i18n";
import { publishingCalendar as strings } from "@/lib/i18n/sections/publishing-calendar";
import { qk } from "@/lib/queries/keys";
import {
  PUBLISHING_CHANNELS,
  PUBLISHING_NETWORKS,
  PublishingCalendarSchema,
  networkOfChannel,
  orderedVersions,
  publishingDays,
  publishingNetworkCounts,
  publishingTargetHref,
  versionLive,
  type PublishingCalendar,
  type PublishingChannel,
  type PublishingLive,
  type PublishingNetwork,
  type PublishingPost,
  type PublishingSwitch,
  type PublishingVersion,
} from "@/lib/publishing-calendar";
import { cn } from "@/lib/utils";
import { dneskaiWorkspaceApi } from "@/lib/marketing/dneskai-workspace-client";
import { DevsharkStudioSlide } from "@/components/design-studio/slide-canvas";

type Lang = "en" | "cs";

async function saveSwitch(input: PublishingSwitch): Promise<void> {
  const response = await fetch("/api/publishing-calendar/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error("switch-unavailable");
}

/** The calendar with one switch applied: a version (`channel`) or the whole post (`all`). */
export function applySwitch(calendar: PublishingCalendar, input: PublishingSwitch): PublishingCalendar {
  return { ...calendar, posts: calendar.posts.map((post) => post.brand !== input.brand || post.slotId !== input.slotId ? post
    : input.channel === "all" ? { ...post, off: input.off }
    : { ...post, versions: post.versions.map((version) => version.channel === input.channel ? { ...version, off: input.off } : version) }) };
}

async function fetchPublishingCalendar(): Promise<PublishingCalendar> {
  const response = await fetch("/api/publishing-calendar", { cache: "no-store" });
  if (!response.ok) throw new Error("publishing-calendar-unavailable");
  return PublishingCalendarSchema.parse(await response.json());
}

const at = (date: string, time: string) => new Date(`${date}T${time}:00+01:00`).toISOString();
const version = (channel: PublishingChannel, date: string, time: string, status: string, caption: string | null): PublishingVersion =>
  ({ channel, time, scheduledAt: at(date, time), status, caption, pictures: [], off: false });

/** Sample plan for /dev-preview: the panel never calls the server there, and the fixtures carry no pictures. */
export const PREVIEW_PUBLISHING: PublishingCalendar = {
  schemaVersion: "publishing-calendar/2", generatedAt: "2026-11-08T07:00:00.000Z", from: "2026-11-08", days: ["2026-11-08", "2026-11-09", "2026-11-10"],
  connected: { facebook: false, instagram: true, threads: true, linkedin: false }, unavailable: [],
  posts: [
    { id: "p1", slotId: "00000000-0000-4000-8000-0000000000d1", off: false, brand: "dneskai", date: "2026-11-08", time: "08:00", scheduledAt: at("2026-11-08", "08:00"), title: "Nový model umí číst tabulky", headline: "Nový model umí číst tabulky", status: "approved", thumbnail: null,
      target: { kind: "dneskai-lab", postId: "00000000-0000-4000-8000-0000000000c1" },
      versions: [
        version("story", "2026-11-08", "08:10", "approved", null),
        version("instagram", "2026-11-08", "08:00", "approved", "Nový model přečte tabulku z fotky a spočítá ji za tebe.\n\n#dneskai #ai #tabulky"),
        version("threads", "2026-11-08", "08:00", "approved", "Nový model přečte tabulku z fotky a spočítá ji za tebe."),
      ] },
    { id: "p2", slotId: "00000000-0000-4000-8000-0000000000d2", off: false, brand: "devshark", date: "2026-11-08", time: "12:00", scheduledAt: at("2026-11-08", "12:00"), title: "typeof null", headline: "typeof null", status: "ready", thumbnail: null,
      target: { kind: "devshark-studio", draftId: "00000000-0000-4000-8000-000000000001" },
      versions: [
        version("story", "2026-11-08", "12:10", "ready", null),
        version("instagram", "2026-11-08", "12:00", "ready", "Guess before you swipe: what does typeof null return?\n\n#javascript #devshark"),
        version("threads", "2026-11-08", "12:00", "ready", "Guess before you swipe: what does typeof null return?"),
      ] },
    { id: "p3", slotId: "00000000-0000-4000-8000-0000000000d3", off: false, brand: "devshark", date: "2026-11-08", time: "19:00", scheduledAt: at("2026-11-08", "19:00"), title: "Array holes", headline: null, status: "planned", thumbnail: null,
      target: { kind: "devshark-studio", draftId: "00000000-0000-4000-8000-000000000002" },
      versions: [version("threads", "2026-11-08", "19:00", "planned", null)] },
    { id: "p4", slotId: "00000000-0000-4000-8000-0000000000d4", off: false, brand: "dneskai", date: "2026-11-09", time: "20:00", scheduledAt: at("2026-11-09", "20:00"), title: "Proč roste cena čipů", headline: null, status: "planned", thumbnail: null, target: null,
      versions: [version("threads", "2026-11-09", "20:00", "planned", null)] },
  ],
};

/** „Dnes · neděle 8. 11.“ / „Today · Sunday 8 Nov“: the date is already a Prague day, so it is formatted in UTC. */
function dayLabel(date: string, from: string, lang: Lang): string {
  const t = strings[lang];
  const day = new Date(`${date}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat(lang === "cs" ? "cs-CZ" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(day);
  const label = lang === "cs" ? `${weekday} ${day.getUTCDate()}. ${day.getUTCMonth() + 1}.` : `${weekday} ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(day)}`;
  const offset = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  return offset === 0 ? `${t.today} · ${label}` : offset === 1 ? `${t.tomorrow} · ${label}` : label;
}

const CHANNEL_ICON = { story: CircleDashed, instagram: ImageIcon, threads: AtSign, linkedin: Link2, facebook: Users } as const;
const publicationTone = (status: string | undefined) => status === "published" ? "success" : status === "failed" ? "risk" : undefined;

/** Opens the post's editor in its project workspace without leaving the shell. */
function openTarget(target: NonNullable<PublishingPost["target"]>, channel?: PublishingChannel) {
  window.history.pushState(null, "", publishingTargetHref(target, channel));
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.dispatchEvent(new Event("project-tab"));
}

/** The channel marks on a card: active for versions the post has, muted for the others, "not connected" for FB and LinkedIn. */
function ChannelMarks({ post, connected, lang }: { post: PublishingPost; connected: PublishingCalendar["connected"]; lang: Lang }) {
  const t = strings[lang];
  return <span className="flex flex-wrap gap-1" aria-hidden>
    {PUBLISHING_CHANNELS.map((channel) => {
      const Icon = CHANNEL_ICON[channel];
      const version = post.versions.find((v) => v.channel === channel);
      const live = !!version && connected[networkOfChannel(channel)] && versionLive(post, version);
      const tone = publicationTone(version?.status);
      const label = tone ? t.statuses[version!.status] : !connected[networkOfChannel(channel)] ? t.notConnected : null;
      return <span key={channel} title={label ? `${t.channel[channel]} · ${label}` : t.channel[channel]} data-status={version?.status}
        className={cn("inline-flex min-h-6 items-center gap-1 rounded-sm border px-1.5 text-[11px] font-medium",
          tone === "success" ? "border-success/25 bg-success-soft text-success"
            : tone === "risk" ? "border-risk/25 bg-risk-soft text-risk"
            : live ? "border-border-strong bg-surface-inset text-foreground" : "border-dashed border-border text-foreground-muted line-through decoration-foreground-muted/60")}>
        <Icon className="h-3 w-3" />{t.channelShort[channel]}
        {tone === "success" && <Check className="size-3" />}
        {tone === "risk" && <CircleAlert className="size-3" />}
      </span>;
    })}
  </span>;
}

function PostCard({ post, connected, lang, onOpen }: { post: PublishingPost; connected: PublishingCalendar["connected"]; lang: Lang; onOpen: () => void }) {
  const t = strings[lang];
  const live = orderedVersions(post).filter((v) => versionLive(post, v) && connected[networkOfChannel(v.channel)]);
  const list = live.length ? live.map((v) => t.channel[v.channel]).join(", ") : t.nothingShared;
  const outcomes = orderedVersions(post).filter((v) => publicationTone(v.status))
    .map((v) => `${t.channel[v.channel]} · ${t.statuses[v.status]}`).join(", ");
  // A devShark concept the plan has not rendered yet: its cover as the Studio draws it.
  const cardDeck = post.thumbnail ? null : post.versions.map((v) => studioDeck(v.live)).find(Boolean) ?? null;
  return <button type="button" onClick={onOpen} aria-label={`${t.open(post.title, post.time)}. ${t.versionsOf(list)}${outcomes ? `. ${outcomes}` : ""}`}
    className="flex w-full min-w-0 items-start gap-3 rounded-md border border-border bg-surface p-2.5 text-left hover:bg-surface-hover focus-ring">
    <span className="relative block h-[60px] w-12 shrink-0 overflow-hidden rounded border border-border bg-surface-inset">
      {post.thumbnail
        ? <Image unoptimized src={post.thumbnail.url} alt="" width={post.thumbnail.width} height={post.thumbnail.height} loading="lazy" sizes="3rem" className="h-full w-full object-cover" />
        : cardDeck ? <DevsharkStudioSlide deck={cardDeck} index={0} label="" className="h-full w-full" />
        : <span aria-hidden className="flex h-full items-center justify-center text-[11px] font-semibold text-foreground-muted">{t.brand[post.brand].slice(0, 2)}</span>}
    </span>
    <span className="min-w-0 flex-1 space-y-1.5">
      <span className="flex flex-wrap items-center gap-1">
        <span className="text-xs font-semibold tabular-nums">{post.time}</span>
        <EntityBadge>{t.brand[post.brand]}</EntityBadge>
        {post.off && <EntityBadge className="border-dashed">{t.postOff}</EntityBadge>}
      </span>
      <span className={cn("block text-sm font-medium break-words", post.off && "line-through decoration-foreground-muted")}>{post.title}</span>
      <ChannelMarks post={post} connected={connected} lang={lang} />
    </span>
  </button>;
}

/**
 * The DNESKAi story the Design Lab draws on demand, drawn here with the Lab's own request and preview route (owner
 * request, 9 November 2026). In /dev-preview that is the Lab's fixture renderer.
 */
function useLiveStory(live: PublishingLive | null | undefined, isPreview: boolean) {
  const request = live?.kind === "dneskai-story" ? live.request : null;
  return useQuery({
    queryKey: [...qk.publishingCalendarLive, isPreview ? "preview" : "live", JSON.stringify(request)],
    enabled: !!request, staleTime: 5 * 60_000, gcTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<string | null> => {
      const result = await (await dneskaiWorkspaceApi(isPreview)).renderPreview(request!, signal);
      return result.status === "rendered" ? result.image : null;
    },
  });
}

/** The deck the devShark Studio would draw for a version the plan has not rendered yet. */
const studioDeck = (live: PublishingLive | null | undefined) => live?.kind === "devshark-deck" ? live.deck : null;

/** The selected channel's actual render, with one whole slide visible at a time. */
function VersionMedia({ version, title, lang, isPreview }: { version: PublishingVersion; title: string; lang: Lang; isPreview: boolean }) {
  const t = strings[lang];
  const pictures = version.pictures;
  const story = useLiveStory(pictures.length ? null : version.live, isPreview);
  const deck = pictures.length ? null : studioDeck(version.live);
  const count = Math.min(pictures.length || deck?.slides.length || 0, version.channel === "threads" ? 1 : 10);
  const [slide, setSlide] = useState(0);
  const current = Math.min(slide, Math.max(count - 1, 0));
  const missing = <p className="m-auto p-3 text-center text-xs text-foreground-muted" role={story.isFetching ? "status" : undefined}>
    {story.isFetching ? t.rendering : story.isError ? t.renderFailed : t.notRendered}</p>;
  if (version.channel === "story") return <div className="relative flex min-h-0 flex-1 items-center justify-center" data-testid="story-frame">
    {pictures[0]
      ? <Image unoptimized src={pictures[0].url} alt={pictures[0].alt} width={pictures[0].width} height={pictures[0].height} className="absolute inset-0 size-full object-contain" data-testid="story-image" />
      : story.data
        // eslint-disable-next-line @next/next/no-img-element -- the Design Lab's rendered data URL
        ? <img src={story.data} alt={t.storyAlt(title)} className="absolute inset-0 size-full object-contain" data-testid="story-image" />
        : missing}
  </div>;
  if (!count) return missing;
  return <>
    <ul aria-label={t.channel[version.channel]} className="relative min-h-0 flex-1" data-testid="version-slides">
      {Array.from({ length: count }, (_, index) => {
        const picture = pictures[index];
        return <li key={index} hidden={index !== current} className="absolute inset-0">
          {picture
            ? <Image unoptimized src={picture.url} alt={picture.alt || t.slideOf(index + 1, count)} width={picture.width} height={picture.height}
                loading={index === 0 ? "eager" : "lazy"} sizes="(min-width: 768px) 33vw, 100vw" className="size-full object-contain" />
            : <DevsharkStudioSlide deck={deck!} index={index} label={t.slideOf(index + 1, count)} className="mx-auto h-full max-w-full [&_svg]:max-h-full [&_svg]:w-full" />}
        </li>;
      })}
    </ul>
    {count > 1 && <div className="flex items-center justify-between border-t border-border px-3 py-1 text-xs">
      <Button type="button" variant="ghost" size="sm" aria-label={t.previousSlide} disabled={current === 0} onClick={() => setSlide(current - 1)}>
        <ChevronLeft className="size-4" aria-hidden />
      </Button>
      <span aria-live="polite" className="tabular-nums">{t.slideOf(current + 1, count)}</span>
      <Button type="button" variant="ghost" size="sm" aria-label={t.nextSlide} disabled={current + 1 === count} onClick={() => setSlide(current + 1)}>
        <ChevronRight className="size-4" aria-hidden />
      </Button>
    </div>}
  </>;
}

function VersionDetails({ version, lang }: { version: PublishingVersion; lang: Lang }) {
  const t = strings[lang];
  return <div className="space-y-3">
    <p className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
      <span className="font-semibold tabular-nums text-foreground">{t.channel[version.channel]} {t.at(version.time)}</span>
      <StatusBadge value={version.status} tone={publicationTone(version.status)} label={t.statuses[version.status] ?? version.status} />
    </p>
    {version.channel !== "story" && <p className="whitespace-pre-line break-words rounded-md border border-border bg-surface-inset p-3 text-sm" data-testid="version-caption">
      {version.caption?.trim() || <span className="text-foreground-muted">{t.noCaption}</span>}
    </p>}
  </div>;
}

function PostDialog({ post, connected, lang, onClose, onSwitch, saving, failed, isPreview }: { post: PublishingPost; connected: PublishingCalendar["connected"]; lang: Lang; onClose: () => void; isPreview: boolean;
  onSwitch: (input: PublishingSwitch) => void; saving: boolean; failed: boolean }) {
  const t = strings[lang];
  const versions = useMemo(() => new Map(post.versions.map((v) => [v.channel, v])), [post]);
  const [selected, setSelected] = useState<PublishingChannel>(() => versions.has("instagram") ? "instagram" : orderedVersions(post)[0]!.channel);
  const current = versions.get(selected);
  const enabled = PUBLISHING_CHANNELS.filter((channel) => versions.has(channel));
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = enabled.indexOf(selected);
    const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
    setSelected(enabled[next]!);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-channel="${enabled[next]}"]`)?.focus();
  };
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="grid max-w-7xl gap-0 overflow-x-hidden p-0 md:h-[min(calc(100dvh-3rem),60rem)] md:max-h-[calc(100dvh-3rem)] md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden" data-testid="publishing-post-dialog">
      <div className="flex h-[38dvh] min-w-0 flex-col border-b border-border bg-surface-inset md:h-full md:min-h-0 md:border-b-0 md:border-r" data-testid="publishing-post-media">
        {current && <VersionMedia key={current.channel} version={current} title={post.title} lang={lang} isPreview={isPreview} />}
      </div>
      <div className="flex min-w-0 flex-col md:min-h-0">
        <header className="shrink-0 border-b border-border px-4 py-3 pr-14 md:px-5 md:pr-14">
          <DialogTitle className="break-words text-base font-semibold">{t.dialogTitle(post.title)}</DialogTitle>
          <DialogDescription className="mt-1">{t.brand[post.brand]} · {t.versionsOf(orderedVersions(post).map((v) => t.channel[v.channel]).join(", "))}</DialogDescription>
        </header>
        <div className="min-h-0 flex-1 px-4 pb-4 md:overflow-y-auto md:overscroll-contain md:px-5 md:pb-5">
      {post.headline && <p className="mt-2 text-sm" data-testid="post-headline"><span className="text-xs text-foreground-muted">{t.headline}: </span>{post.headline}</p>}
      <label className="mt-4 flex min-h-11 items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium">
        <span>{t.sharePost}<span className="block text-xs font-normal text-foreground-muted">{post.off ? t.postOffHint : t.postOnHint}</span></span>
        <Switch checked={!post.off} disabled={saving} aria-label={t.sharePost} data-testid="post-switch"
          onCheckedChange={(on) => onSwitch({ brand: post.brand, slotId: post.slotId, channel: "all", off: !on })} />
      </label>
      {failed && <p role="alert" className="mt-2 text-xs text-risk">{t.switchFailed}</p>}
      <div role="tablist" aria-label={t.versions} onKeyDown={onKey} className="mt-4 flex flex-wrap gap-1.5">
        {PUBLISHING_CHANNELS.map((channel) => {
          const exists = versions.has(channel);
          const live = connected[networkOfChannel(channel)];
          const Icon = CHANNEL_ICON[channel];
          return <button key={channel} type="button" role="tab" data-channel={channel} id={`tab-${channel}`} aria-controls="publishing-version-panel"
            aria-selected={selected === channel} tabIndex={selected === channel ? 0 : -1} disabled={!exists}
            title={!live ? t.notConnected : !exists ? t.noVersion : undefined}
            onClick={() => setSelected(channel)}
            className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium focus-ring",
              selected === channel ? "border-border-strong bg-accent text-foreground" : "border-border bg-surface text-foreground-muted hover:bg-surface-hover",
              !exists && "cursor-not-allowed border-dashed")}>
            <Icon className="h-3.5 w-3.5" aria-hidden /><span className={cn(exists && !versionLive(post, versions.get(channel)!) && "line-through")}>{t.tab[channel]}</span>
            {!live && <span className="text-xs">· {t.notConnected}</span>}
          </button>;
        })}
      </div>
      <div role="tabpanel" id="publishing-version-panel" aria-labelledby={`tab-${selected}`} className="mt-4">
        {current && <label className="mb-3 flex min-h-11 items-center justify-between gap-3 text-sm">
          <span>{t.shareVersion(t.channel[current.channel])}{post.off && <span className="block text-xs text-foreground-muted">{t.postOffHint}</span>}</span>
          <Switch checked={!current.off} disabled={saving || !connected[networkOfChannel(current.channel)]} aria-label={t.shareVersion(t.channel[current.channel])} data-testid="version-switch"
            onCheckedChange={(on) => onSwitch({ brand: post.brand, slotId: post.slotId, channel: current.channel, off: !on })} />
        </label>}
        {current ? <VersionDetails version={current} lang={lang} /> : <p className="text-sm text-foreground-muted">{t.noVersion}</p>}
      </div>
      {post.target && <div className="mt-4 flex justify-end">
        <Button type="button" variant="outline" onClick={() => { const target = post.target!; onClose(); openTarget(target, selected); }}>
          <ExternalLink className="h-4 w-4" aria-hidden />{t.editInLab}
        </Button>
      </div>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}

export function PublishingCalendarPanel({ isPreview = false }: { isPreview?: boolean }) {
  const { lang } = useLang();
  const t = strings[lang];
  // No stale time: back from the Design Lab or the Studio, the preview shows the saved version.
  // /dev-preview reads the in-memory Design Lab samples of both brands, so an edit saved there shows here (8 November 2026).
  const query = useQuery({ queryKey: isPreview ? [...qk.publishingCalendar, "preview"] : qk.publishingCalendar,
    queryFn: isPreview ? () => import("@/lib/demo/publishing-calendar-demo").then((demo) => demo.previewPublishingCalendar()) : fetchPublishingCalendar,
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true });
  const calendar = query.data;
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: saveSwitch,
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: qk.publishingCalendar });
      const before = queryClient.getQueryData<PublishingCalendar>(qk.publishingCalendar);
      if (before) queryClient.setQueryData(qk.publishingCalendar, applySwitch(before, input));
      return { before };
    },
    onError: (_error, _input, context) => { if (context?.before) queryClient.setQueryData(qk.publishingCalendar, context.before); },
  });
  const onSwitch = (input: PublishingSwitch) => {
    if (!isPreview) { mutation.mutate(input); return; }
    void import("@/lib/demo/publishing-calendar-demo").then(async (demo) => { await demo.previewPublishingSwitch(input); await queryClient.invalidateQueries({ queryKey: [...qk.publishingCalendar, "preview"] }); });
  };
  const [shown, setShown] = useState<ReadonlySet<PublishingNetwork>>(() => new Set(PUBLISHING_NETWORKS));
  const [open, setOpen] = useState<string | null>(null);
  const days = useMemo(() => calendar ? publishingDays(calendar, shown) : [], [calendar, shown]);
  const counts = useMemo(() => publishingNetworkCounts(calendar?.posts ?? []), [calendar]);
  const toggle = (network: PublishingNetwork) => setShown((old) => { const next = new Set(old); if (next.has(network)) next.delete(network); else next.add(network); return next; });
  const anyShown = PUBLISHING_NETWORKS.some((network) => shown.has(network) && calendar?.connected[network]);
  const openPost = calendar?.posts.find((post) => post.id === open) ?? null;

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
            connected ? "hover:bg-surface-hover" : "cursor-not-allowed border-dashed")}>
          {t.network[network]}
          {connected ? <span className="tabular-nums text-xs text-foreground-muted">{counts[network]}</span> : <span className="text-xs text-foreground-muted">· {t.notConnected}</span>}
        </button>;
      })}
    </div>
    {isPreview && <p className="mb-3 text-xs text-foreground-muted">{t.previewOnly}</p>}
    {query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>
      : !calendar ? <p role="alert" className="text-sm text-risk">{t.unavailable}</p>
      : <>
        {calendar.unavailable.map((brand) => <p key={brand} role="alert" className="mb-3 text-sm text-risk">{t.brandUnavailable(t.brand[brand])}</p>)}
        {!anyShown && <p className="mb-3 text-sm text-foreground-muted">{t.allHidden}</p>}
        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          {days.map((day) => <Card key={day.date} className="min-w-0 p-3">
            <h2 className="mb-3 text-sm font-semibold">{dayLabel(day.date, calendar.from, lang)}</h2>
            {day.posts.length === 0 ? <p className="text-sm text-foreground-muted">{t.empty}</p>
              : <ul className="grid gap-2" aria-label={dayLabel(day.date, calendar.from, lang)}>
                {day.posts.map((post) => <li key={post.id}><PostCard post={post} connected={calendar.connected} lang={lang} onOpen={() => setOpen(post.id)} /></li>)}
              </ul>}
          </Card>)}
        </div>
        {openPost && <PostDialog key={openPost.id} post={openPost} connected={calendar.connected} lang={lang} onClose={() => { mutation.reset(); setOpen(null); }}
          onSwitch={onSwitch} saving={mutation.isPending} failed={mutation.isError} isPreview={isPreview} />}
      </>}
  </section>;
}
