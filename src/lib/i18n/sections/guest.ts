type GuestStrings = {
  label: string;
  description: string;
  signIn: string;
  dismiss: string;
  readOnlyAction: string;
};

export const guest: { en: GuestStrings; cs: GuestStrings } = {
  en: {
    readOnlyAction: "This tour uses sample data. Sign in to work with your own records.",
    label: "Guest tour",
    description: "Sample data. Edits are not saved.",
    signIn: "Sign in",
    dismiss: "Hide this notice",
  },
  cs: {
    readOnlyAction: "Prohlídka používá ukázková data. Pro práci s vlastními záznamy se přihlaste.",
    label: "Prohlídka pro hosty",
    description: "Ukázková data. Úpravy se neukládají.",
    signIn: "Přihlásit se",
    dismiss: "Skrýt upozornění",
  },
};
