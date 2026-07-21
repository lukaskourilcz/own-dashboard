type NotesStrings = {
  title: string;
  description: string;
  loadingEditor: string;
  editorLabel: string;
  newNote: string;
  importMd: string;
  untitled: string;
  signInFirst: string;
  couldNotCreateNote: string;
  couldNotSaveNote: string;
  deleteConfirm: string;
  copiedAsMarkdown: string;
  couldNotCopy: string;
  couldNotExport: string;
  importedNote: string;
  importedAsNewNote: string;
  clear: string;
  searchPlaceholder: string;
  noMatches: string;
  noNotesYet: string;
  noMatchesDescription: string;
  noNotesDescription: string;
  pinned: string;
  notes: string;
  back: string;
  saving: string;
  /** "Saved {time}" — {time} is locale-formatted. */
  savedAt: (time: string) => string;
  /** Date-fns format string for the saved-at time (locale-aware). */
  savedTimeFormat: string;
  copyAsMarkdown: string;
  downloadMd: string;
  downloadAsMarkdown: string;
  unpin: string;
  pin: string;
  delete: string;
  deleteNote: string;
  linkedProject: string;
  noProject: string;
  removeTag: (tag: string) => string;
  selectANote: string;
  selectANoteDescription: string;
  dragToReorder: string;
  addTag: string;
  addTagPlaceholder: string;
  tagHint: string;
  importFromMarkdown: string;
  importDialogDescription: string;
  importPlaceholder: string;
  cancel: string;
  importing: string;
  createNote: string;
  linkToANote: string;
  findNoteToLink: string;
  esc: string;
  noOtherNotes: string;
  noMatchesShort: string;
  /** Slash menu item to insert a link to another note. */
  linkToNote: string;
  linkToNoteSubtext: string;
  knowledgeReview: string;
  knowledgeTitle: string;
  knowledgeDescription: string;
  knowledgeConsent: string;
  knowledgeNeedsSensitive: string;
  knowledgeReviewing: string;
  knowledgeFailed: string;
  knowledgeEmpty: string;
  knowledgeProposalNotice: string;
  knowledgeKinds: Record<"related_notes" | "duplicate_prompt" | "decision" | "unresolved_question" | "outdated_documentation" | "glossary" | "candidate_task", string>;
};

export const notes: { en: NotesStrings; cs: NotesStrings } = {
  en: {
    title: "Notes",
    description: "A quiet place for thoughts, prompts, and drafts.",
    loadingEditor: "Loading editor…",
    editorLabel: "Note content",
    newNote: "New note",
    importMd: "Import MD",
    untitled: "Untitled",
    signInFirst: "Sign in first.",
    couldNotCreateNote: "Could not create note.",
    couldNotSaveNote: "Could not save note.",
    deleteConfirm: "Delete this note? This cannot be undone.",
    copiedAsMarkdown: "Copied as Markdown.",
    couldNotCopy: "Could not copy.",
    couldNotExport: "Could not export.",
    importedNote: "Imported note",
    importedAsNewNote: "Imported as a new note.",
    clear: "Clear",
    searchPlaceholder: "Search title + content…",
    noMatches: "No matches",
    noNotesYet: "No notes yet",
    noMatchesDescription: "Try a different search or tag.",
    noNotesDescription: "Click New note to start writing.",
    pinned: "Pinned",
    notes: "Notes",
    back: "Back",
    saving: "Saving…",
    savedAt: (time) => `Saved ${time}`,
    savedTimeFormat: "HH:mm",
    copyAsMarkdown: "Copy as Markdown",
    downloadMd: "Download .md",
    downloadAsMarkdown: "Download as Markdown",
    unpin: "Unpin",
    pin: "Pin",
    delete: "Delete",
    deleteNote: "Delete note",
    linkedProject: "Linked project",
    noProject: "No project",
    removeTag: (tag) => `Remove ${tag}`,
    selectANote: "Select a note",
    selectANoteDescription: "Or create a new one to start writing.",
    dragToReorder: "Drag to reorder",
    addTag: "Add tag",
    addTagPlaceholder: "prompt, draft, idea…",
    tagHint: "Lowercase, hyphen-separated.",
    importFromMarkdown: "Import from Markdown",
    importDialogDescription:
      "Paste Markdown — headings, lists, code blocks. Creates a new note.",
    importPlaceholder: "# Title\n\nYour markdown here…",
    cancel: "Cancel",
    importing: "Importing…",
    createNote: "Create note",
    linkToANote: "Link to a note",
    findNoteToLink: "Find a note to link…",
    esc: "esc",
    noOtherNotes: "No other notes yet.",
    noMatchesShort: "No matches.",
    linkToNote: "Link to note",
    linkToNoteSubtext: "Reference another note",
    knowledgeReview: "AI maintenance",
    knowledgeTitle: "Knowledge maintenance",
    knowledgeDescription: "Evidence-grounded proposals across notes, prompts, links, projects, repository notes, and references.",
    knowledgeConsent: "Send the minimum bounded knowledge context to AI for a maintenance review? Nothing will be changed automatically.",
    knowledgeNeedsSensitive: "Enable sensitive AI context in Settings to review private knowledge.",
    knowledgeReviewing: "Reviewing knowledge…",
    knowledgeFailed: "The knowledge review could not be generated.",
    knowledgeEmpty: "No maintenance proposals were found.",
    knowledgeProposalNotice: "These are proposals only. Review them before creating or changing any record.",
    knowledgeKinds: { related_notes: "Related notes", duplicate_prompt: "Duplicate prompt", decision: "Decision", unresolved_question: "Open question", outdated_documentation: "Documentation", glossary: "Glossary", candidate_task: "Candidate task" },
  },
  cs: {
    title: "Poznámky",
    description: "Klidné místo pro myšlenky, nápady a koncepty.",
    loadingEditor: "Načítání editoru…",
    editorLabel: "Obsah poznámky",
    newNote: "Nová poznámka",
    importMd: "Importovat MD",
    untitled: "Bez názvu",
    signInFirst: "Nejprve se přihlaste.",
    couldNotCreateNote: "Poznámku se nepodařilo vytvořit.",
    couldNotSaveNote: "Poznámku se nepodařilo uložit.",
    deleteConfirm: "Smazat tuto poznámku? Tuto akci nelze vrátit zpět.",
    copiedAsMarkdown: "Zkopírováno jako Markdown.",
    couldNotCopy: "Nepodařilo se zkopírovat.",
    couldNotExport: "Nepodařilo se exportovat.",
    importedNote: "Importovaná poznámka",
    importedAsNewNote: "Importováno jako nová poznámka.",
    clear: "Vymazat",
    searchPlaceholder: "Hledat název + obsah…",
    noMatches: "Žádné výsledky",
    noNotesYet: "Zatím žádné poznámky",
    noMatchesDescription: "Zkuste jiné hledání nebo štítek.",
    noNotesDescription: "Kliknutím na Nová poznámka začněte psát.",
    pinned: "Připnuté",
    notes: "Poznámky",
    back: "Zpět",
    saving: "Ukládání…",
    savedAt: (time) => `Uloženo ${time}`,
    savedTimeFormat: "HH:mm",
    copyAsMarkdown: "Kopírovat jako Markdown",
    downloadMd: "Stáhnout .md",
    downloadAsMarkdown: "Stáhnout jako Markdown",
    unpin: "Odepnout",
    pin: "Připnout",
    delete: "Smazat",
    deleteNote: "Smazat poznámku",
    linkedProject: "Propojený projekt",
    noProject: "Bez projektu",
    removeTag: (tag) => `Odebrat ${tag}`,
    selectANote: "Vyberte poznámku",
    selectANoteDescription: "Nebo vytvořte novou a začněte psát.",
    dragToReorder: "Přetažením změňte pořadí",
    addTag: "Přidat štítek",
    addTagPlaceholder: "nápad, koncept, prompt…",
    tagHint: "Malá písmena, oddělená pomlčkou.",
    importFromMarkdown: "Import z Markdownu",
    importDialogDescription:
      "Vložte Markdown — nadpisy, seznamy, bloky kódu. Vytvoří novou poznámku.",
    importPlaceholder: "# Název\n\nVáš markdown sem…",
    cancel: "Zrušit",
    importing: "Importování…",
    createNote: "Vytvořit poznámku",
    linkToANote: "Odkaz na poznámku",
    findNoteToLink: "Najít poznámku k odkazu…",
    esc: "esc",
    noOtherNotes: "Zatím žádné další poznámky.",
    noMatchesShort: "Žádné výsledky.",
    linkToNote: "Odkaz na poznámku",
    linkToNoteSubtext: "Odkázat na jinou poznámku",
    knowledgeReview: "AI údržba",
    knowledgeTitle: "Údržba znalostí",
    knowledgeDescription: "Návrhy podložené zdroji napříč poznámkami, prompty, odkazy, projekty, poznámkami k repozitářům a referencemi.",
    knowledgeConsent: "Odeslat AI minimální omezený kontext znalostí ke kontrole údržby? Nic se nezmění automaticky.",
    knowledgeNeedsSensitive: "Pro kontrolu soukromých znalostí povolte v Nastavení citlivý AI kontext.",
    knowledgeReviewing: "Kontroluji znalosti…",
    knowledgeFailed: "Kontrolu znalostí se nepodařilo vytvořit.",
    knowledgeEmpty: "Nebyly nalezeny žádné návrhy údržby.",
    knowledgeProposalNotice: "Jde pouze o návrhy. Před vytvořením nebo změnou záznamu je zkontrolujte.",
    knowledgeKinds: { related_notes: "Související poznámky", duplicate_prompt: "Duplicitní prompt", decision: "Rozhodnutí", unresolved_question: "Otevřená otázka", outdated_documentation: "Dokumentace", glossary: "Slovník", candidate_task: "Návrh úkolu" },
  },
};
