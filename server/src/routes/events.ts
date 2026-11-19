import { Router } from 'express';
import { bus, type RealtimeEvent } from '../lib/bus.js';
import { verifyAdminToken } from '../middleware/auth.js';
import { unauthorized } from '../lib/errors.js';

const router = Router();

/**
 * GET /api/events?token=<jwt>
 * Server-sent events: spin created / completed, device heartbeat, settings.
 * EventSource cannot send headers, hence the query token.
 */
router.get('/', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  try {
    verifyAdminToken(token);
  } catch {
    throw unauthorized('INVALID_TOKEN', 'Realtime stream requires a valid admin session.');
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const onEvent = (event: RealtimeEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  };
  bus.on('event', onEvent);

  const keepAlive = setInterval(() => {
    res.write(': ping\n\n');
  }, 25_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    bus.off('event', onEvent);
    res.end();
  });
});

export default router;
