/**
 * The single product-brand surface. The temporary OwnDashboard name remains
 * until a replacement is explicitly confirmed; external service names are
 * intentionally not inferred from this file.
 */
const brandName = "OwnDashboard";

export const brandConfig = {
  name: brandName,
  shortName: "Dashboard",
  titleTemplate: `%s · ${brandName}`,
  fileNamePrefix: brandName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, ""),
  description: {
    en: "A personal operating system for projects, clients, opportunities, career, money, planning, and professional knowledge.",
    cs: "Osobní operační systém pro projekty, klienty, příležitosti, kariéru, finance, plánování a profesní znalosti.",
  },
} as const;

export type BrandLocale = keyof typeof brandConfig.description;
