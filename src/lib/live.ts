import {
  type ClientMessage,
  type FeedItem,
  LIVE_PING_INTERVAL_MS,
  LiveClose,
  type ServerMessage,
  type User,
} from '@kerf/shared';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { apiUrl } from '@/lib/api';
import { endSession } from '@/lib/session';

/**
 * the app's one live connection to the api: new measurements and who's online.
 *
 * it is open whenever someone is signed in, on every screen, because having the app open is what
 * makes you "online". it uses a plain websocket, which exists in browsers and in react native
 * alike, so there is nothing native to install and it runs in expo go.
 *
 * the connection is assumed to be unreliable. whenever it drops we reconnect with backoff and
 * tell the server the last measurement we saw (`cursor`); it replies with exactly what we missed.
 */

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

export interface LiveState {
  status: LiveStatus;
  /** measurements from your projects, newest first. */
  items: FeedItem[];
  /** whether the first snapshot has arrived. */
  loaded: boolean;
  /** people online who share a project with you, yourself first. */
  online: User[];
}

const EMPTY: LiveState = { status: 'connecting', items: [], loaded: false, online: [] };

// if the server has been silent this long, the connection is dead even if the socket hasn't
// noticed (a laptop waking from sleep, wi-fi that changed underneath us).
const SILENCE_LIMIT_MS = LIVE_PING_INTERVAL_MS * 2 + 5_000;
const PROBE_TIMEOUT_MS = 4_000;
const MAX_RETRY_MS = 10_000;

let state = EMPTY;
const listeners = new Set<() => void>();

let token: string | undefined;
let socket: WebSocket | undefined;
let epoch: string | undefined;
let cursor: number | undefined;
let lastHeard = 0;
let attempt = 0;
let paused = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let probeTimer: ReturnType<typeof setTimeout> | undefined;

function update(patch: Partial<LiveState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function sendMessage(ws: WebSocket, message: ClientMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function clearTimers() {
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  clearTimeout(probeTimer);
}

/** lets go of the current socket without reacting to its close event. */
function detach() {
  const ws = socket;
  socket = undefined;
  clearTimers();
  if (ws) {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    ws.close();
  }
}

function retry() {
  detach();
  if (!token || paused) return;
  // we can't know who's online while we're cut off, so don't keep showing the old list.
  update({ status: 'reconnecting', online: [] });
  // 0.5 s, 1 s, 2 s … capped at 10 s, with jitter so clients don't all return at once after an
  // api restart.
  const delay = Math.min(MAX_RETRY_MS, 500 * 2 ** attempt) * (0.5 + Math.random() / 2);
  attempt += 1;
  retryTimer = setTimeout(open, delay);
}

function open() {
  detach();
  if (!token || paused) return;
  const ws = new WebSocket(apiUrl().replace(/^http/, 'ws') + '/live');
  socket = ws;

  ws.onopen = () => {
    lastHeard = Date.now();
    sendMessage(ws, { type: 'hello', token: token!, epoch, cursor });
    pingTimer = setInterval(() => {
      if (Date.now() - lastHeard > SILENCE_LIMIT_MS) retry();
      else sendMessage(ws, { type: 'ping' });
    }, LIVE_PING_INTERVAL_MS);
  };
  ws.onmessage = (event) => {
    lastHeard = Date.now();
    clearTimeout(probeTimer);
    receive(JSON.parse(String(event.data)) as ServerMessage);
  };
  ws.onclose = (event) => {
    if (event.code === LiveClose.Unauthorized) {
      // signed out elsewhere, or the session is gone. retrying with this token can't work.
      const rejected = token;
      stopLive();
      endSession(rejected);
      return;
    }
    retry();
  };
  // an error is always followed by close, which does the reconnecting.
  ws.onerror = () => {};
}

function receive(message: ServerMessage) {
  switch (message.type) {
    case 'ready':
      epoch = message.epoch;
      attempt = 0;
      update({ status: 'live' });
      break;
    case 'snapshot':
      cursor = message.cursor;
      update({ items: message.items, loaded: true });
      break;
    case 'measurements': {
      // anything at or below the cursor has been shown already.
      const seen = cursor ?? 0;
      const fresh = message.items.filter((item) => item.id > seen);
      cursor = Math.max(seen, message.cursor);
      if (fresh.length > 0) update({ items: [...fresh.reverse(), ...state.items] });
      break;
    }
    case 'presence':
      update({ online: message.users });
      break;
    case 'pong':
      break;
  }
}

/**
 * called when the app comes back to the foreground or the network returns. reconnects straight
 * away if we're waiting to, and otherwise checks that the socket we hold is really alive.
 */
function wake() {
  if (!token || paused) return;
  const ws = socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (!ws) {
      attempt = 0;
      open();
    }
    return;
  }
  sendMessage(ws, { type: 'ping' });
  clearTimeout(probeTimer);
  probeTimer = setTimeout(retry, PROBE_TIMEOUT_MS);
}

export function startLive(sessionToken: string) {
  if (token === sessionToken) return;
  stopLive();
  token = sessionToken;
  open();
}

export function stopLive() {
  token = undefined;
  // the next person to sign in on this device must not inherit this one's feed or cursor.
  epoch = undefined;
  cursor = undefined;
  attempt = 0;
  detach();
  state = EMPTY;
  listeners.forEach((l) => l());
}

AppState.addEventListener('change', (next) => {
  if (Platform.OS === 'web') {
    // a hidden tab is still open, so it stays connected. check on it when it's looked at again.
    if (next === 'active') wake();
    return;
  }
  // a phone suspends a backgrounded app within seconds. close cleanly so we go offline now
  // rather than timing out, and reconnect (and catch up) when the app returns.
  if (next === 'background') {
    paused = true;
    detach();
    if (token) update({ status: 'reconnecting', online: [] });
  } else if (next === 'active') {
    paused = false;
    wake();
  }
});

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('online', wake);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLive() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}
