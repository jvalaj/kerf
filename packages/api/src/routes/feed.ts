import { Router } from 'express';

import { type Hub, SNAPSHOT_SIZE } from '../hub';

export function feedRouter(hub: Hub) {
  const router = Router();

  // dashboard uses the live socket; this endpoint stays for other api clients
  router.get('/feed', (req, res) => {
    res.json(hub.latestFor(req.userId, SNAPSHOT_SIZE));
  });

  return router;
}
