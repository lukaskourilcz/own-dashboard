type LoginStrings = {
  welcomeBack: string;
  tagline: string;
  continueWithGoogle: string;
  calendarNotice: string;
};

export const login: { en: LoginStrings; cs: LoginStrings } = {
  en: {
    welcomeBack: "Welcome back",
    tagline: brandConfig.description.en,
    continueWithGoogle: "Continue with Google",
    calendarNotice:
      `We request Calendar access to create events from ${brandConfig.name}.`,
  },
  cs: {
    welcomeBack: "Vítejte zpět",
    tagline: brandConfig.description.cs,
    continueWithGoogle: "Pokračovat přes Google",
    calendarNotice:
      `Žádáme o přístup ke Kalendáři pro vytváření událostí z aplikace ${brandConfig.name}.`,
  },
};
import { brandConfig } from "@/lib/brand";
