# Protected preview producer access

> **Retired 2026-10-20 ([#113](https://github.com/lukaskourilcz/own-dashboard/issues/113)).** Outside Vercel Preview the share variables below are ignored: no preflight, no cookie, only the ordinary source request, and the process logs one `pilot-retired` line. See [`marketing-staging-retired-2026-10.md`](marketing-staging-retired-2026-10.md).

The source adapter supports a temporary share token for one exact producer deployment origin during the active staging pilot. It leaves deployment protection and source application authentication enabled. Configure these server-only values for each protected brand:

| Brand | Token variable | Origin variable |
| --- | --- | --- |
| devShark | `MARKETING_DEVSHARK_SOURCE_PREVIEW_SHARE_TOKEN` | `MARKETING_DEVSHARK_SOURCE_PREVIEW_ORIGIN` |
| DNESKAi | `MARKETING_DNESKAI_SOURCE_PREVIEW_SHARE_TOKEN` | `MARKETING_DNESKAI_SOURCE_PREVIEW_ORIGIN` |

Set the origin to the canonical `https://<exact-deployment>.vercel.app` origin, without a trailing slash, path, query or alternate port. The corresponding source URL must match that origin. Supply the opaque token alone, never an authenticated share URL. The owner must provision it for that deployment with an explicit TTL no longer than the remaining pilot window and revoke it when the pilot ends. The adapter does not create tokens or inspect their contents.

Both optional variables must be present together. The adapter also requires `VERCEL_ENV=preview`, the existing complete active pilot tuple, and `MARKETING_OWNER_ID` matching the pilot owner. A pending, expired, malformed or foreign-owner pilot fails before any request. If both optional variables are absent, the original source fetch behavior remains unchanged. There is no fallback to a project-wide automation secret, incoming browser cookies or a stored source packet.

For each source request, the adapter makes a GET preflight to the exact source URL, preserving its public query and adding only `_vercel_share`. This request sends no source Bearer credential, HMAC headers or POST body. It accepts only a307 response whose Location resolves to the exact original clean URL, including the complete public query. It requires exactly one `_vercel_jwt` response cookie with Secure, HttpOnly and root Path attributes. Any foreign redirect, changed path/query, additional cookie or unexpected status prevents the source request.

The adapter then sends that cookie only to the exact clean source URL, alongside its original app authentication: DNESKAi's signed POST/body or devShark's Bearer GET. It refuses further redirects, shares the existing12-second request deadline across both requests, and rechecks pilot expiry after preflight. It buffers at most2MB per response. It acquires a new cookie for each request and keeps it only in that request's memory.

Protected requests use native Node HTTPS rather than Next's extended fetch, which can retain outgoing URL/cache metrics. The adapter suppresses Sentry tracing and isolates its event/breadcrumb scope. It emits only fixed error codes; it does not log, trace, return or persist the share token, authenticated URL or cookie. Source packet/hash/freshness validation remains unchanged.

Vercel documents deployment/alias share-token TTL through [PATCH protection-bypass](https://vercel.com/docs/rest-api/aliases/update-the-protection-bypass-for-a-url) and query access through [Shareable Links](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/sharable-links). Its [automation header](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) uses a project-wide secret. The owner-authorized staging check observed that a10-minute deployment share token failed through that header, while the native `_vercel_share` query yielded307, one `_vercel_jwt` cookie and then an application401 after the clean follow-up request. This establishes platform access for the checked URL, not source-producer eligibility or successful generation.

Offline tests cover both authentication styles, public query preservation, missing/unsafe cookies, mismatched redirects, production/inactive-pilot refusal, expiry during preflight and source refusal. Mocked native sockets verify that protected requests avoid global fetch and stop oversized responses. Before using a real producer, run the authorized read-only staging check against its exact source endpoint, including its public GET query, and verify that Vercel preserves that query in the307 Location. A changed redirect remains held; do not relax origin or query matching to make a live check pass.
