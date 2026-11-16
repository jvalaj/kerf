import { createHash, randomBytes } from 'node:crypto';

import type { AuthUser, LoginResponse } from '@kerf/shared';
import { type NextFunction, type Request, type Response, Router } from 'express';

import type { Db } from './db';
import type { Hub } from './hub';
import { DUMMY_HASH, verifyPassword } from './passwords';

declare global {
  namespace Express {
    interface Request {
      userId: number;
      sessionId: number;
    }
  }
}

export interface Session {
  sessionId: number;
  user: AuthUser;
}

export type Sessions = ReturnType<typeof createSessions>;

// store hash of token only, so a stolen database cannot be used to sign in
function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSessions(db: Db) {
  const insert = db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)',
  );
  const find = db.prepare(`
    SELECT s.id AS sessionId, u.id, u.name, u.username
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `);
  const remove = db.prepare('DELETE FROM sessions WHERE id = ?');

  return {
    create(userId: number): string {
      const token = randomBytes(32).toString('base64url');
      insert.run(hashToken(token), userId, Date.now());
      return token;
    },
    find(token: unknown): Session | undefined {
      if (typeof token !== 'string' || !token) return undefined;
      const row = find.get(hashToken(token)) as
        | { sessionId: number; id: number; name: string; username: string }
        | undefined;
      if (!row) return undefined;
      return {
        sessionId: row.sessionId,
        user: { id: row.id, name: row.name, username: row.username },
      };
    },
    revoke(sessionId: number) {
      remove.run(sessionId);
    },
  };
}

export function requireUser(sessions: Sessions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.get('authorization') ?? '';
    // look up session from the bearer token
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const session = sessions.find(match?.[1]);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.userId = session.user.id;
    req.sessionId = session.sessionId;
    next();
  };
}

export interface LoginLimit {
  maxFailures: number;
  windowMs: number;
}

const DEFAULT_LOGIN_LIMIT: LoginLimit = { maxFailures: 5, windowMs: 60_000 };

// stop people guessing passwords; kept in memory for one api process
function createFailureLimiter({ maxFailures, windowMs }: LoginLimit) {
  const failures = new Map<string, { count: number; resetAt: number }>();
  return {
    retryAfterMs(key: string): number {
      const entry = failures.get(key);
      if (!entry) return 0;
      const now = Date.now();
      if (entry.resetAt <= now) {
        failures.delete(key);
        return 0;
      }
      return entry.count >= maxFailures ? entry.resetAt - now : 0;
    },
    fail(key: string) {
      const now = Date.now();
      if (failures.size > 10_000) {
        for (const [k, entry] of failures) {
          if (entry.resetAt <= now) failures.delete(k);
        }
      }
      const entry = failures.get(key);
      if (entry && entry.resetAt > now) entry.count += 1;
      else failures.set(key, { count: 1, resetAt: now + windowMs });
    },
    clear(key: string) {
      failures.delete(key);
    },
  };
}

// login works without a session already
export function loginRouter(db: Db, sessions: Sessions, limit = DEFAULT_LOGIN_LIMIT) {
  const router = Router();
  const limiter = createFailureLimiter(limit);
  const findUser = db.prepare(
    'SELECT id, name, username, password_hash FROM users WHERE username = ?',
  );

  router.post('/auth/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }
    const name = username.trim();
    const key = `${req.ip}|${name.toLowerCase()}`;
    const retryAfterMs = limiter.retryAfterMs(key);
    if (retryAfterMs > 0) {
      res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
      return;
    }

    const user = findUser.get(name) as
      | { id: number; name: string; username: string; password_hash: string }
      | undefined;
    // always check a password so wrong user and wrong password take the same time
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      limiter.fail(key);
      res.status(401).json({ error: 'Incorrect username or password' });
      return;
    }
    limiter.clear(key);

    const body: LoginResponse = {
      token: sessions.create(user.id),
      user: { id: user.id, name: user.name, username: user.username },
    };
    res.json(body);
  });

  return router;
}

// routes that need a signed-in user
export function accountRouter(db: Db, sessions: Sessions, hub: Hub) {
  const router = Router();
  const findUser = db.prepare('SELECT id, name, username FROM users WHERE id = ?');

  router.get('/me', (req, res) => {
    res.json(findUser.get(req.userId));
  });

  router.post('/auth/logout', (req, res) => {
    sessions.revoke(req.sessionId);
    // also close live sockets for this session
    hub.closeSession(req.sessionId);
    res.json({ ok: true });
  });

  return router;
}
