type MarketingStrings = {
  appliedIn: string;
  usageLink: (label: string, count: number) => string;
  notYetApplied: string;
  plansRead: (summary: string) => string;
  calendarEntries: (label: string, count: number) => string;
  couldNotRead: (location: string, reason: string) => string;
  reason: {
    "not-found": string;
    unreadable: string;
    disconnected: string;
    "invalid-json": string;
    "wrong-schema": string;
    "wrong-project": (project: string | null) => string;
    "too-large": string;
    error: (status: string | null) => string;
  };
  skipped: (label: string, count: number) => string;
  unmatchedRefs: (count: number) => string;
  loading: string;
  loadError: string;
  rateLimited: string;
  signedOut: string;
  checkAgain: string;
  checking: string;
  checkedAt: (time: string) => string;
  opensInNewTab: string;
  weekTitle: string;
  weekDescription: string;
  startsOn: (date: string) => string;
  daysToLaunch: (days: number) => string;
  prelaunchTitle: string;
  prelaunchOverdue: string;
  prelaunchOwner: Record<string, string>;
  noEntries: string;
  noPrelaunch: string;
  nothingRead: string;
  openCalendar: (label: string) => string;
  showAll: (count: number) => string;
  showFewer: string;
  status: Record<string, string>;
  kind: Record<string, string>;
  platform: Record<string, string>;
};

const platform = {
  instagram: "Instagram",
  threads: "Threads",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
};

export const marketing: { en: MarketingStrings; cs: MarketingStrings } = {
  en: {
    appliedIn: "Applied in",
    usageLink: (label, count) => `${label} ×${count}`,
    notYetApplied: "Not yet applied",
    plansRead: (summary) => `Marketing plans: ${summary}`,
    calendarEntries: (label, count) => `${label} (${count} ${count === 1 ? "entry" : "entries"})`,
    couldNotRead: (location, reason) => `Could not read ${location}: ${reason}.`,
    reason: {
      "not-found": "the file is not on the default branch yet",
      unreadable: "the connected GitHub account cannot see the repository",
      disconnected: "GitHub is not connected",
      "invalid-json": "the file is not valid JSON",
      "wrong-schema": "the file is not a marketing-calendar/1 document",
      "wrong-project": (project) => (project ? `the document is for ${project}` : "the document names no project"),
      "too-large": "the file is larger than 1 MB",
      error: (status) => (status ? `GitHub answered ${status}` : "GitHub did not answer"),
    },
    skipped: (label, count) => `${label}: ${count} ${count === 1 ? "item" : "items"} without an id, a date or a title left out.`,
    unmatchedRefs: (count) => `${count} tip ${count === 1 ? "title" : "titles"} cited in the plans ${count === 1 ? "matches" : "match"} no tip here.`,
    loading: "Reading the marketing calendars…",
    loadError: "Could not read the marketing calendars. Try again.",
    rateLimited: "Too many checks in a minute. Wait a moment, then try again.",
    signedOut: "Sign in to read the marketing calendars.",
    checkAgain: "Check the calendars again",
    checking: "Checking…",
    checkedAt: (time) => `Checked at ${time}`,
    opensInNewTab: "(opens in a new tab)",
    weekTitle: "Marketing",
    weekDescription: "The next seven days across the marketing calendars. Read-only: each plan is edited in its own calendar.",
    startsOn: (date) => `Marketing starts ${date}`,
    daysToLaunch: (days) => (days === 1 ? "tomorrow" : `in ${days} days`),
    prelaunchTitle: "Pre-launch due this week",
    prelaunchOverdue: "Overdue",
    prelaunchOwner: { owner: "Owner", agent: "Agent" },
    noEntries: "Nothing is planned in the next seven days.",
    noPrelaunch: "No pre-launch item is due in the next seven days.",
    nothingRead: "No marketing calendar could be read, so the week's plan is unknown.",
    openCalendar: (label) => `Open the ${label} calendar`,
    showAll: (count) => `Show all ${count}`,
    showFewer: "Show fewer",
    status: {
      planned: "Planned",
      drafted: "Drafted",
      queued: "Queued",
      published: "Published",
      skipped: "Skipped",
      blocked: "Blocked",
      done: "Done",
    },
    kind: {
      carousel: "Carousel",
      reel: "Reel",
      post: "Post",
      story: "Story",
      thread: "Thread",
      reddit: "Reddit post",
      ad: "Ad",
      task: "Task",
      review: "Review",
      newsletter: "Newsletter",
    },
    platform: { ...platform, newsletter: "Newsletter", web: "Web" },
  },
  cs: {
    appliedIn: "Použito v",
    usageLink: (label, count) => `${label} ×${count}`,
    notYetApplied: "Zatím nepoužité",
    plansRead: (summary) => `Marketingové plány: ${summary}`,
    calendarEntries: (label, count) =>
      `${label} (${count} ${count === 1 ? "položka" : count >= 2 && count <= 4 ? "položky" : "položek"})`,
    couldNotRead: (location, reason) => `${location} se nepodařilo přečíst: ${reason}.`,
    reason: {
      "not-found": "soubor na výchozí větvi zatím není",
      unreadable: "připojený účet GitHub repozitář nevidí",
      disconnected: "GitHub není připojený",
      "invalid-json": "soubor není platný JSON",
      "wrong-schema": "soubor není dokument marketing-calendar/1",
      "wrong-project": (project) => (project ? `dokument patří k projektu ${project}` : "dokument neuvádí projekt"),
      "too-large": "soubor je větší než 1 MB",
      error: (status) => (status ? `GitHub odpověděl ${status}` : "GitHub neodpověděl"),
    },
    skipped: (label, count) =>
      `${label}: vynecháno ${count} ${count === 1 ? "položka" : count >= 2 && count <= 4 ? "položky" : "položek"} bez id, data nebo názvu.`,
    unmatchedRefs: (count) =>
      count === 1
        ? "1 název tipu z plánů neodpovídá žádnému tipu zde."
        : `${count} ${count >= 2 && count <= 4 ? "názvy" : "názvů"} tipů z plánů ${count >= 2 && count <= 4 ? "neodpovídají" : "neodpovídá"} žádnému tipu zde.`,
    loading: "Čtu marketingové kalendáře…",
    loadError: "Marketingové kalendáře se nepodařilo přečíst. Zkuste to znovu.",
    rateLimited: "Příliš mnoho kontrol za minutu. Chvíli počkejte a zkuste to znovu.",
    signedOut: "Pro čtení marketingových kalendářů se přihlaste.",
    checkAgain: "Znovu zkontrolovat kalendáře",
    checking: "Kontroluji…",
    checkedAt: (time) => `Zkontrolováno v ${time}`,
    opensInNewTab: "(otevře se na nové kartě)",
    weekTitle: "Marketing",
    weekDescription: "Příštích sedm dní napříč marketingovými kalendáři. Jen ke čtení: každý plán se upravuje ve svém kalendáři.",
    startsOn: (date) => `Marketing začíná ${date}`,
    daysToLaunch: (days) => (days === 1 ? "zítra" : days >= 2 && days <= 4 ? `za ${days} dny` : `za ${days} dní`),
    prelaunchTitle: "Příprava před spuštěním, termín tento týden",
    prelaunchOverdue: "Po termínu",
    prelaunchOwner: { owner: "Vlastník", agent: "Agent" },
    noEntries: "Na příštích sedm dní není nic naplánováno.",
    noPrelaunch: "Na příštích sedm dní nepřipadá žádný úkol přípravy.",
    nothingRead: "Žádný marketingový kalendář se nepodařilo přečíst, takže plán týdne není známý.",
    openCalendar: (label) => `Otevřít kalendář ${label}`,
    showAll: (count) => `Zobrazit všech ${count}`,
    showFewer: "Zobrazit méně",
    status: {
      planned: "Naplánováno",
      drafted: "Koncept",
      queued: "Ve frontě",
      published: "Zveřejněno",
      skipped: "Vynecháno",
      blocked: "Blokováno",
      done: "Hotovo",
    },
    kind: {
      carousel: "Karusel",
      reel: "Reel",
      post: "Příspěvek",
      story: "Story",
      thread: "Vlákno",
      reddit: "Příspěvek na Redditu",
      ad: "Reklama",
      task: "Úkol",
      review: "Revize",
      newsletter: "Newsletter",
    },
    platform: { ...platform, newsletter: "Newsletter", web: "Web" },
  },
};
