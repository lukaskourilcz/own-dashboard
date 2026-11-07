import type { StudioBlockKey, StudioWarning } from '@/lib/design-studio/devshark-layout';

/** The Design Studio editor (7 November 2026). Every string exists in English and Czech with the same meaning. */
const en = {
  toolbar: 'Text block tools',
  selectHint: 'Click a text on the slide to select it, double-click to write.',
  blocks: { kicker: 'Kicker', headline: 'Headline', body: 'Text', code: 'Code' } satisfies Record<StudioBlockKey, string>,
  smaller: 'Smaller text',
  larger: 'Larger text',
  align: { left: 'Left', center: 'Centre', right: 'Right' },
  green: 'Green',
  auto: 'Automatic place',
  width: 'Drag to change the width',
  howTo: 'Drag a text to move it, drag its right edge for width, double-click to write; select words while writing and press Green. Arrows move by 1 px, Shift by 10.',
  warnings: { 'outside-slide': 'part of it is off the slide.', 'unsupported-character': 'a character is missing from the font and will not show.', 'word-too-wide': 'a word or code line is wider than the block.' } satisfies Record<StudioWarning['code'], string>,
  slides: 'Slides',
  slideTab: (n: number) => `Slide ${n}`,
  formTitle: 'All texts as a form',
};
const cs: typeof en = {
  toolbar: 'Nástroje textového bloku',
  selectHint: 'Klepnutím na text ve slidu ho vyberete, dvojklikem do něj píšete.',
  blocks: { kicker: 'Nadpis s vlnovkou', headline: 'Nadpis', body: 'Text', code: 'Kód' },
  smaller: 'Menší písmo',
  larger: 'Větší písmo',
  align: { left: 'Vlevo', center: 'Na střed', right: 'Vpravo' },
  green: 'Zelená',
  auto: 'Automatické místo',
  width: 'Tažením změníte šířku',
  howTo: 'Text přesunete tažením, šířku tažením pravého okraje, psát začnete dvojklikem; při psaní označte slova a stiskněte Zelená. Šipky posouvají o 1 px, se Shiftem o 10.',
  warnings: { 'outside-slide': 'část je mimo slide.', 'unsupported-character': 'znak v písmu chybí a nezobrazí se.', 'word-too-wide': 'slovo nebo řádek kódu je širší než blok.' },
  slides: 'Slidy',
  slideTab: (n: number) => `Slide ${n}`,
  formTitle: 'Všechny texty jako formulář',
};
export const designStudio = { en, cs };
