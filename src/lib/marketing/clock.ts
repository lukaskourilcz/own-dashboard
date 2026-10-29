import { z } from 'zod';
const pragueDateTimeFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Resolve a Prague wall-clock slot and reject DST gaps or ambiguous times. */
export function pragueScheduledAt(date:string,time:string):string{
 z.iso.date().parse(date);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('invalid-local-time');
 const naive=Date.parse(`${date}T${time}:00Z`);
 const candidates=[0,60,120].map(minutes=>new Date(naive-minutes*60000)).filter(d=>pragueDateTimeFormatter.format(d)===`${date} ${time}`);
 if(candidates.length!==1)throw new Error('ambiguous-or-missing-local-time');
 return candidates[0].toISOString();
}

export function pragueLocalInput(iso:string):string {
 return pragueDateTimeFormatter.format(new Date(iso)).replace(' ','T');
}
