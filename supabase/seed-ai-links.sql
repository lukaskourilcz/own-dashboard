-- =============================================================
-- Seed: curated AI & dev-resource links for the "AI links" section
-- =============================================================
-- A researched catalogue (July 2026) of 56 sites that improve projects built
-- with Claude Code: AI design, AI image generation, components, free APIs,
-- hosting, performance, MCP/Claude Code ecosystem, security and inspiration.
-- Every entry was scored 1–5 during research; only sites scoring 3+ made the
-- cut. The score prefixes each description ("5/5 · …"); the cost lives in the
-- structured `pricing` column and renders as a colored badge in the app:
--
--     free      → green   (fully free / open source)
--     freemium  → yellow  (real free tier + paid plans)
--     paid      → red     (no meaningful free tier)
--
-- How to run
--   Supabase Dashboard → SQL Editor → paste this whole file → Run.
--   It migrates the `pricing` column itself, so it works even before the
--   latest schema.sql has been re-run.
--
-- Safe to re-run (idempotent, upgrade-aware)
--   • Categories are matched by name (case-insensitive) and created only
--     when missing — existing categories are reused, never duplicated.
--   • Links are matched by URL (ignoring http/https, "www." and trailing
--     slashes) and inserted only when missing.
--   • Links written by an earlier version of this seed (their description
--     starts with "<n>/5 ·") get their description + pricing refreshed —
--     e.g. v2 rows lose the in-text cost label and gain the badge. Links you
--     added or wrote yourself are never modified; nothing is ever deleted.
--
-- Display order
--   The panel shows links newest-first, so inserted rows get slightly
--   staggered timestamps: higher-ranked sites appear first per category.

-- Migration (same statement as in schema.sql; skipped if already applied).
alter table public.ai_links
  add column if not exists pricing text
    check (pricing in ('free', 'freemium', 'paid'));

drop table if exists _seed_ai_links;
create temp table _seed_ai_links (
  rn          serial primary key,
  category    text not null,
  title       text not null,
  url         text not null,
  pricing     text not null,
  description text not null
);

insert into _seed_ai_links (category, title, url, pricing, description) values
  -- ---- AI DESIGN ----------------------------------------------------
  ('AI DESIGN', 'v0 by Vercel', 'https://v0.app/', 'freemium',
   '5/5 · Agentic UI generation tuned for Next.js + shadcn/ui — riff on screens, then paste the code into your repo.'),
  ('AI DESIGN', 'tweakcn', 'https://tweakcn.com/', 'free',
   '5/5 · Visual + AI theme editor for shadcn/Tailwind: restyle a whole app, check contrast, export CSS variables. Open source.'),
  ('AI DESIGN', 'Onlook', 'https://onlook.com/', 'freemium',
   '4/5 · Open-source "Cursor for designers" — visually edit your running Next.js + Tailwind app and it writes the code back.'),
  ('AI DESIGN', 'Google Stitch', 'https://stitch.withgoogle.com/', 'free',
   '4/5 · AI design canvas from Google: prompt to hi-fi screens, export to code or Figma. Great for exploring layouts.'),
  ('AI DESIGN', 'Recraft', 'https://www.recraft.ai/', 'freemium',
   '4/5 · AI image generator that outputs real SVG vectors, icon sets and brand assets. Free daily credits.'),
  ('AI DESIGN', 'Ideogram', 'https://ideogram.ai/', 'freemium',
   '4/5 · Best-in-class text rendering in AI images (logos, banners, OG images). Free daily credits, commercial use OK.'),

  -- ---- AI IMAGES ------------------------------------------------------
  ('AI IMAGES', 'FLUX — Black Forest Labs', 'https://bfl.ai/', 'freemium',
   '5/5 · FLUX.2 model family: frontier quality, superb prompt adherence and text, reference-image editing. Open weights + playground + paid API.'),
  ('AI IMAGES', 'Midjourney', 'https://www.midjourney.com/', 'paid',
   '5/5 · Still the aesthetic benchmark for stylized art, moodboards and hero imagery. From $10/mo, no free tier.'),
  ('AI IMAGES', 'fal.ai', 'https://fal.ai/', 'paid',
   '5/5 · One fast API + playgrounds for nearly every frontier image/video model — easiest way to wire image gen into your apps. Pay-per-use with signup credits.'),
  ('AI IMAGES', 'Seedream (Dreamina)', 'https://dreamina.capcut.com/', 'freemium',
   '4/5 · ByteDance leaderboard-topping image models (Seedream 4.5 / 5.0): multi-image fusion and editing, 4K output, strong text. Free daily credits.'),
  ('AI IMAGES', 'Reve', 'https://reve.com/', 'freemium',
   '4/5 · Layout-first generation with standout prompt faithfulness and multi-image editing; chat-style "Flow" edits.'),
  ('AI IMAGES', 'Krea', 'https://www.krea.ai/', 'freemium',
   '4/5 · Realtime canvas — sketch and it renders instantly. Hosts FLUX, Seedream and more, plus video and upscaling.'),
  ('AI IMAGES', 'Leonardo AI', 'https://leonardo.ai/', 'freemium',
   '4/5 · Production-oriented suite: styles, canvas, model training. Roughly 150 free images/day.'),
  ('AI IMAGES', 'Replicate', 'https://replicate.com/', 'paid',
   '4/5 · Run thousands of open models (FLUX, Seedream, video, audio) through one API. Billed per use.'),

  -- ---- COMPONENTS & UI ----------------------------------------------
  ('COMPONENTS & UI', 'shadcn/ui', 'https://ui.shadcn.com/', 'free',
   '5/5 · The component-registry standard: copy-paste ownership, CLI installs, and the base that AI coding agents know best.'),
  ('COMPONENTS & UI', 'Kibo UI', 'https://www.kibo-ui.com/', 'free',
   '4/5 · Advanced shadcn registry: Gantt, Kanban, code editor, AI chat, dropzone. MIT-licensed.'),
  ('COMPONENTS & UI', 'Magic UI', 'https://magicui.design/', 'freemium',
   '4/5 · 150+ open-source animated components (marquees, beams, bento grids) for landing-page polish. Paid template packs exist.'),
  ('COMPONENTS & UI', 'Origin UI', 'https://originui.com/', 'free',
   '4/5 · Hundreds of copy-paste shadcn/Tailwind variants — huge breadth for forms, inputs and dialogs.'),
  ('COMPONENTS & UI', 'Aceternity UI', 'https://ui.aceternity.com/', 'freemium',
   '4/5 · Wow-factor sections: 3D cards, spotlights and animated backgrounds for hero moments. Free components + paid Pro.'),
  ('COMPONENTS & UI', 'ReactBits', 'https://reactbits.dev/', 'free',
   '4/5 · Playful animated React components and text effects. Free and open source.'),
  ('COMPONENTS & UI', 'Tremor', 'https://tremor.so/', 'free',
   '4/5 · Dashboard and chart components (now by Vercel) — a natural fit for dashboard projects like this one.'),
  ('COMPONENTS & UI', '21st.dev', 'https://21st.dev/', 'freemium',
   '4/5 · Community component marketplace plus the Magic MCP that generates UI right inside Claude Code.'),
  ('COMPONENTS & UI', 'awesome-shadcn-ui', 'https://github.com/birobirobiro/awesome-shadcn-ui', 'free',
   '4/5 · Curated index of the whole shadcn ecosystem — registries, tools, templates and themes.'),

  -- ---- FREE APIS & DATA ----------------------------------------------
  ('FREE APIS & DATA', 'free-for.dev', 'https://free-for.dev/', 'free',
   '5/5 · The canonical list of developer free tiers — SaaS, PaaS, databases, monitoring, email, everything.'),
  ('FREE APIS & DATA', 'public-apis', 'https://github.com/public-apis/public-apis', 'free',
   '5/5 · Massive collective list of free public APIs for any kind of data your next feature needs.'),
  ('FREE APIS & DATA', 'OpenRouter', 'https://openrouter.ai/', 'freemium',
   '5/5 · One API for every LLM, including genuinely free models. A one-time $10 raises the free daily cap.'),
  ('FREE APIS & DATA', 'Hugging Face', 'https://huggingface.co/', 'free',
   '5/5 · Open models, datasets and Spaces demos — the GitHub of AI. Paid compute extras.'),
  ('FREE APIS & DATA', 'Google AI Studio', 'https://aistudio.google.com/', 'freemium',
   '4/5 · The most generous permanent free LLM API tier (Gemini), no credit card needed.'),
  ('FREE APIS & DATA', 'Groq', 'https://groq.com/', 'freemium',
   '4/5 · Ridiculously fast free inference for open models (Llama, Qwen, DeepSeek) — great for prototyping AI features.'),
  ('FREE APIS & DATA', 'Firecrawl', 'https://www.firecrawl.dev/', 'freemium',
   '4/5 · Turns any website into clean LLM-ready markdown; scrape/crawl/search API with free credits.'),
  ('FREE APIS & DATA', 'Jina Reader', 'https://jina.ai/reader/', 'freemium',
   '4/5 · Prefix any URL with r.jina.ai and get clean markdown back — keyless at low rates.'),
  ('FREE APIS & DATA', 'DummyJSON', 'https://dummyjson.com/', 'free',
   '4/5 · Fake REST API with products, users, carts and auth — perfect for prototyping UIs before the backend exists.'),
  ('FREE APIS & DATA', 'Mockaroo', 'https://www.mockaroo.com/', 'freemium',
   '4/5 · Generate realistic test data from a custom schema — CSV, JSON or straight SQL inserts.'),

  -- ---- HOSTING & BACKEND ----------------------------------------------
  ('HOSTING & BACKEND', 'Cloudflare Workers & Pages', 'https://workers.cloudflare.com/', 'freemium',
   '5/5 · Unlimited-bandwidth static hosting plus a generous edge-compute free tier; commercial use allowed.'),
  ('HOSTING & BACKEND', 'Neon', 'https://neon.com/', 'freemium',
   '5/5 · Serverless Postgres with git-like branching and scale-to-zero — the friendliest DB free tier for side projects.'),
  ('HOSTING & BACKEND', 'Turso', 'https://turso.tech/', 'freemium',
   '4/5 · SQLite at the edge with a huge free tier (5 GB) — great for per-user or low-latency data.'),
  ('HOSTING & BACKEND', 'Upstash', 'https://upstash.com/', 'freemium',
   '4/5 · Serverless Redis plus QStash cron/queues, pay-per-request beyond the free tier.'),
  ('HOSTING & BACKEND', 'Convex', 'https://convex.dev/', 'freemium',
   '4/5 · Reactive TypeScript backend — realtime by default, no SQL.'),
  ('HOSTING & BACKEND', 'Render', 'https://render.com/', 'freemium',
   '4/5 · Web services and Postgres without a credit card; free instances spin down when idle.'),

  -- ---- PERFORMANCE & MONITORING ---------------------------------------
  ('PERFORMANCE & MONITORING', 'PageSpeed Insights', 'https://pagespeed.web.dev/', 'free',
   '5/5 · The canonical Core Web Vitals check, including real-user field data when available.'),
  ('PERFORMANCE & MONITORING', 'WebPageTest', 'https://www.webpagetest.org/', 'freemium',
   '4/5 · Deep waterfalls, filmstrips and real devices/locations — shows WHY a page is slow.'),
  ('PERFORMANCE & MONITORING', 'DebugBear Free Tools', 'https://www.debugbear.com/tools', 'freemium',
   '4/5 · Free speed tests with the most detailed LCP breakdown you can get at no cost; monitoring is the paid product.'),
  ('PERFORMANCE & MONITORING', 'UptimeRobot', 'https://uptimerobot.com/', 'freemium',
   '4/5 · 50 free uptime monitors at 5-minute intervals — set and forget.'),
  ('PERFORMANCE & MONITORING', 'Better Stack', 'https://betterstack.com/', 'freemium',
   '4/5 · Uptime checks, incident timelines, status pages and logs with a polished free tier.'),

  -- ---- CLAUDE CODE & MCP ----------------------------------------------
  ('CLAUDE CODE & MCP', 'Context7', 'https://context7.com/', 'freemium',
   '5/5 · Up-to-date, version-specific library docs served to Claude Code via MCP — kills stale-training-data bugs.'),
  ('CLAUDE CODE & MCP', 'Smithery', 'https://smithery.ai/', 'free',
   '5/5 · The package manager for MCP servers — search thousands and install with one line.'),
  ('CLAUDE CODE & MCP', 'awesome-claude-code', 'https://github.com/hesreallyhim/awesome-claude-code', 'free',
   '5/5 · The canonical curated list of Claude Code skills, hooks, agents, statuslines and tooling.'),
  ('CLAUDE CODE & MCP', 'PulseMCP', 'https://www.pulsemcp.com/', 'free',
   '4/5 · The largest hand-reviewed MCP server directory, updated daily.'),
  ('CLAUDE CODE & MCP', 'Superpowers', 'https://github.com/obra/superpowers', 'free',
   '4/5 · The biggest community skill framework for Claude Code: brainstorm → plan → TDD → review. Open source.'),
  ('CLAUDE CODE & MCP', 'DeepWiki', 'https://deepwiki.com/', 'free',
   '4/5 · AI-generated interactive wiki for any public GitHub repo — great before adopting a dependency.'),
  ('CLAUDE CODE & MCP', 'GitIngest', 'https://gitingest.com/', 'free',
   '4/5 · Any repo → one LLM-ready text digest; just swap "hub" for "ingest" in a GitHub URL.'),

  -- ---- SECURITY --------------------------------------------------------
  ('SECURITY', 'Security Headers', 'https://securityheaders.com/', 'free',
   '4/5 · One-click grade of your HTTP security headers with concrete fixes.'),
  ('SECURITY', 'MDN HTTP Observatory', 'https://developer.mozilla.org/en-US/observatory', 'free',
   '4/5 · MDN security scan for your deployed site with actionable guidance.'),

  -- ---- INSPIRATION -----------------------------------------------------
  ('INSPIRATION', 'Mobbin', 'https://mobbin.com/', 'freemium',
   '5/5 · Huge library of real app screens and UX flows — the fastest answer to "how do good apps do X?".'),
  ('INSPIRATION', 'Land-book', 'https://land-book.com/', 'free',
   '4/5 · Curated landing-page gallery to borrow layout and tone ideas from.'),
  ('INSPIRATION', 'Godly', 'https://godly.website/', 'free',
   '4/5 · Astronomically good web design inspiration, one standout site at a time.');

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
      (user_id, category_id, title, url, description, pricing, created_at, updated_at)
    select
      v_user, v_cat, s.title, s.url, s.description, s.pricing,
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

    -- Refresh links written by an earlier run of this seed (recognizable by
    -- the "<n>/5 ·" description prefix): move the cost out of the text and
    -- into the pricing badge column. Links the user created or edited
    -- themselves never match and are left alone; title, URL and category are
    -- never changed either.
    update public.ai_links l
    set description = s.description,
        pricing     = s.pricing,
        updated_at  = now()
    from _seed_ai_links s
    where s.category = r_cat.category
      and l.user_id = v_user
      and l.description ~ '^[1-5]/5 ·'
      and (l.description is distinct from s.description
           or l.pricing is distinct from s.pricing)
      and regexp_replace(regexp_replace(lower(l.url), '^https?://(www\.)?', ''), '/+$', '')
        = regexp_replace(regexp_replace(lower(s.url), '^https?://(www\.)?', ''), '/+$', '');

    get diagnostics n_upd = row_count;
    n_tot_upd := n_tot_upd + n_upd;
  end loop;

  raise notice 'Seed complete: % new link(s) inserted, % link(s) refreshed for %.',
    n_tot_ins, n_tot_upd, v_email;
end $$;

drop table if exists _seed_ai_links;
