import { demoDneskaiWorkspaceApi, DEMO_DNESKAI_PROJECT_ID } from "@/lib/demo/dneskai-workspace-demo";
import { demoDevsharkStudio } from "@/lib/demo/devshark-studio-demo";
import { devsharkCalendarRenders, dneskaiCalendarRenders } from "@/lib/publishing-calendar-renders";
import {
  PUBLISHING_CONNECTED,
  coverHeadline,
  type PublishingCalendar,
  type PublishingLive,
  type PublishingPicture,
  type PublishingPost,
  type PublishingSwitch,
  type PublishingVersion,
} from "@/lib/publishing-calendar";

/**
 * The publishing calendar for /dev-preview (8 November 2026), built from the same in-memory samples the Design Lab
 * edits: the DNESKAi workspace demo and the devShark studio demo. An edit saved in either shows here on the next read,
 * which the e2e checks. Sharing switches live in memory too. Never calls a server.
 */
const off = new Set<string>();
const key = (brand: string, slot: string, channel: string) => `${brand}:${slot}:${channel}`;
/** Fixed slot ids, so a switch survives an edit (a saved DNESKAi edit is a new revision id). */
const SLOTS = ["00000000-0000-4000-8000-0000000000d1", "00000000-0000-4000-8000-0000000000d2", "00000000-0000-4000-8000-0000000000d3", "00000000-0000-4000-8000-0000000000d4"];

const pragueDate = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const dayAfter = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const at = (date: string, time: string) => new Date(`${date}T${time}:00+01:00`).toISOString();
const plus = (time: string, minutes: number) => { const [h, m] = time.split(":").map(Number); const t = h! * 60 + m! + minutes; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

function version(channel: PublishingVersion["channel"], date: string, time: string, status: string, caption: string | null, pictures: PublishingPicture[], live: PublishingLive | null = null): Omit<PublishingVersion, "off"> {
  return { channel, time, scheduledAt: at(date, time), status, caption, pictures, live };
}

function withSwitches(post: Omit<PublishingPost, "off" | "versions"> & { versions: Array<Omit<PublishingVersion, "off">> }): PublishingPost {
  return { ...post, off: off.has(key(post.brand, post.slotId, "all")), versions: post.versions.map((v) => ({ ...v, off: off.has(key(post.brand, post.slotId, v.channel)) })) };
}

export async function previewPublishingCalendar(now = new Date()): Promise<PublishingCalendar> {
  const [dneskai, devshark] = await Promise.all([demoDneskaiWorkspaceApi.loadReview(DEMO_DNESKAI_PROJECT_ID), demoDevsharkStudio.load()]);
  const today = pragueDate(now);
  const days = [today, dayAfter(today, 1), dayAfter(today, 2)];
  const posts: PublishingPost[] = [];
  // Posts waiting for review first: those the Design Lab lets the owner edit.
  const live = dneskai.posts.filter((post) => post.deck && !["superseded", "skipped", "returned"].includes(post.status))
    .sort((a, b) => Number(b.status === "review") - Number(a.status === "review") || a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, 2);
  live.forEach((post, index) => {
    const date = days[index]!, time = index === 0 ? "08:00" : "12:30";
    // The same resolver the Design Lab and the server read use: all slides or none, the Lab's 9:16 story request.
    const renders = dneskaiCalendarRenders(post, post.title);
    posts.push(withSwitches({
      id: `dneskai:${SLOTS[index]}`, brand: "dneskai", slotId: SLOTS[index]!, date, time, scheduledAt: at(date, time), title: post.title, headline: coverHeadline(post.deck),
      status: post.status, thumbnail: renders.thumbnail, target: { kind: "dneskai-lab", postId: post.id },
      versions: [version("story", date, plus(time, 10), post.status, null, renders.story.pictures, renders.story.live), version("instagram", date, time, post.status, post.caption, renders.slides), version("threads", date, time, post.status, post.caption.split("\n\n")[0] ?? post.caption, renders.slides)],
    }));
  });
  devshark.drafts.slice(0, 2).forEach((draft, index) => {
    const date = today, time = index === 0 ? "12:00" : "19:00", slot = SLOTS[2 + index]!;
    // Nothing is stored in the preview, so the post is the Studio's render request, as the Studio draws it.
    const renders = devsharkCalendarRenders(draft, { post: [], threads: [], story: [] });
    const versions = index === 0
      ? [version("story", date, plus(time, 10), draft.status, null, renders.story), version("instagram", date, time, draft.status, draft.caption, renders.slides, renders.live), version("threads", date, time, draft.status, draft.caption.split("\n\n")[0] ?? draft.caption, renders.threads, renders.live)]
      : [version("threads", date, time, draft.status, draft.caption.split("\n\n")[0] ?? draft.caption, renders.threads, renders.live)];
    posts.push(withSwitches({
      id: `devshark:${slot}`, brand: "devshark", slotId: slot, date, time, scheduledAt: at(date, time), title: draft.title, headline: coverHeadline(draft.deck),
      status: draft.status, thumbnail: renders.thumbnail, target: { kind: "devshark-studio", draftId: draft.id }, versions,
    }));
  });
  return { schemaVersion: "publishing-calendar/2", generatedAt: now.toISOString(), from: today, days, connected: PUBLISHING_CONNECTED, unavailable: [], posts };
}

export async function previewPublishingSwitch(input: PublishingSwitch) {
  if (input.off) off.add(key(input.brand, input.slotId, input.channel));
  else off.delete(key(input.brand, input.slotId, input.channel));
}
