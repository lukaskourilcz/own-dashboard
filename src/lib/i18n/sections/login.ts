type LoginStrings = {
  welcomeBack: string;
  tagline: string;
  continueWithGoogle: string;
  calendarNotice: string;
};

export const login: { en: LoginStrings; cs: LoginStrings } = {
  en: {
    welcomeBack: "Welcome back",
    tagline: "Track subscriptions, habits, plans, and your calendar.",
    continueWithGoogle: "Continue with Google",
    calendarNotice:
      "We request Calendar access to create events from the dashboard.",
  },
  cs: {
    welcomeBack: "Vítejte zpět",
    tagline: "Sledujte předplatná, návyky, plány a svůj kalendář.",
    continueWithGoogle: "Pokračovat přes Google",
    calendarNotice:
      "Žádáme o přístup ke Kalendáři pro vytváření událostí z přehledu.",
  },
};
