import { z } from 'zod';
import type { DneskaiDeck, DneskaiSlideType } from './dneskai-slides';
import { DNESKAI_KIT_IDS, DNESKAI_RENDERABLE_KIT_IDS, DneskaiSlideTypeSchema, DneskaiSlideVariantSchema, dneskaiKitOf } from './dneskai-slides';
import { DneskaiDeckEditSchema } from './dneskai-deck-edit';
import { pragueScheduledAt } from './clock';
import {
  dneskaiJobState, dneskaiPostState, dneskaiRenderAttachFailed, dneskaiStateContext, pragueDate, pragueDayAfter, renderBlocking,
  type DneskaiFieldLimit, type DneskaiPostStateDetail, type DneskaiWorkspaceJob, type DneskaiWorkspacePost, type DneskaiWorkspaceRead,
} from './dneskai-workspace';

/**
 * The Design Lab's read model (design-lab-spec.md, variant-approval-model.md): the review read
 * (`dneskai-workspace/1`) seen as one day's queue of posts, each with its exact revision, its slides and the five
 * kits. Browser-safe and pure; the Lab builds it from the read it already has, so no new server read exists.
 *
 * Kits are per post and variants stay per slide (AGENT-RULES §9). A kit switch is an edit like any other: it saves a
 * new revision with its own assets and hash, and that hash needs its own approval. The vendored studio draws all five
 * kits; a tile shows a cover only for the kit the post was saved in, and the stage previews a newly chosen kit.
 */
export const DNESKAI_KITS = DNESKAI_KIT_IDS;
export const DneskaiKitSchema = z.enum(DNESKAI_KITS);
export type DneskaiKit = z.infer<typeof DneskaiKitSchema>;
/** A `dneskai-slides/1` deck has no kit field; it was drawn by the only look there is, which becomes `editorial`. */
export const DNESKAI_DEFAULT_KIT: DneskaiKit = 'editorial';
/**
 * The kits the vendored studio (vendor/carousel-studio, `caught-up`) can render and fit today. Additional kits need approved visual designs and a matching renderer before vendoring;
 * until then their covers stay unrendered.
 */
export const DNESKAI_RENDERABLE_KITS: readonly DneskaiKit[] = DNESKAI_RENDERABLE_KIT_IDS;
export const dneskaiKitRenderable = (kit: DneskaiKit) => DNESKAI_RENDERABLE_KITS.includes(kit);

/** The kit a deck was rendered with. v1 decks read as `editorial`; a v2 deck (`kit` field) names its own. */
export function dneskaiDeckKit(deck: DneskaiDeck | null): DneskaiKit {
  return dneskaiKitOf(deck);
}

export type DneskaiLabAsset = DneskaiWorkspacePost['assets'][number];
type DneskaiRenderProblem = NonNullable<DneskaiWorkspacePost['renderReport']>['problems'][number];

/** One kit tile: the post's cover in that kit when it was rendered, and whether the deck fits it. */
export type DneskaiLabKit = {
  id: DneskaiKit;
  /** The digit that selects it (1–6). */
  key: number;
  current: boolean;
  /** Whether OwnDashboard can render this kit at all today. */
  renderable: boolean;
  /** The rendered cover, or null when no cover exists for this kit. Never a stand-in picture. */
  cover: DneskaiLabAsset | null;
  /** Whether the deck's text fits the kit; null when nobody measured it (the kit cannot be fitted yet). */
  fits: boolean | null;
};

export type DneskaiLabSlide = {
  index: number;
  type: DneskaiSlideType;
  variant: string | null;
  /** The JPEG of this slide in the current kit, or null while it is not rendered. */
  render: DneskaiLabAsset | null;
  fields: DneskaiFieldLimit[];
  problems: DneskaiRenderProblem[];
};

/** Why a post cannot be approved right now, as a code the UI words; null when it can. */
export type DneskaiLabApprovalBlock = 'status' | 'render-blocked' | 'render-attach-failed' | 'preparing' | 'account-unverified' | 'deck-missing';

export type DneskaiLabDeadline = { at: string; time: string; date: string; minutesLeft: number; urgent: boolean; passed: boolean };

export type DneskaiLabPost = {
  post: DneskaiWorkspacePost;
  /** The exact revision an approval binds. */
  revision: { id: string; contentHash: string; shortHash: string };
  kit: DneskaiKit;
  kits: DneskaiLabKit[];
  slides: DneskaiLabSlide[];
  state: DneskaiPostStateDetail;
  deadline: DneskaiLabDeadline;
  block: DneskaiLabApprovalBlock | null;
};

export type DneskaiLabJob = { job: DneskaiWorkspaceJob; state: DneskaiPostStateDetail; deadline: DneskaiLabDeadline | null };
export type DneskaiLabDay = {
  date: string; posts: DneskaiLabPost[]; jobs: DneskaiLabJob[]; approvable: Array<{ id: string; contentHash: string }>;
  /** Topics of the day that wait for the scheduler, earliest first (owner decision 9, „Generate now“). */
  waiting: NonNullable<DneskaiWorkspaceRead['waiting']>;
};

/** A post whose slot is closer than this reads in the warning tone. */
export const DNESKAI_LAB_URGENT_MINUTES = 30;
export const shortHash = (hash: string) => hash.slice(0, 7);

const pragueTime = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

export function dneskaiLabDeadline(at: string, now: number): DneskaiLabDeadline {
  const minutesLeft = Math.floor((Date.parse(at) - now) / 60_000);
  return { at, time: pragueTime(at), date: pragueDate(at), minutesLeft, urgent: minutesLeft >= 0 && minutesLeft < DNESKAI_LAB_URGENT_MINUTES, passed: minutesLeft < 0 };
}

/**
 * The five kit tiles of a post. The current kit's cover is the first rendered slide; any other kit has a cover only
 * when one was rendered for it (none can be today, so `cover` is null and `fits` unknown).
 */
export function dneskaiLabKits(post: Pick<DneskaiWorkspacePost, 'deck' | 'assets' | 'renderReport'>): DneskaiLabKit[] {
  const current = dneskaiDeckKit(post.deck);
  return DNESKAI_KITS.map((id, index) => {
    const isCurrent = id === current;
    const clipped = !!post.renderReport?.problems.some((problem) => problem.code === 'text-clipped');
    return {
      id, key: index + 1, current: isCurrent, renderable: dneskaiKitRenderable(id),
      cover: isCurrent ? post.assets[0] ?? null : null,
      fits: isCurrent && post.renderReport ? !clipped : null,
    };
  });
}

export function dneskaiLabSlides(post: Pick<DneskaiWorkspacePost, 'deck' | 'assets' | 'fields' | 'renderReport'>): DneskaiLabSlide[] {
  // Assets line up with slides only when the render attached one JPEG per slide.
  const complete = !!post.deck && post.assets.length === post.deck.slides.length;
  return (post.deck?.slides ?? []).map((slide, index) => ({
    index, type: slide.type, variant: slide.variant ?? null,
    render: complete ? post.assets[index] ?? null : null,
    fields: post.fields[index] ?? [],
    problems: (post.renderReport?.problems ?? []).filter((problem) => problem.slide === index),
  }));
}

/** Server-side rules the approve route enforces too, so the Lab never offers a button the server refuses. */
export function dneskaiLabApprovalBlock(post: DneskaiWorkspacePost, read: Pick<DneskaiWorkspaceRead, 'accounts' | 'generatedAt'>, renderFailed?: ReadonlySet<string>): DneskaiLabApprovalBlock | null {
  const context = dneskaiStateContext(read, renderFailed);
  if (post.status !== 'review') return 'status';
  if (!post.deck) return 'deck-missing';
  if (renderBlocking(post.renderReport)) return 'render-blocked';
  if (dneskaiRenderAttachFailed(post, context)) return 'render-attach-failed';
  if (!post.ready || dneskaiPostState(post, context).state === 'preparing') return 'preparing';
  if (!read.accounts.some((account) => account.verified && account.remoteId === post.account.id)) return 'account-unverified';
  return null;
}

export function dneskaiLabPost(post: DneskaiWorkspacePost, read: Pick<DneskaiWorkspaceRead, 'accounts' | 'generatedAt'>, now: number, renderFailed?: ReadonlySet<string>): DneskaiLabPost {
  const at = post.publication?.scheduledAt ?? post.scheduledAt;
  return {
    post,
    revision: { id: post.id, contentHash: post.contentHash, shortHash: shortHash(post.contentHash) },
    kit: dneskaiDeckKit(post.deck),
    kits: dneskaiLabKits(post),
    slides: dneskaiLabSlides(post),
    state: dneskaiPostState(post, dneskaiStateContext(read, renderFailed)),
    deadline: dneskaiLabDeadline(at, now),
    block: dneskaiLabApprovalBlock(post, read, renderFailed),
  };
}

/**
 * One Prague day of the Lab queue: every post planned that day in slot order (superseded versions never, skipped ones
 * last so the owner can still see them), the drafting jobs for it, and the posts „approve the day“ would approve with
 * the exact hash each one binds.
 */
export function dneskaiLabDay(read: DneskaiWorkspaceRead, date: string, now: number, renderFailed?: ReadonlySet<string>): DneskaiLabDay {
  const posts = read.posts
    .filter((post) => post.status !== 'superseded' && pragueDate(post.publication?.scheduledAt ?? post.scheduledAt) === date)
    .map((post) => dneskaiLabPost(post, read, now, renderFailed))
    .sort((a, b) => Number(a.post.status === 'skipped') - Number(b.post.status === 'skipped') || Date.parse(a.deadline.at) - Date.parse(b.deadline.at));
  const jobs = read.jobs
    .filter((job) => job.scheduledAt && pragueDate(job.scheduledAt) === date)
    .map((job) => ({ job, state: dneskaiJobState(job), deadline: job.scheduledAt ? dneskaiLabDeadline(job.scheduledAt, now) : null }))
    .sort((a, b) => Date.parse(a.job.scheduledAt!) - Date.parse(b.job.scheduledAt!));
  const approvable = posts.filter((item) => item.block === null && !item.deadline.passed).map((item) => ({ id: item.revision.id, contentHash: item.revision.contentHash }));
  const waiting = (read.waiting ?? []).filter((brief) => pragueDate(brief.scheduledAt) === date).sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  return { date, posts, jobs, approvable, waiting };
}

/** The days the Lab queue shows: today and tomorrow (the night's collection prepares tomorrow's posts). */
export function dneskaiLabQueue(read: DneskaiWorkspaceRead, now: number, renderFailed?: ReadonlySet<string>): DneskaiLabDay[] {
  return [read.today, pragueDayAfter(read.today, 1)].map((date) => dneskaiLabDay(read, date, now, renderFailed));
}

/** Every reviewable post across the queue in order, the J/K and ↑/↓ path. */
export const dneskaiLabOrder = (days: readonly DneskaiLabDay[]) => days.flatMap((day) => day.posts);

/** The profile grid's other cells: the newest covers of other posts that were published or are scheduled, newest first. */
export function dneskaiLabProfileCovers(read: Pick<DneskaiWorkspaceRead, 'posts'>, exceptId: string, limit = 8): DneskaiLabAsset[] {
  return read.posts
    .filter((post) => post.id !== exceptId && post.assets[0] && ['published', 'approved', 'publishing'].includes(post.status))
    .sort((a, b) => Date.parse(b.publication?.publishedAt ?? b.scheduledAt) - Date.parse(a.publication?.publishedAt ?? a.scheduledAt))
    .slice(0, limit)
    .map((post) => post.assets[0]!);
}

/* ---- moved, approve again (owner decision 6, 22 October 2026) ------------- */

/** A moved post's new slot is at least this far ahead: the tick runs every 5 minutes and the owner needs a moment. */
export const DNESKAI_MOVE_LEAD_MINUTES = 15;
/** Another scheduled DNESKAi post this close to a slot takes it, as in the brief allocator. */
export const DNESKAI_MOVE_CLEARANCE_MINUTES = 60;

/**
 * The next free daily slot for a post that missed its own: one of the DNESKAi slots of today or tomorrow (Prague), at
 * least 15 minutes ahead and not within an hour of another scheduled post. Null when both days are full or over. The
 * server repeats this with its own reads before it moves anything (`approve-at`).
 */
export function dneskaiNextFreeSlot(input: { today: string; slots: readonly string[]; taken: readonly string[]; now: number }): string | null {
  const earliest = input.now + DNESKAI_MOVE_LEAD_MINUTES * 60_000;
  for (const date of [input.today, pragueDayAfter(input.today, 1)]) {
    for (const time of [...input.slots].sort()) {
      let at: string;
      try { at = pragueScheduledAt(date, time); } catch { continue; }
      const ms = Date.parse(at);
      if (ms < earliest) continue;
      if (input.taken.some((value) => Math.abs(Date.parse(value) - ms) < DNESKAI_MOVE_CLEARANCE_MINUTES * 60_000)) continue;
      return at;
    }
  }
  return null;
}

/** Statuses whose time holds a slot: everything still planned or already out, the post being moved excepted. */
const SLOT_HOLDING = new Set(['review', 'approved', 'publishing', 'published', 'reconciliation', 'returned']);
/** The instants other posts, drafting jobs and waiting topics hold, as the browser sees them in the read. */
export function dneskaiTakenSlots(read: Pick<DneskaiWorkspaceRead, 'posts' | 'jobs' | 'waiting'>, exceptId: string): string[] {
  return [
    ...read.posts.filter((post) => post.id !== exceptId && SLOT_HOLDING.has(post.status)).map((post) => post.publication?.scheduledAt ?? post.scheduledAt),
    ...read.jobs.filter((job) => job.status === 'queued' || job.status === 'running').flatMap((job) => job.scheduledAt ? [job.scheduledAt] : []),
    ...(read.waiting ?? []).map((brief) => brief.scheduledAt),
  ];
}

/** A post in review whose slot passed without approval: the Lab offers to move it to the next free slot and approve it. */
export const dneskaiMissedSlot = (lab: Pick<DneskaiLabPost, 'post' | 'deadline'>) => lab.post.status === 'review' && lab.deadline.passed;

/* ---- approve the day ---------------------------------------------------- */

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
/** The most posts one „approve the day“ request binds: a day has four slots, a busy day eight. */
export const DNESKAI_APPROVE_MANY_MAX = 8;
export const DneskaiApproveManyInputSchema = z.strictObject({
  action: z.literal('approve-many'),
  posts: z.array(z.strictObject({ id: z.uuid(), expectedHash: sha256 })).min(1).max(DNESKAI_APPROVE_MANY_MAX)
    .refine((posts) => new Set(posts.map((post) => post.id)).size === posts.length, 'distinct posts'),
});
export const DneskaiApproveManyResultSchema = z.strictObject({
  results: z.array(z.strictObject({
    id: z.uuid(),
    ok: z.boolean(),
    publicationId: z.uuid().nullable(),
    /** The refusal code (`revision-changed`, `render-blocked`, …) when this one post was not approved. */
    error: z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/).nullable(),
  })).max(DNESKAI_APPROVE_MANY_MAX),
});
export type DneskaiApproveManyResult = z.infer<typeof DneskaiApproveManyResultSchema>;

/* ---- text fit before saving (POST /api/marketing/dneskai/fit) ------------- */

export const DNESKAI_FIT_VERSION = 'dneskai-fit/1';
const slot = z.string().regex(/^image-[1-9]$/);
export const DneskaiFitSlideSchema = z.strictObject({
  type: DneskaiSlideTypeSchema,
  variant: DneskaiSlideVariantSchema.optional(),
  headline: z.string().max(200),
  body: z.string().max(700).optional(),
  kicker: z.string().max(80).optional(),
  credit: z.string().max(120).optional(),
  /** The picture places the slide fills (never the pictures): `split` with `image-2` is the paired template. */
  images: z.array(slot).max(4),
});
export const DneskaiFitRequestSchema = z.strictObject({
  kit: DneskaiKitSchema,
  slides: z.array(DneskaiFitSlideSchema).min(1).max(10),
});
export type DneskaiFitRequest = z.infer<typeof DneskaiFitRequestSchema>;

export const DneskaiFitFieldSchema = z.strictObject({
  field: z.enum(['headline', 'body', 'kicker', 'credit']),
  /** Characters as the owner counts them (code points of the trimmed, composed text). */
  characters: z.number().int().nonnegative(),
  /** The most characters the template layer holds. */
  max: z.number().int().positive(),
  /** Characters over `max`, 0 when within. */
  overBy: z.number().int().nonnegative(),
  /** The studio's fitter would cut this field at its smallest size (the render refuses it). */
  clipped: z.boolean(),
  /**
   * The lines and font size the fitter sets. Null: the vendored `dneskai-slide` entry reports only whether a field is
   * cut, not how it is set; the kit engine's fit export fills these.
   */
  lines: z.number().int().positive().nullable(),
  fontSize: z.number().positive().nullable(),
  /** Other blocking text problems on this field (`unsupported-glyph`, `text-missing`). */
  codes: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).max(8),
});
export type DneskaiFitField = z.infer<typeof DneskaiFitFieldSchema>;
export const DneskaiFitResultSchema = z.strictObject({
  schemaVersion: z.literal(DNESKAI_FIT_VERSION),
  kit: DneskaiKitSchema,
  slides: z.array(z.strictObject({
    index: z.number().int().min(0).max(9),
    fits: z.boolean(),
    fields: z.array(DneskaiFitFieldSchema).max(4),
    /** Slide-level text problems without a field (`text-unplaced` names its field; a variant problem does not). */
    codes: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).max(8),
  })).max(10),
});
export type DneskaiFitResult = z.infer<typeof DneskaiFitResultSchema>;

/** The fit request for a slide as the Lab edits it. */
export function dneskaiFitSlide(slide: { type: DneskaiSlideType; variant?: string; headline: string; body?: string; kicker?: string; credit?: string; images: ReadonlyArray<{ slot: string }> }): z.infer<typeof DneskaiFitSlideSchema> {
  return DneskaiFitSlideSchema.parse({
    type: slide.type, ...(slide.variant ? { variant: slide.variant } : {}), headline: slide.headline,
    ...(slide.body !== undefined ? { body: slide.body } : {}), ...(slide.kicker !== undefined ? { kicker: slide.kicker } : {}),
    ...(slide.credit !== undefined ? { credit: slide.credit } : {}), images: slide.images.map((image) => image.slot),
  });
}

/* ---- render-only preview before saving (POST /api/marketing/dneskai/preview, REN-01) ------------------------ */

export const DNESKAI_PREVIEW_VERSION = 'dneskai-preview/1';
/**
 * One slide of the owner's unsaved draft: the revision being edited, the draft as the same `edit` deck the save would
 * send, and which slide of the edited deck to draw. The server applies the edit with the save's rules and renders that
 * slide in memory. Nothing is stored, no revision is written, nothing can be approved from it.
 */
export const DneskaiPreviewRequestSchema = z.strictObject({
  id: z.uuid(),
  deck: DneskaiDeckEditSchema,
  slide: z.number().int().min(0).max(9),
});
export type DneskaiPreviewRequest = z.infer<typeof DneskaiPreviewRequestSchema>;
export const DneskaiPreviewResultSchema = z.strictObject({
  schemaVersion: z.literal(DNESKAI_PREVIEW_VERSION),
  /** Always true: a preview is an unsaved draft. It carries no content hash and no stored asset, so nothing binds to it. */
  draft: z.literal(true),
  slide: z.number().int().min(0).max(9),
  status: z.enum(['rendered', 'refused']),
  /** The slide's real pixels, downscaled (`data:image/webp;base64,…`); null when refused. */
  image: z.string().startsWith('data:image/webp;base64,').max(2_000_000).nullable(),
  problems: z.array(z.strictObject({ code: z.string().regex(/^[a-z][a-z0-9-]*$/).max(80), field: z.string().max(80).nullable(), blocking: z.boolean() })).max(30),
});
export type DneskaiPreviewResult = z.infer<typeof DneskaiPreviewResultSchema>;
