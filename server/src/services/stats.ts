import { getDb } from '../db/index.js';
import type { Mode } from '../lib/serialize.js';
import { getPrimaryDevice, isOnline } from './devices.js';
import { prizeStockSummary, type PrizeStockSummary } from './prizes.js';
import { getSettings, type SettingsDTO } from './settings.js';

export interface DashboardStats {
  settings: SettingsDTO;
  customers: { total: number; active: number; waiting: number };
  groups: { total: number; complete: number; waiting: number; remaining: number };
  selections: number;
  spins: { total: number; completed: number; pending: number; demo: number; real: number };
  prizes: PrizeStockSummary[];
  device: { deviceId: string; online: boolean; status: string; lastHeartbeat: string | null };
  recentSpins: Array<Record<string, unknown>>;
}

export async function getDashboardStats(mode: Mode): Promise<DashboardStats> {
  const db = await getDb();
  const settings = await getSettings(db);

  const [customerRows, groupRows, selectionRows, spinRows] = await Promise.all([
    db.query<Record<string, any>>('select * from customers where mode = $1', [mode]),
    db.query<Record<string, any>>('select * from customer_groups where mode = $1', [mode]),
    db.query<Record<string, any>>('select * from group_selections where mode = $1', [mode]),
    db.query<Record<string, any>>('select * from spins where mode = $1', [mode]),
  ]);

  const completeGroups = groupRows.filter((row) => row.status === 'complete');
  const waitingGroups = groupRows.filter((row) => row.status !== 'complete');
  const waitingCustomers = waitingGroups.reduce(
    (sum, group) => sum + customerRows.filter((c) => Number(c.group_number) === Number(group.group_number)).length,
    0,
  );

  const spinsWithCustomer = new Set(spinRows.map((row) => row.customer_id));
  const remainingGroups = completeGroups.filter((group) => {
    const selection = selectionRows.find(
      (row) => Number(row.group_number) === Number(group.group_number),
    );
    return !selection || !spinsWithCustomer.has(selection.customer_id);
  }).length;

  const device = await getPrimaryDevice(settings.deviceId);
  const recent = [...spinRows]
    .sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)))
    .slice(0, 8);

  return {
    settings,
    customers: {
      total: customerRows.length,
      active: customerRows.filter((row) => row.is_active).length,
      waiting: waitingCustomers,
    },
    groups: {
      total: groupRows.length,
      complete: completeGroups.length,
      waiting: waitingGroups.length,
      remaining: remainingGroups,
    },
    selections: selectionRows.length,
    spins: {
      total: spinRows.length,
      completed: spinRows.filter((row) => row.status === 'completed').length,
      pending: spinRows.filter((row) => row.status === 'pending' || row.status === 'spinning').length,
      demo: spinRows.filter((row) => row.mode === 'demo').length,
      real: spinRows.filter((row) => row.mode === 'real').length,
    },
    prizes: await prizeStockSummary(mode),
    device: {
      deviceId: device?.deviceId ?? settings.deviceId,
      online: isOnline(device),
      status: device?.status ?? 'offline',
      lastHeartbeat: device?.lastHeartbeat ?? null,
    },
    recentSpins: recent.map((row) => ({
      id: row.id,
      code: row.spin_code,
      status: row.status,
      customerNumber: Number(row.customer_number),
      customerNumberLabel: String(row.customer_number).padStart(3, '0'),
      customerName: row.customer_name,
      prizeName: row.prize_name,
      completedAt: row.completed_at,
      requestedAt: row.requested_at,
    })),
  };
}
