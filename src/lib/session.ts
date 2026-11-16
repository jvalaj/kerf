import type { AuthUser, LoginResponse } from '@kerf/shared';
import { useSyncExternalStore } from 'react';

import { tokenStorage } from '@/lib/token-storage';

export type Session =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; token: string; user: AuthUser };

// starts as 'loading' on the server render and on the client alike; the stored session is read
// afterwards.
const LOADING: Session = { status: 'loading' };

let session: Session = LOADING;
const listeners = new Set<() => void>();

function set(next: Session) {
  session = next;
  listeners.forEach((l) => l());
}

tokenStorage
  .load()
  .then((raw) => {
    if (session.status !== 'loading') return;
    const saved = raw ? (JSON.parse(raw) as LoginResponse) : undefined;
    set(saved?.token ? { status: 'signedIn', ...saved } : { status: 'signedOut' });
  })
  .catch(() => set({ status: 'signedOut' }));

export function getSession() {
  return session;
}

export function getToken() {
  return session.status === 'signedIn' ? session.token : undefined;
}

export function startSession(login: LoginResponse) {
  set({ status: 'signedIn', ...login });
  tokenStorage.save(JSON.stringify(login)).catch(() => {});
}

/**
 * forgets the session on this device. pass the token that was rejected so a late 401 from an old
 * request can't sign out a session that started since.
 */
export function endSession(token?: string) {
  if (token !== undefined && token !== getToken()) return;
  set({ status: 'signedOut' });
  tokenStorage.clear().catch(() => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSession() {
  return useSyncExternalStore(subscribe, getSession, () => LOADING);
}
