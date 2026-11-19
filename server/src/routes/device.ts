import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../http/async.js';
import { badRequest } from '../lib/errors.js';
import { requireDevice } from '../middleware/auth.js';
import {
  ackCommand,
  assertDeviceId,
  getDeviceCurrent,
  pendingCommands,
  recordHeartbeat,
} from '../services/devices.js';
import { completeSpin, createSpin } from '../services/spins.js';

const router = Router();

router.use(requireDevice);

/** GET /api/device/current – what the machine should show / do right now. */
router.get(
  '/current',
  asyncHandler(async (req, res) => {
    res.json(await getDeviceCurrent(req.device?.deviceId));
  }),
);

/**
 * POST /api/device/spin/start
 * The joystick press lands here. `spin_id` is the firmware's idempotency key so
 * a retried request after a Wi-Fi drop never creates a second spin.
 */
router.post(
  '/spin/start',
  asyncHandler(async (req, res) => {
    const deviceId = assertDeviceId(req.body?.device_id, req.device!.deviceId);
    if (deviceId !== req.device!.deviceId) {
      throw badRequest('DEVICE_ID_MISMATCH', 'device_id does not match the authenticated device.');
    }

    const deviceSpinId = typeof req.body?.spin_id === 'string' ? req.body.spin_id.trim() : '';
    const idempotencyKey = deviceSpinId ? `device:${deviceId}:${deviceSpinId}` : null;

    // The ESP32 owns the show timing: it reports how long its animation takes so
    // phones mirroring the spin animate over the same interval.
    const reportedMs = Number(req.body?.animation_ms);
    const animationMs =
      Number.isFinite(reportedMs) && reportedMs >= 500 && reportedMs <= 60000
        ? Math.round(reportedMs)
        : null;

    const result = await createSpin({
      source: 'device',
      deviceId,
      idempotencyKey,
      animationMs,
      actor: `device:${deviceId}`,
    });

    res.json({
      ok: true,
      spin_id: result.spin.code,
      customer_number: result.spin.customerNumber,
      customer_number_label: result.spin.customerNumberLabel,
      customer_name: result.spin.customerName,
      prize_name: result.spin.prizeName,
      target_angle: result.spin.servoAngle,
      wheel_angle: result.spin.wheelAngle,
      animation_ms: result.spin.animationMs,
      mode: result.spin.mode,
      reused: result.reused,
    });
  }),
);

/** POST /api/device/spin/complete – called once the arrow has physically stopped. */
router.post(
  '/spin/complete',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      spin_id: z.string().min(1),
      device_id: z.string().min(1).optional(),
      prize_name: z.string().optional(),
      target_angle: z.number().optional(),
      mode: z.enum(['demo', 'real']).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('VALIDATION_ERROR', 'spin_id is required.');
    }
    if (parsed.data.device_id && parsed.data.device_id !== req.device!.deviceId) {
      throw badRequest('DEVICE_ID_MISMATCH', 'device_id does not match the authenticated device.');
    }

    const spin = await completeSpin({
      spinCode: parsed.data.spin_id,
      deviceId: req.device!.deviceId,
      actor: `device:${req.device!.deviceId}`,
      reportedPrizeName: parsed.data.prize_name ?? null,
    });

    res.json({
      ok: true,
      spin_id: spin.code,
      status: spin.status,
      prize_name: spin.prizeName,
      stock_deducted: spin.stockDeducted,
      completed_at: spin.completedAt,
    });
  }),
);

/** POST /api/device/heartbeat */
router.post(
  '/heartbeat',
  asyncHandler(async (req, res) => {
    const device = await recordHeartbeat(
      {
        deviceId: assertDeviceId(req.body?.device_id, req.device!.deviceId),
        firmwareVersion: typeof req.body?.firmware_version === 'string' ? req.body.firmware_version : null,
        ipAddress: req.ip ?? null,
      },
      req.headers['x-device-token'] as string | undefined,
    );

    res.json({ ok: true, device_id: device.deviceId, status: device.status, server_time: new Date().toISOString() });
  }),
);

/** GET /api/device/commands – pending test commands queued by the admin. */
router.get(
  '/commands',
  asyncHandler(async (req, res) => {
    res.json({ ok: true, commands: await pendingCommands(req.device!.deviceId) });
  }),
);

/** POST /api/device/commands/:id/ack */
router.post(
  '/commands/:id/ack',
  asyncHandler(async (req, res) => {
    await ackCommand(req.device!.deviceId, req.params.id!);
    res.json({ ok: true });
  }),
);

export default router;
