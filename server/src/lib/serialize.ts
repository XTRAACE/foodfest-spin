/** Row -> API DTO helpers. Keeps SQL snake_case out of the frontend. */

export type Mode = 'demo' | 'real';

export function numberLabel(value: number | string): string {
  return String(Math.trunc(Number(value))).padStart(3, '0');
}

export function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function asIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function toCustomer(row: Record<string, any>) {
  return {
    id: row.id as string,
    mode: row.mode as Mode,
    number: asNumber(row.customer_number),
    numberLabel: numberLabel(row.customer_number),
    groupNumber: asNumber(row.group_number),
    name: row.name as string,
    mobile: (row.mobile as string | null) ?? null,
    rollNo: (row.roll_no as string | null) ?? null,
    course: (row.course as string | null) ?? null,
    classLevel: (row.class_level as string | null) ?? null,
    isActive: Boolean(row.is_active),
    createdAt: asIso(row.created_at),
  };
}

export type CustomerDTO = ReturnType<typeof toCustomer>;

export function toPrize(row: Record<string, any>) {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    imageUrl: (row.image_url as string | null) ?? null,
    color: (row.color as string) ?? '#f97316',
    weight: asNumber(row.weight),
    isEnabled: Boolean(row.is_enabled),
    isUnlimited: Boolean(row.is_unlimited),
    isConsolation: Boolean(row.is_consolation),
    servoAngle: row.servo_angle === null || row.servo_angle === undefined ? null : asNumber(row.servo_angle),
    categoryId: (row.category_id as string | null) ?? null,
    sortOrder: asNumber(row.sort_order),
    realStock: asNumber(row.real_stock ?? row.stock),
    demoStock: asNumber(row.demo_stock ?? 0),
    pending: asNumber(row.pending),
    createdAt: asIso(row.created_at),
  };
}

export type PrizeDTO = ReturnType<typeof toPrize>;

export function toSpin(row: Record<string, any>) {
  return {
    id: row.id as string,
    code: row.spin_code as string,
    mode: row.mode as Mode,
    status: row.status as 'pending' | 'spinning' | 'completed' | 'failed' | 'cancelled',
    customerId: row.customer_id as string,
    customerNumber: asNumber(row.customer_number),
    customerNumberLabel: numberLabel(row.customer_number),
    customerName: row.customer_name as string,
    groupId: (row.group_id as string | null) ?? null,
    prizeId: (row.prize_id as string | null) ?? null,
    prizeName: row.prize_name as string,
    prizeWeight: asNumber(row.prize_weight),
    totalWeight: asNumber(row.total_weight),
    probability: asNumber(row.probability),
    wheelAngle: asNumber(row.wheel_angle),
    servoAngle: asNumber(row.servo_angle),
    animationMs: row.animation_ms === null || row.animation_ms === undefined ? null : asNumber(row.animation_ms),
    source: row.source as 'admin' | 'device' | 'site',
    deviceId: (row.device_id as string | null) ?? null,
    stockDeducted: Boolean(row.stock_deducted),
    requestedAt: asIso(row.requested_at),
    completedAt: asIso(row.completed_at),
  };
}

export type SpinDTO = ReturnType<typeof toSpin>;
