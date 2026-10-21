import 'server-only';

type Environment = Record<string, string | undefined>;

/** Variables that only a Vercel Preview pilot may read. Names only; values never leave the process. */
export const PREVIEW_PILOT_VARIABLES = {
  'generation-pilot': ['MARKETING_PILOT_OWNER_ID', 'MARKETING_PILOT_STARTS_AT', 'MARKETING_PILOT_EXPIRES_AT'],
  'template-approvals': ['MARKETING_PILOT_TEMPLATE_APPROVALS'],
  'collection-pilot': ['MARKETING_DNESKAI_COLLECTION_PILOT_ENABLED', 'MARKETING_DNESKAI_COLLECTION_PILOT_OWNER_ID', 'MARKETING_DNESKAI_COLLECTION_PILOT_PROJECT_ID', 'MARKETING_DNESKAI_COLLECTION_PILOT_STARTS_AT', 'MARKETING_DNESKAI_COLLECTION_PILOT_EXPIRES_AT'],
  'source-preview': ['MARKETING_DNESKAI_SOURCE_PREVIEW_SHARE_TOKEN', 'MARKETING_DNESKAI_SOURCE_PREVIEW_ORIGIN', 'MARKETING_DEVSHARK_SOURCE_PREVIEW_SHARE_TOKEN', 'MARKETING_DEVSHARK_SOURCE_PREVIEW_ORIGIN'],
  'offline-import': ['MARKETING_OFFLINE_IMPORT_ENABLED'],
} as const;
export type PreviewPilotFamily = keyof typeof PREVIEW_PILOT_VARIABLES;

const reported = new Set<PreviewPilotFamily>();

/**
 * The October staging pilots are retired (#113). Outside Vercel Preview a pilot tuple is ignored:
 * it grants no pilot authority and blocks no ordinary path. Returns true when the caller must
 * ignore the family. The first time a process meets a configured family outside Preview it writes
 * one structured `pilot-retired` line naming the variables, never their values.
 */
export function previewPilotRetired(family: PreviewPilotFamily, env: Environment = process.env): boolean {
  if (env.VERCEL_ENV === 'preview') return false;
  const variables = PREVIEW_PILOT_VARIABLES[family].filter(name => env[name] !== undefined);
  if (variables.length && !reported.has(family)) {
    reported.add(family);
    console.warn(JSON.stringify({ event: 'pilot-retired', family, vercelEnv: env.VERCEL_ENV ?? null, variables }));
  }
  return true;
}
