import type { AuthUser, FeedItem, User } from './types';

/**
 * wire protocol for the live connection (websocket at `/live`).
 *
 * the client opens the socket and sends `hello` with its session token and, when it has been
 * connected before, the `epoch` and `cursor` it last saw. the server answers `ready` and then
 * either a `snapshot` (first connection, or the data was reset) or every measurement the client
 * missed. after that it pushes `measurements` and `presence` as they happen.
 *
 * `cursor` is the id of the newest measurement the client has been told about. ids only go up,
 * so "everything after my cursor" is exactly what was missed.
 *
 * `epoch` is a random label that changes whenever ids start again from 1 (seed data reset, or a
 * new database). a cursor from an old epoch points at the wrong measurements, so in that case
 * the server ignores it and sends a fresh snapshot.
 */
export type ClientMessage =
  { type: 'hello'; token: string; epoch?: string; cursor?: number } | { type: 'ping' };

export type ServerMessage =
  | { type: 'ready'; epoch: string; user: AuthUser }
  /** replaces everything the client holds. `items` are newest first. */
  | { type: 'snapshot'; items: FeedItem[]; cursor: number }
  /** new measurements, oldest first. ignore any id at or below your cursor. */
  | { type: 'measurements'; items: FeedItem[]; cursor: number }
  /** everyone online who shares a project with you, yourself included. */
  | { type: 'presence'; users: User[] }
  | { type: 'pong' };

/** close codes the server uses on the live socket. */
export const LiveClose = {
  /** the token is missing, wrong or signed out. reconnecting with it will not work. */
  Unauthorized: 4401,
  /** the first message was not a valid `hello`. */
  BadRequest: 4400,
  /** nothing heard from the client for too long. */
  Timeout: 4408,
} as const;

/** how often clients send `ping`. the server drops a client it has not heard from for 3 pings. */
export const LIVE_PING_INTERVAL_MS = 15_000;
