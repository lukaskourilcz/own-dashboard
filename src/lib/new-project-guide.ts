/**
 * The standards a new project (and the agent building it) should follow so it
 * plugs into OwnDashboard immediately. Rendered in the Projects panel and
 * English is mirrored to `newProject.md` at the repo root; keep it in sync.
 * Czech is the equivalent in-app guidance, with the same authorization rules.
 */
export const NEW_PROJECT_GUIDE = `# New project guide — wiring a repo into OwnDashboard

Standards every new project (and the agent building it) should follow so it plugs into OwnDashboard immediately: tasks import, the Knowledge / Scaling / Monetization tabs render, and existing traffic connections remain available. Keep these files at the **repository root**.

## The four root markdown files

Create all four — OwnDashboard reads and renders each.

### \`about-project.md\` — what it is + the stack
A one-paragraph summary, then \`## Tech stack\` and \`## Third-party libraries\` as bullet lists (\`Name — what it does\`). This is the **only** place the tech stack lives. Keep it ~25 lines.

### \`NEEDED.md\` — owner/agent action items
A markdown checklist, one task per line, in the shared marker format:

\`- [ ] **Title** — description. [imp:1-5] [owner:me|ai] [time:30m] [kind:K]\`

- \`[imp:N]\` 1–5 (5 = highest) · \`[owner:me|ai]\` (ai = an agent can do it end-to-end) · \`[time:…]\` (30m / 2h) · \`[kind:K]\` ∈ \`setup\` \`deploy\` \`legal\` \`content\` \`decision\`.
- Ticked items (\`- [x]\`) count as done. OwnDashboard imports these as tasks.

### \`scaling.md\` — cost & scaling (keep it brief)
Cost/scaling only (the stack is in \`about-project.md\`). ~20 lines: a one-line intro, a compact **What it costs** summary, 2–3 **When to scale** triggers, one **Keep costs down** line. Date the prices and stay honest.

### \`monetization.md\` — how it could earn
A short framing sentence, then a table of options for this project — \`Option | Likelihood of income | Possible earnings | Pros | Cons\` — then a one-line recommendation. Options e.g. GitHub Sponsors, ads, subscriptions, buy-me-a-coffee, one-off sales, consulting / lead-gen. Be honest; mark options that don't apply.

## Wire it to OwnDashboard

- **Deploy on Vercel** from \`main\`, with the git repo linked.
- In OwnDashboard, add the project and set its **repository** (\`owner/name\`) — that's how tasks, docs, and traffic are all matched.

## Skills every repo carries (\`.claude/skills/\`)

- **\`session-start\`** — scan \`NEEDED.md\` for \`[owner:ai]\` tasks an agent can do now and surface them.
- **\`session-end\`** — update \`NEEDED.md\` (finished + newly-needed owner items) and follow the git workflow below.
- **\`markdown-checkup\`** — review every markdown file: trim stale info, update, or verify it's still accurate.

Mirror the common tooling the other repos share where it fits: a design-system skill, a visual-QA / accessibility reviewer, a release-validation check, a product-context skill, and \`preview-video\`.

## Git workflow (every session)

- **Read the destination repository's instructions first.** Its authorization and release rules govern that repository.
- **Commit frequently** in small, meaningful steps, with relevant validation and current documentation.
- **Push and merge only when the owner has authorized it.** Existing authorization remains valid; do not ask again for work already approved. Complete required migrations and release checks before merging. A merge can deploy production when its Git integration is enabled.
- **Clean up branches only within the authorized scope.** Preserve unrelated work and branches; follow the repository's retention policy.
`;

export const NEW_PROJECT_GUIDE_CS = `# Průvodce novým projektem — propojení s OwnDashboard

Pokyny pro nový projekt i agenta, který ho vyvíjí. Díky nim OwnDashboard načte úkoly, dokumentaci v kartách Znalosti / Škálování / Monetizace a stávající zdroje návštěvnosti. Následující soubory patří do **kořene repozitáře**.

## Čtyři hlavní soubory Markdown

Vytvořte všechny čtyři. OwnDashboard je načítá a zobrazuje.

### \`about-project.md\` — účel a technologie
Jeden odstavec se shrnutím, pak nadpisy \`## Tech stack\` a \`## Third-party libraries\` s odrážkami ve formátu \`Název — účel\`. Přehled technologií udržujte pouze tady. Přibližně 25 řádků.

### \`NEEDED.md\` — úkoly pro vlastníka a agenta
Seznam úkolů Markdown, jeden úkol na řádek, ve společném formátu:

\`- [ ] **Název** — popis. [imp:1-5] [owner:me|ai] [time:30m] [kind:K]\`

- \`[imp:N]\`: důležitost 1–5 (5 je nejvyšší). \`[owner:me|ai]\`: řešitel (ai znamená, že agent zvládne celý úkol). \`[time:…]\`: odhad (30m / 2h). \`[kind:K]\`: jedna z hodnot \`setup\`, \`deploy\`, \`legal\`, \`content\`, \`decision\`.
- Zaškrtnuté položky (\`- [x]\`) jsou dokončené. OwnDashboard tento seznam importuje jako úkoly.

### \`scaling.md\` — náklady a škálování
Pouze náklady a škálování; technologie patří do \`about-project.md\`. Přibližně 20 řádků: krátký úvod, přehled nákladů, 2–3 podmínky pro škálování a jeden řádek k úsporám. U cen uvádějte datum a ověřené údaje.

### \`monetization.md\` — možnosti příjmu
Krátký úvod, tabulka možností pro daný projekt (\`Možnost | Pravděpodobnost příjmu | Možný výdělek | Výhody | Nevýhody\`) a jednořádkové doporučení. Například GitHub Sponsors, reklama, předplatné, dobrovolné příspěvky, jednorázový prodej nebo získávání klientů. Nevhodné možnosti výslovně označte.

## Propojení s OwnDashboard

- **Nasaďte na Vercel** z větve \`main\` s propojeným repozitářem.
- V OwnDashboard přidejte projekt a nastavte **repozitář** (\`owner/name\`). Podle něj se přiřazují úkoly, dokumentace a návštěvnost.

## Dovednosti v každém repozitáři (\`.claude/skills/\`)

- **\`session-start\`**: projděte \`NEEDED.md\` a upozorněte na proveditelné úkoly s \`[owner:ai]\`.
- **\`session-end\`**: aktualizujte \`NEEDED.md\` (dokončené úkoly a nové kroky vlastníka) a dodržte níže uvedená pravidla Gitu.
- **\`markdown-checkup\`**: projděte soubory Markdown, odstraňte zastaralé informace a ostatní aktualizujte nebo ověřte.

Podle potřeby převezměte společné nástroje ostatních repozitářů: návrhový systém, kontrolu vzhledu a přístupnosti, ověření vydání, kontext produktu a \`preview-video\`.

## Pravidla Gitu pro každou relaci

- **Nejdřív přečtěte pokyny cílového repozitáře.** Práci v něm řídí jeho pravidla oprávnění a vydávání.
- **Průběžně commitujte** malé, smysluplné změny s odpovídajícím ověřením a aktuální dokumentací.
- **Push a sloučení provádějte jen s oprávněním vlastníka.** Dřívější oprávnění platí dál; již schválenou práci znovu nepotvrzujte. Před sloučením dokončete potřebné migrace a kontroly vydání. Sloučení může při zapnuté Git integraci spustit produkční nasazení.
- **Větve uklízejte pouze v povoleném rozsahu.** Zachovejte nesouvisející práci a větve; dodržte pravidla repozitáře pro jejich uchovávání.
`;
