# Marketing staging pilot guard

> **Retired 2026-10-20 ([#113](https://github.com/lukaskourilcz/own-dashboard/issues/113)).** Outside Vercel Preview the tuple below is ignored: it grants no pilot and blocks no ordinary admission, and the process logs one `pilot-retired` line. Migration `20261020120000_scope_retired_pilot_ledgers.sql` keeps every ledger row but applies the persisted window only until it expires. A reserved job stays a pilot job: after expiry the ordinary path refuses it with `pilot job retired`. See [`marketing-staging-retired-2026-10.md`](marketing-staging-retired-2026-10.md).

The optional guard limits one owner to three durable job reservations, each reserving $0.25 of the $0.75 generation allowance. Failed jobs, ambiguous provider responses, expired leases and deleted operational job rows do not refund a reservation. The separate $2 owner-approved pilot budget must also account for staging compute and other services; this guard covers generation only.

Configure all three server-only variables together in the isolated staging deployment:

| Variable | Value |
| --- | --- |
| `MARKETING_PILOT_OWNER_ID` | The fixed authenticated staging owner UUID |
| `MARKETING_PILOT_STARTS_AT` | The approved pilot start, ISO UTC ending in `Z` |
| `MARKETING_PILOT_EXPIRES_AT` | The approved end, at most 48 hours after the start |

Missing, malformed, future, expired or foreign-owner configuration fails closed whenever any pilot variable is present. With all variables absent and no persisted pilot for the owner, normal marketing behavior is preserved. Once an admission persists the owner/window tuple, removing the variables or changing the window cannot disable or reset its limit. A new pilot requires a separately reviewed database change; there is no reset RPC.

The new migration `20261013092409_marketing_staging_pilot_guard.sql` keeps the four prior marketing migrations unchanged. It places the previous enqueue and claim implementations in a private schema and adds public wrappers with optional `p_pilot` JSON. Existing request/response contracts and ordinary RPC arguments remain valid. The JSON contains exactly `ownerId`, `startsAt` and `expiresAt`. Browser roles cannot read/write the private ledger or invoke the wrappers. The service role has no ledger/config update or delete privileges.

Admission uses an owner advisory transaction lock, performs the existing calendar/idempotency checks, and appends the reservation in the same transaction. A fourth request rolls back its job insertion. Repeating the same job consumes no additional reservation. Queued jobs must have their own reservation before claim; pre-pilot jobs cannot acquire pilot execution authority retroactively. Claims preserve the existing lease/fence rules.

Immediately before each provider invocation, including a copy-validation retry, the worker checks `marketing_check_pilot_attempt(p_owner,p_job,p_fence,p_pilot)` against the persisted window, reservation and current execution fence. A database error or ambiguous response prevents the invocation. The worker deadline is shortened to the exact pilot expiry. The existing two-attempt/$0.25 per-job budget and no-retry rule for ambiguous provider failures remain unchanged. This is a conservative reservation guard using configured token prices, not a provider billing ceiling; actual usage and the remaining total pilot budget still need reconciliation.

Consent, current authored source eligibility, template approval and publication gates remain unchanged. Generic pilot approval does not approve a Design/template digest. Both repository manifests stay pending. The production worker remains held until its existing exact template approval gate is satisfied; this change does not add a pending-template render bypass or any publishing authority.

Verification uses actual SQL in PGlite, mocked provider calls and an explicitly opted-in disposable networkless PostgreSQL container. The contention test requires `MARKETING_PILOT_TEST_POSTGRES_CONTAINER` to name that container and refuses an attached Docker network. It creates/removes a throwaway database there and verifies four overlapping admission transactions produce three reservations totaling $0.75, while two competing claims produce one lease. No production SQL, credentials, model calls or trace writes are part of these tests.
