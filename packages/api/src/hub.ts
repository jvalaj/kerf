import {
  type AuthUser,
  type FeedItem,
  LiveClose,
  type ServerMessage,
  type User,
} from '@kerf/shared';

import { type Db, getEpoch } from './db';
import { FEED_SELECT, type FeedRow, toFeedItem } from './rows';

/**
 * one live connection. the hub only needs to send to it and close it, so it doesn't care that
 * a websocket is underneath (which also makes it easy to test).
 */
export interface LiveClient {
  readonly user: AuthUser;
  readonly sessionId: number;
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

export const SNAPSHOT_SIZE = 50;
const REPLAY_BATCH = 500;

/**
 * sends each new measurement to the people allowed to see it, and keeps track of who is online.
 *
 * why catching up is exact: when a client connects we first send what it missed, then add it to
 * the list that receives new measurements. those two steps run back to back with nothing able
 * to happen in between (node runs one thing at a time, and these database calls don't wait).
 * so no measurement can slip through the gap, and none is sent twice.
 *
 * everything is kept in memory, so this works for one api process. to run several, they would
 * need a shared message channel (for example redis or postgres notifications) and a shared
 * record of who is online.
 */
export class Hub {
  private readonly clients = new Map<number, Set<LiveClient>>();
  private readonly latest;
  private readonly after;
  private readonly head;
  private readonly members;
  private readonly peers;

  constructor(private readonly db: Db) {
    // fix: the feed used to be ordered by time. it is now ordered by id, the same number the
    // catch-up cursor uses, so "newest" means one thing everywhere. two measurements can share
    // a timestamp, but never an id.
    this.latest = db.prepare(`
      ${FEED_SELECT}
      JOIN project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = ?
      ORDER BY m.id DESC
      LIMIT ?
    `);
    this.after = db.prepare(`
      ${FEED_SELECT}
      JOIN project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = ? AND m.id > ?
      ORDER BY m.id
      LIMIT ${REPLAY_BATCH}
    `);
    this.head = db.prepare('SELECT COALESCE(MAX(id), 0) AS head FROM measurements');
    this.members = db.prepare('SELECT user_id FROM project_members WHERE project_id = ?');
    this.peers = db.prepare(`
      SELECT DISTINCT u.id, u.name
      FROM project_members mine
      JOIN project_members theirs ON theirs.project_id = mine.project_id
      JOIN users u ON u.id = theirs.user_id
      WHERE mine.user_id = ?
      ORDER BY u.name
    `);
  }

  /** the newest measurements a user may see, newest first. */
  latestFor(userId: number, limit: number): FeedItem[] {
    return (this.latest.all(userId, limit) as unknown as FeedRow[]).map(toFeedItem);
  }

  /**
   * brings a client up to date and starts sending it live events. `epoch` and `cursor` are what
   * the client last saw, if it has been connected before.
   */
  connect(client: LiveClient, epoch?: string, cursor?: number) {
    this.sync(client, epoch, cursor);

    const userId = client.user.id;
    let set = this.clients.get(userId);
    const cameOnline = !set;
    if (!set) {
      set = new Set();
      this.clients.set(userId, set);
    }
    set.add(client);

    client.send({ type: 'presence', users: this.onlineFor(userId) });
    if (cameOnline) this.announce(userId);
  }

  disconnect(client: LiveClient) {
    const userId = client.user.id;
    const set = this.clients.get(userId);
    if (!set?.delete(client)) return;
    // still online if another tab or device is connected.
    if (set.size > 0) return;
    this.clients.delete(userId);
    this.announce(userId);
  }

  /** call after a measurement is committed, from whichever code path wrote it. */
  publish(item: FeedItem) {
    const message: ServerMessage = { type: 'measurements', items: [item], cursor: item.id };
    // look up the project's members for every measurement, not once per connection. if someone
    // is removed from a project, they stop receiving it straight away.
    for (const { user_id } of this.members.all(item.projectId) as { user_id: number }[]) {
      for (const client of this.clients.get(user_id) ?? []) {
        client.send(message);
      }
    }
  }

  /** call after the data was reset: ids started over, so everyone needs a fresh snapshot. */
  resyncAll() {
    for (const [userId, set] of this.clients) {
      for (const client of set) {
        this.sync(client);
        client.send({ type: 'presence', users: this.onlineFor(userId) });
      }
    }
  }

  closeSession(sessionId: number) {
    for (const set of [...this.clients.values()]) {
      for (const client of [...set]) {
        if (client.sessionId === sessionId) {
          this.disconnect(client);
          client.close(LiveClose.Unauthorized, 'Signed out');
        }
      }
    }
  }

  isOnline(userId: number) {
    return this.clients.has(userId);
  }

  private sync(client: LiveClient, epoch?: string, cursor?: number) {
    const userId = client.user.id;
    const currentEpoch = getEpoch(this.db);
    const { head } = this.head.get() as { head: number };
    client.send({ type: 'ready', epoch: currentEpoch, user: client.user });

    const canResume =
      epoch === currentEpoch && Number.isSafeInteger(cursor) && cursor! >= 0 && cursor! <= head;
    if (!canResume) {
      client.send({
        type: 'snapshot',
        items: this.latestFor(userId, SNAPSHOT_SIZE),
        cursor: head,
      });
      return;
    }

    let from = cursor!;
    for (;;) {
      const rows = this.after.all(userId, from) as unknown as FeedRow[];
      if (rows.length === 0) break;
      from = rows[rows.length - 1].id;
      client.send({ type: 'measurements', items: rows.map(toFeedItem), cursor: from });
      if (rows.length < REPLAY_BATCH) break;
    }
    // tell the client the newest id overall, even if the newest ones weren't in its projects,
    // so next time it asks from the right place.
    if (from < head) client.send({ type: 'measurements', items: [], cursor: head });
  }

  /** everyone online who shares a project with this user, plus the user themselves. */
  private onlineFor(userId: number): User[] {
    const users = (this.peers.all(userId) as unknown as User[]).filter(
      (u) => u.id !== userId && this.clients.has(u.id),
    );
    const self = [...(this.clients.get(userId) ?? [])][0]?.user;
    return self ? [{ id: self.id, name: self.name }, ...users] : users;
  }

  /** tells everyone who can see this user that they came online or went offline. */
  private announce(userId: number) {
    for (const peer of this.peers.all(userId) as unknown as User[]) {
      if (peer.id === userId) continue;
      const set = this.clients.get(peer.id);
      if (!set) continue;
      const message: ServerMessage = { type: 'presence', users: this.onlineFor(peer.id) };
      for (const client of set) client.send(message);
    }
  }
}
