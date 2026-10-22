import json,pathlib,collections
p=pathlib.Path(__file__).resolve().parent
# Merge only findings about the same defect. Related but distinct prerequisites remain separate.
merges=[
 ['C1','briefs-03','M-04','production-05'],['briefs-01'],['briefs-02'],['C2'],['C3','SEL-04','SEL-09','production-12'],['C4'],['C7'],['C8','M-05'],['C9','SEL-13'],['C11','DOCS-11'],['C12','DOCS-12'],['C13','DOCS-18'],
 ['briefs-04','SEL-03','production-02'],['briefs-05','production-01'],['briefs-06'],['briefs-07'],['briefs-08','HOOKS-01'],['briefs-10','DOCS-10'],['briefs-11','DOCS-13'],['briefs-12','TESTS-01','SCHED-14'],
 ['cost-02','GEN-04'],['cost-07','approval-11'],['cost-11','GEN-01'],['cost-12','approval-05'],['cost-14'],
 ['DL-01'],['DL-04','review-07'],['DL-06'],['DOCS-01','production-10'],['DOCS-03','production-09','SCHED-05'],['DOCS-04','SCHED-07'],['DOCS-06','GEN-15'],
 ['GEN-02','M-02'],['GEN-03','review-11'],['GEN-06','review-04','approval-09'],['GEN-07','HOOKS-11'],['GEN-11'],['GEN-14','SCHED-02'],
 ['M-01','production-06'],['M-03'],['M-08','DOCS-15'],['M-10'],
 ['production-03','SCHED-12'],['production-08','SCHED-09'],['production-11','SEL-01'],
 ['REN-01','review-02'],['REN-02','TESTS-04'],['REN-03','approval-06','STU-02','TESTS-05'],['REN-04','SCHED-03','approval-14'],['REN-06'],['review-01','DL-03'],['review-03','approval-02','SCHED-04'],['review-06','approval-10'],['review-14','TESTS-10'],
 ['STU-03','TESTS-09'],['STU-04','TESTS-06'],['STU-08','REN-09'],
]
def verdict(f):return f.get('truth',{}).get('verdict','confirmed' if f.get('truth',{}).get('confirmed') else 'not-confirmed')
def impact(f):
 v=f.get('impactVerdict',f.get('impact',{}));return v if isinstance(v,dict) else {}
all=[];maps={}
for f in sorted(p.glob('map-*.json')):
 d=json.loads(f.read_text());maps[f.stem.removeprefix('map-')]=d
 for v in d['findings']:all.append(dict(v,subsystem=f.stem.removeprefix('map-')))
by={f['id']:f for f in all};assert len(by)==len(all)
kept={f['id']:f for f in all if impact(f).get('keep') and verdict(f) not in ['refuted','not-confirmed','not confirmed']}
seen=set();groups=[]
for ids in merges:
 ids=[i for i in ids if i in kept]
 if ids:
  assert not seen.intersection(ids),ids
  groups.append(ids);seen.update(ids)
groups += [[i] for i in kept if i not in seen]
stages={'collection':'collection','selection':'selection','media':'media','briefs':'briefs','generation':'generation','rendering':'rendering','review':'review-ui','approval':'approval-publishing','scheduler':'scheduler','cost':'cost-and-switches','docs':'docs-drift','brand':'brand','studio':'studio-and-consolidation','tests':'studio-and-consolidation','designlab':'review-ui','hooks':'hooks','production':'scheduler'}
reclass={'production-01':'briefs','production-02':'briefs','production-05':'briefs','production-06':'media','production-10':'docs-drift','production-11':'selection','production-12':'selection','production-15':'collection','cost-11':'generation','cost-12':'rendering','cost-07':'approval-publishing','DOCS-15':'media','GEN-06':'review-ui','REN-03':'studio-and-consolidation','REN-02':'studio-and-consolidation','STU-08':'rendering'}
rows=[]
for ids in groups:
 fs=[kept[i] for i in ids];f=fs[0];ims=[impact(v) for v in fs];score=max(v.get('impactScore',1) for v in ims)
 ev=[]
 for x in fs:
  for e in x['evidence']:
   if e not in ev:ev.append(e)
 corrected=f.get('truth',{}).get('correctedClaim')
 rows.append({'id':f['id'],'sourceIds':ids,'stage':reclass.get(f['id'],stages[f['subsystem']]),'title':f['title'],'claim':corrected or f['claim'],'impactScore':score,'effort':max((v.get('effort','M') for v in ims),key=lambda e:{'S':0,'M':1,'L':2}.get(e,1)),'risk':max((v.get('risk','low') for v in ims),key=lambda r:{'low':0,'medium':1,'high':2}.get(r,1)),'quickWin':any(v.get('quickWin') for v in ims),'recommendation':f['recommendation'],'ownerDecisions':list(dict.fromkeys(v['ownerDecision'] for v in ims if v.get('ownerDecision'))),'evidence':ev,'verification':[{'id':v['id'],'truth':v.get('truth',{}),'impact':impact(v)} for v in fs]})
rows.sort(key=lambda r:(r['stage'],-r['impactScore'],{'S':0,'M':1,'L':2}.get(r['effort'],1),r['id']))
assert sorted(i for row in rows for i in row['sourceIds'])==sorted(kept)
(p/'findings.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
def cell(s):return str(s).replace('|','\\|').replace('\n',' ')
def refs(row):
 return '; '.join(dict.fromkeys(f"{e.get('file','?')}:{e.get('line','?')}" for e in row['evidence']))
excluded=[v for v in all if v['id'] not in kept]
text=['# DNESKAi audit findings','', 'Snapshot: OwnDashboard 8df25a5, Quorum 76314a3, aifirst 0e88cf6, verified 21–22 October 2026. Feature branches are separate implementation work, not deployed behavior. Production observations are timestamped in production-evidence.md; they have not been refreshed by this synthesis.','',f"All 17 areas are mapped: {len(all)} source findings, {len(kept)} kept, {len(excluded)} excluded. Dedupe produces {len(rows)} findings. Every source id appears once in the merged output or the exclusion appendix. JSON retains every source truth verdict, impact judgment and evidence excerpt.",'', 'Read the truth notes before the original titles: partly confirmed claims retain their measured limits. Quick win means small effort and useful impact, not authorization; owner decisions still block implementation.','', '## Highest impact','', '| Id | Finding | Impact | Effort | Owner decision |','| --- | --- | --- | --- | --- |']
for r in sorted(rows,key=lambda r:(-r['impactScore'],{'S':0,'M':1,'L':2}.get(r['effort'],1),r['id']))[:15]:text.append('| '+' | '.join(map(cell,[r['id'],r['title'],r['impactScore'],r['effort'],'; '.join(r['ownerDecisions']) or 'None for this finding']))+' |')
text+=['','## Cost and speed','', 'Local measured rendering: a seven-slide fixture deck took 720.5 ms cold, 503.8–521.7 ms warm and produced 820,252 JPEG bytes (Apple M2; rendering map and handoff measurements). Five kits extrapolate to about 4.1 MB and 2.5–3.6 CPU seconds per post. Uploads, storage requests, cold Vercel execution and unbuilt kits were not measured. Do not turn these figures into a production latency promise.','', 'The original scheduler estimate that 40 slides cannot fit a generation step is not established by these local render measurements. The real deadline risk is model time plus storage round trips under the tick abort. Measure those together before choosing eager warming.','', 'Using the repository pricing assumptions, expected Sonnet copy cost is about $0.024/post or $2.88 for 120 posts. The token-budget arithmetic maximum is $0.13/job for two attempts. The ledger reserves $0.25 while unsettled and counts actual recorded cost after settlement; uncertain provider failures can still book $0.25 for 24 hours. Generation stays under $1/rolling day and eight jobs; collection under $0.25/Prague day and $0.04/profile. These limits remain unchanged. This is an estimate, not an invoice or evidence of a live generated post.','', 'The separate research plan has $126 of task caps under a $150 ceiling and needs owner approval. Pipeline Instagram collection is off. Vision, paid reranking and regeneration remain proposals, with unmeasured quality. Model-price assumptions come from the pinned code and audit, not a fresh provider price check.','', '## Consolidation recommendation','', 'Keep option (a), the pinned upstream vendor, while implementing the accepted additive kit engine. Derive tables from its registry and retain golden and vendor checks. Forking only DNESKAi still pulls about 81–83% of the studio and option (b) leaves Quorum consumers and tests behind. A permanent move or fork needs the owner’s consolidation decision. No files have been relocated.']
for stage in sorted(set(r['stage'] for r in rows)):
 text+=['','## '+stage,'','| Id | Finding | Evidence | Impact | Effort | Risk | Recommendation | Verdict notes |','| --- | --- | --- | --- | --- | --- | --- | --- |']
 for r in rows:
  if r['stage']!=stage:continue
  notes='Merged: '+', '.join(r['sourceIds'])+'. '+ ' '.join(v['id']+': '+v['truth'].get('verdict',str(v['truth'].get('confirmed')))+'. '+v['truth'].get('evidence',v['truth'].get('note','')) for v in r['verification'])
  text.append('| '+' | '.join(map(cell,[r['id'],r['title'],refs(r),r['impactScore'],r['effort'],r['risk'],r['recommendation'],notes]))+' |')
text+=['','## Quick wins','']
for r in rows:
 if r['quickWin']:text.append(f"- {r['id']}: {r['title']}"+(' Owner decision: '+'; '.join(r['ownerDecisions']) if r['ownerDecisions'] else ''))
text+=['','## Doc/code disagreements','']
for r in rows:
 if r['stage']=='docs-drift' or any(i.startswith('DOCS-') for i in r['sourceIds']):text.append(f"- {r['id']}: {r['title']}. {refs(r)}")
text+=['','## Excluded findings','', '| Id | Truth | Reason |','| --- | --- | --- |']
for f in excluded:text.append('| '+' | '.join(map(cell,[f['id'],verdict(f),impact(f).get('reason','No owner-impact keep verdict')]))+' |')
text+=['','## Owner decisions','', '- Copy register, hook policy and hashtag cap: choose among the researched options; do not change the prompt silently.', '- Approve the $126 Apify research plan before enabling the runner or using credit; separately decide pipeline Instagram collection.', '- Cost guards: reservation sizing, unknown-cost reconciliation, job limits and regeneration authorization.', '- Approval rules: time in the hash, missed-slot handling, retained rendered assets and reminders.', '- Four kit designs, magazine/clipping naming, profile rules and long-term consolidation.', '- Agency-photo attribution and migration-history reconciliation before any deployment or db push.','', '## Implementation status at synthesis','', 'Pipeline fixes 1–2, kit-engine steps 1–4 and Design Lab read/fit/batch-approval APIs are local branch commits. Stage components and Apify runner are WIP. None is deployed. See the append-only handoff LOG.md for later work and exact gates.']
(p/'findings.md').write_text('\n'.join(text)+'\n')
counts=[]
for area,d in maps.items():
 fs=d['findings'];counts.append({'area':area,'total':len(fs),'confirmed':sum(verdict(f)=='confirmed' for f in fs),'partly':sum(verdict(f)=='partly' for f in fs),'refuted':sum(verdict(f)=='refuted' for f in fs),'kept':sum(f['id'] in kept for f in fs),'quickWins':sum(bool(impact(f).get('quickWin')) for f in fs)})
(p/'audit-counts.json').write_text(json.dumps({'sourceCount':len(all),'keptCount':len(kept),'excludedCount':len(excluded),'mergedCount':len(rows),'areas':counts},indent=2)+'\n')
print(json.dumps({'sourceCount':len(all),'kept':len(kept),'excluded':len(excluded),'merged':len(rows),'stageCounts':dict(collections.Counter(r['stage'] for r in rows))},indent=2))
