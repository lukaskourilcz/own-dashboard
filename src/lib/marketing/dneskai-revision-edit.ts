import "server-only";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { AssetSchema, DNESKAI_RENDER_REPORT_VERSION, DneskaiRenderReportSchema, parseContentRevision, revisionReadiness, storedRenderKeys, storedRenderProblems,
  type ContentRevision, type DneskaiRenderReport } from "./contracts";
import { DneskaiDeckSchema, DneskaiSlideImageSchema, dneskaiDeckAssetHashes, type DneskaiDeck } from "./dneskai-slides";
import type { ListBriefAssetHashes, LoadDneskaiMediaBytes, RenderDneskaiDeck } from "./dneskai-ports";
import { revisionContentHash } from "./hashes";

type Database = ReturnType<typeof createAdminClient>;

/**
 * One slide of an owner edit (#118). `from` is the zero-based index of the slide in the revision being edited;
 * the order of the entries is the new order, and a slide left out is removed. Only text, credit, alt text and the
 * images of existing slots change: the slide type, variant and sources stay as generated.
 */
export const DneskaiSlideEditSchema = z.strictObject({
  from: z.number().int().min(0).max(9),
  headline: z.string().max(200).optional(),
  body: z.string().max(700).nullable().optional(),
  kicker: z.string().max(80).nullable().optional(),
  credit: z.string().max(120).optional(),
  alt: z.string().min(1).max(1000).optional(),
  images: z.array(DneskaiSlideImageSchema).max(4).optional(),
});
export const DneskaiDeckEditSchema = z.strictObject({ slides: z.array(DneskaiSlideEditSchema).min(1).max(10) });
export type DneskaiDeckEdit = z.infer<typeof DneskaiDeckEditSchema>;

export class DneskaiRevisionEditError extends Error {
  constructor(readonly code: string) { super(code); this.name = "DneskaiRevisionEditError"; }
}
const fail = (code: string): never => { throw new DneskaiRevisionEditError(code); };
const slotKey = (images: { slot: string }[]) => images.map((image) => image.slot).sort().join(",");

/** Applies an owner edit to a deck. Throws `DneskaiRevisionEditError` with a stable code; never returns an invalid deck. */
export function applyDneskaiDeckEdit(deck: DneskaiDeck, value: DneskaiDeckEdit): DneskaiDeck {
  const edit = DneskaiDeckEditSchema.safeParse(value);
  if (!edit.success) return fail("deck-edit-invalid");
  const used = new Set<number>();
  const slides = edit.data.slides.map((change) => {
    const source = deck.slides[change.from];
    if (!source || used.has(change.from)) return fail("deck-edit-slide-invalid");
    used.add(change.from);
    const next = structuredClone(source);
    if (change.headline !== undefined) next.headline = change.headline;
    if (change.body === null) delete next.body; else if (change.body !== undefined) next.body = change.body;
    if (change.kicker === null) delete next.kicker; else if (change.kicker !== undefined) next.kicker = change.kicker;
    if (change.credit !== undefined) next.credit = change.credit;
    if (change.alt !== undefined) next.alt = change.alt;
    if (change.images !== undefined) {
      // Swap a picture or its crop inside the slide's existing slots; adding or dropping a slot would change the template.
      if (slotKey(change.images) !== slotKey(source.images) || new Set(change.images.map((image) => image.slot)).size !== change.images.length) return fail("deck-edit-slots-changed");
      next.images = source.images.map((image) => structuredClone(change.images!.find((candidate) => candidate.slot === image.slot)!));
    }
    return next;
  });
  if (deck.format === "carousel" && (slides.length < 2 || slides.length > 10)) return fail("deck-edit-slide-count");
  if (deck.format === "single-image" && slides.length !== 1) return fail("deck-edit-slide-count");
  const parsed = DneskaiDeckSchema.safeParse({ ...deck, slides });
  return parsed.success ? parsed.data : fail("deck-edit-invalid");
}

export type DneskaiRevisionEditInput = { caption: string; scheduledAt: string; account?: ContentRevision["account"]; deck?: DneskaiDeckEdit };

/**
 * The edited revision as it will be saved: same sources, versions and trace, the new caption, schedule, account and
 * deck, and no assets, because the old JPEGs show the old deck. Every image must come from the brief's media pool.
 */
export async function prepareDneskaiRevisionEdit(original: ContentRevision, input: DneskaiRevisionEditInput, listBriefAssetHashes: ListBriefAssetHashes): Promise<ContentRevision> {
  if (!original.deck) return fail("deck-edit-unsupported");
  const deck = input.deck ? applyDneskaiDeckEdit(original.deck, input.deck) : original.deck;
  const account = input.account ?? original.account;
  if (account.platform !== original.account.platform) return fail("account-platform-changed");
  const pool = new Set(await listBriefAssetHashes(original));
  if (dneskaiDeckAssetHashes(deck).some((sha256) => !pool.has(sha256))) return fail("deck-asset-outside-brief");
  try {
    return parseContentRevision({ ...original, caption: input.caption, scheduledAt: input.scheduledAt, account, deck, assets: [] });
  } catch { return fail("revision-edit-invalid"); }
}

export type DneskaiRenderAttachment = { ready: boolean; contentHash: string; report: DneskaiRenderReport };

/**
 * Renders a saved, unready deck revision and attaches the result with `marketing_attach_revision_render`. A clean
 * render attaches one JPEG per slide and makes the revision ready; a refused or failed render keeps it unready, with
 * no assets and the problems recorded, so approval stays held.
 */
export async function renderAndAttachDneskaiRevision(db: Database, owner: string, input: { revisionId: string; revision: ContentRevision },
  dependencies: { render: RenderDneskaiDeck; loadMedia: LoadDneskaiMediaBytes; now?: () => Date; signal?: AbortSignal }): Promise<DneskaiRenderAttachment> {
  const { revision } = input;
  if (!revision.deck || revision.assets.length) return fail("revision-not-renderable");
  const renderedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  let content = revision; let ready = false;
  let report: DneskaiRenderReport;
  let result: Awaited<ReturnType<RenderDneskaiDeck>> | null = null;
  try { result = await dependencies.render({ owner, revisionId: input.revisionId, deck: revision.deck, loadMedia: dependencies.loadMedia, signal: dependencies.signal }); }
  catch { result = null; }
  if (!result || !["rendered", "refused"].includes(result.status)) {
    report = { schemaVersion: DNESKAI_RENDER_REPORT_VERSION, status: "failed", renderKeys: [], renderedAt,
      problems: [{ slide: -1, code: "render-unavailable", blocking: true, message: "The renderer did not return a result." }] };
  } else {
    const problems = storedRenderProblems(result.problems);
    if (result.status === "rendered" && !problems.some((problem) => problem.blocking)) {
      const assets = z.array(AssetSchema).max(10).safeParse(result.assets);
      let candidate: ContentRevision | null = null;
      try { candidate = assets.success ? parseContentRevision({ ...revision, assets: assets.data }) : null; } catch { candidate = null; }
      const issues = candidate ? revisionReadiness(candidate) : ["render-assets-invalid"];
      if (candidate && !issues.length) { content = candidate; ready = true; }
      else problems.push(...issues.map((code) => ({ slide: -1, code, blocking: true, message: "The rendered assets do not satisfy the revision." })));
    }
    const renderKeys = ready ? storedRenderKeys(result.renderKeys) : [];
    report = { schemaVersion: DNESKAI_RENDER_REPORT_VERSION, status: ready ? "rendered" : "refused", problems: problems.slice(0, 100), renderKeys, renderedAt };
  }
  report = DneskaiRenderReportSchema.parse(report);
  const contentHash = revisionContentHash(content);
  let attached = false;
  try {
    const { error } = await db.rpc("marketing_attach_revision_render", { p_owner: owner, p_revision: input.revisionId, p_expected_hash: revisionContentHash(revision),
      p_content: content, p_hash: contentHash, p_ready: ready, p_report: report });
    attached = !error;
  } catch { attached = false; }
  if (!attached) return fail("render-attach-failed");
  return { ready, contentHash, report };
}
