/**
 * A curated library of genuinely useful, reusable prompts for this owner's
 * work (software engineering + freelancing). These are NOT the owner's own
 * prompts — they're scouted, general-purpose templates surfaced under the
 * "Public" subsection of the Prompts page. Placeholders use [square brackets].
 *
 * They're seeded on demand (the owner clicks "Add curated prompts"), inserted
 * as their own rows with is_public = true, and de-duplicated by name so a
 * repeat click never creates copies. Edit or delete them like any prompt.
 *
 * Informed by widely-shared prompt patterns for developers and freelancers
 * (targeted, single-purpose prompts with explicit inputs, outputs, and
 * constraints), then rewritten for this library.
 */
export type CuratedPrompt = {
  name: string;
  description: string;
  body: string;
};

export const CURATED_PROMPTS: CuratedPrompt[] = [
  {
    name: "Senior code review",
    description:
      "Review a diff like a senior engineer — ranked findings with file/line and severity.",
    body: `Act as a senior engineer reviewing a pull request. Review the code below for correctness bugs, security issues, and maintainability problems.

Rank your findings from most to least important. Cite each with a file/line reference and a severity (blocker / major / minor / nit), and show a concrete fix. Call out anything you are unsure about rather than guessing.

\`\`\`
[paste the diff or code]
\`\`\``,
  },
  {
    name: "Root-cause a bug",
    description:
      "Turn an error + stack trace + code into ranked root causes, a repro, a fix diff, and a test.",
    body: `You are a debugging assistant. Given the error, stack trace, and code below, produce:
1. The most likely root causes, ranked, with your reasoning.
2. The minimal steps to reproduce.
3. A fix, as a diff.
4. A test that would have caught this bug.

Error: [error message]
Stack trace:
[trace]
Code:
[relevant snippet]`,
  },
  {
    name: "Refactor without changing behavior",
    description:
      "Improve readability/maintainability with characterization tests first, then a diff.",
    body: `Refactor the module below for readability and maintainability WITHOUT changing its observable behavior.

First, note where test coverage is weak and add characterization tests that pin the current behavior. Then give the refactor as a diff and explain each change in one line. Do not introduce new dependencies unless you justify them.

[paste the code]`,
  },
  {
    name: "Explain unfamiliar code",
    description:
      "Onboard-style walkthrough of a snippet: what it does, control flow, risks, edge cases.",
    body: `Explain the code below as if you were onboarding a new teammate. Cover:
- what it does, in one sentence;
- the control flow, step by step;
- any non-obvious decisions and why they might be there;
- risks, edge cases, and failure modes.

End with the three questions you would ask the original author.

[paste the code]`,
  },
  {
    name: "Compare design approaches",
    description:
      "Get 2–3 viable architectures with trade-offs and a justified recommendation.",
    body: `I need to design: [describe the feature or problem].
Constraints: [stack, scale, deadline, team size, anything fixed].

Propose 2–3 genuinely different, viable approaches. For each: a one-paragraph summary, the key trade-offs, rough effort, and the main failure modes. Then recommend one and justify the choice against the constraints. Note what you'd need to validate before committing.`,
  },
  {
    name: "Write thorough tests",
    description:
      "Generate happy-path, boundary, error, and async edge-case tests with rationale.",
    body: `Write thorough tests for the function below using [test framework].

Cover the happy path, boundary values, error/invalid inputs, and any concurrency or async edge cases. For each test, add a one-line comment saying what regression it protects against. Prefer clear, independent tests over clever ones.

[paste the function]`,
  },
  {
    name: "Commit + PR description",
    description:
      "Draft an imperative commit message and a structured PR description from a change.",
    body: `From the change described below, write:
1. A commit message: an imperative subject ≤72 chars, a blank line, then a short body explaining WHY (not just what).
2. A PR description with sections: Summary, Changes, Testing, Risks / rollout.

Change: [describe the change, or paste the diff]`,
  },
  {
    name: "SQL query + plan",
    description:
      "Get a correct, efficient SQL query with the query plan and index/pitfall notes.",
    body: `Given the schema and goal below, write a correct and efficient SQL query.

Explain the query plan in plain English, name any index that would materially help, and flag correctness pitfalls (nulls, duplicates, timezones, off-by-one on ranges). Target [Postgres].

Schema:
[tables + relevant columns]
Goal: [what the result set should contain]`,
  },
  {
    name: "Client proposal email",
    description:
      "Write a concise, confident proposal email framed around the client's outcome.",
    body: `Write a concise, professional proposal email to [client name] for [scope of work].

Frame it around the outcome they get, not the tasks. Include: the outcome, a clear scope with what's in and out, a timeline, and a price of [amount / currency]. Warm and confident, no filler. End with one clear next step. Keep it under 200 words.`,
  },
  {
    name: "Overdue invoice follow-up",
    description:
      "Polite-but-firm reminder for an unpaid invoice with a simple path to pay.",
    body: `Write a short, polite but firm follow-up for an overdue invoice.

Client: [name]
Amount: [amount / currency]
Due date: [date]
This is reminder #[n].

Restate the amount and due date, keep a friendly tone, avoid guilt-tripping, and give one simple way to pay. Offer to resend the invoice if it was missed.`,
  },
  {
    name: "Handle scope creep",
    description:
      "Friendly reply that holds the line and offers the extra work as a priced add-on.",
    body: `A client has asked for [out-of-scope request], which is beyond our agreed scope of [agreed scope].

Write a friendly reply that: acknowledges the request positively, explains it falls outside the current scope (without sounding defensive), and offers to do it as a small add-on with a quick estimate or as part of the next phase. Keep the relationship warm.`,
  },
  {
    name: "Learn a topic fast",
    description:
      "A 5-minute mental model of a new topic tailored to what you already know.",
    body: `Teach me [topic] for someone who already knows [related background you have].

Give me: a 5-minute mental model, the 20% of concepts that cover 80% of real use, one tiny hands-on example I can try immediately, and the 3 mistakes beginners make. Skip history and marketing. Be concrete.`,
  },
  {
    name: "Plan before coding",
    description:
      "Have the model interview you to surface requirements and edge cases before you build.",
    body: `I'm about to implement: [feature].

Before I write any code, interview me: ask the clarifying questions a senior engineer would ask about requirements, data, edge cases, error handling, and constraints. Ask them a few at a time. When you have enough, summarize the agreed plan as a short, ordered checklist I can implement against.`,
  },
];
