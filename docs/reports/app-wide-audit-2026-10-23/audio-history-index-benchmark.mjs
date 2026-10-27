/** Deferred index evaluation. Runs only an isolated synthetic database; never connects to Production.
 * Reproduce from the repository root with Node 22 and --experimental-strip-types. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createMigratedDatabase} from '../../../tests/helpers/supabase-pglite.ts';
const owner='11111111-1111-4111-8111-111111111111',revision='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const candidateSql='create index marketing_events_owner_kind_recent on public.marketing_events(user_id,kind,created_at desc,id desc)';
    const database = await createMigratedDatabase({ owner, instant: '2026-10-27T12:00:00Z' });
    try {
        for (const id of [revision, other])
            await database.query("insert into public.marketing_revisions(id,user_id,brand,revision,content_hash) values($1,$2,'dneskai','{}',$3)", [id, owner, 'a'.repeat(64)]);
        await database.query("insert into public.marketing_events(user_id,revision_id,kind,payload,created_at,delivered_at) select $1,case when n%2=0 then $3::uuid else $2::uuid end,case when n=1 then 'dneskai-reel-rendered' else 'TEST_ONLY_OTHER_EVENT' end,'{}'::jsonb,'2026-10-27T08:00:00Z'::timestamptz+n*interval '1 second','2026-10-27T12:00:00Z'::timestamptz from generate_series(1,10001) n", [owner, other, revision]);
        await database.exec('analyze public.marketing_events');
        const query = "select id,user_id,revision_id,kind,created_at,payload->'reelKey' as reel_key,payload->'revisionHash' as revision_hash,payload->'audioId' as audio_id,payload->'sha256' as sha256,payload->'bytes' as bytes from public.marketing_events where user_id=$1 and kind='dneskai-reel-rendered' and revision_id<>$2 order by created_at desc,id desc limit 1";
        const explain = async () => await database.query('explain (format json) ' + query, [owner, revision]);
        const beforePlan = await explain(), before = await database.query('select md5(string_agg(to_jsonb(t)::text,chr(10) order by id)) as fingerprint,count(*)::int as count from public.marketing_events t');
        await database.exec('begin');
        await database.exec(candidateSql);
        await database.exec('analyze public.marketing_events');
        const afterPlan = await explain();
        assert(JSON.stringify(beforePlan).includes('Seq Scan'));
        assert(JSON.stringify(afterPlan).includes('marketing_events_owner_kind_recent'));
        assert.deepEqual(await database.query('select md5(string_agg(to_jsonb(t)::text,chr(10) order by id)) as fingerprint,count(*)::int as count from public.marketing_events t'), before);
        await database.exec("set local plan_cache_mode='force_generic_plan';prepare audit_audio_history(uuid,text,uuid) as select id from public.marketing_events where user_id=$1 and kind=$2 and revision_id<>$3 order by created_at desc,id desc limit 1");
        const genericPlan = await database.query("explain (format json) execute audit_audio_history('11111111-1111-4111-8111-111111111111','dneskai-reel-rendered','22222222-2222-4222-8222-222222222222')");
        assert(JSON.stringify(genericPlan).includes('marketing_events_owner_kind_recent'));
        const indexBytes = (await database.query("select pg_relation_size('public.marketing_events_owner_kind_recent')::int as bytes")).rows[0].bytes;
        await database.exec('rollback');
        assert.equal((await database.query("select to_regclass('public.marketing_events_owner_kind_recent') as value")).rows[0]?.value, null);
        writeFileSync(fileURLToPath(new URL('./audio-history-index-candidate.json',import.meta.url)), JSON.stringify({
            decision:'deferred; the managed table has eight events and no recorded app Reels on 27 October 2026',
            managedObservation:{date:'2026-10-27',eventRows:8,recordedReelRows:0,readOnly:true},
            candidateSql,candidateSha256:createHash('sha256').update(candidateSql).digest('hex'),
            fixtureRows:10001,fixtureRevisions:2,query,beforePlan,afterPlan,genericPlan,indexBytes,history:before,
        },null,2)+'\n');
    }
    finally {
        await database.close();
    }
