import 'server-only';
import { z } from 'zod';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';
import { claudeCallFields, claudeCallProfile } from './claude-call-profile';
import type { ModelUsage } from './generation';

/**
 * The small structured Claude calls on DNESKAi topics (#152 FACT or HYPE, #153 titling). One cheap model, Claude
 * Haiku 5.5 unless `MARKETING_DNESKAI_TOPIC_MODEL` names another, shaped by the same call profile as generation.
 * Every call is reserved first in the topic spend ledger (`dneskai-topic-spend.ts`), under the $1 daily ceiling.
 * Source text goes in as untrusted data; nothing about the owner, commenters or other posts is sent.
 */
type Environment = Record<string, string | undefined>;
export const DEFAULT_DNESKAI_TOPIC_MODEL = 'claude-haiku-5-5';
/** Claude Haiku 5.5 standard rates in USD per million tokens (prompts up to 100K tokens), 23 October 2026. */
export const DEFAULT_DNESKAI_TOPIC_PRICING = { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.5 } as const;

export class DneskaiTopicModelError extends Error { constructor(readonly code: string) { super(code); } }

export interface DneskaiTopicModel {
  model: string; pricing: { inputPerMillionUsd: number; outputPerMillionUsd: number };
  invoke(input: { system: string; prompt: string; schema: z.ZodType; name: string; signal: AbortSignal; maxOutputTokens: number }): Promise<{ output: unknown; usage: ModelUsage | null }>;
}

const unset = (value: string | undefined) => value === undefined || value.trim() === '';
/** The model and its rates. A model other than the default needs both rates set; a malformed value refuses. */
export function dneskaiTopicModelConfiguration(env: Environment = process.env) {
  if (env.MARKETING_AI_CONSENT !== 'true') throw new DneskaiTopicModelError('topic-model-consent-required');
  const model = unset(env.MARKETING_DNESKAI_TOPIC_MODEL) ? DEFAULT_DNESKAI_TOPIC_MODEL : env.MARKETING_DNESKAI_TOPIC_MODEL!.trim();
  const rate = (value: string | undefined, fallback: number) => {
    if (unset(value) && model === DEFAULT_DNESKAI_TOPIC_MODEL) return fallback;
    const parsed = value && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) throw new DneskaiTopicModelError('topic-model-pricing-required');
    return parsed;
  };
  if (!env.ANTHROPIC_API_KEY || !/^claude-[a-z0-9.-]+$/.test(model)) throw new DneskaiTopicModelError('topic-model-configuration-required');
  return { apiKey: env.ANTHROPIC_API_KEY, model, pricing: {
    inputPerMillionUsd: rate(env.MARKETING_DNESKAI_TOPIC_INPUT_USD_PER_MTOK, DEFAULT_DNESKAI_TOPIC_PRICING.inputPerMillionUsd),
    outputPerMillionUsd: rate(env.MARKETING_DNESKAI_TOPIC_OUTPUT_USD_PER_MTOK, DEFAULT_DNESKAI_TOPIC_PRICING.outputPerMillionUsd),
  } };
}

/** USD for measured or reserved tokens. */
export function dneskaiTopicCallCost(usage: ModelUsage, pricing: DneskaiTopicModel['pricing']): number {
  return (usage.inputTokens * pricing.inputPerMillionUsd + usage.outputTokens * pricing.outputPerMillionUsd) / 1_000_000;
}

/** The LangChain ChatAnthropic client the marketing calls already use; no retries, so one reservation is one call. */
export async function createClaudeTopicModel(config: { apiKey: string; model: string; pricing: DneskaiTopicModel['pricing'] }): Promise<DneskaiTopicModel> {
  if (process.env.LANGSMITH_TRACING === 'true' || process.env.LANGCHAIN_TRACING_V2 === 'true') throw new DneskaiTopicModelError('topic-model-unsafe-native-tracing');
  const { ChatAnthropic } = await import('@langchain/anthropic');
  const { isAIMessage } = await import('@langchain/core/messages');
  const profile = claudeCallProfile(config.model);
  return { model: config.model, pricing: config.pricing, async invoke(input) {
    const fields = { apiKey: config.apiKey, model: config.model, maxTokens: input.maxOutputTokens, maxRetries: 0, clientOptions: { maxRetries: 0 }, ...claudeCallFields(profile) };
    const model = new ChatAnthropic(fields as ConstructorParameters<typeof ChatAnthropic>[0]);
    const structured = profile.structured === 'tool'
      ? model.withStructuredOutput(input.schema, { name: input.name, includeRaw: true })
      : model.withStructuredOutput(transformJSONSchema(z.toJSONSchema(input.schema)), { name: input.name, includeRaw: true, method: 'jsonSchema' });
    const result = await structured.invoke([['system', input.system], ['human', input.prompt]], { signal: input.signal, callbacks: [] });
    const usage = isAIMessage(result.raw) ? result.raw.usage_metadata : undefined;
    return { output: result.parsed, usage: usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : null };
  } };
}
