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
  type PublishingPicture,
  type PublishingPost,
  type PublishingVersion,
} from "@/lib/publishing-calendar";

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

/** The rendered JPEGs of a stored revision, read defensively: an asset that does not parse is left out. */
function pictures(revision: unknown, fallbackAlt: string): PublishingPicture[] {
  const assets = (revision as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets)) return [];
  return assets.flatMap((raw): PublishingPicture[] => {
    const asset = raw as { url?: unknown; alt?: unknown; width?: unknown; height?: unknown; mimeType?: unknown };
    const url = https(asset?.url);
    if (asset?.mimeType !== "image/jpeg" || !url || !Number.isInteger(asset.width) || !Number.isInteger(asset.height)) return [];
    return [{ url, alt: (typeof asset.alt === "string" && asset.alt ? asset.alt : fallbackAlt).slice(0, 500), width: asset.width as number, height: asset.height as number }];
  }).slice(0, 10);
}
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

async function dneskaiPosts(db: Database, owner: string, now: Date, from: string, switches: Switches): Promise<PublishingPost[]> {
  const plan = await readDneskaiPlan(db, owner, now, { from, days: PUBLISHING_CALENDAR_DAYS, enabled: dneskaiPlanEnabled() });
  const stories = await revisionsById(db, owner, plan.slots.flatMap((slot) => [slot.story?.revisionId, slot.labPostId].filter((id): id is string => !!id)));
  return plan.slots.map((slot): PublishingPost => {
    const slides = slot.slides.filter((slide) => https(slide.url)).map((slide) => ({ url: slide.url, alt: (slide.alt || slot.title).slice(0, 500), width: slide.width, height: slide.height }));
    const versions: DraftVersion[] = [];
    if (slot.instagram) {
      const at = later(slot.scheduledAt, STORY_DELAY_MS);
      const story = slot.story?.revisionId ? pictures(stories.get(slot.story.revisionId), slot.title).slice(0, 1) : [];
      versions.push({ channel: "story", time: pragueTime(at), scheduledAt: at, status: slot.story?.publicationStatus ?? slot.status, caption: null, pictures: story.length ? story : slides.slice(0, 1) });
      versions.push({ channel: "instagram", time: slot.time, scheduledAt: slot.scheduledAt, status: slot.instagram.publicationStatus ?? slot.status, caption: slot.instagram.caption, pictures: slides });
    }
    if (slot.threads) versions.push({ channel: "threads", time: slot.time, scheduledAt: slot.scheduledAt, status: slot.threads.publicationStatus ?? slot.status, caption: slot.threads.caption, pictures: slides });
    return withSwitches({
      id: `dneskai:${slot.id}`, brand: "dneskai", slotId: slot.id, date: slot.date, time: slot.time, scheduledAt: slot.scheduledAt, title: slot.title, status: slot.status,
      headline: slot.labPostId ? coverHeadline((stories.get(slot.labPostId) as { deck?: unknown } | undefined)?.deck) : null,
      thumbnail: slides[0] ?? null, target: slot.labPostId ? { kind: "dneskai-lab", postId: slot.labPostId } : null, versions,
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
  const [drafts, revisions] = await Promise.all([
    draftIds.length ? db.from("marketing_devshark_drafts").select("id,title,caption,deck").eq("user_id", owner).in("id", draftIds) : Promise.resolve({ data: [], error: null }),
    revisionsById(db, owner, [...new Set(rows.flatMap((row) => [row.instagram_revision_id, row.threads_revision_id, row.story_revision_id]).filter((id): id is string => !!id))]),
  ]);
  if (drafts.error) throw new Error("devshark-plan-unavailable");
  const concepts = new Map(((drafts.data ?? []) as Array<{ id: string; title: string; caption: string; deck: unknown }>).map((row) => [row.id, row]));
  return rows.map((row): PublishingPost => {
    const concept = concepts.get(row.draft_id);
    const title = (concept?.title ?? "devShark").slice(0, 300) || "devShark";
    const scheduledAt = new Date(pragueScheduledAt(row.date, row.local_time)).toISOString();
    const post = row.instagram_revision_id ? revisions.get(row.instagram_revision_id) : undefined;
    const threads = row.threads_revision_id ? revisions.get(row.threads_revision_id) : undefined;
    const slides = pictures(post ?? threads ?? null, title);
    const versions: DraftVersion[] = [];
    if (row.instagram) {
      const at = later(scheduledAt, STORY_DELAY_MS);
      const story = pictures(row.story_revision_id ? revisions.get(row.story_revision_id) : null, title).slice(0, 1);
      versions.push({ channel: "story", time: pragueTime(at), scheduledAt: at, status: row.status, caption: null, pictures: story.length ? story : slides.slice(0, 1) });
      versions.push({ channel: "instagram", time: row.local_time, scheduledAt, status: row.status, caption: captionOf(post) ?? concept?.caption?.slice(0, 2200) ?? null, pictures: slides });
    }
    if (row.threads) versions.push({ channel: "threads", time: row.local_time, scheduledAt, status: row.status, caption: captionOf(threads), pictures: pictures(threads ?? post ?? null, title) });
    return withSwitches({
      id: `devshark:${row.id}`, brand: "devshark", slotId: row.id, date: row.date, time: row.local_time, scheduledAt, title, status: row.status, headline: coverHeadline(concept?.deck),
      thumbnail: slides[0] ?? null, target: { kind: "devshark-studio", draftId: row.draft_id }, versions,
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
