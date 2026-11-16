import type { AddressInfo } from 'node:net';

import type { ClientMessage, FeedItem, LoginResponse, ServerMessage } from '@kerf/shared';
import { WebSocket } from 'ws';

import { type Db, openDb } from '../src/db';
import { USERS } from '../src/seed';
import { createServer, type ServerOptions } from '../src/server';

export type Name = 'alex' | 'sam' | 'priya';

/** seeded ids, for readability in assertions. */
export const ALEX = 1;
export const SAM = 2;
export const PRIYA = 3;
/** seeded groups: 1 is in hendricks kitchen (alex + priya), 4 in unit 4b (alex), 9 in maple st deck (sam). */
export const HENDRICKS_GROUP = 1;
export const UNIT_4B_GROUP = 4;
export const MAPLE_GROUP = 9;
export const SEEDED_MEASUREMENTS = 38;

export interface Live {
  socket: WebSocket;
  messages: ServerMessage[];
  /**
   * resolves with the next matching message after the one the previous call returned, whether
   * it has already arrived or not. messages in between are skipped.
   */
  next<T extends ServerMessage['type']>(
    type: T,
    match?: (message: Extract<ServerMessage, { type: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { type: T }>>;
  send(message: ClientMessage): void;
  closed: Promise<number>;
  /** ids of every measurement received so far, in arrival order. */
  ids(): number[];
  close(): Promise<void>;
}

export async function startApi(options: ServerOptions = {}) {
  const db: Db = openDb(':memory:');
  const { server, hub, live } = createServer(db, options);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  const sockets = new Set<WebSocket>();

  async function request(path: string, init: RequestInit & { token?: string } = {}) {
    const { token, ...rest } = init;
    return fetch(url + path, {
      ...rest,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...rest.headers,
      },
    });
  }

  async function login(name: Name): Promise<string> {
    const user = USERS.find((u) => u.username === name)!;
    const res = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: user.username, password: user.password }),
    });
    return ((await res.json()) as LoginResponse).token;
  }

  async function capture(token: string, groupId: number, label = 'Test', value = 1000) {
    const res = await request(`/groups/${groupId}/measurements`, {
      method: 'POST',
      token,
      body: JSON.stringify({ value, label, deviceId: 'TP-TEST' }),
    });
    return { status: res.status, body: (await res.json()) as { id: number } };
  }

  /** opens a live socket. pass `hello: false` to send the first message yourself. */
  function connect(hello: Omit<Extract<ClientMessage, { type: 'hello' }>, 'type'> | false): Live {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/live`);
    sockets.add(socket);
    const messages: ServerMessage[] = [];
    const waiters = new Set<() => void>();
    let consumed = 0;
    socket.on('message', (data) => {
      messages.push(JSON.parse(String(data)));
      for (const check of [...waiters]) check();
    });
    const opened = new Promise<void>((resolve) => socket.once('open', resolve));
    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
    if (hello) void opened.then(() => socket.send(JSON.stringify({ type: 'hello', ...hello })));

    return {
      socket,
      messages,
      closed,
      next(type, match) {
        return new Promise((resolve, reject) => {
          let seen = consumed;
          const timer = setTimeout(() => {
            waiters.delete(check);
            reject(new Error(`No "${type}" message arrived. Got: ${JSON.stringify(messages)}`));
          }, 2000);
          function check() {
            for (; seen < messages.length; seen++) {
              const message = messages[seen];
              if (message.type === type && (!match || match(message as never))) {
                clearTimeout(timer);
                waiters.delete(check);
                consumed = seen + 1;
                resolve(message as never);
                return;
              }
            }
          }
          waiters.add(check);
          check();
        });
      },
      send(message) {
        void opened.then(() => socket.send(JSON.stringify(message)));
      },
      ids() {
        return messages.flatMap((m) =>
          m.type === 'measurements' ? m.items.map((i: FeedItem) => i.id) : [],
        );
      },
      async close() {
        socket.close();
        await closed;
      },
    };
  }

  /** lets everything already in flight be delivered, for "this must not arrive" assertions. */
  async function settle(live: Live) {
    const seen = live.messages.filter((m) => m.type === 'pong').length;
    live.send({ type: 'ping' });
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (live.messages.filter((m) => m.type === 'pong').length > seen) {
          clearInterval(timer);
          resolve();
        }
      }, 2);
    });
  }

  async function stop() {
    for (const socket of sockets) socket.terminate();
    for (const socket of live.clients) socket.terminate();
    // let the server see every socket close before the database goes away under it.
    while (live.clients.size > 0) await new Promise((resolve) => setImmediate(resolve));
    live.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  return { db, hub, url, request, login, capture, connect, settle, stop };
}

export type Api = Awaited<ReturnType<typeof startApi>>;
