type CostsStrings = {
  // Cost overview (aggregate spend pies)
  overviewTitle: string;
  overviewMonthly: string;
  overviewYearly: string;
  overviewTotal: string;
  overviewProjects: string;
  overviewSubscriptions: string;
  overviewEmpty: string;
  overviewPerMo: string;
  overviewPerYr: string;
};

export const costs: { en: CostsStrings; cs: CostsStrings } = {
  en: {
    overviewTitle: "Cost overview",
    overviewMonthly: "Monthly",
    overviewYearly: "Yearly",
    overviewTotal: "All costs",
    overviewProjects: "Projects",
    overviewSubscriptions: "Subscriptions",
    overviewEmpty: "Add project costs or subscriptions to see the breakdown.",
    overviewPerMo: "/mo",
    overviewPerYr: "/yr",
  },
  cs: {
    overviewTitle: "Přehled nákladů",
    overviewMonthly: "Měsíčně",
    overviewYearly: "Ročně",
    overviewTotal: "Všechny náklady",
    overviewProjects: "Projekty",
    overviewSubscriptions: "Předplatná",
    overviewEmpty: "Přidej náklady projektů nebo předplatná a uvidíš rozpad.",
    overviewPerMo: "/měs",
    overviewPerYr: "/rok",
  },
};
