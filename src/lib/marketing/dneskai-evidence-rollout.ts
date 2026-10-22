/** Enable only after the richer-media and brief/2 SQL migrations have been reconciled and applied. */
export function dneskaiRichEvidenceEnabled(): boolean {
  return process.env.DNESKAI_RICH_EVIDENCE_ENABLED === 'true';
}
