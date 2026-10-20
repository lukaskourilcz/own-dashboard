/**
 * How a structured Claude call is shaped for the configured model (Claude API model docs, 20 October 2026). One
 * place for the generation (`generation.ts`) and the Saved-source analysis (`knowledge-extraction.ts`) calls,
 * which share `MARKETING_CLAUDE_MODEL`.
 *
 * - Claude Sonnet 5.5 rejects forced tool use, non-default sampling and disabled thinking. It answers through
 *   structured outputs (`output_config.format`) with `thinking: {type: "between_tools"}` (no extended thinking,
 *   so the whole output budget goes to the answer) and low effort.
 * - Claude Opus 4.7, Opus 4.8, Opus 5, Opus 5.5, Sonnet 5, Haiku 5.5, Fable 5 and Fable 5.1 reject a sampling
 *   override, and Opus 5.5 and Fable 5.1 also reject forced tool use. They answer through structured outputs at
 *   low effort with the model's own thinking default. `between_tools` is Sonnet 5.5's alone.
 * - Older models keep the forced strict tool call at temperature zero.
 */
export type ClaudeCallProfile =
  | { structured: "tool"; temperature: 0 }
  | { structured: "json-schema"; thinking?: { type: "between_tools" }; effort: "low" };

const SAMPLING_FIXED = /^claude-(?:opus-4-7|opus-4-8|opus-5|opus-5-5|sonnet-5|haiku-5-5|fable-5|fable-5-1)$/;

export function claudeCallProfile(model: string): ClaudeCallProfile {
  if (/^claude-sonnet-5-5(?![0-9])/.test(model)) return { structured: "json-schema", thinking: { type: "between_tools" }, effort: "low" };
  if (SAMPLING_FIXED.test(model)) return { structured: "json-schema", effort: "low" };
  return { structured: "tool", temperature: 0 };
}

/** The `ChatAnthropic` fields a profile sets. `between_tools` is newer than the pinned SDK's thinking type; LangChain passes it through. */
export function claudeCallFields(profile: ClaudeCallProfile): Record<string, unknown> {
  return profile.structured === "tool"
    ? { temperature: profile.temperature }
    : { ...(profile.thinking ? { thinking: profile.thinking } : {}), outputConfig: { effort: profile.effort } };
}
