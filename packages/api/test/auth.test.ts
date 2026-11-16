import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Api, startApi } from './harness';

let api: Api;
beforeEach(async () => {
  api = await startApi({ loginLimit: { maxFailures: 3, windowMs: 60_000 } });
});
afterEach(() => api.stop());

function login(username: string, password: string) {
  return api.request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

describe('sign-in', () => {
  it('signs in with a username and password and returns who you are', async () => {
    const res = await login('alex', 'kerf-alex-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({ id: 1, name: 'Alex', username: 'alex' });
    expect(body.token).toMatch(/^[\w-]{43}$/);

    const me = await api.request('/me', { token: body.token });
    expect(await me.json()).toEqual({ id: 1, name: 'Alex', username: 'alex' });
  });

  it('ignores case and surrounding spaces in the username', async () => {
    expect((await login('  Priya ', 'kerf-priya-3')).status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown user', async () => {
    const wrong = await login('alex', 'nope');
    const unknown = await login('nobody', 'nope');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('rejects a body without both fields', async () => {
    expect((await login('alex', '')).status).toBe(400);
    const res = await api.request('/auth/login', { method: 'POST', body: '{}' });
    expect(res.status).toBe(400);
  });

  it('locks out after repeated failures, even for the right password', async () => {
    for (let i = 0; i < 3; i++) expect((await login('sam', 'guess')).status).toBe(401);
    const res = await login('sam', 'kerf-sam-2');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    // other accounts are unaffected.
    expect((await login('alex', 'kerf-alex-1')).status).toBe(200);
  });

  it('stores neither passwords nor session tokens in the clear', async () => {
    const token = await api.login('alex');
    const dump = JSON.stringify([
      api.db.prepare('SELECT * FROM users').all(),
      api.db.prepare('SELECT * FROM sessions').all(),
    ]);
    expect(dump).not.toContain('kerf-alex-1');
    expect(dump).not.toContain(token);
  });
});

describe('sessions', () => {
  it('rejects requests without a valid token', async () => {
    expect((await api.request('/projects')).status).toBe(401);
    expect((await api.request('/projects', { token: 'made-up' })).status).toBe(401);
  });

  it('no longer accepts the old fixed tokens', async () => {
    expect((await api.request('/projects', { token: 'alex-7f3c2a91' })).status).toBe(401);
  });

  it('signing out ends that session and leaves other devices signed in', async () => {
    const phone = await api.login('alex');
    const laptop = await api.login('alex');
    expect(phone).not.toBe(laptop);

    expect((await api.request('/auth/logout', { method: 'POST', token: phone })).status).toBe(200);
    expect((await api.request('/me', { token: phone })).status).toBe(401);
    expect((await api.request('/me', { token: laptop })).status).toBe(200);
  });
});

describe('project access', () => {
  it('lists only your own projects', async () => {
    const names = async (who: 'alex' | 'sam' | 'priya') => {
      const res = await api.request('/projects', { token: await api.login(who) });
      return ((await res.json()) as { name: string }[]).map((p) => p.name);
    };
    expect(await names('alex')).toEqual([
      'Hendricks Kitchen Remodel',
      'Unit 4B Flooring',
      'Garage Shelving',
    ]);
    expect(await names('priya')).toEqual(['Hendricks Kitchen Remodel']);
    expect(await names('sam')).toEqual(['Maple St Deck']);
  });

  it("answers 404 for a project or group you're not in, as if it didn't exist", async () => {
    const sam = await api.login('sam');
    expect((await api.request('/projects/1/measurements', { token: sam })).status).toBe(404);
    expect((await api.capture(sam, 1)).status).toBe(404);
    expect((await api.request('/projects/999/measurements', { token: sam })).status).toBe(404);
  });

  it('validates new measurements', async () => {
    const alex = await api.login('alex');
    const post = (body: unknown) =>
      api.request('/groups/1/measurements', {
        method: 'POST',
        token: alex,
        body: JSON.stringify(body),
      });
    expect((await post({ value: 0, label: 'x' })).status).toBe(400);
    expect((await post({ value: 1.5, label: 'x' })).status).toBe(400);
    expect((await post({ value: 10, label: '  ' })).status).toBe(400);
    expect((await post({ value: 10, label: 'x'.repeat(201) })).status).toBe(400);
    expect((await post({ value: 10, label: 'ok' })).status).toBe(201);
  });
});

describe('dev tools', () => {
  it('reset keeps people signed in', async () => {
    const alex = await api.login('alex');
    await api.capture(alex, 1);
    expect((await api.request('/dev/reset', { method: 'POST', token: alex })).status).toBe(200);
    const res = await api.request('/projects', { token: alex });
    expect(res.status).toBe(200);
    const projects = (await res.json()) as { measurementCount: number }[];
    expect(projects.reduce((n, p) => n + p.measurementCount, 0)).toBe(30);
  });

  it('is not served in production', async () => {
    const prod = await startApi({ devTools: false });
    const token = await prod.login('alex');
    expect((await prod.request('/dev/reset', { method: 'POST', token })).status).toBe(404);
    await prod.stop();
  });
});
