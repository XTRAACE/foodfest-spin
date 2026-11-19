import { createHash, timingSafeEqual } from 'node:crypto';
import { getDb, type Queryable } from '../db/index.js';
import { unauthorized, notFound, badRequest } from '../lib/errors.js';
import { asIso, type Mode } from '../lib/serialize.js';
import { getSettings } from './settings.js';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export interface DeviceRecord {
  id: string;
  deviceId: string;
  name: string;
  isActive: boolean;
  status: 'online' | 'offline';
  firmwareVersion: string | null;
  ipAddress: string | null;
  lastHeartbeat: string | null;
  createdAt: string | null;
}

export function toDevice(row: Record<string, any>): DeviceRecord {
  return {
    id: row.id,
    deviceId: row.device_id,
    name: row.name,
    isActive: Boolean(row.is_active),
    status: row.status,
    firmwareVersion: row.firmware_version ?? null,
    ipAddress: row.ip_address ?? null,
    lastHeartbeat: asIso(row.last_heartbeat),
    createdAt: asIso(row.created_at),
  };
}

/** Validates the device token header against the stored hash. */
export async function authenticateDeviceToken(token: string | undefined): Promise<DeviceRecord> {
  if (!token) throw unauthorized('DEVICE_TOKEN_MISSING', 'Missing x-device-token header.');
  const db = await getDb();
  const rows = await db.query<Record<string, any>>('select * from devices');
  const candidate = hashToken(token.trim());
  const match = rows.find((row) => hashesMatch(String(row.token_hash), candidate));

  if (!match) throw unauthorized('DEVICE_TOKEN_INVALID', 'Unknown device token.');
  if (!match.is_active) throw unauthorized('DEVICE_DISABLED', 'This device is disabled.');

  return toDevice(match);
}

export interface HeartbeatInput {
  deviceId: string;
  firmwareVersion?: string | null;
  ipAddress?: string | null;
}

export async function recordHeartbeat(input: HeartbeatInput, token: string | undefined): Promise<DeviceRecord> {
  const device = await authenticateDeviceToken(token);
  if (input.deviceId && input.deviceId !== device.deviceId) {
    throw unauthorized('DEVICE_ID_MISMATCH', 'device_id does not match the authenticated device.');
  }

  const db = await getDb();
  const rows = await db.query<Record<string, any>>(
    `update devices
        set status = 'online',
            last_heartbeat = now(),
            firmware_version = coalesce($2, firmware_version),
            ip_address = coalesce($3, ip_address)
      where device_id = $1
    returning *`,
    [device.deviceId, input.firmwareVersion ?? null, input.ipAddress ?? null],
  );

  return toDevice(rows[0]!);
}

export async function listDevices(): Promise<DeviceRecord[]> {
  const db = await getDb();
  const rows = await db.query<Record<string, any>>('select * from devices order by created_at asc');
  return rows.map(toDevice);
}

/** A device is considered online when it sent a heartbeat in the last 90s. */
export function isOnline(device: DeviceRecord | null | undefined): boolean {
  if (!device?.lastHeartbeat) return false;
  const age = Date.now() - new Date(device.lastHeartbeat).getTime();
  return age >= 0 && age < 90_000;
}

export async function getPrimaryDevice(deviceId?: string): Promise<DeviceRecord | null> {
  const db = await getDb();
  const rows = deviceId
    ? await db.query<Record<string, any>>('select * from devices where device_id = $1', [deviceId])
    : await db.query<Record<string, any>>('select * from devices order by created_at asc limit 1');
  return rows[0] ? toDevice(rows[0]) : null;
}

/** Registers (or rotates the token of) the ESP32 machine. */
export async function upsertDevice(input: {
  deviceId: string;
  token: string;
  name?: string;
  firmwareVersion?: string | null;
}): Promise<DeviceRecord> {
  const db = await getDb();
  const rows = await db.query<Record<string, any>>(
    `insert into devices (device_id, name, token_hash, firmware_version)
     values ($1, $2, $3, $4)
     on conflict (device_id) do update
       set token_hash = excluded.token_hash,
           name = coalesce(excluded.name, devices.name),
           firmware_version = coalesce(excluded.firmware_version, devices.firmware_version)
     returning *`,
    [input.deviceId, input.name ?? 'Food Fest Spin Machine', hashToken(input.token), input.firmwareVersion ?? null],
  );
  return toDevice(rows[0]!);
}

// ---------------------------------------------------------------------------
// Device status / spin handoff
// ---------------------------------------------------------------------------

export interface DeviceCurrentResponse {
  mode: Mode;
  status: 'ready' | 'waiting' | 'spin_pending' | 'paused' | 'no_prizes';
  spin_id: string | null;
  customer_number: number | null;
  customer_name: string | null;
  customer_number_label: string | null;
  group_number: number | null;
  prize_name?: string | null;
  prize_id?: string | null;
  target_angle?: number | null;
  wheel_angle?: number | null;
  event_name: string;
  server_time: string;
}

export async function getDeviceCurrent(deviceId?: string): Promise<DeviceCurrentResponse> {
  const db = await getDb();
  const settings = await getSettings(db);
  const mode = settings.mode;

  const base = {
    mode,
    event_name: settings.eventName,
    server_time: new Date().toISOString(),
    device_id: settings.deviceId,
  };

  const pending = await db.query<Record<string, any>>(
    `select * from spins
      where mode = $1 and status in ('pending', 'spinning')
      order by requested_at desc limit 1`,
    [mode],
  );
  if (pending[0]) {
    const spin = pending[0];
    return {
      ...base,
      status: 'spin_pending',
      spin_id: spin.spin_code,
      customer_number: Number(spin.customer_number),
      customer_number_label: String(spin.customer_number).padStart(3, '0'),
      customer_name: spin.customer_name,
      group_number: null,
      prize_name: spin.prize_name,
      prize_id: spin.prize_id,
      target_angle: Number(spin.servo_angle),
      wheel_angle: Number(spin.wheel_angle),
    };
  }

  if (settings.eventStatus === 'paused') {
    return {
      ...base,
      status: 'paused',
      spin_id: null,
      customer_number: null,
      customer_name: null,
      customer_number_label: null,
      group_number: null,
    };
  }

  if (mode === 'real') {
    const ready = await db.query<Record<string, any>>(
      `select gs.customer_number, gs.group_number, c.name
         from group_selections gs join customers c on c.id = gs.customer_id
        where gs.mode = 'real' and c.is_active = true
          and not exists (select 1 from spins s where s.customer_id = gs.customer_id and s.mode = 'real')
        order by gs.group_number asc limit 1`,
    );
    if (ready[0]) {
      return {
        ...base,
        status: 'ready',
        spin_id: null,
        customer_number: Number(ready[0].customer_number),
        customer_number_label: String(ready[0].customer_number).padStart(3, '0'),
        customer_name: ready[0].name,
        group_number: Number(ready[0].group_number),
      };
    }
  }

  const available = await db.query<{ count: string }>(
    `select count(*)::text as count from prizes p
      left join prize_stock s on s.prize_id = p.id and s.mode = $1
      where p.is_enabled = true and p.weight > 0 and (p.is_unlimited = true or coalesce(s.stock, 0) > 0)`,
    [mode],
  );

  return {
    ...base,
    status: Number(available[0]?.count ?? 0) > 0 ? 'waiting' : 'no_prizes',
    spin_id: null,
    customer_number: null,
    customer_name: null,
    customer_number_label: null,
    group_number: null,
  };
}

// ---------------------------------------------------------------------------
// Command queue (test OLED / TM1637 / servo from the admin panel)
// ---------------------------------------------------------------------------

export type CommandType = 'oled' | 'tm1637' | 'servo' | 'reset';

export async function enqueueCommand(
  deviceId: string,
  type: CommandType,
  payload: Record<string, unknown>,
): Promise<{ id: string; type: CommandType; payload: Record<string, unknown>; createdAt: string | null }> {
  const db = await getDb();
  const rows = await db.query<Record<string, any>>(
    `insert into device_commands (device_id, type, payload) values ($1, $2, $3::jsonb) returning *`,
    [deviceId, type, JSON.stringify(payload)],
  );
  const row = rows[0]!;
  return { id: row.id, type: row.type, payload: row.payload, createdAt: asIso(row.created_at) };
}

export async function pendingCommands(deviceId: string): Promise<Array<Record<string, unknown>>> {
  const db = await getDb();
  const rows = await db.query<Record<string, any>>(
    `select * from device_commands
      where device_id = $1 and status = 'pending'
      order by created_at asc limit 20`,
    [deviceId],
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    payload: row.payload,
    created_at: asIso(row.created_at),
  }));
}

export async function ackCommand(deviceId: string, commandId: string): Promise<void> {
  const db = await getDb();
  const rows = await db.query<Record<string, any>>(
    `update device_commands set status = 'acked', acked_at = now()
      where id = $1 and device_id = $2 and status = 'pending' returning id`,
    [commandId, deviceId],
  );
  if (!rows[0]) throw notFound('COMMAND_NOT_FOUND', 'Pending command not found for this device.');
}

export async function recentCommands(deviceId: string, limit = 20) {
  const db = await getDb();
  const rows = await db.query<Record<string, any>>(
    `select * from device_commands where device_id = $1 order by created_at desc limit $2`,
    [deviceId, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    createdAt: asIso(row.created_at),
    ackedAt: asIso(row.acked_at),
  }));
}

export function assertDeviceId(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest('DEVICE_ID_REQUIRED', 'device_id is required.');
  }
  return value.trim() || fallback;
}

export type { Queryable };
