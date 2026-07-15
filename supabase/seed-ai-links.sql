-- =============================================================
-- Seed: curated AI & dev-resource links for the "AI links" section
-- =============================================================
-- A researched catalogue (July 2026) of sites that improve projects built
-- with Claude Code: AI design, components, free APIs, hosting, performance,
-- MCP/Claude Code ecosystem, security and inspiration. Every entry was
-- scored 1–5 during research; only sites scoring 3+ made the cut, and the
-- score is embedded at the start of each description ("5/5 · …").
--
-- How to run
--   Supabase Dashboard → SQL Editor → paste this whole file → Run.
--   (Same place you run supabase/schema.sql. Uses the table-owner role, so
--   RLS does not block it.)
--
-- Safe to re-run (idempotent)
--   • Categories are matched by name (case-insensitive) and created only
--     when missing — existing categories are reused, never duplicated.
--   • Links are matched by URL (ignoring http/https, "www." and trailing
--     slashes) across your whole collection and inserted only when you do
--     not already have that site. Nothing is ever updated or deleted.
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
   '5/5 · Agentic UI generation tuned for Next.js + shadcn/ui — riff on screens, then paste the code into your repo. Free tier.'),
  ('AI DESIGN', 'tweakcn', 'https://tweakcn.com/',
   '5/5 · Visual + AI theme editor for shadcn/Tailwind: restyle a whole app, check contrast, export CSS variables. Open source.'),
  ('AI DESIGN', 'Onlook', 'https://onlook.com/',
   '4/5 · Open-source "Cursor for designers" — visually edit your running Next.js + Tailwind app and it writes the code back.'),
  ('AI DESIGN', 'Google Stitch', 'https://stitch.withgoogle.com/',
   '4/5 · Free AI design canvas from Google: prompt to hi-fi screens, export to code or Figma. Great for exploring layouts.'),
  ('AI DESIGN', 'Recraft', 'https://www.recraft.ai/',
   '4/5 · AI image generator that outputs real SVG vectors, icon sets and brand assets. Free daily credits.'),
  ('AI DESIGN', 'Ideogram', 'https://ideogram.ai/',
   '4/5 · Best-in-class text rendering in AI images (logos, banners, OG images). Free daily credits, commercial use allowed.'),

  -- ---- COMPONENTS & UI ----------------------------------------------
  ('COMPONENTS & UI', 'shadcn/ui', 'https://ui.shadcn.com/',
   '5/5 · The component-registry standard: copy-paste ownership, CLI installs, and the base that AI coding agents know best.'),
  ('COMPONENTS & UI', 'Kibo UI', 'https://www.kibo-ui.com/',
   '4/5 · Free shadcn registry of advanced components: Gantt, Kanban, code editor, AI chat, dropzone. MIT-licensed.'),
  ('COMPONENTS & UI', 'Magic UI', 'https://magicui.design/',
   '4/5 · 150+ free animated components (marquees, beams, bento grids) for landing-page polish.'),
  ('COMPONENTS & UI', 'Origin UI', 'https://originui.com/',
   '4/5 · Hundreds of free copy-paste shadcn/Tailwind variants — huge breadth for forms, inputs and dialogs.'),
  ('COMPONENTS & UI', 'Aceternity UI', 'https://ui.aceternity.com/',
   '4/5 · Wow-factor sections: 3D cards, spotlights and animated backgrounds for hero moments.'),
  ('COMPONENTS & UI', 'ReactBits', 'https://reactbits.dev/',
   '4/5 · Playful animated React components and text effects. Free and open source.'),
  ('COMPONENTS & UI', 'Tremor', 'https://tremor.so/',
   '4/5 · Dashboard and chart components (now by Vercel) — a natural fit for dashboard projects like this one.'),
  ('COMPONENTS & UI', '21st.dev', 'https://21st.dev/',
   '4/5 · Community component marketplace plus the Magic MCP that generates UI right inside Claude Code.'),
  ('COMPONENTS & UI', 'awesome-shadcn-ui', 'https://github.com/birobirobiro/awesome-shadcn-ui',
   '4/5 · Curated index of the whole shadcn ecosystem — registries, tools, templates and themes.'),

  -- ---- FREE APIS & DATA ----------------------------------------------
  ('FREE APIS & DATA', 'free-for.dev', 'https://free-for.dev/',
   '5/5 · The canonical list of developer free tiers — SaaS, PaaS, databases, monitoring, email, everything.'),
  ('FREE APIS & DATA', 'public-apis', 'https://github.com/public-apis/public-apis',
   '5/5 · Massive collective list of free public APIs for any kind of data your next feature needs.'),
  ('FREE APIS & DATA', 'OpenRouter', 'https://openrouter.ai/',
   '5/5 · One API for every LLM, including a rotating set of genuinely free models. A one-time $10 raises the free daily cap.'),
  ('FREE APIS & DATA', 'Hugging Face', 'https://huggingface.co/',
   '5/5 · Open models, datasets and Spaces demos — the GitHub of AI.'),
  ('FREE APIS & DATA', 'Google AI Studio', 'https://aistudio.google.com/',
   '4/5 · The most generous permanent free LLM API tier (Gemini), no credit card needed.'),
  ('FREE APIS & DATA', 'Groq', 'https://groq.com/',
   '4/5 · Ridiculously fast free inference for open models (Llama, Qwen, DeepSeek) — great for prototyping AI features.'),
  ('FREE APIS & DATA', 'Firecrawl', 'https://www.firecrawl.dev/',
   '4/5 · Turns any website into clean LLM-ready markdown; scrape/crawl/search API with free credits.'),
  ('FREE APIS & DATA', 'Jina Reader', 'https://jina.ai/reader/',
   '4/5 · Prefix any URL with r.jina.ai and get clean markdown back — free, no key required.'),
  ('FREE APIS & DATA', 'DummyJSON', 'https://dummyjson.com/',
   '4/5 · Fake REST API with products, users, carts and auth — perfect for prototyping UIs before the backend exists.'),
  ('FREE APIS & DATA', 'Mockaroo', 'https://www.mockaroo.com/',
   '4/5 · Generate realistic test data from a custom schema — CSV, JSON or straight SQL inserts.'),

  -- ---- HOSTING & BACKEND ----------------------------------------------
  ('HOSTING & BACKEND', 'Cloudflare Workers & Pages', 'https://workers.cloudflare.com/',
   '5/5 · Unlimited-bandwidth static hosting plus a generous edge-compute free tier; commercial use allowed.'),
  ('HOSTING & BACKEND', 'Neon', 'https://neon.com/',
   '5/5 · Serverless Postgres with git-like branching and scale-to-zero — the friendliest DB free tier for side projects.'),
  ('HOSTING & BACKEND', 'Turso', 'https://turso.tech/',
   '4/5 · SQLite at the edge with a huge free tier (5 GB) — great for per-user or low-latency data.'),
  ('HOSTING & BACKEND', 'Upstash', 'https://upstash.com/',
   '4/5 · Serverless Redis plus QStash cron/queues, pay-per-request with a real free tier.'),
  ('HOSTING & BACKEND', 'Convex', 'https://convex.dev/',
   '4/5 · Reactive TypeScript backend — realtime by default, no SQL, generous free tier.'),
  ('HOSTING & BACKEND', 'Render', 'https://render.com/',
   '4/5 · Free web services and Postgres without a credit card; free instances spin down when idle.'),

  -- ---- PERFORMANCE & MONITORING ---------------------------------------
  ('PERFORMANCE & MONITORING', 'PageSpeed Insights', 'https://pagespeed.web.dev/',
   '5/5 · The canonical Core Web Vitals check, including real-user field data when available.'),
  ('PERFORMANCE & MONITORING', 'WebPageTest', 'https://www.webpagetest.org/',
   '4/5 · Deep waterfalls, filmstrips and real devices/locations — shows WHY a page is slow.'),
  ('PERFORMANCE & MONITORING', 'DebugBear Free Tools', 'https://www.debugbear.com/tools',
   '4/5 · Free speed tests with the most detailed LCP breakdown you can get at no cost.'),
  ('PERFORMANCE & MONITORING', 'UptimeRobot', 'https://uptimerobot.com/',
   '4/5 · 50 free uptime monitors at 5-minute intervals — set and forget.'),
  ('PERFORMANCE & MONITORING', 'Better Stack', 'https://betterstack.com/',
   '4/5 · Uptime checks, incident timelines, status pages and logs with a polished free tier.'),

  -- ---- CLAUDE CODE & MCP ----------------------------------------------
  ('CLAUDE CODE & MCP', 'Context7', 'https://context7.com/',
   '5/5 · Up-to-date, version-specific library docs served to Claude Code via MCP — kills stale-training-data bugs.'),
  ('CLAUDE CODE & MCP', 'Smithery', 'https://smithery.ai/',
   '5/5 · The package manager for MCP servers — search thousands and install with one line.'),
  ('CLAUDE CODE & MCP', 'awesome-claude-code', 'https://github.com/hesreallyhim/awesome-claude-code',
   '5/5 · The canonical curated list of Claude Code skills, hooks, agents, statuslines and tooling.'),
  ('CLAUDE CODE & MCP', 'PulseMCP', 'https://www.pulsemcp.com/',
   '4/5 · The largest hand-reviewed MCP server directory, updated daily.'),
  ('CLAUDE CODE & MCP', 'Superpowers', 'https://github.com/obra/superpowers',
   '4/5 · The biggest community skill framework for Claude Code: brainstorm → plan → TDD → review.'),
  ('CLAUDE CODE & MCP', 'DeepWiki', 'https://deepwiki.com/',
   '4/5 · AI-generated interactive wiki for any public GitHub repo — great before adopting a dependency.'),
  ('CLAUDE CODE & MCP', 'GitIngest', 'https://gitingest.com/',
   '4/5 · Any repo → one LLM-ready text digest; just swap "hub" for "ingest" in a GitHub URL.'),

  -- ---- SECURITY --------------------------------------------------------
  ('SECURITY', 'Security Headers', 'https://securityheaders.com/',
   '4/5 · One-click grade of your HTTP security headers with concrete fixes.'),
  ('SECURITY', 'MDN HTTP Observatory', 'https://developer.mozilla.org/en-US/observatory',
   '4/5 · MDN security scan for your deployed site with actionable guidance.'),

  -- ---- INSPIRATION -----------------------------------------------------
  ('INSPIRATION', 'Mobbin', 'https://mobbin.com/',
   '5/5 · Huge library of real app screens and UX flows — the fastest answer to "how do good apps do X?".'),
  ('INSPIRATION', 'Land-book', 'https://land-book.com/',
   '4/5 · Curated landing-page gallery to borrow layout and tone ideas from.'),
  ('INSPIRATION', 'Godly', 'https://godly.website/',
   '4/5 · Astronomically good web design inspiration, one standout site at a time.');

do $$
declare
  v_email text := 'kouril.lukas@gmail.com';  -- ← your login email; edit if needed
  v_user  uuid;
  v_cat   uuid;
  v_sort  integer;
  r_cat   record;
  n_ins   integer;
  n_tot   integer := 0;
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
    n_tot := n_tot + n_ins;
  end loop;

  raise notice 'Seed complete: % new link(s) inserted for %.', n_tot, v_email;
end $$;

drop table if exists _seed_ai_links;
