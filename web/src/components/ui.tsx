import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-white/50">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  accent?: 'default' | 'gold' | 'green' | 'red';
}) {
  const accents: Record<string, string> = {
    default: 'from-white/10 to-transparent text-white/80',
    gold: 'from-amber-400/25 to-transparent text-gold',
    green: 'from-emerald-400/25 to-transparent text-emerald-300',
    red: 'from-red-500/25 to-transparent text-red-300',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card relative overflow-hidden p-5"
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${accents[accent]} opacity-40`} />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">{label}</p>
          <p className="mt-2 text-3xl font-bold text-cream">{value}</p>
          {hint && <p className="mt-1 text-xs text-white/40">{hint}</p>}
        </div>
        {icon && <span className="rounded-xl border border-white/10 bg-black/20 p-2">{icon}</span>}
      </div>
    </motion.div>
  );
}

export function StatusDot({ online }: { online: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span
        className={`absolute inline-flex h-full w-full rounded-full ${
          online ? 'animate-ping bg-emerald-400/60' : 'bg-transparent'
        }`}
      />
      <span
        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
          online ? 'bg-emerald-400' : 'bg-red-400'
        }`}
      />
    </span>
  );
}

export function ModeBadge({ mode }: { mode: 'demo' | 'real' }) {
  return mode === 'demo' ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-400/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-200">
      Demo mode
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-200">
      Real mode
    </span>
  );
}

export function SpinStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    pending: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    spinning: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    cancelled: 'border-white/15 bg-white/5 text-white/50',
    failed: 'border-red-400/30 bg-red-400/10 text-red-200',
  };
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize ${
        styles[status] ?? styles.cancelled
      }`}
    >
      {status}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className={`card w-full ${width} max-h-[92vh] overflow-y-auto rounded-b-none rounded-t-3xl p-6 sm:rounded-3xl`}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="btn-ghost h-9 w-9 rounded-lg p-0" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-14 text-center">
      <p className="font-display text-lg text-white/70">{title}</p>
      {hint && <p className="max-w-sm text-sm text-white/40">{hint}</p>}
      {action}
    </div>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-white/20 border-t-gold ${className}`}
    />
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      {message}
    </div>
  );
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
