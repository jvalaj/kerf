import { createServer as createHttpServer } from 'node:http';

import { type AppOptions, createApp } from './app';
import { createSessions } from './auth';
import type { Db } from './db';
import { Hub } from './hub';
import { attachLive, type LiveOptions } from './live';

export interface ServerOptions extends AppOptions {
  live?: LiveOptions;
}

/** the http api and the live websocket endpoint on one server, so both share a port. */
export function createServer(db: Db, options: ServerOptions = {}) {
  const sessions = createSessions(db);
  const hub = new Hub(db);
  const server = createHttpServer(createApp(db, sessions, hub, options));
  const live = attachLive(server, sessions, hub, options.live);
  return { server, hub, live };
}
