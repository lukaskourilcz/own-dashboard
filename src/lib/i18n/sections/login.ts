import { brandConfig } from "@/lib/brand";

type LoginStrings = {
  privateSystem: string;
  welcomeBack: string;
  signInTitle: string;
  tagline: string;
  connectedAreas: string;
  trustTitle: string;
  trustBody: string;
  authError: string;
  signInError: string;
  continueWithGoogle: string;
  calendarNotice: string;
};

export const login: { en: LoginStrings; cs: LoginStrings } = {
  en: {
    privateSystem: "Private professional operating system",
    welcomeBack: "Welcome back",
    signInTitle: "Sign in to your workspace",
    tagline: "Your work, in one place.",
    connectedAreas: "Projects · Opportunities · Clients · Career · Money · Planning · Knowledge",
    trustTitle: "Your system, your data",
    trustBody: "One owner. Integrations under your control.",
    authError: "Sign-in could not be completed. Try again or review the configured OAuth callback.",
    signInError: "Couldn’t start sign-in. Check your connection and try again.",
    continueWithGoogle: "Continue with Google",
    calendarNotice:
      `We request Calendar access to create events from ${brandConfig.name}.`,
  },
  cs: {
    privateSystem: "Soukromý profesní operační systém",
    welcomeBack: "Vítejte zpět",
    signInTitle: "Přihlaste se do svého prostoru",
    tagline: "Vaše práce na jednom místě.",
    connectedAreas: "Projekty · Příležitosti · Klienti · Kariéra · Peníze · Plánování · Znalosti",
    trustTitle: "Váš systém, vaše data",
    trustBody: "Jeden vlastník. Integrace pod vaší kontrolou.",
    authError: "Přihlášení se nepodařilo dokončit. Zkuste to znovu nebo zkontrolujte nastavené OAuth přesměrování.",
    signInError: "Přihlášení se nepodařilo zahájit. Zkontrolujte připojení a zkuste to znovu.",
    continueWithGoogle: "Pokračovat přes Google",
    calendarNotice:
      `Žádáme o přístup ke Kalendáři pro vytváření událostí z aplikace ${brandConfig.name}.`,
  },
};
