import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Dices, RefreshCw, Sparkles, Volume2 } from 'lucide-react';
import { api } from '../lib/api';
import { sound } from '../lib/sound';
import { speak, stopSpeaking } from '../lib/voice';
import type { PublicLuckyState, PublicSpin, ReadyCustomer } from '../lib/types';
import { Wheel } from '../components/Wheel';
import { ErrorNote, Spinner } from '../components/ui';

const DEFAULT_SPIN_MS = 6400;
const POLL_MS = 1000;

function newSpinKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `site-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function Spin() {
  const [params] = useSearchParams();
  const auto = params.get('auto') === '1';

  const [state, setState] = useState<PublicLuckyState | null>(null);
  const [rotation, setRotation] = useState(0);
  const [spinMs, setSpinMs] = useState(DEFAULT_SPIN_MS);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<PublicSpin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);

  const rotationRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const handledRef = useRef<string | null>(null);

  /** Ends the animation: announces the prize and confirms the spin once. */
  const finish = useCallback((spin: PublicSpin) => {
    busyRef.current = false;
    setSpinning(false);
    setStarting(false);
    setResult(spin);
    sound.stopSpin();
    if (/better luck|lose|try again/i.test(spin.prizeName)) sound.lose();
    else sound.win();
    speak(
      `Customer ${spin.customerNumberLabel}, ${spin.customerName}. You won ${spin.prizeName}! Congratulations.`,
    );
    void api.completePublicSpin(spin.code).catch(() => undefined);
    void api.publicLucky().then(setState).catch(() => undefined);
  }, []);

  /**
   * Mirrors a spin over `durationMs`. When the physical machine started it, the
   * server sends the firmware's show duration and the time already elapsed, so
   * the phone lands on the same prize at the same moment.
   */
  const animate = useCallback(
    (spin: PublicSpin, durationMs: number) => {
      const ms = Math.max(900, Math.round(durationMs));
      handledRef.current = spin.code;
      busyRef.current = true;
      setResult(null);
      setError(null);
      setStarting(false);
      setSpinMs(ms);

      const current = rotationRef.current;
      const normalized = ((current % 360) + 360) % 360;
      const delta = (((360 - spin.wheelAngle) % 360) - normalized + 360) % 360;
      const next = current + 360 * 6 + delta;
      rotationRef.current = next;
      setRotation(next);
      setSpinning(true);
      sound.spin(ms);

      timerRef.current = window.setTimeout(() => finish(spin), ms);
    },
    [finish],
  );

  const start = useCallback(
    async (customer: ReadyCustomer) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setStarting(true);
      setError(null);
      try {
        const res = await api.publicSpin(customer.number, newSpinKey());
        animate(res.spin, res.spin.remainingMs || res.spin.durationMs || DEFAULT_SPIN_MS);
      } catch (err) {
        busyRef.current = false;
        setStarting(false);
        setError(err instanceof Error ? err.message : 'Could not start the spin.');
      }
    },
    [animate],
  );

  /** Pulls the state so a joystick press on the machine shows up here too. */
  const sync = useCallback(async () => {
    try {
      const next = await api.publicLucky();
      setState(next);
      setError(null);
      if (next.pendingSpin && next.pendingSpin.code !== handledRef.current) {
        animate(next.pendingSpin, next.pendingSpin.remainingMs);
      }
    } catch {
      // Keep the last known state; the next poll retries.
    }
  }, [animate]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const next = await api.publicLucky();
        if (cancelled) return;
        setState(next);
        setLoading(false);
        if (next.pendingSpin) {
          animate(next.pendingSpin, next.pendingSpin.remainingMs);
          return;
        }
        if (auto && next.readyCustomer) void start(next.readyCustomer);
      } catch (err) {
        if (cancelled) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Cannot reach the event server.');
      }
    })();

    return () => {
      cancelled = true;
      sound.stopSpin();
      stopSpeaking();
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [animate, auto, start]);

  // Live sync: picks up a spin started from the physical joystick.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!busyRef.current) void sync();
    }, POLL_MS);
    return () => window.clearInterval(interval);
  }, [sync]);

  const customer = state?.readyCustomer ?? null;
  const canSpin = Boolean(customer) && !spinning && !starting && !result && state?.mode === 'real';

  return (
    <div className="mx-auto min-h-screen w-full max-w-md px-4 pb-10 pt-5">
      <header className="mb-4 flex items-center justify-between">
        <Link to="/" className="btn-ghost h-9 px-2 text-xs">
          <ChevronLeft size={16} /> Back
        </Link>
        <span className="max-w-[55%] truncate text-[11px] uppercase tracking-[0.18em] text-white/40">
          {state?.eventName ?? 'Lucky spin'}
        </span>
        <button className="btn-ghost h-9 px-2 text-xs" onClick={() => void sync()} aria-label="Refresh">
          <RefreshCw size={15} />
        </button>
      </header>

      {loading && !state ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : !state ? (
        <ErrorNote message={error ?? 'Cannot reach the event server.'} />
      ) : (
        <>
          <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center">
            {customer ? (
              <>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">Selected customer</p>
                <p className="mt-1 font-display text-2xl font-extrabold">
                  <span className="gold-text">{customer.numberLabel}</span> {customer.name}
                </p>
                <p className="text-[11px] text-white/40">Group {customer.groupNumber}</p>
              </>
            ) : (
              <p className="text-sm text-white/55">
                {state.mode === 'demo'
                  ? 'The wheel is off during demo mode.'
                  : 'Waiting for the next group of three registrations.'}
              </p>
            )}
          </div>

          <div className="mx-auto w-full max-w-[360px]">
            <Wheel
              wheel={state.wheel}
              rotation={rotation}
              spinning={spinning}
              durationMs={spinMs}
              size={360}
              highlightPrizeId={result?.prizeId ?? null}
            />
          </div>

          <div className="mt-5">
            {error && <ErrorNote message={error} />}

            {!result && (
              <>
                <button
                  className="btn-primary w-full py-4 text-base"
                  disabled={!canSpin}
                  onClick={() => {
                    if (customer) void start(customer);
                  }}
                >
                  {spinning || starting ? <Spinner /> : <Dices size={20} />}
                  {spinning ? 'Spinning…' : starting ? 'Starting…' : 'Spin the wheel'}
                </button>
                <p className="mt-2 text-center text-[11px] text-white/30">
                  The joystick on the machine starts the same spin.
                </p>
              </>
            )}

            {result && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="card relative overflow-hidden border-gold/30 p-5 text-center"
              >
                <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-gold/20 blur-2xl" />
                <p className="flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                  <Sparkles size={13} /> You won
                </p>
                <p className="mt-2 font-display text-3xl font-extrabold gold-text">{result.prizeName}</p>
                <p className="mt-2 text-xs text-white/45">
                  {result.customerNumberLabel} · {result.customerName}
                </p>
                <button
                  className="btn-secondary mt-4 w-full"
                  onClick={() =>
                    speak(
                      `Customer ${result.customerNumberLabel}, ${result.customerName}. You won ${result.prizeName}! Congratulations.`,
                    )
                  }
                >
                  <Volume2 size={16} /> Announce again
                </button>
              </motion.div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
