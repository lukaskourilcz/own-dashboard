import 'server-only';
import { createDneskaiBriefStore, DNESKAI_BRIEF_SLOTS, type DneskaiBriefsDatabase } from './dneskai-briefs';
import { dneskaiNextFreeSlot } from './dneskai-lab';
import { pragueDayAfter } from './dneskai-workspace';
import { pragueMarketingDate } from './weekly-planning';

/** No run is excluded: every open brief of the day holds its slot, as in the owner reslot (briefs-07). */
const NO_RUN = '00000000-0000-4000-8000-000000000000';

/**
 * The server's own answer to „which slot does a missed post move to“ (owner decision 6): the same rule as the Lab's
 * `dneskaiNextFreeSlot`, over the stored publications, revisions and briefs of today and tomorrow. `own` are the
 * instants the moved post itself holds; they never count against it.
 */
export async function dneskaiServerNextFreeSlot(db: DneskaiBriefsDatabase, owner: string, project: string, own: readonly string[], now: Date): Promise<string | null> {
  const store = createDneskaiBriefStore(db);
  const today = pragueMarketingDate(now);
  const mine = new Set(own.map((value) => Date.parse(value)));
  const taken = (await Promise.all([today, pragueDayAfter(today, 1)].map((date) => store.takenSlots(owner, project, date, NO_RUN))))
    .flat().filter((value) => !mine.has(Date.parse(value)));
  return dneskaiNextFreeSlot({ today, slots: DNESKAI_BRIEF_SLOTS, taken, now: now.getTime() });
}
