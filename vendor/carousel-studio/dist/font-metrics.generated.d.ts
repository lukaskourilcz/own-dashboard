export interface FaceMetrics {
    /** The family name the file itself reports, which is the name a renderer has to ask for. */
    readonly familyName: string;
    /** The name resvg resolves this exact face by (name id 16 when present). */
    readonly rasterFamily: string;
    readonly weight: number;
    readonly file: string;
    /** The mean advance of a letter in this face, which is what capacity questions need. */
    readonly average: number;
    /** What an unmapped character is charged. */
    readonly fallback: number;
    readonly widths: Readonly<Record<string, string>>;
}
export declare const FONT_METRICS: Readonly<Record<string, FaceMetrics>>;
//# sourceMappingURL=font-metrics.generated.d.ts.map