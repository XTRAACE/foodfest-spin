import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { asyncHandler } from '../http/async.js';
import { registerCustomer } from '../services/customers.js';
import { listPrizes } from '../services/prizes.js';
import { getSettings } from '../services/settings.js';
import { completeSpin, createSpin, currentWheelState } from '../services/spins.js';
import { conflict } from '../lib/errors.js';
import { numberLabel, type SpinDTO } from '../lib/serialize.js';

const router = Router();

const mobileSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^[0-9]{10,15}$/.test(value), {
    message: 'Mobile number must be 10 to 15 digits.',
  });

export const COURSES = ['Science', 'Commerce', 'Arts'] as const;
export const CLASSES = ['+1', '+2'] as const;

const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null));

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  mobile: mobileSchema.optional(),
  rollNo: optionalText(20),
  course: z.enum(COURSES).optional(),
  classLevel: z.enum(CLASSES).optional(),
});

router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const db = await getDb();
    const settings = await getSettings(db);
    const counted = await db.query<{ count: string }>(
      `select count(*)::text as count from customers where mode = 'real' and is_active = true`,
    );

    res.json({
      ok: true,
      eventName: settings.eventName,
      eventStatus: settings.eventStatus,
      mode: settings.mode,
      registrationOpen: settings.registrationOpen && settings.eventStatus === 'active',
      registeredCustomers: Number(counted[0]?.count ?? 0),
      duplicateMobileRule: settings.duplicateMobileRule,
      courses: COURSES,
      classes: CLASSES,
    });
  }),
);

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.parse(req.body);
    const result = await registerCustomer({
      name: parsed.name,
      mobile: parsed.mobile ?? null,
      rollNo: parsed.rollNo,
      course: parsed.course ?? null,
      classLevel: parsed.classLevel ?? null,
    });

    res.status(201).json({
      ok: true,
      customer: result.customer,
      groupNumber: result.groupNumber,
      groupComplete: result.groupComplete,
      selected: result.selected,
      selectedCustomerNumber: result.selectedCustomerNumber,
      selectedCustomer: result.selectedCustomer,
    });
  }),
);

/** Public participation list: numbers and academic details only, no contacts. */
router.get(
  '/participants',
  asyncHandler(async (_req, res) => {
    const db = await getDb();
    const rows = await db.query<Record<string, any>>(
      `select customer_number, group_number, name, roll_no, course, class_level
         from customers
        where mode = 'real' and is_active = true
        order by customer_number asc
        limit 1000`,
    );

    const counted = await db.query<{ count: string }>(
      `select count(*)::text as count from customers where mode = 'real' and is_active = true`,
    );

    res.json({
      ok: true,
      count: Number(counted[0]?.count ?? 0),
      participants: rows.map((row) => ({
        numberLabel: numberLabel(row.customer_number),
        groupNumber: Number(row.group_number),
        name: row.name as string,
        rollNo: (row.roll_no as string | null) ?? null,
        course: (row.course as string | null) ?? null,
        classLevel: (row.class_level as string | null) ?? null,
      })),
    });
  }),
);

const publicSpinSchema = z.object({
  customer_number: z.coerce.number().int().min(1),
  spin_id: z.string().trim().min(4).max(80),
});

/** Only the fields the phone wheel needs – no weights or stock internals. */
function publicSpin(spin: SpinDTO) {
  const durationMs = spin.animationMs ?? 6400;
  const requestedAt = spin.requestedAt ? new Date(spin.requestedAt).getTime() : Date.now();
  return {
    code: spin.code,
    status: spin.status,
    customerNumber: spin.customerNumber,
    customerNumberLabel: spin.customerNumberLabel,
    customerName: spin.customerName,
    prizeId: spin.prizeId,
    prizeName: spin.prizeName,
    wheelAngle: spin.wheelAngle,
    durationMs,
    // Time left so a phone joining mid-spin lands together with the machine.
    remainingMs: Math.max(0, durationMs - (Date.now() - requestedAt)),
  };
}

/** State for the customer-facing wheel page. */
router.get(
  '/lucky/current',
  asyncHandler(async (_req, res) => {
    const state = await currentWheelState();
    res.json({
      ok: true,
      eventName: state.settings.eventName,
      eventStatus: state.settings.eventStatus,
      mode: state.settings.mode,
      readyCustomer: state.readyCustomer,
      wheel: state.wheel,
      pendingSpin: state.pendingSpin ? publicSpin(state.pendingSpin) : null,
    });
  }),
);

/**
 * Starts the spin for the selected customer from their phone.
 * The prize was already chosen and stored by the backend before this call
 * returns; the phone only animates to the angle it receives. `spin_id` is the
 * phone's idempotency key, so a retry can never create a second spin.
 */
router.post(
  '/spin',
  asyncHandler(async (req, res) => {
    const body = publicSpinSchema.parse(req.body);
    const state = await currentWheelState();

    if (state.settings.mode !== 'real') {
      throw conflict('DEMO_MODE', 'The public wheel only spins during the real event.');
    }
    if (state.settings.eventStatus !== 'active') {
      throw conflict('EVENT_NOT_ACTIVE', 'The event is not active right now.');
    }
    if (state.pendingSpin) {
      // A retry for the customer whose spin is already pending is fine: the
      // idempotency key below (or the backend's pending-spin reuse) returns it.
      if (state.pendingSpin.customerNumber !== body.customer_number) {
        throw conflict('SPIN_ALREADY_PENDING', 'A spin is already in progress.');
      }
    } else if (!state.readyCustomer) {
      throw conflict(
        'NO_CUSTOMER_READY',
        'No customer is selected yet. Every three registrations complete a group.',
      );
    } else if (state.readyCustomer.number !== body.customer_number) {
      throw conflict('NO_CUSTOMER_READY', 'Another customer is selected right now.');
    }

    const result = await createSpin({
      mode: 'real',
      source: 'site',
      actor: 'site',
      idempotencyKey: `site:${body.customer_number}:${body.spin_id}`,
    });

    res.json({
      ok: true,
      reused: result.reused,
      spin: publicSpin(result.spin),
      wheel: result.wheel,
    });
  }),
);

/** Called by the phone once the wheel has stopped; deducts stock exactly once. */
router.post(
  '/spin/:code/complete',
  asyncHandler(async (req, res) => {
    const spin = await completeSpin({ spinCode: String(req.params.code), actor: 'site' });
    res.json({
      ok: true,
      spin_id: spin.code,
      status: spin.status,
      prize_name: spin.prizeName,
      stock_deducted: spin.stockDeducted,
    });
  }),
);

router.get(
  '/prizes',
  asyncHandler(async (_req, res) => {
    const prizes = await listPrizes();
    res.json({
      ok: true,
      prizes: prizes
        .filter((prize) => prize.isEnabled)
        .map((prize) => ({
          id: prize.id,
          name: prize.name,
          description: prize.description,
          imageUrl: prize.imageUrl,
          color: prize.color,
        })),
    });
  }),
);

export default router;
