import { LiveClose } from '@kerf/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALEX,
  type Api,
  HENDRICKS_GROUP,
  MAPLE_GROUP,
  PRIYA,
  SAM,
  SEEDED_MEASUREMENTS,
  startApi,
  UNIT_4B_GROUP,
} from './harness';

let api: Api;
let alex: string;
let sam: string;
let priya: string;

beforeEach(async () => {
  api = await startApi();
  [alex, sam, priya] = await Promise.all([api.login('alex'), api.login('sam'), api.login('priya')]);
});
afterEach(() => api.stop());

describe('connecting', () => {
  it('sends a snapshot of your own projects, newest first', async () => {
    const live = api.connect({ token: priya });
    const ready = await live.next('ready');
    expect(ready.user).toEqual({ id: PRIYA, name: 'Priya', username: 'priya' });

    const snapshot = await live.next('snapshot');
    expect(snapshot.cursor).toBe(SEEDED_MEASUREMENTS);
    expect(snapshot.items).toHaveLength(12);
    expect(new Set(snapshot.items.map((i) => i.projectName))).toEqual(
      new Set(['Hendricks Kitchen Remodel']),
    );
    const ids = snapshot.items.map((i) => i.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(snapshot.items[0].createdByName).toBe('Alex');
  });

  it('refuses a bad token, and a first message that is not hello', async () => {
    const bad = api.connect({ token: 'made-up' });
    expect(await bad.closed).toBe(LiveClose.Unauthorized);
    expect(bad.messages).toEqual([]);

    const rude = api.connect(false);
    rude.send({ type: 'ping' });
    expect(await rude.closed).toBe(LiveClose.BadRequest);
  });

  it('does not accept the token anywhere but the hello message', async () => {
    const res = await fetch(`${api.url}/live?token=${alex}`);
    expect(res.status).not.toBe(200);
  });
});

describe('live measurements', () => {
  it('delivers a measurement to everyone in the project, whoever wrote it and however', async () => {
    const alexLive = api.connect({ token: alex });
    const priyaLive = api.connect({ token: priya });
    await Promise.all([alexLive.next('snapshot'), priyaLive.next('snapshot')]);

    // written with a plain http request, the way a customer's own tool would.
    const { body } = await api.capture(priya, HENDRICKS_GROUP, 'Toe kick', 102);

    for (const live of [alexLive, priyaLive]) {
      const message = await live.next('measurements');
      expect(message.cursor).toBe(body.id);
      expect(message.items).toEqual([
        expect.objectContaining({
          id: body.id,
          label: 'Toe kick',
          value: 102,
          projectName: 'Hendricks Kitchen Remodel',
          groupName: 'Base cabinets',
          createdBy: PRIYA,
          createdByName: 'Priya',
          deviceId: 'TP-TEST',
        }),
      ]);
    }
  });

  it("never delivers a measurement from a project you're not in", async () => {
    const samLive = api.connect({ token: sam });
    const priyaLive = api.connect({ token: priya });
    await Promise.all([samLive.next('snapshot'), priyaLive.next('snapshot')]);

    await api.capture(alex, HENDRICKS_GROUP); // alex + priya
    await api.capture(alex, UNIT_4B_GROUP); // alex only
    await api.capture(sam, MAPLE_GROUP); // sam only
    await Promise.all([api.settle(samLive), api.settle(priyaLive)]);

    expect(samLive.ids()).toEqual([SEEDED_MEASUREMENTS + 3]);
    expect(priyaLive.ids()).toEqual([SEEDED_MEASUREMENTS + 1]);
  });

  it('stops delivering the moment someone is removed from a project', async () => {
    const priyaLive = api.connect({ token: priya });
    await priyaLive.next('snapshot');

    api.db.prepare('DELETE FROM project_members WHERE user_id = ?').run(PRIYA);
    await api.capture(alex, HENDRICKS_GROUP);
    await api.settle(priyaLive);

    expect(priyaLive.ids()).toEqual([]);
  });
});

describe('catching up after a dropped connection', () => {
  it('replays exactly what was missed: nothing missing, nothing repeated, in order', async () => {
    const first = api.connect({ token: alex });
    const { epoch } = await first.next('ready');
    await first.next('snapshot');
    await api.capture(alex, HENDRICKS_GROUP, 'seen before the drop');
    const { cursor } = await first.next('measurements');
    await first.close();

    // while away: three of alex's, and one in a project alex can't see.
    const missed = [
      (await api.capture(alex, HENDRICKS_GROUP, 'missed 1')).body.id,
      (await api.capture(sam, MAPLE_GROUP, 'not mine')).body.id,
      (await api.capture(priya, HENDRICKS_GROUP, 'missed 2')).body.id,
      (await api.capture(alex, UNIT_4B_GROUP, 'missed 3')).body.id,
    ];

    const second = api.connect({ token: alex, epoch, cursor });
    await second.next('ready');
    await second.next('measurements', (m) => m.cursor === missed[3]);
    // and it is live again afterwards.
    const { body: after } = await api.capture(alex, HENDRICKS_GROUP, 'after');
    await second.next('measurements', (m) => m.cursor === after.id);

    expect(second.messages.some((m) => m.type === 'snapshot')).toBe(false);
    expect(second.ids()).toEqual([missed[0], missed[2], missed[3], after.id]);
  });

  it('sends nothing when nothing was missed, but still moves the cursor on', async () => {
    const first = api.connect({ token: alex });
    const { epoch } = await first.next('ready');
    const { cursor } = await first.next('snapshot');
    await first.close();
    const { body } = await api.capture(sam, MAPLE_GROUP); // not visible to alex

    const second = api.connect({ token: alex, epoch, cursor });
    const message = await second.next('measurements');
    expect(message).toEqual({ type: 'measurements', items: [], cursor: body.id });
  });

  it('replays a long backlog completely', async () => {
    const first = api.connect({ token: alex });
    const { epoch } = await first.next('ready');
    const { cursor } = await first.next('snapshot');
    await first.close();

    const insert = api.db.prepare(
      `INSERT INTO measurements (group_id, value, label, device_id, created_at, created_by)
       VALUES (?, 100, 'bulk', 'TP-BULK', ?, ?)`,
    );
    for (let i = 0; i < 1203; i++) insert.run(HENDRICKS_GROUP, Date.now(), ALEX);

    const second = api.connect({ token: alex, epoch, cursor });
    await second.next('measurements', (m) => m.cursor === cursor + 1203);
    expect(second.ids()).toEqual(Array.from({ length: 1203 }, (_, i) => cursor + 1 + i));
  });

  it('sends a fresh snapshot to connected clients when the data is reset', async () => {
    const live = api.connect({ token: alex });
    const before = await live.next('ready');
    await live.next('snapshot');
    await api.capture(alex, HENDRICKS_GROUP);
    await live.next('measurements');

    await api.request('/dev/reset', { method: 'POST', token: alex });

    const after = await live.next('ready', (m) => m.epoch !== before.epoch);
    expect(after.epoch).not.toBe(before.epoch);
    const snapshots = live.messages.filter((m) => m.type === 'snapshot');
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].cursor).toBe(SEEDED_MEASUREMENTS);

    // ids started over, so the next one is below the old cursor. it must still arrive.
    const { body } = await api.capture(alex, HENDRICKS_GROUP, 'after reset');
    expect(body.id).toBe(SEEDED_MEASUREMENTS + 1);
    await live.next('measurements', (m) => m.items[0]?.label === 'after reset');
  });

  it('sends a snapshot instead of a replay when the cursor is from before a reset', async () => {
    const first = api.connect({ token: alex });
    const { epoch } = await first.next('ready');
    await first.next('snapshot');
    for (let i = 0; i < 5; i++) await api.capture(alex, HENDRICKS_GROUP);
    const { cursor } = await first.next(
      'measurements',
      (m) => m.cursor === SEEDED_MEASUREMENTS + 5,
    );
    await first.close();

    await api.request('/dev/reset', { method: 'POST', token: alex });
    await api.capture(alex, HENDRICKS_GROUP, 'after reset');

    const second = api.connect({ token: alex, epoch, cursor });
    const snapshot = await second.next('snapshot');
    expect(snapshot.items[0].label).toBe('after reset');
    expect(second.ids()).toEqual([]);
  });

  it('survives an API restart on the same database', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { openDb } = await import('../src/db');
    const { createSessions } = await import('../src/auth');
    const { Hub } = await import('../src/hub');
    const dir = mkdtempSync(join(tmpdir(), 'kerf-'));
    try {
      const path = join(dir, 'kerf.db');
      const received: unknown[] = [];
      const client = (userId: number) => ({
        user: { id: userId, name: 'Alex', username: 'alex' },
        sessionId: 1,
        send: (m: unknown) => received.push(m),
        close: () => {},
      });

      let db = openDb(path);
      new Hub(db).connect(client(ALEX));
      const ready = received[0] as { epoch: string };
      const { cursor } = received[1] as { cursor: number };
      const token = createSessions(db).create(ALEX);
      db.close();

      // "restart": a new process opens the same file. sessions and the epoch are still there.
      db = openDb(path);
      expect(createSessions(db).find(token)?.user.id).toBe(ALEX);
      db.prepare(
        `INSERT INTO measurements (group_id, value, label, device_id, created_at, created_by)
         VALUES (1, 100, 'while down', 'TP', 0, 1)`,
      ).run();
      received.length = 0;
      new Hub(db).connect(client(ALEX), ready.epoch, cursor);
      db.close();

      expect(received[0]).toMatchObject({ type: 'ready', epoch: ready.epoch });
      expect(received[1]).toMatchObject({
        type: 'measurements',
        cursor: cursor + 1,
        items: [{ label: 'while down' }],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("who's online", () => {
  const names = (message: { users: { name: string }[] }) => message.users.map((u) => u.name);

  it('shows people who share a project with you, and nobody else', async () => {
    const alexLive = api.connect({ token: alex });
    expect(names(await alexLive.next('presence'))).toEqual(['Alex']);

    const samLive = api.connect({ token: sam });
    expect(names(await samLive.next('presence'))).toEqual(['Sam']);

    const priyaLive = api.connect({ token: priya });
    expect(names(await priyaLive.next('presence'))).toEqual(['Priya', 'Alex']);
    expect(names(await alexLive.next('presence', (m) => m.users.length === 2))).toEqual([
      'Alex',
      'Priya',
    ]);

    // sam shares nothing with either of them: no update, and never sees them.
    await api.settle(samLive);
    expect(samLive.messages.filter((m) => m.type === 'presence')).toHaveLength(1);
  });

  it('shows someone on two devices once, and keeps them online until the last one closes', async () => {
    const alexLive = api.connect({ token: alex });
    await alexLive.next('presence');

    const phone = api.connect({ token: priya });
    const laptop = api.connect({ token: await api.login('priya') });
    await Promise.all([phone.next('presence'), laptop.next('presence')]);
    expect(names(await alexLive.next('presence', (m) => m.users.length === 2))).toEqual([
      'Alex',
      'Priya',
    ]);

    await phone.close();
    await api.settle(alexLive);
    expect(alexLive.messages.filter((m) => m.type === 'presence')).toHaveLength(2);
    expect(api.hub.isOnline(PRIYA)).toBe(true);

    await laptop.close();
    expect(names(await alexLive.next('presence', (m) => m.users.length === 1))).toEqual(['Alex']);
    expect(api.hub.isOnline(PRIYA)).toBe(false);
  });

  it('takes you offline when you sign out, and closes that live connection', async () => {
    const alexLive = api.connect({ token: alex });
    const priyaLive = api.connect({ token: priya });
    await alexLive.next('presence', (m) => m.users.length === 2);

    await api.request('/auth/logout', { method: 'POST', token: priya });

    expect(await priyaLive.closed).toBe(LiveClose.Unauthorized);
    await alexLive.next('presence', (m) => m.users.length === 1);
    expect(api.hub.isOnline(SAM)).toBe(false);
  });
});

describe('a device that just disappears', () => {
  it('drops off after the timeout, while a device that keeps pinging stays', async () => {
    await api.stop();
    api = await startApi({ live: { timeoutMs: 300, sweepMs: 50 } });
    [alex, priya] = await Promise.all([api.login('alex'), api.login('priya')]);

    const alexLive = api.connect({ token: alex });
    const pinger = setInterval(() => alexLive.send({ type: 'ping' }), 100);
    try {
      // priya's socket stays open but goes silent, like a laptop with its lid shut.
      const priyaLive = api.connect({ token: priya });
      await alexLive.next('presence', (m) => m.users.length === 2);

      const started = Date.now();
      await alexLive.next('presence', (m) => m.users.length === 1);
      expect(Date.now() - started).toBeGreaterThanOrEqual(250);
      expect(Date.now() - started).toBeLessThan(1500);
      await priyaLive.closed;
      expect(api.hub.isOnline(PRIYA)).toBe(false);
      expect(api.hub.isOnline(ALEX)).toBe(true);
    } finally {
      clearInterval(pinger);
    }
  });

  it('drops a socket that connects and never says hello', async () => {
    await api.stop();
    api = await startApi({ live: { timeoutMs: 200, sweepMs: 50 } });
    const silent = api.connect(false);
    expect(await silent.closed).toBe(1006);
  });
});
