import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, LogOut, Plus, RefreshCw, Save, Trash2, Users, Wifi } from 'lucide-react';
import { api, clearToken, getToken } from '../../lib/api';
import type { Customer, DevicePanel, Mode, Prize, Settings } from '../../lib/types';
import { ErrorNote, Modal, Spinner, StatusDot, formatTime } from '../../components/ui';

type Confirm =
  | { kind: 'one'; id: string; label: string }
  | { kind: 'all'; count: number }
  | null;

const toInt = (value: string, max = 1000000) => {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, max);
};

export default function AdminHome() {
  const navigate = useNavigate();
  const [form, setForm] = useState<Settings | null>(null);
  const [device, setDevice] = useState<DevicePanel | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [deleting, setDeleting] = useState(false);

  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [prizeSaving, setPrizeSaving] = useState(false);
  const [prizeNotice, setPrizeNotice] = useState<string | null>(null);
  const [prizeToDelete, setPrizeToDelete] = useState<Prize | null>(null);
  const [draft, setDraft] = useState({ name: '', weight: '5', stock: '100', isUnlimited: false });

  const loadDevice = useCallback(async () => {
    try {
      setDevice(await api.device());
    } catch {
      // the next interval retries
    }
  }, []);

  /** Customers + prizes for one mode (real and demo stock are separate). */
  const loadData = useCallback(async (mode: Mode) => {
    const [customerRes, prizeRes] = await Promise.all([api.customers(mode), api.prizes(mode)]);
    setCustomers(customerRes.customers);
    setPrizes(prizeRes.prizes);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api.settings();
      setForm(res.settings);
      setError(null);
      await loadData(res.settings.mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings.');
    }
    await loadDevice();
  }, [loadData, loadDevice]);

  useEffect(() => {
    if (!getToken()) {
      navigate('/admin/login', { replace: true });
      return;
    }
    void load();
    const interval = setInterval(() => void loadDevice(), 5000);
    return () => clearInterval(interval);
  }, [load, loadDevice, navigate]);

  const setMode = async (mode: Mode) => {
    if (!form) return;
    setForm({ ...form, mode });
    try {
      await loadData(mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load data for this mode.');
    }
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.updateSettings({
        eventName: form.eventName,
        eventStatus: form.eventStatus,
        registrationOpen: form.registrationOpen,
        mode: form.mode,
      });
      setForm(res.settings);
      setNotice('Settings saved. Live on the site and the ESP32.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  /** Saves product names, switches, weights and stock in one go. */
  const savePrizes = async () => {
    setPrizeSaving(true);
    setError(null);
    setPrizeNotice(null);
    try {
      const nextPrizes = prizes.map((prize) => ({ ...prize, name: prize.name.trim() }));
      if (nextPrizes.some((prize) => prize.name.length === 0)) {
        throw new Error('Every prize needs a name.');
      }
      await Promise.all(
        nextPrizes.map((prize) =>
          api.updatePrize(prize.id, {
            name: prize.name,
            isEnabled: prize.isEnabled,
            isUnlimited: prize.isUnlimited,
            weight: prize.weight,
            realStock: prize.realStock,
            demoStock: prize.demoStock,
          }),
        ),
      );
      setPrizes(nextPrizes);
      setPrizeNotice('Prizes saved. Phone wheel and ESP32 hardware both draw only from enabled prizes.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save prizes.');
    } finally {
      setPrizeSaving(false);
    }
  };

  const addPrize = async () => {
    if (!form) return;
    const name = draft.name.trim();
    if (!name) {
      setError('Give the new prize a name.');
      return;
    }
    setPrizeSaving(true);
    setError(null);
    setPrizeNotice(null);
    try {
      const stock = toInt(draft.stock);
      const res = await api.createPrize({
        name,
        weight: toInt(draft.weight, 1000),
        isEnabled: true,
        isUnlimited: draft.isUnlimited,
        realStock: form.mode === 'real' ? stock : 0,
        demoStock: form.mode === 'demo' ? stock : 100,
        sortOrder: prizes.length,
      });
      setPrizes((current) => [...current, res.prize]);
      setDraft({ name: '', weight: '5', stock: '100', isUnlimited: false });
      setPrizeNotice(`"${res.prize.name}" added. It can be drawn on the phone and the hardware.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the prize.');
    } finally {
      setPrizeSaving(false);
    }
  };

  const removePrize = async (prize: Prize) => {
    setError(null);
    setPrizeNotice(null);
    try {
      await api.deletePrize(prize.id);
      setPrizes((current) => current.filter((item) => item.id !== prize.id));
      setPrizeNotice(`"${prize.name}" deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the prize.');
    }
  };

  const removeCustomer = async (id: string) => {
    if (!form) return;
    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.deleteCustomer(id);
      await loadData(form.mode);
      setNotice(`Customer ${String(res.number).padStart(3, '0')} ${res.name} deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the customer.');
    } finally {
      setDeleting(false);
    }
  };

  const removeAllCustomers = async () => {
    if (!form) return;
    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.deleteAllCustomers(form.mode);
      await loadData(form.mode);
      setNotice(
        `${res.deleted} ${form.mode} customer${res.deleted === 1 ? '' : 's'} deleted. Numbering restarts at 001.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the customers.');
    } finally {
      setDeleting(false);
    }
  };

  const logout = () => {
    clearToken();
    navigate('/admin/login', { replace: true });
  };

  if (!form) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
        {error ? <ErrorNote message={error} /> : <Spinner className="h-8 w-8" />}
      </div>
    );
  }

  const consolation = prizes.find((prize) => prize.isConsolation) ?? null;
  const wheelPrizes = prizes.filter((prize) => !prize.isConsolation);
  const patchPrize = (id: string, patch: Partial<Prize>) =>
    setPrizes((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  const renamePrize = (id: string, name: string) => patchPrize(id, { name });
  const togglePrize = (id: string, value: boolean) => patchPrize(id, { isEnabled: value });

  return (
    <div className="mx-auto min-h-screen w-full max-w-md px-4 pb-12 pt-5">
      <header className="mb-5 flex items-center justify-between">
        <div className="leading-tight">
          <p className="font-display text-lg font-bold">Admin</p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">Food Fest lucky spin</p>
        </div>
        <div className="flex items-center gap-1">
          <Link to="/" className="btn-ghost h-9 px-2 text-xs">Site</Link>
          <button className="btn-ghost h-9 w-9 p-0" onClick={logout} aria-label="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {error && <div className="mb-4"><ErrorNote message={error} /></div>}
      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          {notice}
        </div>
      )}

      <section className="card p-5">
        <h2 className="mb-4 text-base font-bold">Event settings</h2>

        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="eventName">Event name</label>
            <input
              id="eventName"
              className="input py-3"
              value={form.eventName}
              onChange={(event) => setForm({ ...form, eventName: event.target.value })}
            />
          </div>

          <SwitchRow
            label="Registration open"
            hint="Accept new participants on the site."
            checked={form.registrationOpen}
            onChange={(value) => setForm({ ...form, registrationOpen: value })}
          />

          <SwitchRow
            label="Event active"
            hint="Paused stops spins without closing the app."
            checked={form.eventStatus === 'active'}
            onChange={(value) =>
              setForm({ ...form, eventStatus: value ? 'active' : 'paused' })
            }
          />

          <div>
            <p className="label">Mode</p>
            <div className="grid grid-cols-2 gap-2">
              {(['real', 'demo'] as Mode[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => void setMode(value)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold capitalize transition ${
                    form.mode === value
                      ? value === 'real'
                        ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-200'
                        : 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                      : 'border-white/10 bg-black/20 text-white/50'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <button className="btn-primary w-full py-3" disabled={saving} onClick={() => void save()}>
            {saving ? <Spinner /> : <Save size={17} />} Save settings
          </button>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Prizes: one tab per group, enable switches, save                    */}
      {/* ------------------------------------------------------------------ */}
      <section className="card mt-4 p-5">
        <h2 className="mb-1 flex items-center gap-2 text-base font-bold">
          <span className="text-gold">🎁</span> Prizes
        </h2>
        <p className="mb-4 text-[11px] text-white/40">
          One list for both screens: the phone wheel and the ESP32 hardware ask the same server for a
          random prize. Only enabled prizes can be drawn.
        </p>

        {consolation && (
          <div
            className={`mb-4 rounded-xl border px-3 py-3 ${
              consolation.isEnabled
                ? 'border-sky-400/30 bg-sky-400/10'
                : 'border-white/10 bg-black/20'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Better luck next time</p>
                <p className="text-[11px] text-white/45">
                  {consolation.isEnabled
                    ? 'On — a losing spin shows this.'
                    : 'Off — losing spins are not possible; only enabled prizes can be drawn.'}
                </p>
              </div>
              <Toggle
                checked={consolation.isEnabled}
                label="Enable better luck next time"
                onChange={(value) => togglePrize(consolation.id, value)}
              />
            </div>
            <input
              className="input mt-2 py-1.5 text-sm"
              aria-label="Better luck next time text"
              maxLength={60}
              value={consolation.name}
              onChange={(event) => renamePrize(consolation.id, event.target.value)}
            />
            <p className="mt-1 text-[11px] text-white/35">
              Shown on the wheel when the spin lands here. Press Save prizes to apply.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {wheelPrizes.length === 0 && (
            <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-white/35">
              No prizes yet. Add one below.
            </p>
          )}
          {wheelPrizes.map((prize) => (
            <div key={prize.id} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <input
                  className="input min-w-0 flex-1 py-1.5 text-sm font-medium"
                  aria-label={`Prize name for ${prize.name}`}
                  maxLength={60}
                  value={prize.name}
                  onChange={(event) => renamePrize(prize.id, event.target.value)}
                />
                <Toggle
                  checked={prize.isEnabled}
                  label={`Enable ${prize.name}`}
                  onChange={(value) => togglePrize(prize.id, value)}
                />
                <button
                  type="button"
                  className="btn-ghost h-8 w-8 shrink-0 p-0 text-red-300/80 hover:text-red-200"
                  aria-label={`Delete ${prize.name}`}
                  onClick={() => setPrizeToDelete(prize)}
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide text-white/35">Weight</span>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    className="input mt-1 py-1.5 text-xs"
                    value={prize.weight}
                    onChange={(event) =>
                      patchPrize(prize.id, { weight: toInt(event.target.value, 1000) })
                    }
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide text-white/35">
                    Stock ({form.mode})
                  </span>
                  <input
                    type="number"
                    min={0}
                    className="input mt-1 py-1.5 text-xs disabled:opacity-50"
                    disabled={prize.isUnlimited}
                    value={form.mode === 'real' ? prize.realStock : prize.demoStock}
                    onChange={(event) =>
                      patchPrize(
                        prize.id,
                        form.mode === 'real'
                          ? { realStock: toInt(event.target.value) }
                          : { demoStock: toInt(event.target.value) },
                      )
                    }
                  />
                </label>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-white/40">
                  {prize.isUnlimited
                    ? 'Unlimited'
                    : `${form.mode === 'real' ? prize.realStock : prize.demoStock} left`}
                  {prize.weight === 0 ? ' · weight 0 (never wins)' : ''}
                  {prize.isEnabled ? '' : ' · off (not drawn)'}
                </span>
                <label className="flex items-center gap-2 text-[11px] text-white/45">
                  Unlimited
                  <Toggle
                    checked={prize.isUnlimited}
                    label={`Unlimited stock for ${prize.name}`}
                    onChange={(value) => patchPrize(prize.id, { isUnlimited: value })}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-dashed border-white/15 p-3">
          <p className="mb-2 text-xs font-bold text-white/70">Add a prize</p>
          <input
            className="input py-2 text-sm"
            placeholder="Prize name (e.g. Chocolate)"
            maxLength={60}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-white/35">Weight</span>
              <input
                type="number"
                min={0}
                max={1000}
                className="input mt-1 py-1.5 text-xs"
                value={draft.weight}
                onChange={(event) => setDraft({ ...draft, weight: event.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-white/35">
                Stock ({form.mode})
              </span>
              <input
                type="number"
                min={0}
                className="input mt-1 py-1.5 text-xs disabled:opacity-50"
                disabled={draft.isUnlimited}
                value={draft.stock}
                onChange={(event) => setDraft({ ...draft, stock: event.target.value })}
              />
            </label>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-white/45">
            <span>Unlimited (never runs out)</span>
            <Toggle
              checked={draft.isUnlimited}
              label="New prize is unlimited"
              onChange={(value) => setDraft({ ...draft, isUnlimited: value })}
            />
          </div>
          <button
            type="button"
            className="btn-secondary mt-2 w-full py-2 text-xs"
            disabled={prizeSaving}
            onClick={() => void addPrize()}
          >
            <Plus size={14} /> Add prize
          </button>
          <p className="mt-2 text-[11px] text-white/35">
            A new prize is enabled right away — phone and hardware both use this same list.
          </p>
        </div>

        {prizeNotice && (
          <p className="mt-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
            {prizeNotice}
          </p>
        )}

        <button
          className="btn-primary mt-3 w-full py-3"
          disabled={prizeSaving}
          onClick={() => void savePrizes()}
        >
          {prizeSaving ? <Spinner /> : <Save size={17} />} Save prizes
        </button>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Customers: delete one (confirm) or all                              */}
      {/* ------------------------------------------------------------------ */}
      <section className="card mt-4 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Users size={16} className="text-gold" /> Customers
          </h2>
          <span className="text-xs text-white/40">{customers.length}</span>
        </div>

        {customers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-white/35">
            No customers in {form.mode} mode.
          </p>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {customers.map((customer) => (
              <li
                key={customer.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    <span className="font-mono text-xs text-gold">{customer.numberLabel}</span>{' '}
                    {customer.name}
                  </p>
                  <p className="truncate text-[11px] text-white/40">
                    Group {customer.groupNumber}
                    {customer.isSelected ? ' · selected' : ''}
                    {customer.isActive ? '' : ' · inactive'}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost h-8 w-8 shrink-0 p-0 text-red-300/80 hover:text-red-200"
                  aria-label={`Delete ${customer.name}`}
                  disabled={deleting}
                  onClick={() =>
                    setConfirm({
                      kind: 'one',
                      id: customer.id,
                      label: `${customer.numberLabel} ${customer.name}`,
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="btn-secondary mt-3 w-full border-red-400/25 py-2.5 text-red-200"
          disabled={deleting || customers.length === 0}
          onClick={() => setConfirm({ kind: 'all', count: customers.length })}
        >
          <Trash2 size={15} /> Delete all {form.mode} customers
        </button>
      </section>

      <section className="card mt-4 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Wifi size={16} className="text-gold" /> Device connection
          </h2>
          <button className="btn-ghost h-8 px-2 text-xs" onClick={() => void loadDevice()}>
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="mb-4 flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
          <StatusDot online={device?.online ?? false} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{device?.online ? 'Online' : 'Offline'}</p>
            <p className="truncate text-[11px] text-white/40">
              {device?.device?.deviceId ?? 'No device registered'}
            </p>
          </div>
        </div>

        <dl className="space-y-2 text-sm">
          <Row label="Firmware" value={device?.device?.firmwareVersion ?? '—'} />
          <Row label="Last heartbeat" value={formatTime(device?.device?.lastHeartbeat)} />
          <Row label="IP address" value={device?.device?.ipAddress ?? '—'} />
          <Row
            label="Current spin"
            value={
              device?.currentSpin
                ? `${device.currentSpin.customerName} · ${device.currentSpin.prizeName}`
                : '—'
            }
          />
        </dl>
      </section>

      <Modal
        open={confirm !== null}
        onClose={() => {
          if (!deleting) setConfirm(null);
        }}
        title={confirm?.kind === 'all' ? 'Delete all customers?' : 'Delete this customer?'}
        width="max-w-sm"
      >
        {confirm && (
          <div>
            <p className="flex items-start gap-2 text-sm text-white/65">
              <AlertTriangle size={17} className="mt-0.5 shrink-0 text-red-300" />
              <span>
                {confirm.kind === 'one'
                  ? `Delete ${confirm.label}? Their group, selection and spin history are removed too.`
                  : `Delete all ${confirm.count} ${form.mode} customer${
                      confirm.count === 1 ? '' : 's'
                    }? Groups and spin history are cleared and numbering restarts at 001.`}
              </span>
            </p>
            <p className="mt-3 text-xs text-white/40">
              {form.mode} data only · this cannot be undone.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                className="btn-secondary flex-1"
                disabled={deleting}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-400 disabled:opacity-60"
                disabled={deleting}
                onClick={() => {
                  const action = confirm;
                  setConfirm(null);
                  if (action.kind === 'one') void removeCustomer(action.id);
                  else void removeAllCustomers();
                }}
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={prizeToDelete !== null}
        onClose={() => setPrizeToDelete(null)}
        title="Delete this prize?"
        width="max-w-sm"
      >
        {prizeToDelete && (
          <div>
            <p className="flex items-start gap-2 text-sm text-white/65">
              <AlertTriangle size={17} className="mt-0.5 shrink-0 text-red-300" />
              <span>
                Delete “{prizeToDelete.name}”? A prize that already appears in spin history cannot be
                deleted — turn it off instead.
              </span>
            </p>
            <div className="mt-5 flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setPrizeToDelete(null)}>
                Cancel
              </button>
              <button
                className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-400"
                onClick={() => {
                  const target = prizeToDelete;
                  setPrizeToDelete(null);
                  void removePrize(target);
                }}
              >
                Yes, delete
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${
        checked ? 'bg-emerald-400/80' : 'bg-white/15'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-white/40">{hint}</p>
      </div>
      <Toggle checked={checked} label={label} onChange={onChange} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-2 last:border-0 last:pb-0">
      <dt className="text-white/40">{label}</dt>
      <dd className="max-w-[62%] truncate text-right font-medium text-white/80">{value}</dd>
    </div>
  );
}
