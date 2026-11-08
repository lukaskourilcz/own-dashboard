import type { DevsharkDraftsRead, DevsharkDraftStatus } from "@/lib/marketing/devshark-studio";
import type { DevsharkDeck } from "@/lib/marketing/devshark-deck";

/**
 * The devShark Design Lab for /dev-preview (8 November 2026): sample concepts kept in memory for the page's lifetime,
 * edited and decided the way the server does, so the studio and the publishing calendar show the same saved version.
 * Never calls a server.
 */
const INITIAL: DevsharkDraftsRead = { plan: [], drafts: [{ id: '00000000-0000-4000-8000-000000000001', title: 'typeof null', origin: 'concept', status: 'draft', decided_at: null, created_at: '2026-11-07T17:00:00.000Z',
  caption: 'Guess before you swipe: what does typeof null return?\n\n#javascript #devshark',
  deck: { schemaVersion: 'devshark-deck/1', cover: 'light', slides: [
    { kind: 'cover', kicker: 'JavaScript quiz', headline: 'typeof null', body: 'One line of JavaScript. [[What does it return?]]' },
    { kind: 'answer', headline: 'B. "object"', body: 'A bug from the first JavaScript, kept so old code still works.' },
    { kind: 'closing', headline: 'Quizzes, lessons and [[coding tasks]] for web developers.' }] } }] };

let store: DevsharkDraftsRead | null = null;
const read = () => (store ??= structuredClone(INITIAL));

export const demoDevsharkStudio = {
  async load(): Promise<DevsharkDraftsRead> { return structuredClone(read()); },
  /** A saved edit returns the concept to review, as `marketing_devshark_save` does. */
  async save(input: { id: string; title: string; caption: string; deck: DevsharkDeck }) {
    const draft = read().drafts.find((item) => item.id === input.id);
    if (!draft) throw new Error("draft-unavailable");
    Object.assign(draft, { title: input.title, caption: input.caption, deck: structuredClone(input.deck), status: "draft", decided_at: null });
  },
  async decide(id: string, decision: Extract<DevsharkDraftStatus, "approved" | "rejected" | "draft">) {
    const draft = read().drafts.find((item) => item.id === id);
    if (!draft) throw new Error("draft-unavailable");
    Object.assign(draft, { status: decision, decided_at: decision === "draft" ? null : new Date().toISOString() });
  },
};

export function resetDemoDevsharkStudio() { store = null; }
