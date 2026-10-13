# Manual staging source check

The owner approved this limited staging credential transfer on13 October2026. The separate manual workflow was imported and executed once: three packets, two eligible (`rm-js-17`, `js-digit-sum`), one held (`rm-js-1`), zero missing/dropped. No generation or publishing occurred. Keep the four existing workflows inactive and this check unpublished.

To reproduce within the authorized window:

1. Import `staging-source-check.json` as a separate manual workflow. Confirm that the HTTP node
   targets `https://own-dashboard-j2ndtg5xk-lukas-kourils-projects.vercel.app/api/marketing/n8n`.
2. Select Generic Credential Type → Custom Auth. Create or select the credential named
   `OwnDashboard marketing staging (owner approval pending)`. Enter only these two headers in its
   credential JSON, replacing the placeholders inside n8n's credential editor:

   ```json
   {
     "headers": {
       "Authorization": "Bearer <staging MARKETING_N8N_SECRET>",
       "Cookie": "_vercel_jwt=<cookie for this exact Preview deployment>"
     }
   }
   ```

   Use the exact Preview hostname as the credential's allowed domain when the installed n8n
   version offers that control. Keep values out of workflow parameters, pinned data and exports.
   n8n documents this multi-header shape in [Custom Auth](https://docs.n8n.io/integrations/builtin/credentials/httprequest/#using-custom-auth).
3. Clipboard paste imported nodes/connections but did **not** preserve workflow settings in the current Cloud UI. Set success, error, manual and progress execution saving explicitly to **Do not save** in Workflow settings, save, and inspect the actual selections before running. Confirm the 60-second timeout and disabled redirects/retries. Click Execute workflow once; do not publish or activate it.
4. Inspect only **Safe source status summary**. The HTTP node temporarily receives full source
   packets in the editor; do not pin or share that intermediate output. The summary returns three
   IDs, their content hashes, fixed status labels and counts. Check that `question:rm-js-1` remains
   held; inspect the actual returned eligibility for `question:rm-js-17` and
   `coding-task:js-digit-sum`. `checked` means that the response accounted for the requested IDs,
   not that all sources qualify or any draft has approval.

This single POST refreshes owner-scoped source heads in the isolated staging database. It does
not request a draft, model call, approval or publication. A timeout, login response or HTTP error
stops the run. Investigate its cause before another manual attempt; the workflow retries nothing.
Clear execution after recording the safe summary. Remove this pilot workflow and its credential by15 October2026 09:10UTC or earlier when the exact deployment access expires. Do not reuse the deployment cookie for a different Preview.

Preparation checked against the current [HTTP Request documentation](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)
and n8n's [`httpCustomAuth` credential definition](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/credentials/HttpCustomAuth.credentials.ts).
