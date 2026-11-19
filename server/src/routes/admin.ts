import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { asyncHandler } from '../http/async.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { Mode } from '../lib/serialize.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import {
  createCustomerManually,
  deleteAllCustomers,
  deleteCustomer,
  listCustomers,
  listGroups,
  updateCustomer,
} from '../services/customers.js';
import { demoGroupsReady, resetDemo } from '../services/demo.js';
import {
  enqueueCommand,
  getPrimaryDevice,
  isOnline,
  listDevices,
  recentCommands,
} from '../services/devices.js';
import {
  createCategory,
  createPrize,
  deletePrize,
  listCategories,
  listPrizes,
  prizeStockSummary,
  updateCategory,
  updatePrize,
} from '../services/prizes.js';
import { getSettings, updateSettings } from '../services/settings.js';
import {
  cancelSpin,
  completeSpin,
  createSpin,
  currentWheelState,
  listSpins,
} from '../services/spins.js';
import { getDashboardStats } from '../services/stats.js';

const router = Router();
const actorOf = (req: { admin?: { email: string; name: string } }) =>
  req.admin?.email ?? 'admin';

const modeSchema = z.enum(['demo', 'real']);
const modeQuery = (value: unknown): Mode => (value === 'demo' ? 'demo' : 'real');

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const mode = modeQuery(req.query.mode);
    const stats = await getDashboardStats(mode);
    res.json({ ok: true, ...stats });
  }),
);

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
router.get(
  '/customers',
  asyncHandler(async (req, res) => {
    const customers = await listCustomers({
      mode: modeQuery(req.query.mode),
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      groupNumber: req.query.group ? Number(req.query.group) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ ok: true, customers });
  }),
);

const courseSchema = z.enum(['Science', 'Commerce', 'Arts']);
const classLevelSchema = z.enum(['+1', '+2']);
const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.literal(''), z.null()])
    .optional()
    .transform((value) => (value ? value : null));

const customerInput = z.object({
  name: z.string().trim().min(2).max(80),
  mobile: z.string().trim().regex(/^[0-9]{10,15}$/, 'Mobile number must be 10 to 15 digits').optional(),
  rollNo: optionalText(20),
  course: courseSchema.optional(),
  classLevel: classLevelSchema.optional(),
  mode: modeSchema.optional(),
});

router.post(
  '/customers',
  asyncHandler(async (req, res) => {
    const parsed = customerInput.parse(req.body);
    const customer = await createCustomerManually(
      {
        name: parsed.name,
        mobile: parsed.mobile ?? null,
        rollNo: parsed.rollNo,
        course: parsed.course ?? null,
        classLevel: parsed.classLevel ?? null,
        mode: parsed.mode ?? 'real',
      },
      actorOf(req),
    );
    res.status(201).json({ ok: true, customer });
  }),
);

router.patch(
  '/customers/:id',
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        mobile: z.union([z.string().trim().regex(/^[0-9]{10,15}$/), z.literal(''), z.null()]).optional(),
        rollNo: optionalText(20),
        course: z.union([courseSchema, z.literal(''), z.null()]).optional(),
        classLevel: z.union([classLevelSchema, z.literal(''), z.null()]).optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);

    const customer = await updateCustomer(
      req.params.id!,
      {
        ...parsed,
        mobile: parsed.mobile === '' ? null : parsed.mobile,
        course: parsed.course === '' ? null : parsed.course,
        classLevel: parsed.classLevel === '' ? null : parsed.classLevel,
      },
      actorOf(req),
    );
    res.json({ ok: true, customer });
  }),
);

router.delete(
  '/customers',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const mode = modeQuery(req.query.mode);
    const result = await deleteAllCustomers(mode, actorOf(req));
    await logAudit(await getDb(), {
      actor: actorOf(req),
      action: 'customers.deleted_all',
      entity: 'customer',
      details: { mode, deleted: result.deleted },
    });
    res.json({ ok: true, ...result });
  }),
);

router.delete(
  '/customers/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const result = await deleteCustomer(req.params.id!, actorOf(req));
    res.json({ ok: true, ...result });
  }),
);

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
router.get(
  '/groups',
  asyncHandler(async (req, res) => {
    const groups = await listGroups(modeQuery(req.query.mode));
    res.json({ ok: true, groups });
  }),
);

// ---------------------------------------------------------------------------
// Prizes
// ---------------------------------------------------------------------------
router.get(
  '/prizes',
  asyncHandler(async (req, res) => {
    const prizes = await listPrizes();
    const mode = modeQuery(req.query.mode);
    res.json({
      ok: true,
      prizes,
      categories: await listCategories(),
      summary: await prizeStockSummary(mode),
      eligibility: await prizeStockSummary((req.query.eligibility as Mode) ?? mode),
    });
  }),
);

const categoryInput = z.object({ name: z.string().trim().min(1).max(30) });

router.post(
  '/categories',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = categoryInput.parse(req.body);
    const category = await createCategory(parsed.name);
    await logAudit(await getDb(), {
      actor: actorOf(req),
      action: 'category.created',
      entity: 'prize_category',
      entityId: category.id,
      details: { name: category.name },
    });
    res.status(201).json({ ok: true, category });
  }),
);

router.patch(
  '/categories/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = categoryInput.partial().parse(req.body);
    const category = await updateCategory(req.params.id!, parsed);
    await logAudit(await getDb(), {
      actor: actorOf(req),
      action: 'category.updated',
      entity: 'prize_category',
      entityId: category.id,
      details: parsed as Record<string, unknown>,
    });
    res.json({ ok: true, category });
  }),
);

const prizeInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).nullable().optional(),
  imageUrl: z.union([z.string().trim().url(), z.literal(''), z.null()]).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  weight: z.number().int().min(0).max(1000).optional(),
  isEnabled: z.boolean().optional(),
  isUnlimited: z.boolean().optional(),
  isConsolation: z.boolean().optional(),
  servoAngle: z.number().int().min(0).max(180).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  realStock: z.number().int().min(0).max(1000000).optional(),
  demoStock: z.number().int().min(0).max(1000000).optional(),
});

router.post(
  '/prizes',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = prizeInput.parse(req.body);
    const prize = await createPrize({
      ...parsed,
      imageUrl: parsed.imageUrl === '' ? null : parsed.imageUrl ?? null,
    });
    await logAudit(await getDb(), {
      actor: actorOf(req),
      action: 'prize.created',
      entity: 'prize',
      entityId: prize.id,
      details: { name: prize.name },
    });
    res.status(201).json({ ok: true, prize });
  }),
);

router.patch(
  '/prizes/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = prizeInput.partial().parse(req.body);
    const prize = await updatePrize(req.params.id!, {
      ...parsed,
      imageUrl: parsed.imageUrl === '' ? null : parsed.imageUrl,
    });
    await logAudit(await getDb(), {
      actor: actorOf(req),
      action: 'prize.updated',
      entity: 'prize',
      entityId: prize.id,
      details: parsed as Record<string, unknown>,
    });
    res.json({ ok: true, prize });
  }),
);

router.delete(
  '/prizes/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await deletePrize(req.params.id!);
    await logAudit(await getDb(), {
      actor: actorOf(req),
      action: 'prize.deleted',
      entity: 'prize',
      entityId: req.params.id,
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Lucky spin
// ---------------------------------------------------------------------------
router.get(
  '/lucky/current',
  asyncHandler(async (_req, res) => {
    const state = await currentWheelState();
    res.json({ ok: true, ...state });
  }),
);

router.post(
  '/spins',
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        mode: modeSchema.optional(),
        groupId: z.string().uuid().optional(),
        customerId: z.string().uuid().optional(),
      })
      .parse(req.body ?? {});

    const result = await createSpin({
      mode: parsed.mode,
      groupId: parsed.groupId ?? null,
      customerId: parsed.customerId ?? null,
      source: 'admin',
      actor: actorOf(req),
    });

    await logAudit(await getDb(), {
      actor: actorOf(req),
      action: 'spin.created',
      entity: 'spin',
      entityId: result.spin.id,
      details: {
        code: result.spin.code,
        prize: result.spin.prizeName,
        customer: result.spin.customerName,
        mode: result.spin.mode,
      },
    });

    res.status(201).json({ ok: true, ...result });
  }),
);

router.get(
  '/spins',
  asyncHandler(async (req, res) => {
    const spins = await listSpins({
      mode: (req.query.mode as Mode | 'all' | undefined) ?? 'real',
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    });
    res.json({ ok: true, spins });
  }),
);

router.post(
  '/spins/:code/complete',
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({ prizeName: z.string().optional() })
      .parse(req.body ?? {});
    const spin = await completeSpin({
      spinCode: req.params.code!,
      actor: actorOf(req),
      reportedPrizeName: parsed.prizeName ?? null,
    });
    await logAudit(await getDb(), {
      actor: actorOf(req),
      action: 'spin.completed',
      entity: 'spin',
      entityId: spin.id,
      details: { code: spin.code, prize: spin.prizeName },
    });
    res.json({ ok: true, spin });
  }),
);

router.post(
  '/spins/:code/cancel',
  asyncHandler(async (req, res) => {
    const spin = await cancelSpin(req.params.code!, actorOf(req));
    res.json({ ok: true, spin });
  }),
);

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------
router.get(
  '/demo/groups',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, groups: await demoGroupsReady() });
  }),
);

router.post(
  '/demo/reset',
  asyncHandler(async (req, res) => {
    const result = await resetDemo();
    await logAudit(await getDb(), {
      actor: actorOf(req),
      action: 'demo.reset',
      entity: 'demo',
      details: result as unknown as Record<string, unknown>,
    });
    res.json({ ok: true, ...result });
  }),
);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    const admins = await (await getDb()).query<Record<string, any>>(
      `select id, email, name, role, is_active, created_at from admin_users order by created_at asc`,
    );
    res.json({
      ok: true,
      settings,
      admins: admins.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
      })),
    });
  }),
);

router.patch(
  '/settings',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        eventName: z.string().trim().min(1).max(80).optional(),
        eventStatus: z.enum(['active', 'paused', 'ended']).optional(),
        mode: modeSchema.optional(),
        registrationOpen: z.boolean().optional(),
        duplicateMobileRule: z.enum(['reject', 'allow']).optional(),
        deviceId: z.string().trim().min(1).max(60).optional(),
        servoMinAngle: z.number().int().min(0).max(179).optional(),
        servoMaxAngle: z.number().int().min(1).max(180).optional(),
      })
      .parse(req.body);

    const current = await getSettings();
    const min = parsed.servoMinAngle ?? current.servoMinAngle;
    const max = parsed.servoMaxAngle ?? current.servoMaxAngle;
    if (min >= max) {
      throw badRequest('INVALID_SERVO_RANGE', 'Servo minimum angle must be smaller than the maximum angle.');
    }

    const settings = await updateSettings(parsed);
    await logAudit(await getDb(), {
      actor: actorOf(req),
      action: 'settings.updated',
      entity: 'settings',
      details: parsed as Record<string, unknown>,
    });
    res.json({ ok: true, settings });
  }),
);

// ---------------------------------------------------------------------------
// Admin accounts
// ---------------------------------------------------------------------------
router.get(
  '/admins',
  asyncHandler(async (_req, res) => {
    const rows = await (await getDb()).query<Record<string, any>>(
      `select id, email, name, role, is_active, created_at from admin_users order by created_at asc`,
    );
    res.json({
      ok: true,
      admins: rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
      })),
    });
  }),
);

router.post(
  '/admins',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        email: z.string().trim().email(),
        name: z.string().trim().min(2).max(60),
        password: z.string().min(8).max(72),
        role: z.enum(['admin', 'operator']).default('operator'),
      })
      .parse(req.body);

    const db = await getDb();
    const existing = await db.query('select id from admin_users where lower(email) = $1', [
      parsed.email.toLowerCase(),
    ]);
    if (existing[0]) throw badRequest('EMAIL_IN_USE', 'An admin with this email already exists.');

    const hash = await bcrypt.hash(parsed.password, 10);
    const rows = await db.query<Record<string, any>>(
      `insert into admin_users (email, name, password_hash, role)
       values ($1, $2, $3, $4) returning id, email, name, role, is_active, created_at`,
      [parsed.email.toLowerCase(), parsed.name, hash, parsed.role],
    );
    await logAudit(db, {
      actor: actorOf(req),
      action: 'admin.created',
      entity: 'admin',
      entityId: rows[0]!.id,
      details: { email: parsed.email, role: parsed.role },
    });
    res.status(201).json({ ok: true, admin: rows[0] });
  }),
);

router.patch(
  '/admins/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(60).optional(),
        role: z.enum(['admin', 'operator']).optional(),
        isActive: z.boolean().optional(),
        password: z.string().min(8).max(72).optional(),
      })
      .parse(req.body);

    if (req.params.id === req.admin?.id && parsed.isActive === false) {
      throw badRequest('CANNOT_DISABLE_SELF', 'You cannot disable your own account.');
    }

    const db = await getDb();
    const sets: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (parsed.name !== undefined) assign('name', parsed.name);
    if (parsed.role !== undefined) assign('role', parsed.role);
    if (parsed.isActive !== undefined) assign('is_active', parsed.isActive);
    if (parsed.password !== undefined) assign('password_hash', await bcrypt.hash(parsed.password, 10));
    if (sets.length === 0) throw badRequest('NOTHING_TO_UPDATE', 'No fields to update.');

    values.push(req.params.id);
    const rows = await db.query<Record<string, any>>(
      `update admin_users set ${sets.join(', ')} where id = $${values.length}
       returning id, email, name, role, is_active, created_at`,
      values,
    );
    if (!rows[0]) throw notFound('ADMIN_NOT_FOUND', 'Admin account not found.');

    await logAudit(db, {
      actor: actorOf(req),
      action: 'admin.updated',
      entity: 'admin',
      entityId: req.params.id,
      details: { ...parsed, password: parsed.password ? 'changed' : undefined },
    });
    res.json({ ok: true, admin: rows[0] });
  }),
);

// ---------------------------------------------------------------------------
// Hardware control
// ---------------------------------------------------------------------------
router.get(
  '/device',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    const device = await getPrimaryDevice(settings.deviceId);
    const devices = await listDevices();
    const commands = device ? await recentCommands(device.deviceId) : [];

    const latestSpin = await (await getDb()).query<Record<string, any>>(
      `select * from spins order by requested_at desc limit 1`,
    );

    res.json({
      ok: true,
      online: isOnline(device),
      device,
      devices,
      commands,
      currentSpin: latestSpin[0]
        ? {
            code: latestSpin[0].spin_code,
            status: latestSpin[0].status,
            customerNumber: Number(latestSpin[0].customer_number),
            customerName: latestSpin[0].customer_name,
            prizeName: latestSpin[0].prize_name,
            servoAngle: Number(latestSpin[0].servo_angle),
            mode: latestSpin[0].mode,
            requestedAt: latestSpin[0].requested_at,
          }
        : null,
    });
  }),
);

router.post(
  '/device/commands',
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        type: z.enum(['oled', 'tm1637', 'servo', 'reset']),
        payload: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
      })
      .parse(req.body);

    const settings = await getSettings();
    const device = await getPrimaryDevice(settings.deviceId);
    if (!device) throw notFound('DEVICE_NOT_FOUND', 'No device is registered.');

    const command = await enqueueCommand(device.deviceId, parsed.type, parsed.payload);
    await logAudit(await getDb(), {
      actor: actorOf(req),
      action: 'device.command',
      entity: 'device',
      entityId: device.deviceId,
      details: { type: parsed.type, payload: parsed.payload },
    });
    res.status(201).json({ ok: true, command });
  }),
);

router.get(
  '/device/commands',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    res.json({ ok: true, commands: await recentCommands(settings.deviceId, 30) });
  }),
);

// ---------------------------------------------------------------------------
// Reports / CSV export
// ---------------------------------------------------------------------------
function toCsv(rows: Array<Record<string, unknown>>, columns: Array<[string, string]>): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = columns.map(([, label]) => escape(label)).join(',');
  const body = rows.map((row) => columns.map(([key]) => escape(row[key])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

router.get(
  '/reports/:type',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const type = req.params.type;
    const mode = modeQuery(req.query.mode);
    let rows: Array<Record<string, unknown>> = [];
    let columns: Array<[string, string]> = [];

    if (type === 'customers') {
      const data = await db.query<Record<string, any>>(
        `select c.customer_number, c.name, c.roll_no, c.course, c.class_level, c.group_number, c.is_active, c.created_at,
                case when sel.customer_id is not null then 'yes' else 'no' end as selected
           from customers c
           left join group_selections sel on sel.customer_id = c.id
          where c.mode = $1 order by c.customer_number`,
        [mode],
      );
      rows = data.map((row) => ({
        ...row,
        customer_number: String(row.customer_number).padStart(3, '0'),
        is_active: row.is_active ? 'yes' : 'no',
      }));
      columns = [
        ['customer_number', 'Number'],
        ['name', 'Customer'],
        ['roll_no', 'Roll no'],
        ['course', 'Course'],
        ['class_level', 'Class'],
        ['group_number', 'Group'],
        ['selected', 'Selected'],
        ['is_active', 'Active'],
        ['created_at', 'Registered at'],
      ];
    } else if (type === 'groups') {
      const data = await db.query<Record<string, any>>(
        `select g.group_number, g.status, g.completed_at,
                sel.customer_number as selected_number, c.name as selected_name,
                s.spin_code, s.prize_name, s.status as spin_status, s.completed_at as spin_completed_at
           from customer_groups g
           left join group_selections sel on sel.group_id = g.id
           left join customers c on c.id = sel.customer_id
           left join spins s on s.customer_id = sel.customer_id and s.mode = g.mode
          where g.mode = $1 order by g.group_number`,
        [mode],
      );
      rows = data;
      columns = [
        ['group_number', 'Group'],
        ['status', 'Status'],
        ['selected_number', 'Selected number'],
        ['selected_name', 'Selected customer'],
        ['spin_code', 'Spin'],
        ['prize_name', 'Prize'],
        ['spin_status', 'Spin status'],
        ['completed_at', 'Group completed at'],
        ['spin_completed_at', 'Spin completed at'],
      ];
    } else if (type === 'spins') {
      const data = await db.query<Record<string, any>>(
        `select spin_code, customer_number, customer_name, prize_name, probability, weight_snapshot,
                wheel_angle, servo_angle, status, source, device_id, stock_deducted,
                requested_at, completed_at
           from (select *, prize_weight as weight_snapshot from spins where mode = $1) s
          order by requested_at desc`,
        [mode],
      );
      rows = data;
      columns = [
        ['spin_code', 'Spin'],
        ['customer_number', 'Customer number'],
        ['customer_name', 'Customer'],
        ['prize_name', 'Prize'],
        ['weight_snapshot', 'Weight'],
        ['probability', 'Probability'],
        ['wheel_angle', 'Wheel angle'],
        ['servo_angle', 'Servo angle'],
        ['status', 'Status'],
        ['source', 'Source'],
        ['device_id', 'Device'],
        ['stock_deducted', 'Stock deducted'],
        ['requested_at', 'Requested at'],
        ['completed_at', 'Completed at'],
      ];
    } else if (type === 'stock') {
      const data = await db.query<Record<string, any>>(
        `select t.created_at, p.name as prize_name, t.mode, s.spin_code, t.delta,
                t.stock_before, t.stock_after
           from prize_stock_transactions t
           join prizes p on p.id = t.prize_id
           left join spins s on s.id = t.spin_id
          where t.mode = $1 order by t.created_at desc`,
        [mode],
      );
      rows = data;
      columns = [
        ['created_at', 'When'],
        ['prize_name', 'Prize'],
        ['mode', 'Mode'],
        ['spin_code', 'Spin'],
        ['delta', 'Change'],
        ['stock_before', 'Stock before'],
        ['stock_after', 'Stock after'],
      ];
    } else {
      throw badRequest('UNKNOWN_REPORT', 'Unknown report type.');
    }

    const csv = toCsv(rows, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="foodfest-${type}-${mode}.csv"`);
    res.send(csv);
  }),
);

router.get(
  '/stock',
  asyncHandler(async (req, res) => {
    const mode = modeQuery(req.query.mode);
    const rows = await (await getDb()).query<Record<string, any>>(
      `select t.*, p.name as prize_name, s.spin_code
         from prize_stock_transactions t
         join prizes p on p.id = t.prize_id
         left join spins s on s.id = t.spin_id
        where t.mode = $1
        order by t.created_at desc limit 200`,
      [mode],
    );
    res.json({
      ok: true,
      transactions: rows.map((row) => ({
        id: row.id,
        prizeId: row.prize_id,
        prizeName: row.prize_name,
        mode: row.mode,
        spinCode: row.spin_code,
        delta: Number(row.delta),
        stockBefore: Number(row.stock_before),
        stockAfter: Number(row.stock_after),
        createdAt: row.created_at,
      })),
    });
  }),
);

router.get(
  '/audit',
  asyncHandler(async (_req, res) => {
    const rows = await (await getDb()).query<Record<string, any>>(
      'select * from audit_logs order by created_at desc limit 200',
    );
    res.json({
      ok: true,
      logs: rows.map((row) => ({
        id: row.id,
        actor: row.actor,
        action: row.action,
        entity: row.entity,
        entityId: row.entity_id,
        details: row.details,
        createdAt: row.created_at,
      })),
    });
  }),
);

export default router;
