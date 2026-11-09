"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import Image from "next/image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, CircleDashed, ExternalLink, ImageIcon, Link2, Users } from "lucide-react";
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
import { renderDevsharkPreview } from "@/lib/marketing/devshark-studio";

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
        version("threads", "2026-11-08", "08:00", "approved", "Nový model přečte tabulku z fotky a spočítá ji za tebe. #AI"),
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
      return <span key={channel} title={connected[networkOfChannel(channel)] ? t.channel[channel] : `${t.channel[channel]} · ${t.notConnected}`}
        className={cn("inline-flex min-h-6 items-center gap-1 rounded-sm border px-1.5 text-[11px] font-medium",
          live ? "border-border-strong bg-surface-inset text-foreground" : "border-dashed border-border text-foreground-muted line-through decoration-foreground-muted/60")}>
        <Icon className="h-3 w-3" />{t.channelShort[channel]}
      </span>;
    })}
  </span>;
}

function PostCard({ post, connected, lang, onOpen }: { post: PublishingPost; connected: PublishingCalendar["connected"]; lang: Lang; onOpen: () => void }) {
  const t = strings[lang];
  const live = orderedVersions(post).filter((v) => versionLive(post, v) && connected[networkOfChannel(v.channel)]);
  const list = live.length ? live.map((v) => t.channel[v.channel]).join(", ") : t.nothingShared;
  return <button type="button" onClick={onOpen} aria-label={`${t.open(post.title, post.time)}. ${t.versionsOf(list)}`}
    className="flex w-full min-w-0 items-start gap-3 rounded-md border border-border bg-surface p-2.5 text-left hover:bg-surface-hover focus-ring">
    <span className="relative block h-[60px] w-12 shrink-0 overflow-hidden rounded border border-border bg-surface-inset">
      {post.thumbnail
        ? <Image unoptimized src={post.thumbnail.url} alt="" width={post.thumbnail.width} height={post.thumbnail.height} loading="lazy" sizes="3rem" className="h-full w-full object-cover" />
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
 * A version the Design Lab draws on demand, drawn here with the Lab's own request and route (owner request, 9 November
 * 2026): the DNESKAi story through the Lab's preview, an unplanned devShark concept through the Studio's. In
 * /dev-preview the DNESKAi story uses the Lab's fixture renderer; the Studio does not render there, so neither does this.
 */
function useLiveRender(live: PublishingLive | null | undefined, isPreview: boolean) {
  const enabled = !!live && !(live.kind === "devshark-deck" && isPreview);
  return useQuery({
    queryKey: [...qk.publishingCalendarLive, isPreview ? "preview" : "live", JSON.stringify(live ?? null)],
    enabled, staleTime: 5 * 60_000, gcTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<Array<{ src: string; alt: string }>> => {
      if (!live) return [];
      if (live.kind === "dneskai-story") {
        const result = await (await dneskaiWorkspaceApi(isPreview)).renderPreview(live.request, signal);
        return result.status === "rendered" && result.image ? [{ src: result.image, alt: "" }] : [];
      }
      return (await renderDevsharkPreview(live.deck)).slides.map((slide) => ({ src: slide.src, alt: slide.alt }));
    },
  });
}

/** How one version will look: the 9:16 story frame, the slides as a carousel, the Threads text with its picture. */
function VersionPreview({ version, title, lang, isPreview }: { version: PublishingVersion; title: string; lang: Lang; isPreview: boolean }) {
  const t = strings[lang];
  const pictures = version.pictures;
  const live = useLiveRender(pictures.length ? null : version.live, isPreview);
  const drawn = live.data ?? [];
  const waiting = live.isFetching && !drawn.length;
  const missing = <p className="flex h-full items-center justify-center p-3 text-center text-xs text-foreground-muted" role={waiting ? "status" : undefined}>
    {waiting ? t.rendering : live.isError ? t.renderFailed : t.notRendered}</p>;
  return <div className="space-y-3">
    <p className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
      <span className="font-semibold tabular-nums text-foreground">{t.channel[version.channel]} {t.at(version.time)}</span>
      <StatusBadge value={`publishing-${version.status}`} label={t.statuses[version.status] ?? version.status} />
    </p>
    {version.channel === "story"
      ? <div className="mx-auto aspect-[9/16] w-44 overflow-hidden rounded-lg border border-border bg-surface-inset sm:w-52" data-testid="story-frame">
          {pictures[0]
            ? <Image unoptimized src={pictures[0].url} alt={pictures[0].alt} width={pictures[0].width} height={pictures[0].height} className="h-full w-full object-cover" data-testid="story-image" />
            : drawn[0]
              // eslint-disable-next-line @next/next/no-img-element -- the Design Lab's own render, a data URL; nothing to optimise
              ? <img src={drawn[0].src} alt={t.storyAlt(title)} className="h-full w-full object-cover" data-testid="story-image" />
              : missing}
        </div>
      : pictures.length === 0 && drawn.length === 0
        ? <div className="rounded-md border border-dashed border-border-strong px-3 py-4">{missing}</div>
        : <ul role="list" tabIndex={0} aria-label={t.channel[version.channel]} data-testid="version-slides"
            className={cn("flex w-0 min-w-full snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain rounded-md pb-2 focus-ring", version.channel === "threads" && "max-w-xs")}>
            {pictures.length
              ? (version.channel === "threads" ? pictures.slice(0, 1) : pictures).map((picture, index) => <li key={`${picture.url}-${index}`} className="w-52 shrink-0 snap-start sm:w-60">
                <Image unoptimized src={picture.url} alt={picture.alt || t.slideOf(index + 1, pictures.length)} width={picture.width} height={picture.height} loading="lazy" sizes="15rem"
                  className="h-auto w-full rounded border border-border bg-surface-inset" />
              </li>)
              : (version.channel === "threads" ? drawn.slice(0, 1) : drawn).map((slide, index) => <li key={index} className="w-52 shrink-0 snap-start sm:w-60">
                {/* eslint-disable-next-line @next/next/no-img-element -- the Studio's own render, a data URL; nothing to optimise */}
                <img src={slide.src} alt={slide.alt || t.slideOf(index + 1, drawn.length)} width={1080} height={1350} className="h-auto w-full rounded border border-border bg-surface-inset" />
              </li>)}
          </ul>}
    {version.channel !== "story" && <p className="whitespace-pre-line rounded-md border border-border bg-surface-inset p-3 text-sm break-words" data-testid="version-caption">
      {version.caption?.trim() || <span className="text-foreground-muted">{t.noCaption}</span>}
    </p>}
  </div>;
}

function PostDialog({ post, connected, lang, onClose, onSwitch, saving, failed, isPreview }: { post: PublishingPost; connected: PublishingCalendar["connected"]; lang: Lang; onClose: () => void; isPreview: boolean;
  onSwitch: (input: PublishingSwitch) => void; saving: boolean; failed: boolean }) {
  const t = strings[lang];
  const versions = useMemo(() => new Map(post.versions.map((v) => [v.channel, v])), [post]);
  const [selected, setSelected] = useState<PublishingChannel>(() => orderedVersions(post)[0]!.channel);
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
    <DialogContent className="max-w-2xl" data-testid="publishing-post-dialog">
      <DialogTitle className="pr-10 text-base font-semibold">{t.dialogTitle(post.title)}</DialogTitle>
      <DialogDescription className="mt-1 text-xs text-foreground-muted">{t.brand[post.brand]} · {t.versionsOf(orderedVersions(post).map((v) => t.channel[v.channel]).join(", "))}</DialogDescription>
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
        {current ? <VersionPreview version={current} title={post.title} lang={lang} isPreview={isPreview} /> : <p className="text-sm text-foreground-muted">{t.noVersion}</p>}
      </div>
      {post.target && <div className="mt-4 flex justify-end">
        <Button type="button" variant="outline" onClick={() => { const target = post.target!; onClose(); openTarget(target, selected); }}>
          <ExternalLink className="h-4 w-4" aria-hidden />{t.editInLab}
        </Button>
      </div>}
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
