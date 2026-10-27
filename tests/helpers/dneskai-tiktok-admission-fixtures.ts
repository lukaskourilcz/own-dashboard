export function tikTokAdmissionReceipt(args: Record<string, unknown>, decision: {
    admitted: boolean;
    id?: string;
} = { admitted: true, id: '44444444-4444-4444-8444-444444444444' }) {
    return {
        ownerId: args.p_owner, accountId: args.p_account, remoteAccountId: args.p_remote, verifiedAt: args.p_verified_at, enabled: args.p_enabled, day: args.p_day, requestedAt: args.p_requested_at, actorId: 'sDvA9jM4WRTDX4Syr', actorName: 'clockworks~tiktok-trends-scraper', input: { adsScrapeSounds: true, adsSoundsCountryCode: 'CZ', adsRankType: 'surging', adsScrapeHashtags: false, adsScrapeCreators: false, adsScrapeVideos: false, resultsPerPage: 25 }, reservationUsd: 0.1, ceilingUsd: args.p_ceiling, spentUsd: 0, admitted: decision.admitted, spendId: decision.admitted ? decision.id : null, reservedAt: decision.admitted ? args.p_requested_at : null
    };
}
export function tikTokBindingReceipt(args: Record<string, unknown>) {
    const provider = args.p_provider as {
        id: string;
        datasetId: string;
    }, admission = args.p_admission as {
        reservedAt: string;
    };
    return { admission: args.p_admission, provider, ref: `tiktok:${provider.id}:${provider.datasetId}`, boundAt: admission.reservedAt };
}
