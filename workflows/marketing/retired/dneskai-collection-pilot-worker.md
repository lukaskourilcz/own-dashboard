# Isolated DNESKAi collection worker

This credential-free export is inactive. It provides one manual start followed by
native detached internal continuations. Each execution makes one registered pilot
request, waits 15 seconds when the same run needs another step, and starts at most
one new execution. The counter stops at 40; the server keeps its independent
immutable pilot window, one-run limit and budget ledger. A terminal `partial` or
`held` result ends the chain. Reaching a counter/expiry limit leaves the result
incomplete, rather than claiming successful collection.

The worker has Manual and Execute Sub-workflow triggers only. Its time-based Wait
node does not accept a resume webhook. It contains no schedule, public Webhook
trigger, publishing operation, model node, browser call or MCP exposure.
The ordinary saved rotating workflow remains inactive and unchanged.

Before use, the owner/root must:

1. Obtain the explicit credential and budget approval, apply/verify the separate
   collection-pilot migration on the isolated database, and deploy the matching
   Own and Quorum Preview commits. Use the actual verified Own Preview origin;
   the production/custom-domain route is rejected by the export.
2. Replace the project, Preview origin and worker-ID placeholders in
   `Validate isolated scope`. Replace `settings.callerIds` with the same saved
   worker ID. The expiry placeholder is `2026-10-15T09:10:00Z`; it must match the
   server's approved immutable window. Configure only the dedicated Custom Auth
   credential: collection Authorization and, where required, deployment-scoped
   Vercel protection cookie. The export contains no credential values.
3. Read back the actual n8n Cloud 2.42.7 workflow and verify: exactly nine nodes;
   only the two permitted trigger types; same-project/run continuation; self-only
   caller policy; 120-second timeout; all four retention settings disabled;
   MCP disabled; HTTP redirects/retries disabled; detached self-call with
   `waitForSubWorkflow:false`; no pin data. Confirm a saved/published version
   contains the same guarded nodes and exact Preview target.
4. Publish **only this internal worker**, if needed for native stored-ID calls.
   It has no schedule/webhook activation. Do not publish the existing rotating
   workflow, whose Schedule Trigger would enable recurring collection.
5. Start once manually. The manual execution finishing means it dispatched a
   continuation, not that the entire collection finished. Check the same durable
   run's status through the owner Sources UI/database read-back. On transport,
   response-binding, expiry or child errors, stop and inspect that registered run;
   do not reset its reservations or start a replacement paid run. Internal
   publishing by itself grants no server authorization or social approval.

Primary evidence pinned to n8n 2.42.7:

- [Execute Sub-workflow documentation](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/)
- [Child mode, published-version gate and independent detached deadlines](https://github.com/n8n-io/n8n/blob/n8n%402.42.7/packages/cli/src/workflow-execute-additional-data.ts)
- [Native `waitForSubWorkflow` dispatch](https://github.com/n8n-io/n8n/blob/n8n%402.42.7/packages/nodes-base/nodes/ExecuteWorkflow/ExecuteWorkflow/ExecuteWorkflow.node.ts)
- [Self-only caller allowlist](https://github.com/n8n-io/n8n/blob/n8n%402.42.7/packages/cli/src/executions/pre-execution-checks/subworkflow-policy-checker.ts)

A manual caller can load an unpublished child draft. A child's nested call runs
as `integrated` and requires a published stored workflow; an entirely unpublished
self-call chain therefore cannot be assumed to work. Detached children receive
their own bounded deadline. A long Wait in one execution does not reset its
original workflow timeout. These code checks and local tests are not evidence
that the Cloud chain has run successfully.
