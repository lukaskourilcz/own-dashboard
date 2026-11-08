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
  type PublishingBrand,
  type PublishingCalendar,
  type PublishingItem,
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

type Thumb = PublishingItem["thumbnail"];
/** The first rendered JPEG of a stored revision, read defensively: a revision that does not parse has no thumbnail. */
function firstAsset(revision: unknown, fallbackAlt: string): Thumb {
  const assets = (revision as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets)) return null;
  const asset = assets.find((item) => (item as { mimeType?: unknown })?.mimeType === "image/jpeg") as { url?: unknown; alt?: unknown; width?: unknown; height?: unknown } | undefined;
  const url = https(asset?.url);
  if (!asset || !url || !Number.isInteger(asset.width) || !Number.isInteger(asset.height)) return null;
  return { url, alt: (typeof asset.alt === "string" && asset.alt ? asset.alt : fallbackAlt).slice(0, 500), width: asset.width as number, height: asset.height as number };
}

async function dneskaiItems(db: Database, owner: string, now: Date, from: string): Promise<PublishingItem[]> {
  const plan = await readDneskaiPlan(db, owner, now, { from, days: PUBLISHING_CALENDAR_DAYS, enabled: dneskaiPlanEnabled() });
  return plan.slots.flatMap((slot): PublishingItem[] => {
    const slide = slot.slides[0];
    const thumbnail = slide && https(slide.url) ? { url: slide.url, alt: (slide.alt || slot.title).slice(0, 500), width: slide.width, height: slide.height } : null;
    const target = slot.labPostId ? { kind: "dneskai-lab" as const, postId: slot.labPostId } : null;
    const base = { brand: "dneskai" as const, date: slot.date, title: slot.title, thumbnail, target };
    const items: PublishingItem[] = [];
    if (slot.instagram) {
      items.push({ ...base, id: `dneskai:${slot.id}:instagram`, channel: "instagram", time: slot.time, scheduledAt: slot.scheduledAt, status: slot.status });
      const at = later(slot.scheduledAt, STORY_DELAY_MS);
      items.push({ ...base, id: `dneskai:${slot.id}:story`, channel: "story", time: pragueTime(at), scheduledAt: at, status: slot.story?.publicationStatus ?? slot.status });
    }
    if (slot.threads) items.push({ ...base, id: `dneskai:${slot.id}:threads`, channel: "threads", time: slot.time, scheduledAt: slot.scheduledAt, status: slot.threads?.publicationStatus ?? slot.status });
    return items;
  });
}

type DevsharkSlotRow = { id: string; date: string; local_time: string; instagram: boolean; threads: boolean; status: string; draft_id: string; instagram_revision_id: string | null; threads_revision_id: string | null };

async function devsharkItems(db: Database, owner: string, from: string, until: string): Promise<PublishingItem[]> {
  const slots = await db.from("marketing_devshark_plan").select("id,date,local_time,instagram,threads,status,draft_id,instagram_revision_id,threads_revision_id")
    .eq("user_id", owner).gte("date", from).lte("date", until).order("date").order("local_time").limit(100);
  if (slots.error) throw new Error("devshark-plan-unavailable");
  const rows = (slots.data ?? []) as DevsharkSlotRow[];
  const draftIds = [...new Set(rows.map((row) => row.draft_id))];
  const revisionIds = [...new Set(rows.flatMap((row) => [row.instagram_revision_id, row.threads_revision_id]).filter((id): id is string => !!id))];
  const [drafts, revisions] = await Promise.all([
    draftIds.length ? db.from("marketing_devshark_drafts").select("id,title").eq("user_id", owner).in("id", draftIds) : Promise.resolve({ data: [], error: null }),
    revisionIds.length ? db.from("marketing_revisions").select("id,revision").eq("user_id", owner).in("id", revisionIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (drafts.error || revisions.error) throw new Error("devshark-plan-unavailable");
  const titles = new Map(((drafts.data ?? []) as Array<{ id: string; title: string }>).map((row) => [row.id, row.title]));
  const stored = new Map(((revisions.data ?? []) as Array<{ id: string; revision: unknown }>).map((row) => [row.id, row.revision]));
  return rows.flatMap((row): PublishingItem[] => {
    if (!z.iso.date().safeParse(row.date).success) return [];
    const title = (titles.get(row.draft_id) ?? "devShark").slice(0, 300) || "devShark";
    const scheduledAt = new Date(pragueScheduledAt(row.date, row.local_time)).toISOString();
    const thumbnail = firstAsset(stored.get(row.instagram_revision_id ?? "") ?? stored.get(row.threads_revision_id ?? "") ?? null, title);
    const base = { brand: "devshark" as const, date: row.date, title, thumbnail, status: row.status, target: { kind: "devshark-studio" as const, draftId: row.draft_id } };
    const items: PublishingItem[] = [];
    if (row.instagram) {
      items.push({ ...base, id: `devshark:${row.id}:instagram`, channel: "instagram", time: row.local_time, scheduledAt });
      const at = later(scheduledAt, STORY_DELAY_MS);
      items.push({ ...base, id: `devshark:${row.id}:story`, channel: "story", time: pragueTime(at), scheduledAt: at });
    }
    if (row.threads) items.push({ ...base, id: `devshark:${row.id}:threads`, channel: "threads", time: row.local_time, scheduledAt });
    return items;
  });
}

/**
 * Today and the next two Prague days of both brands' plans, read through the owner's session so own-only RLS decides
 * what is visible. A brand whose plan cannot be read is listed in `unavailable`; the other still shows.
 */
export async function readPublishingCalendar(db: Database, owner: string, now: Date): Promise<PublishingCalendar> {
  z.uuid().parse(owner);
  const from = pragueMarketingDate(now);
  const days = Array.from({ length: PUBLISHING_CALENDAR_DAYS }, (_, index) => pragueDayAfter(from, index));
  const brands: PublishingBrand[] = ["dneskai", "devshark"];
  const reads = await Promise.allSettled([dneskaiItems(db, owner, now, from), devsharkItems(db, owner, from, days[days.length - 1]!)]);
  const unavailable = brands.filter((_, index) => reads[index]!.status === "rejected");
  const items = reads.flatMap((read) => read.status === "fulfilled" ? read.value : []);
  return PublishingCalendarSchema.parse({ schemaVersion: PUBLISHING_CALENDAR_VERSION, generatedAt: now.toISOString(), from, days, connected: PUBLISHING_CONNECTED, unavailable, items });
}
