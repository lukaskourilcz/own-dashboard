'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOwnerPreferences } from '@/lib/owner-preferences';
import { useUnsavedDraft } from '@/components/navigation-guard';
import { qk } from '@/lib/queries/keys';

type Scope = { ownerId: string; signal: AbortSignal };

/** Reserve synchronously and retain the original owner and component lifetime. */
export function useAccountActionScope() {
  const owner = useOwnerPreferences();
  const client = useQueryClient();
  const lifetime = useRef(new AbortController());
  const active = useRef<Scope | null>(null);
  const [pending, setPending] = useState(false);

  useLayoutEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    return () => {
      if (active.current) {
        void client.invalidateQueries({ queryKey: qk.marketingAccounts, refetchType: 'none' });
      }
      lifetime.current.abort();
      active.current = null;
    };
  }, [client]);

  useUnsavedDraft({
    get dirty() { return false; },
    get pending() { return active.current !== null; },
    canSave: false,
    save: async () => false,
    discard: () => {},
  });

  function capture() {
    if (active.current || !owner || lifetime.current.signal.aborted) return null;
    const original = owner.capture();
    const scope = {
      ownerId: original.ownerId,
      signal: AbortSignal.any([original.signal, lifetime.current.signal]),
    };
    if (scope.signal.aborted) return null;
    active.current = scope;
    setPending(true);
    return scope;
  }

  function release(scope: Scope) {
    if (active.current !== scope) return;
    active.current = null;
    if (!scope.signal.aborted) setPending(false);
  }

  return { available: !!owner, pending, capture, release };
}
