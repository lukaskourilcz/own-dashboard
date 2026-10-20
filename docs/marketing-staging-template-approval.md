# Private staging template approval receipt

> **Retired 2026-10-20 ([#113](https://github.com/lukaskourilcz/own-dashboard/issues/113)).** Outside Vercel Preview the receipt is ignored: the repository manifests apply, nothing is approved, and the process logs one `pilot-retired` line. See [`marketing-staging-retired-2026-10.md`](marketing-staging-retired-2026-10.md).

The owner approved the two current Claude Design-derived template digests for the staging pilot only. Public template manifests remain pending. Store the receipt only in the private Vercel Preview server variable `MARKETING_PILOT_TEMPLATE_APPROVALS`; do not commit its owner UUID, copy it into browser variables or provision it for Production.

The value is a JSON array of at most two unique-brand objects. Each object contains exactly `brand`, `approvedBy`, `approvedAt`, `designExportSha256` and `templateSha256`. Use the fixed staging owner UUID for `approvedBy` and the actual owner approval timestamp for `approvedAt`. The timestamp must fall inside the fixed pilot window and must not be in the future. Keep the receipt unchanged after queue admission so retries/reloads bind the same approval metadata.

| Brand | Approved template digest | Bound Design archive digest |
| --- | --- | --- |
| `devshark` | `41a8ff3a7bacbd8935e754fbafea8eafa0874ab5f50fa207504a432f2d39ba23` | `eaddeced6e28df466fe65d6b1dd87a449331c7bc17578d70d662a1f4dcb286cb` |
| `dneskai` | `e19dc4f3bf14c82ff429ae28bc08f975d174a37fd9ef4e09c839d8d30feec1d5` | `78801c2471b31b24d5bf57fc62765374ec0d97d89e52131e80b5f98c7b734b09` |

The server accepts the receipt only when `VERCEL_ENV=preview`, `MARKETING_OWNER_ID` matches `MARKETING_PILOT_OWNER_ID`, and the complete fixed pilot tuple is active. It checks each supplied entry against the current trusted template digest and Design export metadata. A malformed entry, duplicate brand, wrong owner/hash/export or invalid time holds the whole registry. A brand missing from a valid receipt stays pending. With no receipt variable, the ordinary repository registry remains unchanged.

Calendar orchestration, durable admission and worker template reload share this registry. Approval exists only on the returned in-memory template; the registry does not rewrite manifests, renderer definitions, fonts or layout. Deployed workers ignore resolver overrides and require caller/job templates to match the trusted registry. Removing or changing an admitted receipt causes the existing template reload gate to hold that job.

This receipt authorizes the exact layout for the bounded staging generation workflow. It does not approve a post, extend source eligibility, change generation consent/budgets or enable publication. The existing exact revision approval and publishing gates still apply. Remove the Preview receipt at pilot closure; Production continues to use its pending public manifests.

Focused tests use synthetic owner receipts and mocked durable admission/execution. They verify shared calendar/worker selection, caller-forgery refusal, reload after receipt removal, production refusal and unchanged public digests/manifests. They make no model, trace, cloud or publication calls.
