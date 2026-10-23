// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { NotesPanel } from "@/components/panels/notes-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmationProvider } from "@/components/ui/confirmation-dialog";
import type { Note } from "@/lib/types";

const state = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => ({ delete: () => {
  state.remove(); return { in: async () => ({ error: null }), eq: async () => ({ error: null }) };
} }) }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps old untitled rich-content notes and empty drafts when merely opening the library", async () => {
  document.documentElement.lang = "en";
  const client = new QueryClient();
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const base = { user_id: "owner", title: "Untitled", plain_text: "", tags: [], is_pinned: false,
    created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z", sort_order: 1 };
  const notes = [
    { ...base, id: "legacy-rich", content: [{ type: "paragraph", content: [{ type: "text", text: "Important saved draft" }] }] },
    { ...base, id: "empty-draft", content: [] },
  ] as Note[];
  const update = vi.fn();
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><TooltipProvider><ConfirmationProvider>
      <NotesPanel notes={notes} setNotes={update} projects={[]} />
    </ConfirmationProvider></TooltipProvider></QueryClientProvider>));
    expect(state.remove).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Untitled");
  } finally {
    act(() => root.unmount()); host.remove(); client.clear(); document.documentElement.lang = "";
  }
});
