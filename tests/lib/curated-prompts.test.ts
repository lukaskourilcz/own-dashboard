import { describe, expect, it } from "vitest";
import { CURATED_PROMPTS } from "@/lib/curated-prompts";
import { PROMPT_KINDS } from "@/lib/prompt-kinds";

describe("curated prompts", () => {
  it("cover the nine kinds with one or two universal prompts each", () => {
    const counts = new Map<string, number>();
    for (const prompt of CURATED_PROMPTS) counts.set(prompt.kind, (counts.get(prompt.kind) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(PROMPT_KINDS.filter((kind) => kind !== "other").sort());
    for (const count of counts.values()) {
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it("have unique names, placeholders, the links hand-off and suggested categories", () => {
    const names = CURATED_PROMPTS.map((prompt) => prompt.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const prompt of CURATED_PROMPTS) {
      expect(prompt.body, prompt.name).toMatch(/\{\{project\.(name|repo|url|dev_url)\}\}/);
      expect(prompt.body, prompt.name).toContain("Links to consult");
      expect(prompt.suggestedCategories.length, prompt.name).toBeGreaterThan(0);
      expect(prompt.description.length, prompt.name).toBeLessThanOrEqual(160);
      expect(prompt.name.length, prompt.name).toBeLessThanOrEqual(120);
    }
  });
});
