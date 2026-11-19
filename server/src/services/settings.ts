import { getDb, type Queryable } from '../db/index.js';
import { asIso } from '../lib/serialize.js';

export interface SettingsDTO {
  eventName: string;
  eventStatus: 'active' | 'paused' | 'ended';
  mode: 'demo' | 'real';
  registrationOpen: boolean;
  duplicateMobileRule: 'reject' | 'allow';
  deviceId: string;
  servoMinAngle: number;
  servoMaxAngle: number;
  updatedAt: string | null;
}

export function toSettings(row: Record<string, any>): SettingsDTO {
  return {
    eventName: row.event_name,
    eventStatus: row.event_status,
    mode: row.mode,
    registrationOpen: Boolean(row.registration_open),
    duplicateMobileRule: row.duplicate_mobile_rule,
    deviceId: row.device_id,
    servoMinAngle: Number(row.servo_min_angle),
    servoMaxAngle: Number(row.servo_max_angle),
    updatedAt: asIso(row.updated_at),
  };
}

/** Reads settings, creating the single settings row on first use. */
export async function getSettings(q?: Queryable): Promise<SettingsDTO> {
  const db = q ?? (await getDb());
  await db.query('insert into event_settings (id) values (1) on conflict (id) do nothing');
  const rows = await db.query('select * from event_settings where id = 1');
  return toSettings(rows[0]!);
}

export interface SettingsPatch {
  eventName?: string;
  eventStatus?: 'active' | 'paused' | 'ended';
  mode?: 'demo' | 'real';
  registrationOpen?: boolean;
  duplicateMobileRule?: 'reject' | 'allow';
  deviceId?: string;
  servoMinAngle?: number;
  servoMaxAngle?: number;
}

export async function updateSettings(patch: SettingsPatch): Promise<SettingsDTO> {
  const db = await getDb();
  await getSettings(db);

  const columns: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    values.push(value);
    columns.push(`${column} = $${values.length}`);
  };

  if (patch.eventName !== undefined) assign('event_name', patch.eventName);
  if (patch.eventStatus !== undefined) assign('event_status', patch.eventStatus);
  if (patch.mode !== undefined) assign('mode', patch.mode);
  if (patch.registrationOpen !== undefined) assign('registration_open', patch.registrationOpen);
  if (patch.duplicateMobileRule !== undefined) assign('duplicate_mobile_rule', patch.duplicateMobileRule);
  if (patch.deviceId !== undefined) assign('device_id', patch.deviceId);
  if (patch.servoMinAngle !== undefined) assign('servo_min_angle', patch.servoMinAngle);
  if (patch.servoMaxAngle !== undefined) assign('servo_max_angle', patch.servoMaxAngle);

  if (columns.length > 0) {
    columns.push('updated_at = now()');
    await db.query(`update event_settings set ${columns.join(', ')} where id = 1`, values);
  }

  return getSettings(db);
}
