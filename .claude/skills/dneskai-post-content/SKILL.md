---
name: dneskai-post-content
description: The owner's binding rules for what a DNESKAi Instagram post may show. Use for any change to DNESKAi generation (prompt, schema, validation, caption assembly), the deck contract, the vendored carousel studio or its kits, the Design Lab editor, demo fixtures or anything that writes slide text or captions.
---

# DNESKAi post content

The owner set these rules on 22 October 2026. They hold for every kit, every slide type and every post,
and no other rule outranks them. Generation, validation, the editor and the studio templates must all
enforce them; a change that lets any of them through is a bug.

## Slides

- **The first slide shows the headline and nothing else.** A carousel's cover and a single-image post's only
  slide carry no kicker, no body, no picture credit and no label.
- **No page counts.** No slide shows "02 / 05" or any other position or count.
- **No picture credits on any slide.** "Obrázek: …" and "Foto: …" never appear in the graphics.
- **No sources slide.** A deck is the written slides only; nothing is appended after them.
- **No text about sources or verification.** No slide says where information comes from, which article,
  text or announcement states it, or whether it is confirmed or independently verified. Never "Zdrojem je
  oznámení samotného…", "Údaj pochází od firmy samotné", "nezávislé potvrzení chybí", "Z dostupného textu
  nevyplývá…", "podle dostupných zdrojů". Attribute a claim to its actor inside the sentence ("Anthropic
  uvádí, že…") and move on.

## Caption

- The same ban on text about sources and verification.
- No source list, no links, no picture credits.
- It ends with the AI disclosure ("Text připravil jazykový model. Výběr a schválení: redakce DNESKAi.") and
  the hashtags.
- **No call to comment or follow in model text.** The one allowed call is the keyword line, and code writes it
  from the approved keyword, in its own paragraph before the disclosure: „Napište do komentáře „SKILL“ a pošleme
  vám návod do zpráv.“ Only posts with a keyword (education) carry it; news posts do not. It holds no hashtag.
- **At most 10 hashtags**, `#dneskai` first. Generation keeps to it, and every caption edit is checked. The keyword
  line does not count toward them.

## DM message (education posts)

- The private message a keyword comment receives (`engagement.replyMessage`) follows the caption's truth rules:
  only what the evidence states, every number from the evidence, no text about sources or verification, no emoji,
  markup or hashtags, and no call to comment. It may carry one URL, and only an evidence link.
- The model writes it for education topics only; the owner edits and approves it with the post.

## Where it is enforced

- Prompt and checks: `src/lib/marketing/dneskai-generation.ts` (`SYSTEM_RULES`, `validateDneskaiCopy`,
  `validateDneskaiReplyMessage`, `dneskaiTalksAboutSources`, `buildDneskaiDeck`, `assembleDneskaiCaption`,
  `DNESKAI_HASHTAG_LIMIT`). The keyword line and the disclosure: `src/lib/marketing/dneskai-caption.ts`
  (`dneskaiKeywordLine`, `dneskaiCaptionWithKeyword`, also applied on every owner edit).
- What each slide type draws: `DNESKAI_PLACED_FIELDS` and `DNESKAI_TEXT_LIMITS` in
  `src/lib/marketing/dneskai-slide-layout.ts`, held to the vendored studio by
  `tests/lib/carousel-studio-vendor.test.ts`. `dneskaiShownDeck` brings an older deck into line when it is edited.
- Caption edits: `DNESKAI_CAPTION_HASHTAG_MAX` in `src/lib/marketing/dneskai-deck-editor.ts` and the `edit`
  action of `src/app/api/marketing/revisions/route.ts`.
- Templates: Quorum `studio/src/dneskai-kits/` (contract and all five kits) carry no folio or credit layers,
  and their cover and single templates hold only the headline.

Credits and source URLs stay in the database (`marketing_media_asset_links.credit`, brief evidence), so
provenance is kept even though the post never shows it.
