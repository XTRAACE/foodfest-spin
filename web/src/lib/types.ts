export type Mode = 'demo' | 'real';
export type SpinStatus = 'pending' | 'spinning' | 'completed' | 'failed' | 'cancelled';

export interface Admin {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator';
}

export interface Settings {
  eventName: string;
  eventStatus: 'active' | 'paused' | 'ended';
  mode: Mode;
  registrationOpen: boolean;
  duplicateMobileRule: 'reject' | 'allow';
  deviceId: string;
  servoMinAngle: number;
  servoMaxAngle: number;
  updatedAt: string | null;
}

export interface Customer {
  id: string;
  mode: Mode;
  number: number;
  numberLabel: string;
  groupNumber: number;
  name: string;
  mobile: string | null;
  rollNo: string | null;
  course: string | null;
  classLevel: string | null;
  isActive: boolean;
  createdAt: string | null;
  groupStatus?: string;
  isSelected?: boolean;
  spinStatus?: SpinStatus | null;
}

export interface Prize {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  color: string;
  weight: number;
  isEnabled: boolean;
  isUnlimited: boolean;
  isConsolation: boolean;
  servoAngle: number | null;
  categoryId: string | null;
  sortOrder: number;
  realStock: number;
  demoStock: number;
  pending: number;
  createdAt: string | null;
}

export interface PrizeCategory {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string | null;
}

export interface PrizeSummary {
  id: string;
  name: string;
  isEnabled: boolean;
  isUnlimited: boolean;
  weight: number;
  probability: number;
  stock: number;
  pending: number;
  awarded: number;
  color: string;
}

export interface WheelSection {
  prizeId: string;
  name: string;
  imageUrl: string | null;
  color: string;
  weight: number;
  startAngle: number;
  endAngle: number;
  centerAngle: number;
  eligible: boolean;
  stock: number;
  isUnlimited: boolean;
}

export interface Wheel {
  sections: WheelSection[];
  totalWeight: number;
}

export interface Spin {
  id: string;
  code: string;
  mode: Mode;
  status: SpinStatus;
  customerId: string;
  customerNumber: number;
  customerNumberLabel: string;
  customerName: string;
  groupId: string | null;
  prizeId: string | null;
  prizeName: string;
  prizeWeight: number;
  totalWeight: number;
  probability: number;
  wheelAngle: number;
  servoAngle: number;
  source: 'admin' | 'device' | 'site';
  deviceId: string | null;
  stockDeducted: boolean;
  requestedAt: string | null;
  completedAt: string | null;
}

export interface Group {
  id: string;
  mode: Mode;
  groupNumber: number;
  status: 'waiting' | 'complete';
  completedAt: string | null;
  members: Customer[];
  selection: {
    customerId: string;
    customerNumber: number;
    customerNumberLabel: string;
    customerName: string;
    createdAt: string | null;
  } | null;
  spin: { id: string; code: string; status: SpinStatus; prizeName: string; completedAt: string | null } | null;
}

export interface ReadyCustomer {
  customerId: string;
  number: number;
  numberLabel: string;
  name: string;
  groupNumber: number | null;
}

export interface LuclyState {
  settings: Settings;
  wheel: Wheel;
  readyCustomer: ReadyCustomer | null;
  pendingSpin: Spin | null;
  lastSpin: Spin | null;
}

export interface PublicSpin {
  code: string;
  status: SpinStatus;
  customerNumber: number;
  customerNumberLabel: string;
  customerName: string;
  prizeId: string | null;
  prizeName: string;
  wheelAngle: number;
  /** Spin animation length reported by the device that started it. */
  durationMs: number;
  /** Time left when the server answered — used to join a spin in progress. */
  remainingMs: number;
}

export interface PublicLuckyState {
  eventName: string;
  eventStatus: 'active' | 'paused' | 'ended';
  mode: Mode;
  readyCustomer: ReadyCustomer | null;
  wheel: Wheel;
  pendingSpin: PublicSpin | null;
}

export interface Stats {
  settings: Settings;
  customers: { total: number; active: number; waiting: number };
  groups: { total: number; complete: number; waiting: number; remaining: number };
  selections: number;
  spins: { total: number; completed: number; pending: number; demo: number; real: number };
  prizes: PrizeSummary[];
  device: { deviceId: string; online: boolean; status: string; lastHeartbeat: string | null };
  recentSpins: Array<{
    id: string;
    code: string;
    status: SpinStatus;
    customerNumber: number;
    customerNumberLabel: string;
    customerName: string;
    prizeName: string;
    completedAt: string | null;
    requestedAt: string | null;
  }>;
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

export interface DeviceCommand {
  id: string;
  type: 'oled' | 'tm1637' | 'servo' | 'reset';
  payload: Record<string, unknown>;
  status: 'pending' | 'acked';
  createdAt: string | null;
  ackedAt: string | null;
}

export interface DevicePanel {
  online: boolean;
  device: DeviceRecord | null;
  devices: DeviceRecord[];
  commands: DeviceCommand[];
  currentSpin: {
    code: string;
    status: SpinStatus;
    customerNumber: number;
    customerName: string;
    prizeName: string;
    servoAngle: number;
    mode: Mode;
    requestedAt: string | null;
  } | null;
}

export interface StockTransaction {
  id: string;
  prizeId: string;
  prizeName: string | null;
  mode: Mode;
  spinCode: string | null;
  delta: number;
  stockBefore: number;
  stockAfter: number;
  createdAt: string | null;
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown>;
  createdAt: string | null;
}
