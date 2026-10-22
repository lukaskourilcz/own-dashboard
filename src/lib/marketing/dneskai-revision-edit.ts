import { dneskaiShownDeck } from "./dneskai-slide-layout";
import "server-only";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { AssetSchema, DNESKAI_RENDER_REPORT_VERSION, DneskaiRenderReportSchema, canonicalJson, parseContentRevision, renderReportBlocks, revisionReadiness, storedRenderKeys,
  storedRenderProblems, type ContentEngagement, type ContentRevision, type DneskaiRenderReport } from "./contracts";
import { dneskaiDeckAssetHashes, type DneskaiDeck } from "./dneskai-slides";
import { DneskaiRevisionEditError, applyDneskaiDeckEdit, dneskaiDeckEditNeedsPool, type DneskaiDeckEdit } from "./dneskai-deck-edit";
import type { ListBriefAssetHashes, LoadDneskaiBriefPool, LoadDneskaiMediaBytes, RenderDneskaiDeck } from "./dneskai-ports";
import { revisionContentHash } from "./hashes";
import { dneskaiCaptionWithKeyword } from "./dneskai-caption";

type Database = ReturnType<typeof createAdminClient>;

export { DneskaiDeckEditSchema, DneskaiRevisionEditError, DneskaiSlideEditSchema, applyDneskaiDeckEdit, type DneskaiDeckEdit } from "./dneskai-deck-edit";
const fail = (code: string): never => { throw new DneskaiRevisionEditError(code); };

/** `engagement`: left out keeps the saved keyword and messages, `null` removes them, an object replaces them (#157).
 * `audio`: absent keeps the saved choice, null clears it (the Reel then takes the next track in rotation, #164). */
export type DneskaiRevisionEditInput = { caption: string; scheduledAt: string; account?: ContentRevision["account"]; deck?: DneskaiDeckEdit; engagement?: ContentEngagement | null; audio?: ContentRevision["audio"] | null;
  /** #165: a carousel deck publishes as a carousel or as a Reel; absent keeps the saved format. */
  format?: "carousel" | "reel" };

/**
 * The deck an owner edit produces, checked against the brief: the edit applied by `applyDneskaiDeckEdit`
 * (dneskai-deck-edit.ts), the pool's capability flags loaded only for a type move or an inserted slide, and every
 * picture from the brief's media pool. The save and the Lab's render-only preview (REN-01) share it, so a preview
 * never shows a deck the save would refuse.
 */
export async function editedDneskaiDeck(original: ContentRevision, edit: DneskaiDeckEdit | undefined, listBriefAssetHashes: ListBriefAssetHashes, loadBriefPool?: LoadDneskaiBriefPool): Promise<DneskaiDeck> {
  if (!original.deck) return fail("deck-edit-unsupported");
  // A type move of a picture slide or an inserted slide is checked against the pool's capability flags (review-10).
  const briefPool = edit && dneskaiDeckEditNeedsPool(original.deck, edit) ? (loadBriefPool ? await loadBriefPool(original) : fail("deck-edit-pool-unavailable")) : null;
  const deck = dneskaiShownDeck(edit ? applyDneskaiDeckEdit(original.deck, edit, briefPool) : original.deck);
  const pool = new Set(await listBriefAssetHashes(original));
  if (dneskaiDeckAssetHashes(deck).some((sha256) => !pool.has(sha256))) return fail("deck-asset-outside-brief");
  return deck;
}

/**
 * The edited revision as it will be saved: same sources, versions and trace, the new caption, schedule, account,
 * deck and engagement, and no assets, because the old JPEGs show the old deck.
 */
export async function prepareDneskaiRevisionEdit(original: ContentRevision, input: DneskaiRevisionEditInput, listBriefAssetHashes: ListBriefAssetHashes, loadBriefPool?: LoadDneskaiBriefPool): Promise<ContentRevision> {
  if (!original.deck) return fail("deck-edit-unsupported");
  const account = input.account ?? original.account;
  if (account.platform !== original.account.platform) return fail("account-platform-changed");
  const deck = await editedDneskaiDeck(original, input.deck, listBriefAssetHashes, loadBriefPool);
  const { engagement: saved, audio: savedAudio, ...rest } = original;
  const engagement = input.engagement === undefined ? saved : input.engagement ?? undefined;
  const audio = input.audio === undefined ? savedAudio : input.audio ?? undefined;
  try {
    if (input.format && (deck.format !== "carousel" || !["carousel", "reel"].includes(original.format))) return fail("revision-format-unsupported");
    // #158: the caption's keyword line follows the approved keyword (added, changed or removed); code owns that line.
    const caption = dneskaiCaptionWithKeyword(input.caption, engagement?.keyword ?? null);
    return parseContentRevision({ ...rest, caption, scheduledAt: input.scheduledAt, account, deck, assets: [], ...(input.format ? { format: input.format } : {}), ...(engagement ? { engagement } : {}), ...(audio ? { audio } : {}) });
  } catch { return fail("revision-edit-invalid"); }
}

export type DneskaiRenderAttachment = { ready: boolean; contentHash: string; report: DneskaiRenderReport; reused: boolean };

/** Pixels an edit can keep: the previous revision's rendered JPEGs and the clean report that produced them. */
export type DneskaiReusableRender = { assets: ContentRevision["assets"]; report: DneskaiRenderReport };

/**
 * The previous render, when an edit leaves the deck as it was (review-03). A caption, schedule, account or engagement
 * (#157) change does not move a pixel: the deck holds the slide text, images, crops, order and alt text, so an identical deck draws the
 * same JPEGs. They are reused only when the previous revision carries one JPEG per slide and a stored report that is a
 * clean `rendered` result; anything else (no report, a refused or failed render, a changed deck) renders again.
 * Reuse never touches approval: the edited revision still gets its own content hash and needs a new approval.
 */
export function reusableDneskaiRender(original: ContentRevision, originalReport: unknown, edited: ContentRevision): DneskaiReusableRender | null {
  if (!original.deck || !edited.deck || canonicalJson(original.deck) !== canonicalJson(edited.deck)) return null;
  const report = DneskaiRenderReportSchema.safeParse(originalReport);
  if (!report.success || report.data.status !== "rendered" || renderReportBlocks(report.data)) return null;
  if (original.assets.length !== original.deck.slides.length || revisionReadiness(original).length) return null;
  return { assets: original.assets, report: report.data };
}

/**
 * Renders a saved, unready deck revision and attaches the result with `marketing_attach_revision_render`. A clean
 * render attaches one JPEG per slide and makes the revision ready; a refused or failed render keeps it unready, with
 * no assets and the problems recorded, so approval stays held. With `reuse` (an unchanged deck, see
 * `reusableDneskaiRender`) the renderer is not called: the previous JPEGs, same sha256s, go through the same checks and
 * the same attach, and the stored report keeps the time those pixels were rendered.
 */
export async function renderAndAttachDneskaiRevision(db: Database, owner: string, input: { revisionId: string; revision: ContentRevision },
  dependencies: { render: RenderDneskaiDeck; loadMedia: LoadDneskaiMediaBytes; now?: () => Date; signal?: AbortSignal; reuse?: DneskaiReusableRender | null }): Promise<DneskaiRenderAttachment> {
  const { revision } = input;
  if (!revision.deck || revision.assets.length) return fail("revision-not-renderable");
  const reuse = dependencies.reuse ?? null;
  const renderedAt = reuse ? reuse.report.renderedAt : (dependencies.now ?? (() => new Date()))().toISOString();
  let content = revision; let ready = false;
  let report: DneskaiRenderReport;
  let result: Awaited<ReturnType<RenderDneskaiDeck>> | null = null;
  if (reuse) result = { status: "rendered", assets: reuse.assets, renderKeys: reuse.report.renderKeys, problems: reuse.report.problems };
  else {
    try { result = await dependencies.render({ owner, revisionId: input.revisionId, deck: revision.deck, loadMedia: dependencies.loadMedia, signal: dependencies.signal }); }
    catch { result = null; }
  }
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
  return { ready, contentHash, report, reused: !!reuse };
}
