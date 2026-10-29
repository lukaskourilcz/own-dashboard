import { marketingStateFixture,stateOwner } from './marketing-state-fixture';
import type { CalendarReleaseIntent } from '@/lib/marketing/calendar-release';
export function calendarReleaseFixture(){
 const state=marketingStateFixture(),original=state.entries[0],source=state.sources[0];
 const intent:CalendarReleaseIntent={id:original.id,expectedEntryHash:original.capture_hash,expectedCampaignHash:state.campaigns[0].source_hash,sourceId:source.id,expectedSourceHash:source.packet.contentHash,expectedSourceRevision:source.packet.sourceRevision,date:original.date,time:original.local_time!,kind:'thread'};
 state.campaigns[0].status='active';
 const receipt={ownerId:stateOwner,previousHash:original.capture_hash,source:{id:source.id,sourceRevision:source.packet.sourceRevision,contentHash:source.packet.contentHash},entry:{...original,bound_source_id:source.id as string|null,capture_hash:'e'.repeat(64)}};
 return{state,original,intent,receipt};
}
