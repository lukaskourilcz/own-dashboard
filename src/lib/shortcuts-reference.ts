// Static reference content for the Shortcuts section's cheatsheets. The
// command/key columns are language-neutral; only the prose (description /
// action) is translated, so each row carries both en + cs.

export type GitRow = { command: string; en: string; cs: string };
export type SubstRow = { win: string; mac: string };
export type TransRow = { en: string; cs: string; win: string; mac: string };

export const GIT_SCRIPTS: GitRow[] = [
  {
    command: "git fetch origin",
    en: "Download new commits from the remote without touching your files.",
    cs: "Stáhne nové commity z remote bez zásahu do souborů.",
  },
  {
    command: "git pull",
    en: "Fetch and merge the remote branch into your current branch.",
    cs: "Stáhne a sloučí remote větev do aktuální.",
  },
  {
    command: "git pull --rebase",
    en: "Fetch, then replay your commits on top of the updated branch.",
    cs: "Stáhne a tvé commity přehraje na aktualizovanou větev.",
  },
  {
    command: "git merge <branch>",
    en: "Merge another branch into the current one.",
    cs: "Sloučí jinou větev do aktuální.",
  },
  {
    command: "git rebase <branch>",
    en: "Reapply your commits on top of another branch.",
    cs: "Přehraje tvé commity na jinou větev.",
  },
  {
    command: "git rebase -i HEAD~3",
    en: "Interactively squash or reword the last 3 commits.",
    cs: "Interaktivně sloučí nebo přepíše poslední 3 commity.",
  },
  {
    command: "git rebase --continue",
    en: "Continue a rebase after resolving conflicts.",
    cs: "Pokračuje v rebase po vyřešení konfliktů.",
  },
  {
    command: "git rebase --abort",
    en: "Cancel an in-progress rebase and restore the branch.",
    cs: "Zruší probíhající rebase a obnoví větev.",
  },
  {
    command: "git worktree add ../feat feature",
    en: "Check a branch out into a separate folder (worktree).",
    cs: "Naklonuje větev do samostatné složky (worktree).",
  },
  {
    command: "git worktree list",
    en: "List all linked worktrees.",
    cs: "Vypíše všechny propojené worktrees.",
  },
  {
    command: "git worktree remove ../feat",
    en: "Remove a worktree you no longer need.",
    cs: "Odstraní worktree, který už nepotřebuješ.",
  },
  {
    command: "git switch -c <branch>",
    en: "Create a new branch and switch to it.",
    cs: "Vytvoří novou větev a přepne na ni.",
  },
  {
    command: "git stash  ·  git stash pop",
    en: "Shelve your changes, then restore them later.",
    cs: "Odloží změny a později je vrátí.",
  },
  {
    command: "git log --oneline --graph --all",
    en: "Show a compact commit graph across all branches.",
    cs: "Zobrazí kompaktní graf commitů přes všechny větve.",
  },
  {
    command: "git reset --hard origin/main",
    en: "Discard local changes and match the remote branch.",
    cs: "Zahodí lokální změny a srovná se s remote větví.",
  },
];

// Reading a Windows VS Code tutorial on a Mac keyboard: which modifier to press.
export const KEY_SUBSTITUTIONS: SubstRow[] = [
  { win: "Ctrl", mac: "Command (Cmd ⌘)" },
  { win: "Alt", mac: "Option (Opt ⌥)" },
  { win: "Win", mac: "Control (Ctrl ⌃)" },
];

// Action → Windows shortcut → the equivalent on a Mac keyboard.
export const TRANSLATED_SHORTCUTS: TransRow[] = [
  { en: "Command Palette", cs: "Paleta příkazů", win: "Ctrl + Shift + P", mac: "Cmd + Shift + P" },
  { en: "Open Settings", cs: "Otevřít nastavení", win: "Ctrl + ,", mac: "Cmd + ," },
  { en: "Quick Open (Find File)", cs: "Rychlé otevření (najít soubor)", win: "Ctrl + P", mac: "Cmd + P" },
  { en: "Toggle Sidebar", cs: "Přepnout postranní panel", win: "Ctrl + B", mac: "Cmd + B" },
  { en: "Toggle Integrated Terminal", cs: "Přepnout terminál", win: "Ctrl + `", mac: "Cmd + `" },
  { en: "Find in Files", cs: "Hledat v souborech", win: "Ctrl + Shift + F", mac: "Cmd + Shift + F" },
  { en: "Comment Line", cs: "Zakomentovat řádek", win: "Ctrl + K  Ctrl + C", mac: "Cmd + K  Cmd + C" },
  { en: "Uncomment Line", cs: "Odkomentovat řádek", win: "Ctrl + K  Ctrl + U", mac: "Cmd + K  Cmd + U" },
  { en: "Toggle Line Comment", cs: "Přepnout řádkový komentář", win: "Ctrl + /", mac: "Cmd + /" },
  { en: "Duplicate Line Down/Up", cs: "Duplikovat řádek dolů/nahoru", win: "Shift + Alt + ↓ / ↑", mac: "Shift + Opt + ↓ / ↑" },
  { en: "Move Line Down/Up", cs: "Posunout řádek dolů/nahoru", win: "Alt + ↓ / ↑", mac: "Opt + ↓ / ↑" },
  { en: "Delete Line", cs: "Smazat řádek", win: "Ctrl + Shift + K", mac: "Cmd + Shift + K" },
];
