# DNESKAi production evidence (read-only SELECT, 2026-10-21/22)

Project `gcctapykhrdyxikieemn`, queried through the Supabase MCP `execute_sql` and `list_migrations`, SELECT only. No writes, no Vault, no token columns. Database clock at the time of querying: `2026-10-21 23:57 UTC` (Q3) to `2026-10-22 00:00 UTC` (Q30), so the first daily tick (02:18 UTC) and the second native night (22 Oct 20:00 UTC) had not run yet. Results are trimmed; source URLs are reduced to hostnames.

## Q1 Columns of every marketing table

```sql
select table_schema, table_name, string_agg(column_name||':'||data_type, ', ' order by ordinal_position)
from information_schema.columns where (table_schema='public' and table_name like 'marketing%') or table_schema='marketing_private' group by 1,2;
```
28 tables. Relevant: `marketing_ticks(id, user_id, kind, started_at, finished_at, did jsonb, errors jsonb)`; `marketing_dneskai_runs(..., status, tick_count, selected_count, cost_usd, error_code, jev_stage_count)`; `marketing_dneskai_stages(run_id, source_id, kind, status, max_items, reserved_usd, reserved_items, cost_usd, error_code)`; `marketing_dneskai_candidates(id, run_id, candidate jsonb, status, target_date)`; `marketing_dneskai_briefs(..., rank, category, member_ids, status, code, brief jsonb, scheduled_at, job_id)`; `marketing_media_assets(sha256, source_id, origin_url, origin_kind, width, height, mime, bytes, credit, purged_at, duplicate_of_asset_id)`; `marketing_private.dneskai_generation_spend(job_id, reserved_usd, calls)`, `generation_pilot_reservations`, `generation_pilots`, `dneskai_collection_pilots`.

## Q2 Ticks by kind: count, window, errors, duration

```sql
select kind, count(*), min(started_at), max(started_at), count(*) filter (where errors::text not in ('[]','{}','null')) with_errors,
 percentile_cont(0.5|0.95) of extract(epoch from finished_at-started_at), max(...), avg(...) from marketing_ticks group by kind;
```
| kind | n | first | last | with_errors | unfinished | p50 s | p95 s | max s | avg s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| minute | 124 | 2026-10-21 13:40:04 | 2026-10-21 23:55:01 | 0 | 0 | 3.78 | 15.84 | 29.40 | 5.23 |

No `daily` row exists.

## Q3 Clock and the latest ticks

```sql
select now(), (last 2 minute ticks: did, errors), (all daily ticks);
```
`now() = 2026-10-21 23:57:00 UTC`. Latest minute tick: collection noop `collection-not-due` 1180 ms, media noop 364 ms, briefs noop `pending:true` 2889 ms `{jobs:0, created:0, skipped:0, runId:6305e565…}`, generation 317, publishing 319, reconciliation 644, token 132; `errors: []`. The one before: briefs 5024 ms, same detail. Daily ticks: `null` (none).

## Q4 Per-category outcomes over the whole history

```sql
select d->>'category', d->>'status', d->>'code', count(*), avg(ms), max(ms), count(*) filter (where pending)
from marketing_ticks, jsonb_array_elements(did) d group by 1,2,3;
```
| category | status | code | n | avg ms | max ms | pending |
| --- | --- | --- | --- | --- | --- | --- |
| briefs | done | | 1 | 7132 | 7132 | 1 |
| briefs | noop | | 44 | 2681 | 6568 | 44 |
| briefs | noop | briefs-no-finished-run | 79 | 7 | 327 | 0 |
| collection | done | | 4 | 15522 | 26945 | 3 |
| collection | noop | collection-finished | 20 | 1111 | 2249 | 0 |
| collection | noop | collection-not-due | 100 | 1445 | 19379 | 0 |
| generation | noop | | 124 | 305 | 836 | 0 |
| media | done | | 1 | 7360 | 7360 | 0 |
| media | noop | | 123 | 320 | 743 | 0 |
| publishing | noop | | 124 | 429 | 2332 | 0 |
| reconciliation | noop | | 124 | 629 | 5833 | 0 |
| token | noop | | 124 | 292 | 1918 | 0 |

No `error`, `deferred` (`tick-budget-exhausted`) or `skipped` step in 124 ticks.

## Q5 Ticks 2026-10-21 19:55-20:35 UTC (the first native night)

```sql
select started, duration, string_agg(category=status/code@ms) from marketing_ticks where started_at between '2026-10-21 19:55' and '2026-10-21 20:35';
```
| start | s | steps |
| --- | --- | --- |
| 19:55:01 | 3.0 | collection not-due@1062, briefs no-finished-run@0, rest noop |
| 20:00:01 | 29.4 | collection done@26945 (run created, admitted), briefs no-finished-run |
| 20:05:02 | 16.4 | collection done@14288 |
| 20:10:02 | 12.9 | collection done@11118 |
| 20:15:01 | 27.4 | collection done@9736 (run partial), media done@7360, briefs done@7132, publishing noop@2332 |
| 20:20:01 | 6.2 | collection finished@1424, briefs noop@2553 |
| 20:25:01 | 5.5 | collection finished@757, briefs noop@2881 |
| 20:30:01 | 17.1 | collection finished@2249, briefs noop@6568, publishing noop@2038 |

## Q6 Ticks longer than 10 s

```sql
select started, duration, steps over 2 s from marketing_ticks where duration > 10 s;
```
8 ticks: 17:00 21.9 s (collection@19379), 18:55 20.0 s (collection@16080), 20:00 29.4 s, 20:05 16.4 s, 20:10 12.9 s, 20:15 27.4 s, 20:30 17.1 s (briefs@6568), 23:35 18.9 s (collection@3303, briefs@6285, publishing@2191, reconciliation@5833).

## Q7 Collection steps over 9 s

```sql
select started, step from marketing_ticks, jsonb_array_elements(did) d where category='collection' and ms > 9000;
```
17:00 `collection-not-due` 19379 ms; 18:55 `collection-not-due` 16080 ms; 20:00 done 26945 ms `{admitted:true, continue:true, runStatus:running}`; 20:05 done 14288; 20:10 done 11118; 20:15 done 9736 `{continue:false, runStatus:partial}`.

## Q8 Collection runs

```sql
select id, date, target_date, status, tick_count, selected_count, cost_usd, error_code, jev_stage_count, created_at, (stage count) from marketing_dneskai_runs;
```
| run | date → target | status | ticks | selected | cost $ | error | jev stages | stages |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| edc97cf7 | 10-13 → 10-14 | partial | 16 | 0 | 0.017213 | collection-review-incomplete | null | 29 |
| 6305e565 | 10-21 → 10-22 | partial | 4 | 4 | 0.002243 | collection-review-incomplete | 8 | 21 |

## Q9 Stages of run 6305e565

```sql
select source_id, kind, status, max_items, reserved_usd, reserved_items, cost_usd, error_code from marketing_dneskai_stages where run_id='6305e565-…';
```
- 9 feed stages: ok anthropic-news, deepmind-blog, google-research, meta-ai, openai-blog; partial `collection-source-error` arxiv-cs-ai, arxiv-cs-lg; partial `collection-source-item-cap` hn-frontpage, techcrunch-ai. All $0.
- 4 Instagram stages (evolving.ai, meta.ai, mosseri, robotic): `held` `collection-apify-disabled`, reserved $0.
- 8 Jev stages `__jev:00`-`__jev:07`: ok, max_items 8, reserved $0.003 each ($0.024), cost $0.000193-0.000366 (sum $0.002243).

## Q10 Candidates by run, status and category

```sql
select run_id like '6305%', status, candidate->>'category', count(*) from marketing_dneskai_candidates group by 1,2,3;
```
Run 6305e565 (64): held 45 (ai-news 13, tech-news 16, other 6, ai-project 5, marketing 3, tool 2), new 12 (ai-news 4, tech-news 8), rejected 3 (other), selected 4 (one each ai-news, ai-project, marketing, tech-news). Run edc97cf7 (13 Oct, 70): all 70 `held` (10 without category).

## Q11 Candidate JSON keys (run 6305e565)

```sql
select jsonb_object_keys(candidate), count(*) from marketing_dneskai_candidates where run_id='6305e565-…' group by 1;
```
All 64: category, contentHash, duplicateOf, externalId, fetchedAt, id, mediaUrls, publishedAt, reason, relevance, sourceId, status, targetDate, text, title, url. `dateEstimated` on 11.

## Q12 Text lengths and media per candidate

```sql
select run, count(*), min/median/max(length(text)), count(*) filter (where length(text)<400), min/median/max(length(title)), avg/≥1/≥3/sum(jsonb_array_length(mediaUrls)) from marketing_dneskai_candidates group by run;
```
| run | n | text min/med/max | text < 400 | title min/med/max | avg media | ≥ 1 media | ≥ 3 media | media URLs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6305e565 | 64 | 0 / 136 / 261 | 64 | 10 / 64 / 100 | 0.14 | 9 | 0 | 9 |
| edc97cf7 | 70 | 0 / 146 / 2000 | 52 | 14 / 51 / 500 | 0.14 | 4 | 2 | 10 |

## Q13 Run 6305e565 per source

```sql
select sourceId, count(*), by status, median(length(text)), sum(media), avg(relevance) from marketing_dneskai_candidates where run_id='6305e565-…' group by 1;
```
| source | n | selected | held | new | rejected | median text | media | avg relevance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hn-frontpage | 20 | 0 | 15 | 2 | 3 | 0 | 0 | 0.45 |
| techcrunch-ai | 20 | 1 | 12 | 7 | 0 | 158.5 | 0 | 0.83 |
| openai-blog | 15 | 2 | 11 | 2 | 0 | 147 | 0 | 0.82 |
| anthropic-news | 5 | 1 | 3 | 1 | 0 | 168 | 5 | 0.72 |
| deepmind-blog | 2 | 0 | 2 | 0 | 0 | 130.5 | 2 | 0.87 |
| google-research | 2 | 0 | 2 | 0 | 0 | 17 | 2 | 0.39 |

## Q14 Reasons by status (run 6305e565)

```sql
select status, left(reason,60), count(*), min/max(relevance), count(duplicateOf) from marketing_dneskai_candidates where run_id='6305e565-…' group by 1,2;
```
held: `collection-review-relevance` 15 (0.46-0.84); `collection-review-category-duplicate-relevance` 11 (0.14-0.80); `collection-review-category-relevance` 7 (0.19-0.60); `collection-source-date-unavailable-or-stale` 5 (0.88-0.96); `collection-review-duplicate` 5 (0.86-0.93); `collection-review-category` 1 (0.95); `collection-review-duplicate-relevance` 1 (0.60). new: 12 (0.87-0.97). rejected `collection-editorial-out-of-scope` 3 (0.04-0.07). selected `research-selection-not-fact-checked` 4 (0.96-0.97).

## Q15 Source states

```sql
select source_id, status, error_code, item_count, cost_usd, last_success_at, last_attempt_at from marketing_dneskai_source_states;
```
19 rows. ok: anthropic-news 5, deepmind-blog 2, google-research 2, meta-ai 0, openai-blog 18 (last attempt 21 Oct); hf-blog 5 and instagram:tiffintech 0 ($0.0046) last attempted 13 Oct. partial: arxiv-cs-ai, arxiv-cs-lg `collection-source-error` (21 Oct, never succeeded); hn-frontpage 20, techcrunch-ai 20 `collection-source-item-cap`; github-ai-releases 10, simonw 10, rest-of-world 0 `collection-source-error` (last attempt 13 Oct, never succeeded). held: instagram evolving.ai, meta.ai, mosseri, robotic `collection-apify-disabled` (21 Oct); instagram:activeprogrammer `provider-http-400-invalid-input` (13 Oct).

## Q16 Briefs

```sql
select id, rank, category, status, code, scheduled_at, suggestedFormat, #media, #evidence, length(title), expiresAt, job_id, #members from marketing_dneskai_briefs;
```
| brief | rank | category | status / code | slot (UTC) | format | media | evidence | members | expires (UTC) | job |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4e291572 | 1 | ai-news | pending / account-unavailable | 10-22 06:00 | single-image | 0 | 1 | 1 | 10-23 20:15 | null |
| acae807e | 2 | tech-news | pending / account-unavailable | 10-22 10:30 | single-image | 1 | 1 | 1 | 10-23 20:15 | null |
| 6d1902a2 | 3 | marketing | pending / account-unavailable | 10-22 15:00 | single-image | 0 | 1 | 1 | 11-04 20:15 | null |
| 3a7ca8dc | 4 | ai-project | pending / account-unavailable | 10-22 18:00 | carousel | 2 | 1 | 1 | 11-04 20:15 | null |

## Q17 Brief evidence and media dimensions

```sql
select rank, keys(evidence[0]), max(length(excerpt)), evidence[0].sourceId, media width×height from marketing_dneskai_briefs;
```
| rank | excerpt chars | source | media |
| --- | --- | --- | --- |
| 1 | 166 | openai-blog | none |
| 2 | 162 | techcrunch-ai | 1024×683 |
| 3 | 137 | openai-blog | none |
| 4 | 236 | anthropic-news | 1200×630, 1920×1080 |

## Q18 Media assets

```sql
select id, source_id, origin_kind, host, width, height, min(w,h)>=900, width>=600, mime, bytes, credit, purged, dup from marketing_media_assets;
```
| asset | source | kind | host | w×h | full-bleed | inset | mime | bytes | credit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 86e39efd | techcrunch-ai | og-image | techcrunch.com | 1024×683 | no | yes | webp | 66618 | Obrázek: TechCrunch |
| ea10e9d3 | anthropic-news | og-image | www-cdn.anthropic.com | 1200×630 | no | yes | jpeg | 173456 | Obrázek: Anthropic |
| 57045225 | anthropic-news | article-figure | www.anthropic.com | 1920×1080 | yes | yes | webp | 221676 | Obrázek: Anthropic |

None purged, none duplicate.

## Q19 Media collections

```sql
select candidate_id, status, page_status, page_attempts, page_error, asset_count, skipped, links from marketing_media_collections;
```
4 rows: 2 `empty` with `media-page-http-403` (0 assets), 2 `complete` (1 and 2 assets). 3 asset links in total.

## Q20 Row counts

```sql
select count(*) from marketing_accounts, marketing_account_tokens, marketing_jobs, marketing_revisions, marketing_publications, marketing_campaigns, marketing_calendar_entries, marketing_events, marketing_knowledge_items, marketing_knowledge_sources, marketing_knowledge_events, marketing_offline_imports, marketing_sources, marketing_source_history, marketing_media_asset_links, marketing_media_collections;
```
accounts 0, tokens 0, jobs 0, revisions 0, publications 0, campaigns 0, calendar entries 0, events 0, knowledge items 0, knowledge sources 0, knowledge events 0, offline imports 0, sources 0, source history 0, media links 3, media collections 4.

## Q21 Spend ledgers (counts and sums)

```sql
select count(*), sum(reserved_usd), sum(calls) from marketing_private.dneskai_generation_spend; … generation_pilot_reservations; generation_pilots; dneskai_collection_pilots; sum(reserved_usd), sum(cost_usd) from marketing_dneskai_stages;
```
dneskai_generation_spend 0 rows; generation_pilot_reservations 0; generation_pilots 0; dneskai_collection_pilots 0. All 50 stages (both runs): reserved $0.208, cost $0.019456.

## Q22 Storage per marketing bucket

```sql
select b.id, b.public, b.file_size_limit, count(o.id), sum((o.metadata->>'size')::bigint) from storage.buckets b left join storage.objects o on o.bucket_id=b.id where b.id like 'marketing%' group by 1,2,3;
```
marketing-assets: private, limit 8388608, 0 objects, 0 bytes. marketing-media: private, limit 33554432, 3 objects, 461750 bytes.

## Q23 Cron jobs

```sql
select jobid, jobname, schedule, active, left(command,120) from cron.job;
```
1 `marketing-tick-minute` `*/5 * * * *` active `select marketing_private.scheduler_post('minute')`; 2 `marketing-tick-daily` `18 2 * * *` active `select marketing_private.scheduler_post('daily')`. No `marketing-cron-history-prune`.

## Q24 Cron run history

```sql
select jobid, status, count(*), min/max(start_time), avg(end-start), max(left(return_message,80)) from cron.job_run_details where jobid in (1,2) group by 1,2;
```
job 1 succeeded 134, 2026-10-21 12:50:00 → 23:55:00, avg 35.6 ms, message `1 row`. Job 2: no runs yet. 134 cron runs against 124 tick rows: the 10 runs 12:50-13:35 left no `marketing_ticks` row.

## Q25 pg_net responses by status

```sql
select count(*), status_code, count(*), max(created), count(*) filter (where timed_out), max(error_msg) from net._http_response group by status_code;
```
72 responses, all `200`, 0 timeouts, no error message.

## Q26 Scheduler state

```sql
select category, holder is not null, lease_until, next_allowed_at, left(state::text,160), updated_at from marketing_scheduler_state;
```
briefs `{"runId":"6305e565…","pending":true}` updated 23:55:05; collection `{}` 20:15:11; media `{}` 20:15:18. No lease held. No rows for generation, publishing, reconciliation, token.

## Q27 Production migration history (list_migrations), entries from 13 October

20261013193104 marketing_control_surface; 20261013193105 marketing_durable_jobs; 20261013193106 marketing_knowledge_import; 20261013193107 marketing_private_assets; 20261013193108 marketing_staging_pilot_guard; 20261013193131 marketing_offline_import; 20261013193132 marketing_story_receipts; 20261013193134 marketing_dneskai_collection; 20261013193136 dneskai_collection_pilot; 20261015234547 oslo_career_preferences; 20261021122104 dneskai_collection_cursor_limits; 20261021122220 marketing_account_tokens; 20261021122330 scope_retired_pilot_ledgers; 20261021122453 dneskai_source_media; 20261021122551 marketing_revision_media_identity; 20261021123547 dneskai_events_briefs; 20261021124058 dneskai_events_briefs_finish; 20261021124144 dneskai_events_briefs_functions; 20261021124400 marketing_scheduler; 20261021124438 marketing_scheduler_functions; 20261021124628 marketing_scheduler_cron; 20261021124651 dneskai_daily_generation_budget; 20261021124706 marketing_job_render_report; 20261021124712 dneskai_hideable_project_tabs; 20261021125123 restrict_pg_net_browser_roles. (Identical to the list in audit-map-workflow.js.)

Repository (`ls supabase/migrations`, from 20261012): 20261012225640 marketing_control_surface, 20261012232949 marketing_durable_jobs, 20261012233059 marketing_knowledge_import, 20261013001528 marketing_private_assets, 20261013092409 marketing_staging_pilot_guard, 20261013150816 marketing_offline_import, 20261013150933 marketing_story_receipts, 20261013165236 marketing_dneskai_collection, 20261013181506 dneskai_collection_pilot, 20261015234547 oslo_career_preferences, 20261020100000 dneskai_collection_cursor_limits, 20261020110000 marketing_account_tokens, 20261020120000 scope_retired_pilot_ledgers, 20261020130000 dneskai_source_media, 20261020140000 marketing_revision_media_identity, 20261020150000 dneskai_events_briefs, 20261020160000 marketing_scheduler, 20261020160100 marketing_scheduler_cron, 20261020170000 dneskai_daily_generation_budget, 20261021090000 marketing_job_render_report, 20261021100000 dneskai_hideable_project_tabs. 21 repo files against 25 production entries; only 20261015234547 shares a version. `restrict_pg_net_browser_roles` has no repo file (grep finds it only in docs/migration-guide.md).

## Q28 Elapsed before generation's minimum-start check

```sql
with t as (select sum(ms) over collection, media, briefs, generation steps as pre_gen_ms, briefs.pending from marketing_ticks)
select briefs_pending, count(*), count(*) filter (where pre_gen_ms > 5000), median(pre_gen_ms), max(pre_gen_ms) from t group by 1;
```
| briefs pending | ticks | > 5000 ms | median ms | max ms |
| --- | --- | --- | --- | --- |
| false | 79 | 5 | 1774 | 28013 |
| true | 45 | 5 | 4109 | 24552 |

## Q29 Tick overhead outside the steps

```sql
select avg/max/min(duration_ms - sum(step ms)) from marketing_ticks;
```
avg 338 ms, max 4751 ms, min 131 ms.

## Q30 pg_net response retention window

```sql
select min(created), max(created), count(*) from net._http_response;
```
2026-10-21 18:05:00 → 2026-10-22 00:00:00, 72 rows (about 6 h kept).

## Q31 Unselected vs selected relevance

```sql
select count(new), max(relevance) of new, min(relevance) of selected, selected list, held from 13 Oct, dateEstimated count from marketing_dneskai_candidates;
```
12 `new` (all run 6305e565), best new 0.97; lowest selected 0.96. Selected: ai-project 0.96 anthropic-news, ai-news 0.97 openai-blog, tech-news 0.97 techcrunch-ai, marketing 0.96 openai-blog. 70 candidates from 13 Oct still `held`. 11 with `dateEstimated`.

## Q32 Media collection by host

```sql
select candidate.sourceId, host(candidate.url), status, page_error, asset_count, #mediaUrls from marketing_media_collections join marketing_dneskai_candidates;
```
openai.com ×2: empty, `media-page-http-403`, 0 assets, 0 feed media. techcrunch.com: complete, 1 asset, 0 feed media. www.anthropic.com: complete, 2 assets, 1 feed media.

## Q33 Scheduler and finish functions in production

```sql
select proname, identity args from pg_proc join pg_namespace where nspname in ('public','marketing_private') and (proname like 'marketing_scheduler%' or like 'marketing_dneskai_finish%' or like '%purge%');
```
marketing_dneskai_finish (6 args), marketing_dneskai_finish_retired_20261021 (5 args), marketing_media_claim_purge, marketing_media_unmark_purge, marketing_scheduler_acquire, _begin_tick, _finish_tick, _release, _save_state, purge_old_cron_runs. `marketing_scheduler_prune_ticks` is absent.

## Verification queries (separate verifier pass, 2026-10-22 00:07 UTC database clock)

Read-only SELECTs re-run by the verifier. No daily tick had run yet.

- **V1 clock, ticks, briefs, cron:** `now() = 2026-10-22 00:07:39 UTC`; marketing_ticks 126 (daily 0, with errors 0, last 00:05:01); the 4 briefs are unchanged (pending / account-unavailable, job null, slots 06:00, 10:30, 15:00, 18:00 UTC; expiry 23 Oct for news, 4 Nov for marketing and ai-project); marketing_accounts 0; cron job 1 has 136 runs from 12:50:00, job 2 has no runs.
- **V2 time spent before generation's check:** pending ticks 47, 5 over 5000 ms, median 4109 ms, max 24552; other ticks 79, 5 over, median 1774 ms, max 28013. Pending briefs noop steps: 46, avg 2663 ms, max 6568. No deferred, error or skipped step in 882 steps.
- **V3 candidates:** run 6305e565 n 64, text 0/136/261, 64 under 400 chars, ≥1 media 9, ≥3 media 0; held 45 (0.14-0.96), new 12 (ai-news 4 at 0.87-0.97, tech-news 8 at 0.89-0.97), rejected 3, selected 4 (0.96-0.97). hn-frontpage 20, median text 0, avg relevance 0.45, 0 selected. 5 held for `collection-source-date-unavailable-or-stale` (0.88-0.96). Run edc97cf7: 70 held.
- **V4 media, storage, stages, sources, cron, functions:** assets 1024×683 (not full-bleed), 1200×630 (not), 1920×1080 (full-bleed); collections: 2 empty `media-page-http-403`, 2 complete; marketing-media 3 objects, 461750 bytes (marketing-assets has no objects); Jev batches reserved $0.003 each against costs of $0.000193-0.000366; all stages together reserved $0.208 and cost $0.019456; runs edc97cf7 and 6305e565 are both partial with `collection-review-incomplete`; sources never succeeded: arxiv-cs-ai, arxiv-cs-lg, github-ai-releases, simonw, rest-of-world, plus Instagram profiles held; cron.job holds only marketing-tick-minute and marketing-tick-daily; of the two functions checked, `purge_old_cron_runs` exists and `marketing_scheduler_prune_ticks` is absent.
- **V5 migrations ≥ 20261012:** 25 production entries, identical to Q27.
