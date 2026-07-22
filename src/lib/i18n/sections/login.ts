type LoginStrings = {
  privateSystem: string;
  welcomeBack: string;
  signInTitle: string;
  tagline: string;
  connectedAreas: string;
  trustTitle: string;
  trustBody: string;
  authError: string;
  continueWithGoogle: string;
  calendarNotice: string;
};

export const login: { en: LoginStrings; cs: LoginStrings } = {
  en: {
    privateSystem: "Private professional operating system",
    welcomeBack: "Welcome back",
    signInTitle: "Sign in to your workspace",
    tagline: brandConfig.description.en,
    connectedAreas: "Projects · Opportunities · Clients · Career · Money · Planning · Knowledge",
    trustTitle: "Your system, your data",
    trustBody: "One owner. Explicit integrations. Contextual AI only when you start it.",
    authError: "Sign-in could not be completed. Try again or review the configured OAuth callback.",
    continueWithGoogle: "Continue with Google",
    calendarNotice:
      `We request Calendar access to create events from ${brandConfig.name}.`,
  },
  cs: {
    privateSystem: "Soukromý profesní operační systém",
    welcomeBack: "Vítejte zpět",
    signInTitle: "Přihlaste se do svého prostoru",
    tagline: brandConfig.description.cs,
    connectedAreas: "Projekty · Příležitosti · Klienti · Kariéra · Peníze · Plánování · Znalosti",
    trustTitle: "Váš systém, vaše data",
    trustBody: "Jeden vlastník. Výslovné integrace. Kontextová AI pouze na váš pokyn.",
    authError: "Přihlášení se nepodařilo dokončit. Zkuste to znovu nebo zkontrolujte nastavené OAuth přesměrování.",
    continueWithGoogle: "Pokračovat přes Google",
    calendarNotice:
      `Žádáme o přístup ke Kalendáři pro vytváření událostí z aplikace ${brandConfig.name}.`,
  },
};
import { brandConfig } from "@/lib/brand";
