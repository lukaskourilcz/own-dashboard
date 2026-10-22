# DNESKAi hook reference

House reference for people who write or review DNESKAi covers and carousels. It sorts the hook families and carousel structures in the vendored Quorum material into what DNESKAi can use and what it cannot, with a line citation for each.

**Reference only.** No code reads this file. Do not paste it, or the Quorum files it cites, into the generation prompt, the humanizer, the brief or any model input. The prompt in `src/lib/marketing/dneskai-generation.ts` stays the only source of rules for generated copy, and this document changes none of them: register, humanizer, hashtag limits and slide rules stay as they are.

Citations name lines in Quorum at commit `83bdfb2e` (read only) and in this repository on 22 October 2026. The playbook is `docs/reports/dneskai-audit-2026-10/research/carousel-playbook.md`; below it appears as "playbook". Quorum paths are relative to the Quorum repository root. Audit findings HOOKS-02, HOOKS-03 and HOOKS-06 (`docs/reports/dneskai-audit-2026-10/map-hooks.json`) record the review behind this page.

## Rules a DNESKAi hook has to pass

These come from DNESKAi's own prompt and from Quorum's news rules. A family or structure below counts as usable only when it passes all of them.

| Rule | Where it is written |
|---|---|
| Every fact, name, date and number comes from the evidence; a claim stays as strong as its source and names who makes it. | `dneskai-generation.ts:109` |
| Calm, direct, skeptical Czech prose. No hype, clickbait, exclamation marks, rhetorical questions, emoji, URLs, greetings, or calls to follow or comment. | `dneskai-generation.ts:111` (the current calm register) |
| A news hook delivers what it promises, makes no "first" or "breaking" claim, and attributes single-source claims. | `quorum/docs/hooks/05-surfaces.md:95-101` |
| No invented statistics, fake urgency or unverifiable claims about the reader. | `quorum/docs/hooks/02-hook-craft-rules.md:38-40` |
| A gap names a concrete noun; a withheld referent ("this one trick") loses. | `quorum/docs/hooks/01-hook-psychology.md:21-31` |
| Slide 2 closes the gap the cover opens. | `quorum/docs/hooks/02-hook-craft-rules.md:25`, playbook:47 |

## Hook families

GoVIRAL names five families (`quorum/orchestrator/prompts/goviral.md:24-29`). The playbook adds two and lists the families that fail the rules (playbook:49-61).

| Family | Source | DNESKAi use | The brief must carry |
|---|---|---|---|
| Value | goviral.md:26-27 | The change itself in line one: tool, change, date. The default cover. | the change, in the evidence |
| Social proof | goviral.md:28 | Finding, figure and who says so. Precise figures persuade (`01-hook-psychology.md:82-89`) only when they are real. | the number, in the evidence |
| Story | goviral.md:25-26 | A dated third-person moment: date, actor, action. The reason goes on slide 2. | a date and a named actor |
| Curiosity | goviral.md:25 | A concrete gap stated as a declaration, such as "Nařízení má [N] stran. Rozhoduje jeden odstavec.", only when slide 2 names the paragraph. | the closing fact, in the evidence |
| Attributed quote | playbook:55 | Quote, speaker and role on one slide. | the quote, in the evidence |
| Human stakes | playbook:57 | Who is affected and from when. | the affected group, in the evidence |
| Contrarian | goviral.md:27-28 | Only a headline set against the document it reports, with both in the evidence (playbook:56). | both texts |

Families DNESKAi does not use: a question to the reader, alarm and superlatives, second-person "you're doing it wrong", and face, emoji or personal voice (playbook:58-61). The calm register bans the first and last outright; the other two make claims no evidence can license.

## Why Quorum's twelve news lines stay in Quorum

`quorum/studio/hooks/news.hooks.json:2-13` holds twelve lines written for a whole-day edition. Three describe the product instead of the event ("whole-day", "read-once", "earns-the-minutes" at lines 2, 8 and 11). Two gate on `signalStrengthAtLeast:80` (lines 10-11), a desk score the OwnDashboard brief does not carry (`quorum/docs/hooks/05-surfaces.md:60`), so they never fire here.

The cooldown arithmetic also rules out a fixed list. Quorum rests a line for `max(2 × cooldownDays, 14)` days per channel (`quorum/docs/hooks/03-metrics-and-testing.md:40-41`, `06-hook-brain.md:69`). At four posts a day, twelve lines with 8-12 day cooldowns run out by day three (HOOKS-03).

DNESKAi takes the engine ideas and leaves the lines:

- A gate licenses a claim. A hook may say only what the brief proves (`02-hook-craft-rules.md:33-37`, `05-surfaces.md:35-40`).
- Port the mechanism. The words get written per event (`05-surfaces.md:39-40`).
- Tag each hook with a family and cap any family at 20 % (`02-hook-craft-rules.md:18`). Rotate families, so a model writes each line fresh for its event.
- When no family fits, the cover gets the plain truthful headline (`03-metrics-and-testing.md:49-51`, `:77-79`; playbook:63).

## Carousel structures

`quorum/.claude/skills/social/references/carousel-frameworks.md` describes five frameworks for creator accounts. Four ideas from it pass the DNESKAi rules intact (HOOKS-06).

| Idea | Quorum lines | DNESKAi form |
|---|---|---|
| Slide 1 is the thumbnail and has to work alone in the feed. | carousel-frameworks.md:19, :130 | The cover carries one declarative finding. Slide 2 also has to stand alone, because Instagram may re-serve a carousel from slide 2 (playbook:9). |
| Problem-Proof: slide 1 opens a loop and the last slide shows the receipt. | carousel-frameworks.md:44, :52, :54 | The receipt is the sources slide that code writes after the slides the model writes (`dneskai-generation.ts:113`, playbook:74). |
| Demo Walkthrough: show the overview before the detail. | carousel-frameworks.md:108, :112 | One overview slide in an explainer deck. The playbook files it under register option C, so it waits for the owner (playbook:148). |
| Value-Stack: an exact count on the cover, delivered in full. | carousel-frameworks.md:30, :34, :38, :133 | Only when the source itself enumerates. Never pad toward a bigger number. |

Two production rules transfer as they stand: one visual template per carousel (carousel-frameworks.md:20, matching kits per post) and real numbers only (carousel-frameworks.md:134).

The DNESKAi deck itself follows playbook:69-74: cover, second cover, one beat per inner slide, code-written sources. A single fact takes two or three slides (playbook:76). The prompt asks for 4 to 7 written slides per carousel (`dneskai-generation.ts:113`).

## Excluded parts, and why

| Quorum lines | What they teach | Why DNESKAi leaves it out |
|---|---|---|
| carousel-frameworks.md:32, :71, :136 | Close with "comment a keyword, follow, link in bio" or a save, share and follow call | The register bans calls to follow or comment, and slides carry no URLs (`dneskai-generation.ts:111`). The last DNESKAi slide lists sources. |
| carousel-frameworks.md:48 | Problem-Proof cover as a personal result ("I/we did X") | DNESKAi has no person and writes no invented first person (playbook:130). |
| carousel-frameworks.md:87-90 | Rant Callout: "Unpopular opinion", escalation, a signed persona | Opinion and heat break the calm register; contrarian stays limited to headline against document. |
| carousel-frameworks.md:68 | Hack List cover: a stat implying most people fail | That is a claim about the reader with no evidence behind it (`02-hook-craft-rules.md:40`). |
| social/SKILL.md:86-104 | Curiosity, story, value and contrarian templates in first person ("I was wrong about", "I almost", "Unpopular opinion") | First person and opinion; keep the family, drop the template. |
| social/references/reverse-engineering.md:96-99 | Question, agree-or-disagree, tag-someone and save CTAs | The register bans questions and calls to comment. Comments also rank below sends (playbook:10). |
| social/references/reverse-engineering.md:105-108, :142-146 | "Smart friend" first-person voice; write from emotion | DNESKAi writes third-person editorial prose with no feelings attributed to anyone. |
| copywriting/SKILL.md:93-96 | Use rhetorical questions | `dneskai-generation.ts:111` bans rhetorical questions. |
| docs/hooks/02-hook-craft-rules.md:9-10 | Clipped, dry, confident voice with tykání | DNESKAi does not address the reader; its prompt sets a calm, skeptical voice instead. |
| docs/hooks/02-hook-craft-rules.md:106 | The final CTA slide is a quiet ad | DNESKAi ends on sources and carries no ad slide. |
| studio/hooks/news.hooks.json:2-13 | Twelve fixed edition lines | See the section on the twelve news lines above. |

## Owner decisions

Both were open when this page was written (playbook:161-167); the owner settled them on 22 October 2026:

- Register: option B without the family tag. The prompt asks for a factual cover hook and the humanizer's Czech voice carves it out (see [marketing-generation.md](marketing-generation.md#dneskai-briefs-generation-v5)).
- The hashtag ceiling: a caption carries at most five, `#dneskai` first (`dneskaiHashtags`).
