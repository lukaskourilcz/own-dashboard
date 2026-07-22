# OwnDashboard brand system

## Brand core

**Purpose:** connect the operational parts of one professional's work into one private system.

**Positioning:** a private operating system for projects, clients, opportunities, Career, money, planning, and professional knowledge.

**Promise:** OwnDashboard gives one professional a clear, connected view of work without turning it into disconnected tools.

**Attributes:** connected, precise, calm, capable, private, technical, intentional, dependable, direct, self-owned.

**Design thesis:** calm operational intelligence for one professional managing connected work.

**Visual concept:** operational cartography. Alignment, section lines, entity relationships, paths, timelines, consistent status markers, and a modular symbol make the system feel like a maintained work map rather than a card gallery. The interface should feel like a private control desk and work ledger, never a futuristic cockpit.

## Anti-positioning

OwnDashboard is not a team SaaS, public productivity product, full CRM, accounting suite, lifestyle tracker, “Life OS,” sales funnel, or generic AI chatbot. Never add pricing, plans, testimonials, public metrics, team claims, organization switchers, or lifestyle features. Tugedr is a professional opportunity source. Pulse, moods, habits, streaks, books, couples, and partner data remain retired.

## Voice

Copy is direct, specific, calm, short, honest about limits, and action-oriented. State the condition and consequence: “3 opportunities need a follow-up,” “GitHub access needs to be reconnected,” “AI will read the selected project records,” and “Create project after review.” Avoid “unlock,” “supercharge,” “seamless,” “revolutionary,” “magical,” and unqualified “smart.”

English and Czech must express the same meaning and consequence, not merely fit the same character count. Generated images never carry essential copy.

## Mark

The current deterministic mark is implemented by `src/components/brand-mark.tsx` and mirrored by the dynamic app icon. It uses a structured frame, a linked path, two square nodes, and one circular endpoint. It is name-independent, compact, monochrome-capable, and deliberately avoids a dashboard gauge, sparkle, crypto coin, analytics graph, and the OpenAI knot.

Higgsfield symbol exploration remains blocked because the connected MCP trial has no usable generation credits. The attempted vector and stylized model requests produced no asset. The next pass must compare safe low-cost or free alternatives before buying credits. Any generator may inform proportions only after three genuinely different directions are reviewed; the selected concept must preserve the placement contract and small-size clarity and be redrawn deterministically. Do not replace the component with an unreviewed raster logo.

## Color

- Warm paper and stone create the light canvas and inset ledger surfaces.
- Deep graphite and charcoal create dark canvas and surfaces.
- Deep ink/cobalt defines primary action, selection, focus, and structural identity.
- Amber is attention/follow-up, green is confirmed success/healthy, red is destructive/failed/overdue/high-risk, and blue-gray is information.
- Status colors are semantic, paired with text and markers, and never decorative.
- Purple-blue gradients, rainbow accents, neon, cyan glow, and saturated finance backgrounds are prohibited.

All implementation colors live in `src/app/globals.css`. Raw values are limited to fixed legal invoice output, third-party marks, and framework metadata that cannot consume CSS variables.

## Typography

Geist Sans remains the interface family; Geist Mono remains the technical family. UI headings are compact and moderately scaled. Monospace is reserved for repository paths, invoice symbols, cron expressions, commands, and identifiers. Money, dates, rates, counts, and durations use tabular figures. Authenticated surfaces never use giant marketing typography.

## Shape and surface

Use modest 4/7/10/14 px radii. Borders establish hierarchy before shadows. Ordinary modules are flat. Shadows belong to dialogs, popovers, toasts, and floating mobile controls. Pills are reserved for tags/status. Avoid nested cards, blurred decorative panels, glass, and oversized rounding.

## Iconography

Lucide is canonical at 14–16 px in dense controls and 16–20 px in primary actions. Meaningful icon-only controls require localized accessible names and tooltips where discoverability benefits. Do not put an icon in every heading. Status always includes a word or screen-reader label; color alone is insufficient.

## Motion

Motion communicates state, continuity, reordering, opening/closing, and generation progress. Use 110 ms fast feedback, 170 ms standard transitions, and 240 ms deliberate transitions with small distances and opacity. No looping decoration in operational screens, large scale effects, bounce on finance controls, or transitions that delay action. `MotionConfig` and `prefers-reduced-motion` remain authoritative.

## Transfer to a future name

Product identity remains centralized in `src/lib/brand.ts`. A later approved rename updates that file and the external checklist in `docs/external-setup.md`; it must not require replacing tokens, component semantics, the visual concept, or the symbol placement contract.
