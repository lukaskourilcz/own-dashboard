-- =============================================================
-- Seed: curated AI & dev-resource links for the "AI links" section
-- =============================================================
-- A researched catalogue (July 2026) of 56 sites that improve projects built
-- with Claude Code: AI design, AI image generation, components, free APIs,
-- hosting, performance, MCP/Claude Code ecosystem, security and inspiration.
-- Every entry was scored 1–5 during research; only sites scoring 3+ made the
-- cut. Each description is formatted as:
--
--     <score>/5 · <cost> · <what it is>
--
-- where <cost> is one of: Free · Free (open source) · Free tier + paid ·
-- Pay-per-use · Paid — so you can see at a glance what is free to use.
--
-- How to run
--   Supabase Dashboard → SQL Editor → paste this whole file → Run.
--   (Same place you run supabase/schema.sql. Uses the table-owner role, so
--   RLS does not block it.)
--
-- Safe to re-run (idempotent, upgrade-aware)
--   • Categories are matched by name (case-insensitive) and created only
--     when missing — existing categories are reused, never duplicated.
--   • Links are matched by URL (ignoring http/https, "www." and trailing
--     slashes) and inserted only when missing.
--   • If a matching link was written by an earlier version of this seed
--     (its description starts with "<n>/5 ·"), its description is refreshed
--     to the latest text — e.g. to pick up the cost labels. Links you added
--     or wrote yourself are never modified, and nothing is ever deleted.
--
-- Display order
--   The panel shows links newest-first, so inserted rows get slightly
--   staggered timestamps: higher-ranked sites appear first per category.

drop table if exists _seed_ai_links;
create temp table _seed_ai_links (
  rn          serial primary key,
  category    text not null,
  title       text not null,
  url         text not null,
  description text not null
);

insert into _seed_ai_links (category, title, url, description) values
  -- ---- AI DESIGN ----------------------------------------------------
  ('AI DESIGN', 'v0 by Vercel', 'https://v0.app/',
   '5/5 · Free tier + paid · Agentic UI generation tuned for Next.js + shadcn/ui — riff on screens, then paste the code into your repo.'),
  ('AI DESIGN', 'tweakcn', 'https://tweakcn.com/',
   '5/5 · Free (open source) · Visual + AI theme editor for shadcn/Tailwind: restyle a whole app, check contrast, export CSS variables.'),
  ('AI DESIGN', 'Onlook', 'https://onlook.com/',
   '4/5 · Free tier + paid, open source · "Cursor for designers" — visually edit your running Next.js + Tailwind app and it writes the code back.'),
  ('AI DESIGN', 'Google Stitch', 'https://stitch.withgoogle.com/',
   '4/5 · Free · AI design canvas from Google: prompt to hi-fi screens, export to code or Figma. Great for exploring layouts.'),
  ('AI DESIGN', 'Recraft', 'https://www.recraft.ai/',
   '4/5 · Free tier + paid · AI image generator that outputs real SVG vectors, icon sets and brand assets.'),
  ('AI DESIGN', 'Ideogram', 'https://ideogram.ai/',
   '4/5 · Free tier + paid · Best-in-class text rendering in AI images (logos, banners, OG images). Commercial use OK on the free tier.'),

  -- ---- AI IMAGES ------------------------------------------------------
  ('AI IMAGES', 'FLUX — Black Forest Labs', 'https://bfl.ai/',
   '5/5 · Free open weights + paid API · FLUX.2 model family: frontier quality, superb prompt adherence and text, reference-image editing. Playground + API.'),
  ('AI IMAGES', 'Midjourney', 'https://www.midjourney.com/',
   '5/5 · Paid (from $10/mo, no free tier) · Still the aesthetic benchmark for stylized art, moodboards and hero imagery.'),
  ('AI IMAGES', 'fal.ai', 'https://fal.ai/',
   '5/5 · Pay-per-use (signup credits) · One fast API + playgrounds for nearly every frontier image/video model — easiest way to wire image gen into your apps.'),
  ('AI IMAGES', 'Seedream (Dreamina)', 'https://dreamina.capcut.com/',
   '4/5 · Free tier + paid · ByteDance leaderboard-topping image models (Seedream 4.5 / 5.0): multi-image fusion and editing, 4K output, strong text.'),
  ('AI IMAGES', 'Reve', 'https://reve.com/',
   '4/5 · Free tier + paid · Layout-first generation with standout prompt faithfulness and multi-image editing; chat-style "Flow" edits.'),
  ('AI IMAGES', 'Krea', 'https://www.krea.ai/',
   '4/5 · Free tier + paid · Realtime canvas — sketch and it renders instantly. Hosts FLUX, Seedream and more, plus video and upscaling.'),
  ('AI IMAGES', 'Leonardo AI', 'https://leonardo.ai/',
   '4/5 · Free tier + paid · Production-oriented suite: styles, canvas, model training; roughly 150 free images/day.'),
  ('AI IMAGES', 'Replicate', 'https://replicate.com/',
   '4/5 · Pay-per-use · Run thousands of open models (FLUX, Seedream, video, audio) through one API.'),

  -- ---- COMPONENTS & UI ----------------------------------------------
  ('COMPONENTS & UI', 'shadcn/ui', 'https://ui.shadcn.com/',
   '5/5 · Free (open source) · The component-registry standard: copy-paste ownership, CLI installs, and the base that AI coding agents know best.'),
  ('COMPONENTS & UI', 'Kibo UI', 'https://www.kibo-ui.com/',
   '4/5 · Free (MIT) · Advanced shadcn registry: Gantt, Kanban, code editor, AI chat, dropzone.'),
  ('COMPONENTS & UI', 'Magic UI', 'https://magicui.design/',
   '4/5 · Free + paid templates · 150+ open-source animated components (marquees, beams, bento grids) for landing-page polish.'),
  ('COMPONENTS & UI', 'Origin UI', 'https://originui.com/',
   '4/5 · Free · Hundreds of copy-paste shadcn/Tailwind variants — huge breadth for forms, inputs and dialogs.'),
  ('COMPONENTS & UI', 'Aceternity UI', 'https://ui.aceternity.com/',
   '4/5 · Free + paid Pro · Wow-factor sections: 3D cards, spotlights and animated backgrounds for hero moments.'),
  ('COMPONENTS & UI', 'ReactBits', 'https://reactbits.dev/',
   '4/5 · Free (open source) · Playful animated React components and text effects.'),
  ('COMPONENTS & UI', 'Tremor', 'https://tremor.so/',
   '4/5 · Free (open source) · Dashboard and chart components (now by Vercel) — a natural fit for dashboard projects like this one.'),
  ('COMPONENTS & UI', '21st.dev', 'https://21st.dev/',
   '4/5 · Free tier + paid · Community component marketplace plus the Magic MCP that generates UI right inside Claude Code.'),
  ('COMPONENTS & UI', 'awesome-shadcn-ui', 'https://github.com/birobirobiro/awesome-shadcn-ui',
   '4/5 · Free · Curated index of the whole shadcn ecosystem — registries, tools, templates and themes.'),

  -- ---- FREE APIS & DATA ----------------------------------------------
  ('FREE APIS & DATA', 'free-for.dev', 'https://free-for.dev/',
   '5/5 · Free · The canonical list of developer free tiers — SaaS, PaaS, databases, monitoring, email, everything.'),
  ('FREE APIS & DATA', 'public-apis', 'https://github.com/public-apis/public-apis',
   '5/5 · Free · Massive collective list of free public APIs for any kind of data your next feature needs.'),
  ('FREE APIS & DATA', 'OpenRouter', 'https://openrouter.ai/',
   '5/5 · Free models + pay-per-use · One API for every LLM, including genuinely free models. A one-time $10 raises the free daily cap.'),
  ('FREE APIS & DATA', 'Hugging Face', 'https://huggingface.co/',
   '5/5 · Free (paid compute extras) · Open models, datasets and Spaces demos — the GitHub of AI.'),
  ('FREE APIS & DATA', 'Google AI Studio', 'https://aistudio.google.com/',
   '4/5 · Free tier + paid · The most generous permanent free LLM API tier (Gemini), no credit card needed.'),
  ('FREE APIS & DATA', 'Groq', 'https://groq.com/',
   '4/5 · Free tier + paid · Ridiculously fast free inference for open models (Llama, Qwen, DeepSeek) — great for prototyping AI features.'),
  ('FREE APIS & DATA', 'Firecrawl', 'https://www.firecrawl.dev/',
   '4/5 · Free tier + paid · Turns any website into clean LLM-ready markdown; scrape/crawl/search API.'),
  ('FREE APIS & DATA', 'Jina Reader', 'https://jina.ai/reader/',
   '4/5 · Free tier + paid · Prefix any URL with r.jina.ai and get clean markdown back — keyless at low rates.'),
  ('FREE APIS & DATA', 'DummyJSON', 'https://dummyjson.com/',
   '4/5 · Free · Fake REST API with products, users, carts and auth — perfect for prototyping UIs before the backend exists.'),
  ('FREE APIS & DATA', 'Mockaroo', 'https://www.mockaroo.com/',
   '4/5 · Free tier + paid · Generate realistic test data from a custom schema — CSV, JSON or straight SQL inserts.'),

  -- ---- HOSTING & BACKEND ----------------------------------------------
  ('HOSTING & BACKEND', 'Cloudflare Workers & Pages', 'https://workers.cloudflare.com/',
   '5/5 · Free tier + paid · Unlimited-bandwidth static hosting plus a generous edge-compute free tier; commercial use allowed.'),
  ('HOSTING & BACKEND', 'Neon', 'https://neon.com/',
   '5/5 · Free tier + paid · Serverless Postgres with git-like branching and scale-to-zero — the friendliest DB free tier for side projects.'),
  ('HOSTING & BACKEND', 'Turso', 'https://turso.tech/',
   '4/5 · Free tier + paid · SQLite at the edge with a huge free tier (5 GB) — great for per-user or low-latency data.'),
  ('HOSTING & BACKEND', 'Upstash', 'https://upstash.com/',
   '4/5 · Free tier + pay-per-use · Serverless Redis plus QStash cron/queues.'),
  ('HOSTING & BACKEND', 'Convex', 'https://convex.dev/',
   '4/5 · Free tier + paid · Reactive TypeScript backend — realtime by default, no SQL.'),
  ('HOSTING & BACKEND', 'Render', 'https://render.com/',
   '4/5 · Free tier + paid · Web services and Postgres without a credit card; free instances spin down when idle.'),

  -- ---- PERFORMANCE & MONITORING ---------------------------------------
  ('PERFORMANCE & MONITORING', 'PageSpeed Insights', 'https://pagespeed.web.dev/',
   '5/5 · Free · The canonical Core Web Vitals check, including real-user field data when available.'),
  ('PERFORMANCE & MONITORING', 'WebPageTest', 'https://www.webpagetest.org/',
   '4/5 · Free tier + paid · Deep waterfalls, filmstrips and real devices/locations — shows WHY a page is slow.'),
  ('PERFORMANCE & MONITORING', 'DebugBear Free Tools', 'https://www.debugbear.com/tools',
   '4/5 · Free tools (paid product) · Speed tests with the most detailed LCP breakdown you can get at no cost.'),
  ('PERFORMANCE & MONITORING', 'UptimeRobot', 'https://uptimerobot.com/',
   '4/5 · Free tier + paid · 50 free uptime monitors at 5-minute intervals — set and forget.'),
  ('PERFORMANCE & MONITORING', 'Better Stack', 'https://betterstack.com/',
   '4/5 · Free tier + paid · Uptime checks, incident timelines, status pages and logs.'),

  -- ---- CLAUDE CODE & MCP ----------------------------------------------
  ('CLAUDE CODE & MCP', 'Context7', 'https://context7.com/',
   '5/5 · Free tier + paid · Up-to-date, version-specific library docs served to Claude Code via MCP — kills stale-training-data bugs.'),
  ('CLAUDE CODE & MCP', 'Smithery', 'https://smithery.ai/',
   '5/5 · Free · The package manager for MCP servers — search thousands and install with one line.'),
  ('CLAUDE CODE & MCP', 'awesome-claude-code', 'https://github.com/hesreallyhim/awesome-claude-code',
   '5/5 · Free · The canonical curated list of Claude Code skills, hooks, agents, statuslines and tooling.'),
  ('CLAUDE CODE & MCP', 'PulseMCP', 'https://www.pulsemcp.com/',
   '4/5 · Free · The largest hand-reviewed MCP server directory, updated daily.'),
  ('CLAUDE CODE & MCP', 'Superpowers', 'https://github.com/obra/superpowers',
   '4/5 · Free (open source) · The biggest community skill framework for Claude Code: brainstorm → plan → TDD → review.'),
  ('CLAUDE CODE & MCP', 'DeepWiki', 'https://deepwiki.com/',
   '4/5 · Free (public repos) · AI-generated interactive wiki for any GitHub repo — great before adopting a dependency.'),
  ('CLAUDE CODE & MCP', 'GitIngest', 'https://gitingest.com/',
   '4/5 · Free · Any repo → one LLM-ready text digest; just swap "hub" for "ingest" in a GitHub URL.'),

  -- ---- SECURITY --------------------------------------------------------
  ('SECURITY', 'Security Headers', 'https://securityheaders.com/',
   '4/5 · Free · One-click grade of your HTTP security headers with concrete fixes.'),
  ('SECURITY', 'MDN HTTP Observatory', 'https://developer.mozilla.org/en-US/observatory',
   '4/5 · Free · MDN security scan for your deployed site with actionable guidance.'),

  -- ---- INSPIRATION -----------------------------------------------------
  ('INSPIRATION', 'Mobbin', 'https://mobbin.com/',
   '5/5 · Free tier + paid · Huge library of real app screens and UX flows — the fastest answer to "how do good apps do X?".'),
  ('INSPIRATION', 'Land-book', 'https://land-book.com/',
   '4/5 · Free · Curated landing-page gallery to borrow layout and tone ideas from.'),
  ('INSPIRATION', 'Godly', 'https://godly.website/',
   '4/5 · Free · Astronomically good web design inspiration, one standout site at a time.');

do $$
declare
  v_email text := 'kouril.lukas@gmail.com';  -- ← your login email; edit if needed
  v_user  uuid;
  v_cat   uuid;
  v_sort  integer;
  r_cat   record;
  n_ins   integer;
  n_upd   integer;
  n_tot_ins integer := 0;
  n_tot_upd integer := 0;
begin
  select id into v_user
  from auth.users
  where lower(email) = lower(v_email)
  limit 1;

  if v_user is null then
    raise exception 'No auth user found with email %. Edit v_email at the top of the DO block.', v_email;
  end if;

  for r_cat in
    select category, min(rn) as first_rn
    from _seed_ai_links
    group by category
    order by first_rn
  loop
    -- Reuse an existing category with the same name, else create it at the
    -- end of the current sort order.
    select id into v_cat
    from public.ai_categories
    where user_id = v_user
      and upper(trim(name)) = upper(trim(r_cat.category))
    order by sort_order
    limit 1;

    if v_cat is null then
      select coalesce(max(sort_order), 0) + 1 into v_sort
      from public.ai_categories
      where user_id = v_user;

      insert into public.ai_categories (user_id, name, sort_order)
      values (v_user, r_cat.category, v_sort)
      returning id into v_cat;
    end if;

    -- Insert only links whose URL the user does not already have anywhere
    -- (scheme-, www- and trailing-slash-insensitive). Timestamps are
    -- staggered by rank so the best links render first (list is newest-first).
    insert into public.ai_links
      (user_id, category_id, title, url, description, created_at, updated_at)
    select
      v_user, v_cat, s.title, s.url, s.description,
      now() - make_interval(secs => s.rn),
      now() - make_interval(secs => s.rn)
    from _seed_ai_links s
    where s.category = r_cat.category
      and not exists (
        select 1
        from public.ai_links l
        where l.user_id = v_user
          and regexp_replace(regexp_replace(lower(l.url), '^https?://(www\.)?', ''), '/+$', '')
            = regexp_replace(regexp_replace(lower(s.url), '^https?://(www\.)?', ''), '/+$', '')
      );

    get diagnostics n_ins = row_count;
    n_tot_ins := n_tot_ins + n_ins;

    -- Refresh descriptions of links written by an earlier run of this seed
    -- (recognizable by the "<n>/5 ·" prefix), e.g. to add the cost labels.
    -- Links the user created or edited themselves never match and are left
    -- alone; title, URL and category are never changed either.
    update public.ai_links l
    set description = s.description,
        updated_at  = now()
    from _seed_ai_links s
    where s.category = r_cat.category
      and l.user_id = v_user
      and l.description ~ '^[1-5]/5 ·'
      and l.description is distinct from s.description
      and regexp_replace(regexp_replace(lower(l.url), '^https?://(www\.)?', ''), '/+$', '')
        = regexp_replace(regexp_replace(lower(s.url), '^https?://(www\.)?', ''), '/+$', '');

    get diagnostics n_upd = row_count;
    n_tot_upd := n_tot_upd + n_upd;
  end loop;

  raise notice 'Seed complete: % new link(s) inserted, % description(s) refreshed for %.',
    n_tot_ins, n_tot_upd, v_email;
end $$;

drop table if exists _seed_ai_links;
