type RelinkStrings = {
  relinkGoogle: string;
  failed: string;
  grantCalendarAccess: string;
};

export const relink: { en: RelinkStrings; cs: RelinkStrings } = {
  en: {
    relinkGoogle: "Re-link Google",
    failed: "Could not start Google authorization. Check your connection and try again.",
    grantCalendarAccess: "Grant Calendar access",
  },
  cs: {
    relinkGoogle: "Znovu propojit Google",
    failed: "Přihlášení ke Googlu se nepodařilo zahájit. Zkontrolujte připojení a zkuste to znovu.",
    grantCalendarAccess: "Povolit přístup ke Kalendáři",
  },
};
