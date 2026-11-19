import type {
  Admin,
  AuditLog,
  Customer,
  DevicePanel,
  Group,
  LuclyState,
  Mode,
  Prize,
  PrizeCategory,
  PrizeSummary,
  PublicLuckyState,
  PublicSpin,
  Settings,
  Spin,
  Stats,
  StockTransaction,
  Wheel,
} from './types';

const TOKEN_KEY = 'foodfest.admin.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  const response = await fetch(`/api${path}`, { ...options, headers });

  if (response.status === 401 && token) {
    clearToken();
    if (!location.pathname.startsWith('/admin/login')) {
      location.assign('/admin/login');
    }
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error?.code ?? 'REQUEST_FAILED',
      data?.error?.message ?? 'Request failed.',
      data?.error?.details,
    );
  }
  return data as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; admin: Admin }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ admin: Admin }>('/auth/me'),

  // ---------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------
  publicStatus: () =>
    request<{
      eventName: string;
      eventStatus: string;
      mode: Mode;
      registrationOpen: boolean;
      registeredCustomers: number;
      duplicateMobileRule: string;
    }>('/public/status'),

  publicPrizes: () =>
    request<{
      prizes: Array<{
        id: string;
        name: string;
        description: string | null;
        imageUrl: string | null;
        color: string;
      }>;
    }>('/public/prizes'),

  /** Wheel page state: selected customer, wheel and any unfinished spin. */
  publicLucky: () => request<PublicLuckyState>('/public/lucky/current'),

  /** Starts the spin for the selected customer from their phone. */
  publicSpin: (customerNumber: number, spinId: string) =>
    request<{ reused: boolean; spin: PublicSpin; wheel: Wheel }>('/public/spin', {
      method: 'POST',
      body: JSON.stringify({ customer_number: customerNumber, spin_id: spinId }),
    }),

  /** Confirms the animation finished so stock is deducted exactly once. */
  completePublicSpin: (code: string) =>
    request<{ spin_id: string; status: string; prize_name: string; stock_deducted: boolean }>(
      `/public/spin/${code}/complete`,
      { method: 'POST' },
    ),

  register: (body: {
    name: string;
    rollNo?: string;
    course?: string;
    classLevel?: string;
  }) =>
    request<{
      customer: Customer;
      groupNumber: number;
      groupComplete: boolean;
      selected: boolean;
      selectedCustomerNumber: number | null;
      selectedCustomer: { numberLabel: string; name: string } | null;
    }>('/public/register', { method: 'POST', body: JSON.stringify(body) }),

  // ---------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------
  stats: (mode: Mode) => request<Stats>(`/admin/stats?mode=${mode}`),

  customers: (mode: Mode, search?: string, group?: number) => {
    const params = new URLSearchParams({ mode });
    if (search) params.set('search', search);
    if (group) params.set('group', String(group));
    return request<{ customers: Customer[] }>(`/admin/customers?${params.toString()}`);
  },

  participants: () =>
    request<{
      count: number;
      participants: Array<{
        numberLabel: string;
        groupNumber: number;
        name: string;
        rollNo: string | null;
        course: string | null;
        classLevel: string | null;
      }>;
    }>('/public/participants'),

  createCustomer: (body: {
    name: string;
    rollNo?: string;
    course?: string;
    classLevel?: string;
    mobile?: string;
    mode?: Mode;
  }) =>
    request<{ customer: Customer }>('/admin/customers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateCustomer: (
    id: string,
    body: {
      name?: string;
      mobile?: string | null;
      rollNo?: string | null;
      course?: string | null;
      classLevel?: string | null;
      isActive?: boolean;
    },
  ) =>
    request<{ customer: Customer }>(`/admin/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteCustomer: (id: string) =>
    request<{ number: number; name: string }>(`/admin/customers/${id}`, { method: 'DELETE' }),

  deleteAllCustomers: (mode: Mode) =>
    request<{ deleted: number; mode: Mode }>(`/admin/customers?mode=${mode}`, {
      method: 'DELETE',
    }),

  groups: (mode: Mode) => request<{ groups: Group[] }>(`/admin/groups?mode=${mode}`),

  prizes: (mode: Mode) =>
    request<{
      prizes: Prize[];
      categories: PrizeCategory[];
      summary: PrizeSummary[];
      eligibility: PrizeSummary[];
    }>(`/admin/prizes?mode=${mode}&eligibility=${mode}`),

  createCategory: (name: string) =>
    request<{ category: PrizeCategory }>('/admin/categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  updateCategory: (id: string, name: string) =>
    request<{ category: PrizeCategory }>(`/admin/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  createPrize: (body: Record<string, unknown>) =>
    request<{ prize: Prize }>('/admin/prizes', { method: 'POST', body: JSON.stringify(body) }),

  updatePrize: (id: string, body: Record<string, unknown>) =>
    request<{ prize: Prize }>(`/admin/prizes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deletePrize: (id: string) =>
    request<{ ok: true }>(`/admin/prizes/${id}`, { method: 'DELETE' }),

  luckyCurrent: () => request<LuclyState>('/admin/lucky/current'),

  createSpin: (body: { mode?: Mode; groupId?: string; customerId?: string }) =>
    request<{ spin: Spin; wheel: Wheel; reused: boolean }>('/admin/spins', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  completeSpin: (code: string) =>
    request<{ spin: Spin }>(`/admin/spins/${code}/complete`, { method: 'POST' }),

  cancelSpin: (code: string) =>
    request<{ spin: Spin }>(`/admin/spins/${code}/cancel`, { method: 'POST' }),

  spins: (mode: Mode | 'all', limit = 100) =>
    request<{ spins: Spin[] }>(`/admin/spins?mode=${mode}&limit=${limit}`),

  demoGroups: () =>
    request<{
      groups: Array<{
        groupNumber: number;
        customerNumber: number;
        customerNumberLabel: string;
        customerName: string;
      }>;
    }>('/admin/demo/groups'),

  resetDemo: () =>
    request<{ ok: true; seededCustomers: number; groups: number }>('/admin/demo/reset', {
      method: 'POST',
    }),

  settings: () =>
    request<{
      settings: Settings;
      admins: Array<Admin & { isActive: boolean; createdAt: string | null }>;
    }>('/admin/settings'),

  updateSettings: (body: Partial<Settings>) =>
    request<{ settings: Settings }>('/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  admins: () =>
    request<{
      admins: Array<Admin & { isActive: boolean; createdAt: string | null }>;
    }>('/admin/admins'),

  createAdmin: (body: {
    email: string;
    name: string;
    password: string;
    role: 'admin' | 'operator';
  }) =>
    request<{ admin: Admin }>('/admin/admins', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateAdmin: (id: string, body: Record<string, unknown>) =>
    request<{ admin: Admin }>(`/admin/admins/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  device: () => request<DevicePanel>('/admin/device'),

  sendCommand: (
    type: 'oled' | 'tm1637' | 'servo' | 'reset',
    payload: Record<string, unknown>,
  ) =>
    request<{ command: { id: string } }>('/admin/device/commands', {
      method: 'POST',
      body: JSON.stringify({ type, payload }),
    }),

  stock: async (mode: Mode): Promise<{ transactions: StockTransaction[] }> =>
    request<{ transactions: StockTransaction[] }>(`/admin/stock?mode=${mode}`),

  audit: () => request<{ logs: AuditLog[] }>('/admin/audit'),

  downloadReport: async (type: 'customers' | 'groups' | 'spins' | 'stock', mode: Mode) => {
    const token = getToken();
    const response = await fetch(`/api/admin/reports/${type}?mode=${mode}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error('Could not build the report.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `foodfest-${type}-${mode}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

/** Subscribes to server-sent realtime events. Returns an unsubscribe fn. */
export function subscribeEvents(
  handlers: Record<string, (payload: unknown) => void>,
): () => void {
  const token = getToken();
  if (!token) return () => undefined;

  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  for (const [event, handler] of Object.entries(handlers)) {
    source.addEventListener(event, (message) => {
      try {
        handler(JSON.parse((message as MessageEvent).data));
      } catch {
        handler(null);
      }
    });
  }
  return () => source.close();
}
