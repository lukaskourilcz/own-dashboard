import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pragueScheduledAt } from "@/lib/marketing/clock";
import { pragueMarketingDate } from "@/lib/marketing/weekly-planning";
import { pragueDayAfter } from "@/lib/marketing/dneskai-workspace";
import { readDneskaiPlan } from "@/lib/marketing/dneskai-plan-read";
import { dneskaiPlanEnabled } from "@/lib/marketing/dneskai-evidence-rollout";
import {
  PUBLISHING_CALENDAR_DAYS,
  PUBLISHING_CALENDAR_VERSION,
  PUBLISHING_CONNECTED,
  PublishingCalendarSchema,
  coverHeadline,
  type PublishingBrand,
  type PublishingCalendar,
  type PublishingPost,
  type PublishingVersion,
} from "@/lib/publishing-calendar";
import { devsharkCalendarRenders, dneskaiCalendarRenders } from "@/lib/publishing-calendar-renders";
import { DevsharkDeckSchema } from "@/lib/marketing/devshark-deck";
import { dneskaiThreadsText, stripThreadsHashtags } from "@/lib/marketing/dneskai-threads";
import type { DesignLabPicture } from "@/lib/marketing/design-lab-renders";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = SupabaseClient<any>;

/**
 * Both brands post a story from the Instagram cover ten minutes after the post (`DEVSHARK_STORY_DELAY_MS`, the DNESKAi
 * plan's story delay). Kept here so this read never imports the renderer and its native image library.
 */
const STORY_DELAY_MS = 10 * 60_000;
const pragueTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const later = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const https = (value: unknown) => { try { return typeof value === "string" && new URL(value).protocol === "https:" ? value : null; } catch { return null; } };

/**
 * The stored assets of a revision, read defensively as the Lab reads them (every asset in order, https only, no
 * mime filter, so the count still lines up with the deck's slides); an asset that does not parse is left out.
 */
function storedAssets(revision: unknown): DesignLabPicture[] {
  const assets = (revision as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets)) return [];
  return assets.flatMap((raw): DesignLabPicture[] => {
    const asset = raw as { url?: unknown; alt?: unknown; width?: unknown; height?: unknown };
    const url = https(asset?.url);
    if (!url || !Number.isInteger(asset.width) || !Number.isInteger(asset.height) || (asset.width as number) <= 0 || (asset.height as number) <= 0) return [];
    return [{ url, alt: typeof asset.alt === "string" ? asset.alt : "", width: asset.width as number, height: asset.height as number }];
  });
}
const deckOf = (revision: unknown) => {
  const deck = (revision as { deck?: unknown } | null)?.deck as { kit?: unknown; slides?: unknown } | undefined;
  return deck && Array.isArray(deck.slides) ? { ...(typeof deck.kit === "string" ? { kit: deck.kit } : {}), slides: deck.slides as unknown[] } : null;
};
const captionOf = (revision: unknown) => {
  const caption = (revision as { caption?: unknown } | null)?.caption;
  return typeof caption === "string" ? caption.slice(0, 2200) : null;
};

async function revisionsById(db: Database, owner: string, ids: string[]) {
  if (!ids.length) return new Map<string, unknown>();
  const { data, error } = await db.from("marketing_revisions").select("id,revision").eq("user_id", owner).in("id", ids);
  if (error) throw new Error("revisions-unavailable");
  return new Map(((data ?? []) as Array<{ id: string; revision: unknown }>).map((row) => [row.id, row.revision]));
}

/** How many saved versions in a row the calendar follows from the plan's head to the newest one. */
const SUCCESSOR_STEPS = 10;
/**
 * The newest saved version of each revision, as the Design Lab shows it: the plan names its head, but an edit saved in
 * the Lab is a successor (`replaces_id`) the plan picks up only on its next tick. Follows the newest successor, as the
 * plan's own `resolveHead` does, a bounded number of steps.
 */
async function newestVersions(db: Database, owner: string, ids: string[]): Promise<Map<string, string>> {
  const newest = new Map(ids.map((id) => [id, id]));
  let frontier = new Map(ids.map((id) => [id, [id]]));
  for (let step = 0; step < SUCCESSOR_STEPS && frontier.size; step++) {
    const { data, error } = await db.from("marketing_revisions").select("id,replaces_id,created_at").eq("user_id", owner).in("replaces_id", [...frontier.keys()]).order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error("revisions-unavailable");
    const next = new Map<string, string[]>();
    for (const row of (data ?? []) as Array<{ id: string; replaces_id: string }>) {
      const origins = frontier.get(row.replaces_id);
      // Newest first: the first successor of a version wins.
      if (!origins || [...next.values()].some((list) => list === origins)) continue;
      for (const origin of origins) newest.set(origin, row.id);
      next.set(row.id, origins);
    }
    frontier = next;
  }
  return newest;
}

type Switches = ReadonlySet<string>;
const switchKey = (brand: PublishingBrand, slot: string, channel: string) => `${brand}:${slot}:${channel}`;
/** The owner's sharing switches as `brand:slot:channel` keys; a row means "off". */
async function readSwitches(db: Database, owner: string): Promise<Switches> {
  const { data, error } = await db.from("marketing_publishing_switches").select("brand,slot_id,channel").eq("user_id", owner).limit(1000);
  if (error) throw new Error("publishing-switches-unavailable");
  return new Set(((data ?? []) as Array<{ brand: PublishingBrand; slot_id: string; channel: string }>).map((row) => switchKey(row.brand, row.slot_id, row.channel)));
}
/** Marks each version and the post off from the switches. */
function withSwitches(post: Omit<PublishingPost, "off" | "versions"> & { versions: Array<Omit<PublishingVersion, "off">> }, switches: Switches): PublishingPost {
  return { ...post, off: switches.has(switchKey(post.brand, post.slotId, "all")), versions: post.versions.map((version) => ({ ...version, off: switches.has(switchKey(post.brand, post.slotId, version.channel)) })) };
}
type Draft = Parameters<typeof withSwitches>[0];
type DraftVersion = Draft["versions"][number];
const beforePublication = (status: string) => status === "published" || status === "failed" ? "planned" : status;

async function dneskaiPosts(db: Database, owner: string, now: Date, from: string, switches: Switches): Promise<PublishingPost[]> {
  const plan = await readDneskaiPlan(db, owner, now, { from, days: PUBLISHING_CALENDAR_DAYS, enabled: dneskaiPlanEnabled() });
  const heads = await newestVersions(db, owner, [...new Set(plan.slots.flatMap((slot) => slot.labPostId ? [slot.labPostId] : []))]);
  const revisions = await revisionsById(db, owner, [...new Set(heads.values())]);
  return plan.slots.map((slot): PublishingPost => {
    const headId = slot.labPostId ? heads.get(slot.labPostId) ?? slot.labPostId : null;
    const head = headId ? revisions.get(headId) : undefined;
    // The pictures of the version the Design Lab shows, through the Lab's own resolver.
    const renders = headId && head ? dneskaiCalendarRenders({ id: headId, deck: deckOf(head), assets: storedAssets(head) }, slot.title) : null;
    const slides = renders?.slides ?? [];
    const versions: DraftVersion[] = [];
    if (slot.instagram) {
      const at = later(slot.scheduledAt, STORY_DELAY_MS);
      versions.push({ channel: "story", time: pragueTime(at), scheduledAt: at, status: slot.story?.publicationStatus ?? beforePublication(slot.status), caption: null, pictures: renders?.story.pictures ?? [], live: renders?.story.live ?? null });
      versions.push({ channel: "instagram", time: slot.time, scheduledAt: slot.scheduledAt, status: slot.instagram.publicationStatus ?? beforePublication(slot.status), caption: captionOf(head) ?? slot.instagram.caption, pictures: slides });
    }
    if (slot.threads) versions.push({ channel: "threads", time: slot.time, scheduledAt: slot.scheduledAt, status: slot.threads.publicationStatus ?? beforePublication(slot.status), caption: slot.threads.caption === null ? null : dneskaiThreadsText(slot.threads.caption), pictures: slides });
    return withSwitches({
      id: `dneskai:${slot.id}`, brand: "dneskai", slotId: slot.id, date: slot.date, time: slot.time, scheduledAt: slot.scheduledAt, title: slot.title, status: slot.status,
      headline: head ? coverHeadline((head as { deck?: unknown }).deck) : null,
      thumbnail: renders?.thumbnail ?? null, target: headId ? { kind: "dneskai-lab", postId: headId } : null, versions,
    }, switches);
  }).filter((post) => post.versions.length > 0);
}

type DevsharkSlotRow = { id: string; date: string; local_time: string; instagram: boolean; threads: boolean; status: string; draft_id: string;
  instagram_revision_id: string | null; threads_revision_id: string | null; story_revision_id: string | null };

async function devsharkPosts(db: Database, owner: string, from: string, until: string, switches: Switches): Promise<PublishingPost[]> {
  const slots = await db.from("marketing_devshark_plan").select("id,date,local_time,instagram,threads,status,draft_id,instagram_revision_id,threads_revision_id,story_revision_id")
    .eq("user_id", owner).gte("date", from).lte("date", until).order("date").order("local_time").limit(100);
  if (slots.error) throw new Error("devshark-plan-unavailable");
  const rows = ((slots.data ?? []) as DevsharkSlotRow[]).filter((row) => z.iso.date().safeParse(row.date).success);
  const draftIds = [...new Set(rows.map((row) => row.draft_id))];
  const revisionIds = [...new Set(rows.flatMap((row) => [row.instagram_revision_id, row.threads_revision_id, row.story_revision_id]).filter((id): id is string => !!id))];
  const [drafts, revisions, publications] = await Promise.all([
    draftIds.length ? db.from("marketing_devshark_drafts").select("id,title,caption,deck").eq("user_id", owner).in("id", draftIds) : Promise.resolve({ data: [], error: null }),
    revisionsById(db, owner, revisionIds),
    revisionIds.length ? db.from("marketing_publications").select("revision_id,platform,status").eq("user_id", owner).in("revision_id", revisionIds).neq("status", "cancelled") : Promise.resolve({ data: [], error: null }),
  ]);
  if (drafts.error || publications.error) throw new Error("devshark-plan-unavailable");
  const outcomes = new Map((publications.data ?? []).map((row) => [`${row.revision_id}:${row.platform}`, row.status]));
  const concepts = new Map(((drafts.data ?? []) as Array<{ id: string; title: string; caption: string; deck: unknown }>).map((row) => [row.id, row]));
  return rows.map((row): PublishingPost => {
    const concept = concepts.get(row.draft_id);
    const title = (concept?.title ?? "devShark").slice(0, 300) || "devShark";
    const scheduledAt = new Date(pragueScheduledAt(row.date, row.local_time)).toISOString();
    const post = row.instagram_revision_id ? revisions.get(row.instagram_revision_id) : undefined;
    const threads = row.threads_revision_id ? revisions.get(row.threads_revision_id) : undefined;
    const statusOf = (revision: string | null, platform: "instagram" | "threads") =>
      (revision ? outcomes.get(`${revision}:${platform}`) : undefined) ?? beforePublication(row.status);
    const threadsCaption = captionOf(threads);
    const deck = DevsharkDeckSchema.safeParse(concept?.deck);
    // The Studio's pictures: the stored JPEGs once planned, before then the concept drawn by the Studio's own route.
    const renders = devsharkCalendarRenders(deck.success ? { title, deck: deck.data } : null,
      { post: storedAssets(post ?? null), threads: storedAssets(threads ?? null), story: storedAssets(row.story_revision_id ? revisions.get(row.story_revision_id) : null) });
    const versions: DraftVersion[] = [];
    if (row.instagram) {
      const at = later(scheduledAt, STORY_DELAY_MS);
      versions.push({ channel: "story", time: pragueTime(at), scheduledAt: at, status: statusOf(row.story_revision_id, "instagram"), caption: null, pictures: renders.story });
      versions.push({ channel: "instagram", time: row.local_time, scheduledAt, status: statusOf(row.instagram_revision_id, "instagram"), caption: captionOf(post) ?? concept?.caption?.slice(0, 2200) ?? null, pictures: renders.slides, live: renders.live });
    }
    if (row.threads) versions.push({ channel: "threads", time: row.local_time, scheduledAt, status: statusOf(row.threads_revision_id, "threads"), caption: threadsCaption === null ? null : stripThreadsHashtags(threadsCaption), pictures: renders.threads, live: renders.live });
    return withSwitches({
      id: `devshark:${row.id}`, brand: "devshark", slotId: row.id, date: row.date, time: row.local_time, scheduledAt, title, status: row.status, headline: coverHeadline(concept?.deck),
      thumbnail: renders.thumbnail, target: { kind: "devshark-studio", draftId: row.draft_id }, versions,
    }, switches);
  }).filter((post) => post.versions.length > 0);
}

/**
 * Today and the next two Prague days of both brands' plans, one post per card, read through the owner's session so
 * own-only RLS decides what is visible. A brand whose plan cannot be read is listed in `unavailable`; the other still
 * shows.
 */
export async function readPublishingCalendar(db: Database, owner: string, now: Date): Promise<PublishingCalendar> {
  z.uuid().parse(owner);
  const from = pragueMarketingDate(now);
  const days = Array.from({ length: PUBLISHING_CALENDAR_DAYS }, (_, index) => pragueDayAfter(from, index));
  const brands: PublishingBrand[] = ["dneskai", "devshark"];
  // Without the switches nothing can say what is off, so the whole read fails rather than show a version as live.
  const switches = await readSwitches(db, owner);
  const reads = await Promise.allSettled([dneskaiPosts(db, owner, now, from, switches), devsharkPosts(db, owner, from, days[days.length - 1]!, switches)]);
  const unavailable = brands.filter((_, index) => reads[index]!.status === "rejected");
  const posts = reads.flatMap((read) => read.status === "fulfilled" ? read.value : []);
  return PublishingCalendarSchema.parse({ schemaVersion: PUBLISHING_CALENDAR_VERSION, generatedAt: now.toISOString(), from, days, connected: PUBLISHING_CONNECTED, unavailable, posts });
}
