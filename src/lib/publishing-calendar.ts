import { z } from "zod";

/**
 * The publishing calendar (owner request, 8 November 2026): what DNESKAi and devShark share in the next three Prague
 * days, one item per post and channel. Instagram (post and story) and Threads publish today. Facebook and LinkedIn are
 * channels of the model already, so the section shows them; until an account is connected they carry no items and their
 * filter is disabled.
 */
export const PUBLISHING_CALENDAR_VERSION = "publishing-calendar/1";
export const PUBLISHING_CALENDAR_DAYS = 3;
export const PUBLISHING_BRANDS = ["dneskai", "devshark"] as const;
export const PUBLISHING_CHANNELS = ["facebook", "instagram", "story", "threads", "linkedin"] as const;
/** The filter toolbar's networks; an Instagram story is filtered with Instagram. */
export const PUBLISHING_NETWORKS = ["facebook", "instagram", "threads", "linkedin"] as const;
export type PublishingBrand = (typeof PUBLISHING_BRANDS)[number];
export type PublishingChannel = (typeof PUBLISHING_CHANNELS)[number];
export type PublishingNetwork = (typeof PUBLISHING_NETWORKS)[number];

export const networkOfChannel = (channel: PublishingChannel): PublishingNetwork => channel === "story" ? "instagram" : channel;

const Thumbnail = z.strictObject({ url: z.url({ protocol: /^https$/ }), alt: z.string().max(500), width: z.number().int().positive(), height: z.number().int().positive() });
/** Where a click goes: the DNESKAi post in the Design Lab, or the devShark concept in the Studio. */
const Target = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dneskai-lab"), postId: z.uuid() }),
  z.strictObject({ kind: z.literal("devshark-studio"), draftId: z.uuid() }),
]);
export const PublishingItemSchema = z.strictObject({
  id: z.string().min(1).max(200),
  brand: z.enum(PUBLISHING_BRANDS),
  channel: z.enum(PUBLISHING_CHANNELS),
  date: z.iso.date(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  scheduledAt: z.iso.datetime(),
  title: z.string().min(1).max(300),
  status: z.string().regex(/^[a-z][a-z_-]{0,40}$/),
  thumbnail: Thumbnail.nullable(),
  target: Target.nullable(),
});
export type PublishingItem = z.infer<typeof PublishingItemSchema>;

export const PublishingCalendarSchema = z.strictObject({
  schemaVersion: z.literal(PUBLISHING_CALENDAR_VERSION),
  generatedAt: z.iso.datetime(),
  from: z.iso.date(),
  days: z.array(z.iso.date()).length(PUBLISHING_CALENDAR_DAYS),
  /** Networks with a connected account; the others show "Not connected yet". */
  connected: z.strictObject({ facebook: z.boolean(), instagram: z.boolean(), threads: z.boolean(), linkedin: z.boolean() }),
  /** A brand whose plan could not be read; the other brand still shows. */
  unavailable: z.array(z.enum(PUBLISHING_BRANDS)),
  items: z.array(PublishingItemSchema).max(400),
});
export type PublishingCalendar = z.infer<typeof PublishingCalendarSchema>;

/** Facebook and LinkedIn have no publisher yet: connected only once one is built (owner request, 8 November 2026). */
export const PUBLISHING_CONNECTED: PublishingCalendar["connected"] = { facebook: false, instagram: true, threads: true, linkedin: false };

/** Items of the networks switched on, by day, in time order (brand, then channel, break a tie). */
export function publishingDays(calendar: Pick<PublishingCalendar, "days" | "items">, networks: ReadonlySet<PublishingNetwork>): Array<{ date: string; items: PublishingItem[] }> {
  const order = (item: PublishingItem) => `${item.scheduledAt}|${PUBLISHING_BRANDS.indexOf(item.brand)}|${PUBLISHING_CHANNELS.indexOf(item.channel)}`;
  return calendar.days.map((date) => ({
    date,
    items: calendar.items.filter((item) => item.date === date && networks.has(networkOfChannel(item.channel))).sort((a, b) => order(a).localeCompare(order(b))),
  }));
}

export function publishingNetworkCounts(items: readonly PublishingItem[]): Record<PublishingNetwork, number> {
  const counts = { facebook: 0, instagram: 0, threads: 0, linkedin: 0 };
  for (const item of items) counts[networkOfChannel(item.channel)] += 1;
  return counts;
}

/** The workspace URL that opens a post's detail: the DNESKAi Design Lab in its Studio view, or the devShark Studio. */
export function publishingTargetHref(target: NonNullable<PublishingItem["target"]>): string {
  const params = target.kind === "dneskai-lab"
    ? new URLSearchParams({ projectTab: "dneskai-review", labPost: target.postId, labSlide: "0", labView: "studio" })
    : new URLSearchParams({ projectTab: "devshark-studio", studioDraft: target.draftId });
  return `/projects/${target.kind === "dneskai-lab" ? "dneskai" : "devshark"}?${params}`;
}
