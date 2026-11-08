import { z } from "zod";

/**
 * The publishing calendar (owner request, 8 November 2026): what DNESKAi and devShark share in the next three Prague
 * days. One card per post (a DNESKAi plan slot, a devShark concept), with a version per channel it goes out on:
 * Instagram story, Instagram post and Threads publish today. Facebook and LinkedIn are channels of the model already;
 * until an account is connected they have no versions and their filter is disabled.
 */
export const PUBLISHING_CALENDAR_VERSION = "publishing-calendar/2";
export const PUBLISHING_CALENDAR_DAYS = 3;
export const PUBLISHING_BRANDS = ["dneskai", "devshark"] as const;
/** The order of the version selector in the post dialog and of the icons on a card. */
export const PUBLISHING_CHANNELS = ["story", "instagram", "threads", "linkedin", "facebook"] as const;
/** The filter toolbar's networks; an Instagram story is filtered with Instagram. */
export const PUBLISHING_NETWORKS = ["facebook", "instagram", "threads", "linkedin"] as const;
export type PublishingBrand = (typeof PUBLISHING_BRANDS)[number];
export type PublishingChannel = (typeof PUBLISHING_CHANNELS)[number];
export type PublishingNetwork = (typeof PUBLISHING_NETWORKS)[number];

export const networkOfChannel = (channel: PublishingChannel): PublishingNetwork => channel === "story" ? "instagram" : channel;

const Picture = z.strictObject({ url: z.url({ protocol: /^https$/ }), alt: z.string().max(500), width: z.number().int().positive(), height: z.number().int().positive() });
export type PublishingPicture = z.infer<typeof Picture>;
/** Where "Open" goes: the DNESKAi post in the Design Lab, or the devShark concept in the Studio. */
const Target = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dneskai-lab"), postId: z.uuid() }),
  z.strictObject({ kind: z.literal("devshark-studio"), draftId: z.uuid() }),
]);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const status = z.string().regex(/^[a-z][a-z_-]{0,40}$/);

/** One channel's version of a post, as the platform will show it. */
export const PublishingVersionSchema = z.strictObject({
  channel: z.enum(PUBLISHING_CHANNELS),
  time,
  scheduledAt: z.iso.datetime(),
  status,
  /** The caption or Threads text, hashtags included; null while the version is not written yet. */
  caption: z.string().max(2200).nullable(),
  /** The rendered slides (post, Threads) or the 9:16 story frame; empty while not rendered yet. */
  pictures: z.array(Picture).max(10),
  /** The owner switched this version off: it will not be published (the whole post off turns every version off). */
  off: z.boolean(),
});
export type PublishingVersion = z.infer<typeof PublishingVersionSchema>;

export const PublishingPostSchema = z.strictObject({
  id: z.string().min(1).max(200),
  brand: z.enum(PUBLISHING_BRANDS),
  /** The plan slot the sharing switches belong to. */
  slotId: z.uuid(),
  /** The whole post is switched off. */
  off: z.boolean(),
  date: z.iso.date(),
  /** The first version's time, for ordering the day. */
  time,
  scheduledAt: z.iso.datetime(),
  /** The DNESKAi topic or the devShark concept. */
  title: z.string().min(1).max(300),
  /** The first slide's headline as the post will show it, `[[marks]]` removed; null while not written yet. */
  headline: z.string().max(300).nullable(),
  status,
  thumbnail: Picture.nullable(),
  target: Target.nullable(),
  versions: z.array(PublishingVersionSchema).min(1).max(PUBLISHING_CHANNELS.length),
});
export type PublishingPost = z.infer<typeof PublishingPostSchema>;

export const PublishingCalendarSchema = z.strictObject({
  schemaVersion: z.literal(PUBLISHING_CALENDAR_VERSION),
  generatedAt: z.iso.datetime(),
  from: z.iso.date(),
  days: z.array(z.iso.date()).length(PUBLISHING_CALENDAR_DAYS),
  /** Networks with a connected account; the others show "Not connected yet". */
  connected: z.strictObject({ facebook: z.boolean(), instagram: z.boolean(), threads: z.boolean(), linkedin: z.boolean() }),
  /** A brand whose plan could not be read; the other brand still shows. */
  unavailable: z.array(z.enum(PUBLISHING_BRANDS)),
  posts: z.array(PublishingPostSchema).max(200),
});
export type PublishingCalendar = z.infer<typeof PublishingCalendarSchema>;

/** Facebook and LinkedIn have no publisher yet: connected only once one is built (owner request, 8 November 2026). */
export const PUBLISHING_CONNECTED: PublishingCalendar["connected"] = { facebook: false, instagram: true, threads: true, linkedin: false };

/** A post's versions in selector order. */
export const orderedVersions = (post: Pick<PublishingPost, "versions">) =>
  [...post.versions].sort((a, b) => PUBLISHING_CHANNELS.indexOf(a.channel) - PUBLISHING_CHANNELS.indexOf(b.channel));

/** Posts with a version on a network switched on, by day, in time order (brand breaks a tie). */
export function publishingDays(calendar: Pick<PublishingCalendar, "days" | "posts">, networks: ReadonlySet<PublishingNetwork>): Array<{ date: string; posts: PublishingPost[] }> {
  const order = (post: PublishingPost) => `${post.scheduledAt}|${PUBLISHING_BRANDS.indexOf(post.brand)}|${post.id}`;
  return calendar.days.map((date) => ({
    date,
    posts: calendar.posts
      .filter((post) => post.date === date && post.versions.some((version) => networks.has(networkOfChannel(version.channel))))
      .sort((a, b) => order(a).localeCompare(order(b))),
  }));
}

/** Posts per network (a post with a story and an Instagram post counts once for Instagram). */
export function publishingNetworkCounts(posts: readonly PublishingPost[]): Record<PublishingNetwork, number> {
  const counts = { facebook: 0, instagram: 0, threads: 0, linkedin: 0 };
  for (const post of posts)
    for (const network of new Set(post.versions.map((version) => networkOfChannel(version.channel)))) counts[network] += 1;
  return counts;
}

/** The workspace URL that opens a post's detail: the DNESKAi Design Lab in its Studio view, or the devShark Studio. */
export function publishingTargetHref(target: NonNullable<PublishingPost["target"]>): string {
  const params = target.kind === "dneskai-lab"
    ? new URLSearchParams({ projectTab: "dneskai-review", labPost: target.postId, labSlide: "0", labView: "studio" })
    : new URLSearchParams({ projectTab: "devshark-studio", studioDraft: target.draftId });
  return `/projects/${target.kind === "dneskai-lab" ? "dneskai" : "devshark"}?${params}`;
}

/** A sharing switch: a channel of a post, or "all" for the whole post (owner request, 8 November 2026). */
export const PUBLISHING_SWITCH_CHANNELS = ["all", ...PUBLISHING_CHANNELS] as const;
export const PublishingSwitchSchema = z.strictObject({
  brand: z.enum(PUBLISHING_BRANDS),
  slotId: z.uuid(),
  channel: z.enum(PUBLISHING_SWITCH_CHANNELS),
  off: z.boolean(),
});
export type PublishingSwitch = z.infer<typeof PublishingSwitchSchema>;

/** A version goes out only when neither it nor its whole post is switched off. */
export const versionLive = (post: Pick<PublishingPost, "off">, version: Pick<PublishingVersion, "off">) => !post.off && !version.off;

/** The first slide's headline of a deck (DNESKAi revision deck or devShark concept deck), `[[marks]]` removed. */
export function coverHeadline(deck: unknown): string | null {
  const slides = (deck as { slides?: unknown } | null)?.slides;
  const headline = Array.isArray(slides) ? (slides[0] as { headline?: unknown } | undefined)?.headline : undefined;
  return typeof headline === "string" && headline.trim() ? headline.replace(/\[\[|\]\]/g, "").trim().slice(0, 300) : null;
}
