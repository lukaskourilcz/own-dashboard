type GuestStrings = {
  label: string;
  description: string;
  signIn: string;
  dismiss: string;
};

export const guest: { en: GuestStrings; cs: GuestStrings } = {
  en: {
    label: "Guest tour",
    description: "Sample data. Edits are not saved.",
    signIn: "Sign in",
    dismiss: "Hide this notice",
  },
  cs: {
    label: "Prohlídka pro hosty",
    description: "Ukázková data. Úpravy se neukládají.",
    signIn: "Přihlásit se",
    dismiss: "Skrýt upozornění",
  },
};
