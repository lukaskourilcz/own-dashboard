// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { announceOwnerRetirement, watchOwnerRetirement } from '@/lib/owner-retirement';
const eventName = 'own-dashboard:owner-retirement';
class Channel {
 static instances: Channel[] = [];
 onmessage: ((event: { data: unknown }) => void) | null = null;
 closed = false;
 constructor(readonly name: string) { Channel.instances.push(this); }
 postMessage(data: unknown) { for (const other of Channel.instances) if (other !== this && !other.closed && other.name === this.name) other.onmessage?.({ data }); }
 close() { this.closed = true; }
}
let original: PropertyDescriptor | undefined;
const channels = (value: unknown) => Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value });
beforeEach(() => { original = Object.getOwnPropertyDescriptor(window, 'BroadcastChannel'); Channel.instances = []; channels(Channel); window.localStorage.clear(); });
afterEach(() => { if (original) Object.defineProperty(window, 'BroadcastChannel', original); else Reflect.deleteProperty(window, 'BroadcastChannel'); vi.restoreAllMocks(); window.localStorage.clear(); });
it('sends only a fixed retirement marker, closes channels and retains no storage', () => {
 const parent = new AbortController(), retire = vi.fn(), set = vi.spyOn(window.localStorage, 'setItem');
 watchOwnerRetirement(parent.signal, retire); announceOwnerRetirement();
 expect(retire).toHaveBeenCalledOnce(); expect(Channel.instances.map(channel => channel.closed)).toEqual([true, true]);
 expect(set).toHaveBeenCalledExactlyOnceWith(eventName, 'retire'); expect(window.localStorage.getItem(eventName)).toBeNull(); parent.abort();
});
it('ignores malformed channel and storage messages; a valid signal closes once', () => {
 const parent = new AbortController(), retire = vi.fn(); watchOwnerRetirement(parent.signal, retire); const channel = Channel.instances[0];
 for (const data of [null, {}, { ownerId: 'synthetic' }, 'signed-in', ['retire']]) channel.onmessage?.({ data });
 window.dispatchEvent(new StorageEvent('storage', { key: eventName, newValue: null })); window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'retire' })); expect(retire).not.toHaveBeenCalled();
 channel.onmessage?.({ data: 'retire' }); window.dispatchEvent(new Event(eventName)); expect(retire).toHaveBeenCalledOnce(); expect(channel.closed).toBe(true); parent.abort();
});
it('receives storage fallback without BroadcastChannel, including a later listener', () => {
 channels(undefined);
 for (let index = 0; index < 2; index++) {
  const retire = vi.fn(), parent = new AbortController(); watchOwnerRetirement(parent.signal, retire);
  window.dispatchEvent(new StorageEvent('storage', { key: eventName, newValue: 'retire' })); expect(retire).toHaveBeenCalledOnce(); parent.abort();
 }
});
it('keeps local retirement available when storage and channel construction are restricted', () => {
 channels(class { constructor() { throw Error('Synthetic restriction'); } }); vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw Error('Synthetic restriction'); });
 const parent = new AbortController(), retire = vi.fn(); watchOwnerRetirement(parent.signal, retire); expect(() => announceOwnerRetirement()).not.toThrow(); expect(retire).toHaveBeenCalledOnce(); parent.abort();
});
it('cleans up aborted/disposed subscriptions without affecting a later scope', () => {
 const parent = new AbortController(), retire = vi.fn(), stop = watchOwnerRetirement(parent.signal, retire); parent.abort(); stop();
 const next = new AbortController(), nextRetire = vi.fn(); watchOwnerRetirement(next.signal, nextRetire); announceOwnerRetirement(); expect(retire).not.toHaveBeenCalled(); expect(nextRetire).toHaveBeenCalledOnce(); next.abort();
 const aborted = new AbortController(); aborted.abort(); const count = Channel.instances.length; watchOwnerRetirement(aborted.signal, retire); expect(Channel.instances).toHaveLength(count);
});
