# Reproducible DNESKAi selection evaluation

The offline evaluator scores already recorded Jev decisions against declared
labels. It makes no requests, reads no credentials and does not reclassify or
change stored candidates. Reports contain case/dataset hashes and metrics;
they exclude raw titles, text, URLs, candidate IDs and duplicate target IDs.
An owner-declared label is not proof of facts or approval to publish.

Input schema `dneskai-evaluation/1` has `labelAuthority` (`agent` or
`owner-declared`), `expectations` and `predictions`. Each expectation contains
a matching candidate `id`, `expected` (`eligible`, `insufficient`,
`out-of-scope`, `duplicate`) and, only for duplicates, exact `duplicateOf`.
Predictions use the existing `DneskaiCandidate` schema. Missing, extra and
duplicate IDs fail rather than silently reducing the dataset.

```sh
npx esbuild scripts/dneskai-evaluation.ts --bundle --platform=node --packages=external --format=cjs --outfile=node_modules/.cache/dneskai-evaluation.cjs
node node_modules/.cache/dneskai-evaluation.cjs INPUT_JSON NEW_OUTPUT_JSON
```

Keep actual inputs and reports in private storage. Input is capped at 4 MB
and 200 cases. The tool refuses to overwrite an existing report. It reports
false acceptance, relevant recall, exact duplicate recall and conservative
abstention separately. A missing denominator yields `null`, not zero.
It never chooses a threshold or automatically changes a model or prompt.

Replay of the previously approved unseen eight-item public sample produced
7 correct decisions and 1 conservative abstention, 3/4 relevant recall,
3/3 accepted precision, and no false acceptance. The sample has no duplicate
cases, so duplicate recall is unknown. This reused saved results and made
zero additional provider calls. Labels remain agent judgments. Real
cross-source labels and broader held-out measurements remain under #108.
