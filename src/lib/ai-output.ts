export type ProjectBriefOutput = {
  facts: string[];
  risks: string[];
  suggestions: string[];
};

function parseList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const strings = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (strings.some((item) => item.length === 0 || item.length > 320)) return null;
  return strings;
}

/** Strict boundary for structured model output; unknown keys are ignored. */
export function parseProjectBriefOutput(value: unknown): ProjectBriefOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const facts = parseList(record.facts);
  const risks = parseList(record.risks);
  const suggestions = parseList(record.suggestions);
  if (!facts || !risks || !suggestions) return null;
  return { facts, risks, suggestions };
}
