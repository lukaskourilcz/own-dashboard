import "server-only";

export const AI_MODELS = {
  intent: process.env.AI_INTENT_MODEL?.trim() || "claude-haiku-4-5-20251001",
  enrichment: process.env.AI_ENRICHMENT_MODEL?.trim() || "claude-haiku-4-5-20251001",
  synthesis: process.env.AI_SYNTHESIS_MODEL?.trim() || "claude-sonnet-4-5-20250929",
} as const;

export function anthropicRuntime() {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
    baseURL: process.env.ANTHROPIC_BASE_URL?.trim() || null,
  };
}
