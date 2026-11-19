import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { asyncHandler } from '../http/async.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { requireAdmin, signAdminToken } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('VALIDATION_ERROR', 'Enter a valid email and password.');
    }

    const db = await getDb();
    const rows = await db.query<Record<string, any>>(
      'select * from admin_users where lower(email) = $1',
      [parsed.data.email.toLowerCase()],
    );
    const user = rows[0];

    if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
      throw unauthorized('INVALID_CREDENTIALS', 'Incorrect email or password.');
    }
    if (!user.is_active) {
      throw unauthorized('ACCOUNT_DISABLED', 'This account has been disabled.');
    }

    const token = signAdminToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    await logAudit(db, {
      actor: user.email,
      action: 'admin.login',
      entity: 'admin',
      entityId: user.id,
    });

    res.json({
      ok: true,
      token,
      admin: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  }),
);

router.get(
  '/me',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ ok: true, admin: req.admin });
  }),
);

export default router;
