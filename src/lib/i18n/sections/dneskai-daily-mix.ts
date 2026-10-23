/** Zdroje → Denní mix (#156). Every string exists in English and Czech with the same meaning. */
const en = {
  title: 'Daily mix', loading: 'Loading the daily mix…', disabled: 'Daily mix settings are not enabled for this workspace.', retry: 'Retry',
  intro: 'How many posts a day, and at which times. The night proposes three topics for each post, and an approved topic takes the nearest free active time.',
  news: 'News posts a day',
  education: 'Education posts a day',
  times: 'Active times',
  defaultNote: 'Not saved yet: the default is 1 news post at 08:00 and 1 education post at 17:00.',
  tooFew: (posts: number, times: number) => `${posts} posts need at least ${posts} active times; ${times} are on.`,
  save: 'Save mix',
  saving: 'Saving…',
  saved: 'Mix saved.',
  failed: 'The mix was not saved. Check the numbers and try again.',
  preview: 'Preview: the mix shows the default and saves nothing.',
  unavailable: 'The daily mix could not be loaded.',
};
const cs: typeof en = {
  title: 'Denní mix', loading: 'Načítám denní mix…', disabled: 'Nastavení denního mixu není pro tento projekt zapnuté.', retry: 'Zkusit znovu',
  intro: 'Kolik příspěvků denně a v kolik hodin. Noc navrhne ke každému příspěvku tři náměty a schválený námět dostane nejbližší volný aktivní čas.',
  news: 'Zpravodajských příspěvků denně',
  education: 'Vzdělávacích příspěvků denně',
  times: 'Aktivní časy',
  defaultNote: 'Zatím neuloženo: výchozí je 1 zpráva v 8:00 a 1 vzdělávací příspěvek v 17:00.',
  tooFew: (posts: number, times: number) => `Příspěvků je ${posts}, potřebují aspoň ${posts} aktivních časů; zapnutých je ${times}.`,
  save: 'Uložit mix',
  saving: 'Ukládám…',
  saved: 'Mix je uložený.',
  failed: 'Mix se neuložil. Zkontrolujte čísla a zkuste to znovu.',
  preview: 'Ukázka: mix ukazuje výchozí nastavení a nic neukládá.',
  unavailable: 'Denní mix se nepodařilo načíst.',
};
export const dneskaiDailyMix = { en, cs };
