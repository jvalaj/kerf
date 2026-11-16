import express from 'express';

import { accountRouter, type LoginLimit, loginRouter, requireUser, type Sessions } from './auth';
import { type Db, resetDb } from './db';
import type { Hub } from './hub';
import { exportRouter } from './routes/export';
import { feedRouter } from './routes/feed';
import { measurementsRouter } from './routes/measurements';
import { projectsRouter } from './routes/projects';

export interface AppOptions {
  loginLimit?: LoginLimit;
  // only turn on /dev/reset while developing
  devTools?: boolean;
}

export function createApp(db: Db, sessions: Sessions, hub: Hub, options: AppOptions = {}) {
  const { devTools = process.env.NODE_ENV !== 'production' } = options;
  const app = express();
  app.use(express.json());

  // app and api run on different ports, so allow any origin (we use bearer tokens, not cookies)
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
    res.set(
      'Access-Control-Allow-Headers',
      req.get('access-control-request-headers') ?? 'authorization, content-type',
    );
    res.set('Access-Control-Expose-Headers', 'Content-Disposition');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(loginRouter(db, sessions, options.loginLimit));
  app.use(requireUser(sessions));
  app.use(accountRouter(db, sessions, hub));

  if (devTools) {
    app.post('/dev/reset', (_req, res) => {
      resetDb(db);
      // dashboards may be holding old rows; send them fresh data
      hub.resyncAll();
      res.json({ ok: true });
    });
  }

  app.use(projectsRouter(db));
  app.use(measurementsRouter(db, hub));
  app.use(feedRouter(hub));
  app.use(exportRouter(db));

  return app;
}
