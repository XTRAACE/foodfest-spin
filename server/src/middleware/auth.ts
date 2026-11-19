import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { authenticateDeviceToken } from '../services/devices.js';

export interface AdminClaims {
  sub: string;
  email: string;
  name: string;
  role: 'admin' | 'operator';
}

export function signAdminToken(claims: AdminClaims): string {
  return jwt.sign(claims, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

export function verifyAdminToken(token: string): AdminClaims {
  const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload & Partial<AdminClaims>;
  if (!payload.sub || !payload.email || !payload.role) {
    throw unauthorized('INVALID_TOKEN', 'Session token is not valid.');
  }
  return {
    sub: String(payload.sub),
    email: String(payload.email),
    name: String(payload.name ?? 'Admin'),
    role: payload.role === 'operator' ? 'operator' : 'admin',
  };
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    next(unauthorized('AUTH_REQUIRED', 'Administrator authentication required.'));
    return;
  }
  try {
    const claims = verifyAdminToken(token);
    req.admin = { id: claims.sub, email: claims.email, name: claims.name, role: claims.role };
    next();
  } catch {
    next(unauthorized('INVALID_TOKEN', 'Session expired or invalid. Please sign in again.'));
  }
}

/** Role guard: only full admins may change configuration. */
export function requireRole(role: 'admin') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.admin?.role !== role) {
      next(forbidden('INSUFFICIENT_ROLE', 'Your account does not have permission for this action.'));
      return;
    }
    next();
  };
}

/** ESP32 authentication through the x-device-token header. */
export async function requireDevice(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.headers['x-device-token'];
    req.device = await authenticateDeviceToken(Array.isArray(token) ? token[0] : token);
    next();
  } catch (error) {
    next(error);
  }
}
