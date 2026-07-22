# Higgsfield opportunity audit

Status: generation blocked after a live capability audit on 2026-07-22. The Higgsfield MCP connected, the private Plus workspace and model catalog loaded, and cost preflight succeeded. The billing endpoint then reported an active MCP trial with zero remaining trial credits. Recraft and Z Image returned `only_website_usage_on_trial_is_available`; Soul Location returned generation errors. No job produced an asset, no credit was spent, and no substitute generator or placeholder was used.

The governing rule is simple: generated media may establish a small brand atmosphere around authentic OwnDashboard UI; it must never fabricate operational evidence.

## Classification

| Candidate | Class | Decision and intended placement |
| --- | --- | --- |
| Brand-symbol exploration | High value, credit-blocked | Explore name-independent operational-cartography shapes, then redraw the selected mark deterministically as SVG. Current `BrandMark` is the production-safe vector/CSS contract, not generated output. |
| PWA icon and favicon exploration | High value, follows mark | Derive from the selected mark; maintain monochrome and mask-safe behavior. Current dynamic `src/app/icon.tsx` remains valid. |
| Login desktop/mobile stills | High value, credit-blocked | A text-free connected-work composition behind the seam marked `data-brand-media-slot="login-hero"` in `src/app/login/page.tsx`; sign-in and trust copy remain real HTML. |
| Login ambient loop/poster | Potentially useful, not yet justified | Only if an approved still materially benefits from subtle motion; must have static poster and reduced-motion fallback. |
| Inbox, Opportunities, Projects, Clients empty states | High value, credit-blocked | A small coherent family; only use where the state is truly empty and never behind dense data. Existing `EmptyState` remains complete without images. |
| Open Graph / README presentation | High value, credit-blocked | Composite a real `/dev-preview` screenshot deterministically over an abstract brand background; never redraw UI or invent metrics. |
| Integration disconnected state | Potentially useful, rejected for now | Existing status, copy, and actions communicate the state without decorative media. |
| AI limited-context explanation | Potentially useful, rejected for now | Prefer a deterministic semantic source diagram; no brain, bot, glow, or unverified claim. |
| Project workspace texture | Unnecessary | Dense project context does not benefit from decorative texture. |
| Documentation diagrams | Unnecessary for current scope | Prefer deterministic Mermaid/SVG; generated framing adds no operational evidence. |
| Social graphics / future public loop | Unnecessary now | OwnDashboard has no marketing funnel or current announcement requirement. |
| Career empty state | Unnecessary | Domain copy and real application/listing structure carry more value than decoration. |
| Financial screens, charts, accounts, transactions | Harmful | Trust depends on exact real values and deterministic charts. |
| Invoice UI and print output | Inappropriate | Legal/financial correctness, QR readability, and A4 isolation prohibit generated content. |
| Notes editor, tables, repository/bank/GitHub UI | Harmful | Generated media would compete with or fake real operational information. |
| Product screenshots | Inappropriate to generate | Capture authentic fixtures from `/dev-preview` only. |
| Fake people, clients, recruiters, testimonials, logos, metrics | Inappropriate | These claims do not exist and must never be invented. |

## Acceptance boundary

An asset is eligible only when its real MCP capability is known, it has a concrete placement and size budget, three materially different outputs can be reviewed, weak directions can be rejected, authentic UI stays untouched, responsive/theme fallbacks exist, and exact provenance can be recorded in `generated-media-manifest.json`.

MCP presence is not enough: `balance`, workspace selection, model discovery, and a `get_cost` preflight must all succeed, and the billing status must report usable paid or trial credits before production requests are submitted. The exact attempted prompts, models, errors, and request IDs are recorded in the manifest so the next run can resume without repeating the failed capability discovery.
