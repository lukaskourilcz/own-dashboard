export type ProjectBriefOutput = {
  facts: string[];
  risks: string[];
  suggestions: string[];
};

export type AiEvidence = {
  claim: string;
  sourceIds: string[];
};

export type CareerCopilotOutput = {
  summary: string;
  evidence: AiEvidence[];
  gaps: string[];
  suggestions: string[];
  coverLetterDraft: string;
  interviewQuestions: string[];
};

export type KnowledgeProposalKind =
  | "related_notes"
  | "duplicate_prompt"
  | "decision"
  | "unresolved_question"
  | "outdated_documentation"
  | "glossary"
  | "candidate_task";

export type KnowledgeProposal = {
  kind: KnowledgeProposalKind;
  title: string;
  reason: string;
  sourceIds: string[];
};

export type KnowledgeReviewOutput = {
  summary: string;
  proposals: KnowledgeProposal[];
};

function parseList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const strings = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (strings.some((item) => item.length === 0 || item.length > 320)) return null;
  return strings;
}

function parseText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
}

function parseSourceIds(value: unknown, allowedSources: ReadonlySet<string>): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return null;
  const ids = Array.from(new Set(value.filter((item): item is string => typeof item === "string")));
  if (ids.length === 0 || ids.some((id) => !allowedSources.has(id))) return null;
  return ids;
}

function parseEvidence(value: unknown, allowedSources: ReadonlySet<string>): AiEvidence[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const parsed: AiEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const claim = parseText(record.claim, 420);
    const sourceIds = parseSourceIds(record.source_ids, allowedSources);
    if (!claim || !sourceIds) return null;
    parsed.push({ claim, sourceIds });
  }
  return parsed;
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


export function parseCareerCopilotOutput(
  value: unknown,
  allowedSources: ReadonlySet<string>,
): CareerCopilotOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const summary = parseText(record.summary, 1000);
  const evidence = parseEvidence(record.evidence, allowedSources);
  const gaps = parseList(record.gaps);
  const suggestions = parseList(record.suggestions);
  const coverLetterDraft = parseText(record.cover_letter_draft, 4000);
  const interviewQuestions = parseList(record.interview_questions);
  if (!summary || !evidence || !gaps || !suggestions || !coverLetterDraft || !interviewQuestions) return null;
  return { summary, evidence, gaps, suggestions, coverLetterDraft, interviewQuestions };
}

export function parseKnowledgeReviewOutput(
  value: unknown,
  allowedSources: ReadonlySet<string>,
): KnowledgeReviewOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const summary = parseText(record.summary, 1000);
  if (!summary || !Array.isArray(record.proposals) || record.proposals.length > 16) return null;
  const kinds = new Set<KnowledgeProposalKind>([
    "related_notes", "duplicate_prompt", "decision", "unresolved_question",
    "outdated_documentation", "glossary", "candidate_task",
  ]);
  const proposals: KnowledgeProposal[] = [];
  for (const item of record.proposals) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const proposal = item as Record<string, unknown>;
    const kind = typeof proposal.kind === "string" && kinds.has(proposal.kind as KnowledgeProposalKind)
      ? proposal.kind as KnowledgeProposalKind
      : null;
    const title = parseText(proposal.title, 180);
    const reason = parseText(proposal.reason, 500);
    const sourceIds = parseSourceIds(proposal.source_ids, allowedSources);
    if (!kind || !title || !reason || !sourceIds) return null;
    proposals.push({ kind, title, reason, sourceIds });
  }
  return { summary, proposals };
}
