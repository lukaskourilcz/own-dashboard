import type { SupabaseClient } from '@supabase/supabase-js';
import { awaitWithSignal } from '@/lib/abortable';

/** Events may retire an already server-verified scope, never authenticate or
 * reseed one. SDK callbacks stay synchronous; the rare null-start verification
 * runs in a separate task outside the SDK's session lock. */
export function watchOwnerSession(db: SupabaseClient, ownerId: string, parent: AbortSignal, retire: () => void): () => void {
 let stopped = false, generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
 let verification: AbortController | undefined, subscription: { unsubscribe: () => void } | undefined;
 function cancelVerification() { if (timer !== undefined) clearTimeout(timer); timer = undefined; verification?.abort(); verification = undefined; }
 function stop() { if (stopped) return; stopped = true; generation++; cancelVerification(); subscription?.unsubscribe(); parent.removeEventListener('abort', stop); }
 function close() { if (stopped) return; stop(); retire(); }
 if (parent.aborted) return stop;
 parent.addEventListener('abort', stop, { once: true });
 try {
  subscription = db.auth.onAuthStateChange((event, session) => {
   if (stopped) return;
   if (event === 'SIGNED_OUT') { close(); return; }
   if (session?.user?.id === ownerId) { generation++; cancelVerification(); return; }
   if (event !== 'INITIAL_SESSION' || session !== null || !ownerId) { close(); return; }
   if (timer !== undefined || verification) return;
   const captured = generation;
   timer = setTimeout(() => {
    timer = undefined;
    if (stopped || parent.aborted || generation !== captured) return;
    const controller = new AbortController(); verification = controller;
    const signal = AbortSignal.any([parent, controller.signal, AbortSignal.timeout(8_000)]);
    void (async () => {
     let confirmed = false;
     try { const result = await awaitWithSignal(db.auth.getUser(), signal); confirmed = !result.error && result.data.user?.id === ownerId; }
     catch { /* An unverified startup cannot retain the private workspace. */ }
     if (stopped || parent.aborted || generation !== captured || controller.signal.aborted) return;
     verification = undefined; if (!confirmed) close();
    })();
   }, 0);
  }).data.subscription;
  // Defend synchronous callback implementations as well as the actual SDK.
  if (stopped) subscription.unsubscribe();
 } catch { close(); }
 return stop;
}
