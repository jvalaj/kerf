import type { Server } from 'node:http';

import { type ClientMessage, LIVE_PING_INTERVAL_MS, LiveClose } from '@kerf/shared';
import { WebSocket, WebSocketServer } from 'ws';

import type { Sessions } from './auth';
import type { Hub, LiveClient } from './hub';

export interface LiveOptions {
  /** drop a connection that has been silent for this long. */
  timeoutMs: number;
  /** how often to look for silent connections. */
  sweepMs: number;
}

// clients ping every 15 s. a device that vanishes without closing its socket (lid shut, battery
// dead, wi-fi gone) is noticed after three missed pings, so it drops off within about 50 s.
export const DEFAULT_LIVE_OPTIONS: LiveOptions = {
  timeoutMs: LIVE_PING_INTERVAL_MS * 3,
  sweepMs: 5_000,
};

// if this much is waiting to be sent, the client has stopped reading. disconnect it rather than
// let memory grow; it will catch up on what it missed when it reconnects.
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

function parse(data: unknown): ClientMessage | undefined {
  try {
    const message = JSON.parse(String(data));
    return message && typeof message.type === 'string' ? message : undefined;
  } catch {
    return undefined;
  }
}

/**
 * serves the live connection at `ws://…/live` on the api's own port, so a phone that can reach
 * the api can reach this too.
 *
 * a browser can't set an authorization header on a websocket, and a token in the url ends up in
 * logs and history, so the token arrives in the first message instead.
 */
export function attachLive(
  server: Server,
  sessions: Sessions,
  hub: Hub,
  options: LiveOptions = DEFAULT_LIVE_OPTIONS,
) {
  const wss = new WebSocketServer({ server, path: '/live', maxPayload: 16 * 1024 });
  const lastHeard = new Map<WebSocket, number>();

  wss.on('connection', (socket) => {
    let client: LiveClient | undefined;
    lastHeard.set(socket, Date.now());

    socket.on('message', (data) => {
      lastHeard.set(socket, Date.now());
      const message = parse(data);

      if (!client) {
        if (message?.type !== 'hello') {
          socket.close(LiveClose.BadRequest, 'Expected hello');
          return;
        }
        const session = sessions.find(message.token);
        if (!session) {
          socket.close(LiveClose.Unauthorized, 'Unauthorized');
          return;
        }
        client = {
          user: session.user,
          sessionId: session.sessionId,
          send(payload) {
            if (socket.readyState !== WebSocket.OPEN) return;
            if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
              socket.terminate();
              return;
            }
            socket.send(JSON.stringify(payload));
          },
          close(code, reason) {
            socket.close(code, reason);
          },
        };
        hub.connect(client, message.epoch, message.cursor);
        return;
      }

      if (message?.type === 'ping') client.send({ type: 'pong' });
    });

    socket.on('close', () => {
      lastHeard.delete(socket);
      if (client) hub.disconnect(client);
    });
    socket.on('error', () => socket.terminate());
  });

  const sweep = setInterval(() => {
    const cutoff = Date.now() - options.timeoutMs;
    for (const [socket, heard] of lastHeard) {
      // a polite close waits for the other side to answer, and a vanished device never will,
      // so cut the connection instead.
      if (heard < cutoff) socket.terminate();
    }
  }, options.sweepMs);
  server.on('close', () => clearInterval(sweep));

  return wss;
}
