import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MARKETING_CONTENT_VERSION, parseContentRevision } from "@/lib/marketing/contracts";
import { revisionContentHash } from "@/lib/marketing/hashes";
import { prepareDneskaiRevisionEdit } from "@/lib/marketing/dneskai-revision-edit";
import { createDeckDraft, dneskaiEditRequest } from "@/lib/marketing/dneskai-deck-editor";
import { createDneskaiWorkspaceFixture } from "@/lib/demo/dneskai-workspace-fixtures";
import { a, b, deckRevision } from "./marketing-dneskai-revision-fixture";

const track = "44444444-4444-4444-8444-444444444444";
const other = "55555555-5555-4555-8555-555555555555";
const list = async () => [a, b];
const edit = { caption: "Test-only caption.", scheduledAt: "2099-10-21T06:00:00Z" };

describe("audio on the revision (#164)", () => {
  it("is part of the approval hash", () => {
    const plain = deckRevision();
    const withTrack = parseContentRevision({ ...plain, audio: { trackId: track } });
    expect(revisionContentHash(withTrack)).not.toBe(revisionContentHash(plain));
    expect(revisionContentHash(parseContentRevision({ ...plain, audio: { trackId: other } }))).not.toBe(revisionContentHash(withTrack));
  });

  it("belongs only to DNESKAi deck revisions and names exactly one track", () => {
    expect(() => parseContentRevision({ ...deckRevision(), schemaVersion: MARKETING_CONTENT_VERSION, deck: undefined, audio: { trackId: track } })).toThrow();
    expect(() => parseContentRevision({ ...deckRevision(), audio: { trackId: track, volume: 1 } })).toThrow();
    expect(() => parseContentRevision({ ...deckRevision(), audio: { trackId: "not-a-uuid" } })).toThrow();
  });

  it("is kept by an edit that does not name it, set by one that does, and cleared by null", async () => {
    const saved = parseContentRevision({ ...deckRevision(), audio: { trackId: track } });
    expect((await prepareDneskaiRevisionEdit(saved, edit, list)).audio).toEqual({ trackId: track });
    expect((await prepareDneskaiRevisionEdit(saved, { ...edit, audio: { trackId: other } }, list)).audio).toEqual({ trackId: other });
    expect("audio" in await prepareDneskaiRevisionEdit(saved, { ...edit, audio: null }, list)).toBe(false);
  });

  it("goes into the Lab's edit request only when the owner changed it", () => {
    const post = createDneskaiWorkspaceFixture(new Date("2026-10-24T09:00:00Z")).posts[0]!;
    const now = new Date("2026-10-24T09:00:00Z");
    const draft = createDeckDraft(post, null, now);
    expect(draft.audioTrackId).toBeNull();
    expect(dneskaiEditRequest(post, draft)).not.toHaveProperty("audioTrackId");
    expect(dneskaiEditRequest(post, { ...draft, audioTrackId: track }).audioTrackId).toBe(track);
    const chosen = { ...post, audio: { trackId: track } };
    expect(createDeckDraft(chosen, null, now).audioTrackId).toBe(track);
    expect(dneskaiEditRequest(chosen, { ...createDeckDraft(chosen, null, now), audioTrackId: null }).audioTrackId).toBeNull();
  });
});
