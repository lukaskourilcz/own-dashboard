import 'server-only';
import { z } from 'zod';
import { marketingPilotConfiguration } from './pilot';
import { previewPilotRetired } from './preview-pilot';
import { currentMarketingTemplate, marketingTemplateDefinition, validateMarketingTemplate, type MarketingTemplate } from './render';

type Environment = Record<string, string | undefined>;
// devShark only: DNESKAi renders through the vendored carousel studio and has no Claude Design template to approve.
const approvalSchema = z.strictObject({
  brand: z.literal('devshark'), approvedBy: z.uuid(), approvedAt: z.iso.datetime({ offset: true }),
  designExportSha256: z.string().regex(/^[a-f0-9]{64}$/), templateSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const approvalsSchema = z.array(approvalSchema).max(1);
export class MarketingTemplateApprovalError extends Error {
  readonly code = 'pilot-template-approval-invalid';
  constructor() { super('pilot-template-approval-invalid'); this.name = 'MarketingTemplateApprovalError'; }
}
function stagingApprovals(env: Environment, now: Date): z.infer<typeof approvalsSchema> {
  const raw = env.MARKETING_PILOT_TEMPLATE_APPROVALS;
  // Outside Preview the retired receipt grants nothing and blocks nothing; repository manifests apply.
  if (raw === undefined || previewPilotRetired('template-approvals', env)) return [];
  try {
    if (Buffer.byteLength(raw, 'utf8') > 4096) throw new Error();
    const pilot = marketingPilotConfiguration(env.MARKETING_OWNER_ID ?? '', env, now);
    if (!pilot) throw new Error();
    const approvals = approvalsSchema.parse(JSON.parse(raw));
    if (new Set(approvals.map(approval => approval.brand)).size !== approvals.length) throw new Error();
    for (const approval of approvals) {
      const template = validateMarketingTemplate(currentMarketingTemplate(approval.brand), false);
      const approvedAt = Date.parse(approval.approvedAt);
      if (approval.approvedBy !== pilot.ownerId || approvedAt < Date.parse(pilot.startsAt) || approvedAt >= Date.parse(pilot.expiresAt) || approvedAt > now.getTime()
        || template.authoring !== 'claude-design' || approval.templateSha256 !== template.templateSha256
        || approval.designExportSha256 !== marketingTemplateDefinition(approval.brand).style.design.archiveSha256) throw new Error();
    }
    return approvals;
  } catch { throw new MarketingTemplateApprovalError(); }
}
/** In-memory private Preview receipt; repository manifests remain the ordinary registry. */
export function trustedMarketingTemplate(brand: MarketingTemplate['brand'], env: Environment = process.env, now = new Date()): MarketingTemplate {
  const approvals = stagingApprovals(env, now); // Validate the complete supplied receipt before selecting a brand.
  const template = currentMarketingTemplate(brand), entry = approvals.find(approval => approval.brand === brand);
  if (!entry) return template;
  const { approvedBy, approvedAt, designExportSha256, templateSha256 } = entry;
  return validateMarketingTemplate({ ...template, approved: true, approval: { approvedBy, approvedAt, designExportSha256, templateSha256 } }, true);
}
export function resolveTrustedMarketingTemplate(version: string, env: Environment = process.env, now = new Date()): MarketingTemplate | null {
  // Invalid supplied receipts fail closed even for an unavailable version.
  stagingApprovals(env, now);
  const brand = (['devshark'] as const).find(candidate => currentMarketingTemplate(candidate).version === version);
  return brand ? trustedMarketingTemplate(brand, env, now) : null;
}
