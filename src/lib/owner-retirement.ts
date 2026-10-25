/** Same-origin, retirement-only notification. No identity/session is sent and
 * receiving it can only close an already server-verified private workspace. */
const marker = 'retire';
const channelName = 'own-dashboard-owner-retirement';
const eventName = 'own-dashboard:owner-retirement';
const storageKey = 'own-dashboard:owner-retirement';

export function announceOwnerRetirement(): void {
 if (typeof window === 'undefined') return;
 let channel: BroadcastChannel | undefined;
 try {
  if (typeof window.BroadcastChannel === 'function') {
   channel = new window.BroadcastChannel(channelName);
   channel.postMessage(marker);
  }
 } catch { /* Storage remains a fallback when channels are unavailable. */ }
 finally { channel?.close(); }
 try {
  // Remove immediately: retain no identity, session or persistent state. The
  // set/remove pair also notifies peers on each subsequent confirmed sign-out.
  window.localStorage.setItem(storageKey, marker);
  window.localStorage.removeItem(storageKey);
 } catch { /* Restricted storage must not prevent confirmed local sign-out. */ }
 window.dispatchEvent(new window.Event(eventName));
}

export function watchOwnerRetirement(parent: AbortSignal, retire: () => void): () => void {
 if (typeof window === 'undefined' || parent.aborted) return () => {};
 let stopped = false, channel: BroadcastChannel | undefined;
 function stop() {
  if (stopped) return;
  stopped = true;
  window.removeEventListener(eventName, receiveLocal);
  window.removeEventListener('storage', receiveStorage);
  parent.removeEventListener('abort', stop);
  channel?.close();
 }
 function receiveLocal() { if (stopped) return; stop(); retire(); }
 function receiveStorage(event: StorageEvent) { if (event.key === storageKey && event.newValue === marker) receiveLocal(); }
 window.addEventListener(eventName, receiveLocal);
 window.addEventListener('storage', receiveStorage);
 parent.addEventListener('abort', stop, { once: true });
 try {
  if (typeof window.BroadcastChannel === 'function') {
   channel = new window.BroadcastChannel(channelName);
   channel.onmessage = event => { if (event.data === marker) receiveLocal(); };
  }
 } catch { /* The local event and storage listener remain available. */ }
 return stop;
}
