import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

// Load .env from the workspace root first, then the server folder.
for (const candidate of [resolve(process.cwd(), '../.env'), resolve(process.cwd(), '.env')]) {
  if (existsSync(candidate)) loadEnv({ path: candidate });
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const databaseUrl = (process.env.DATABASE_URL ?? '').trim();

const configuredPort = Number(process.env.PORT);

export const env = {
  port: Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 4000,
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  databaseUrl: databaseUrl.length > 0 ? databaseUrl : null,
  pglitePath: process.env.PGLITE_PATH ?? './.data/pglite',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-insecure-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  deviceToken: process.env.DEVICE_TOKEN ?? 'dev-device-token-change-me',
  deviceId: process.env.DEVICE_ID ?? 'FOODFEST_ESP32',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@foodfest.local',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin12345',
  adminName: process.env.ADMIN_NAME ?? 'Food Fest Admin',
  requireDeviceAuth: bool(process.env.REQUIRE_DEVICE_AUTH, true),
  isProduction: process.env.NODE_ENV === 'production',
};
