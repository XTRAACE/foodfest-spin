import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BadgeCheck, Dices, Sparkles, Ticket, UserPlus, Users, Volume2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { ErrorNote, Modal, Spinner } from '../components/ui';
import { speak, speechSupported } from '../lib/voice';

interface Status {
  eventName: string;
  eventStatus: string;
  mode: 'demo' | 'real';
  registrationOpen: boolean;
  registeredCustomers: number;
}

interface Success {
  numberLabel: string;
  name: string;
  groupNumber: number;
  course: string | null;
  classLevel: string | null;
  selected: boolean;
}

interface Winner {
  groupNumber: number;
  numberLabel: string;
  name: string;
  you: boolean;
}

interface Participant {
  numberLabel: string;
  groupNumber: number;
  name: string;
  rollNo: string | null;
  course: string | null;
  classLevel: string | null;
}

const COURSES = ['Science', 'Commerce', 'Arts'] as const;
const CLASSES = ['+1', '+2'] as const;

export default function Register() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status | null>(null);
  const [name, setName] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [course, setCourse] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);
  const [duplicate, setDuplicate] = useState<number | null>(null);
  const [winner, setWinner] = useState<Winner | null>(null);

  const [liveSpin, setLiveSpin] = useState<{ code: string; customerNumberLabel: string; customerName: string } | null>(null);

  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsError, setParticipantsError] = useState<string | null>(null);

  useEffect(() => {
    api.publicStatus().then(setStatus).catch(() => setError('Cannot reach the event server.'));
  }, []);

  // Shows a spin started at the physical machine, even on another phone.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await api.publicLucky();
        if (active) setLiveSpin(next.pendingSpin);
      } catch {
        // ignore; the next poll retries
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const openParticipants = async () => {
    setParticipantsOpen(true);
    setParticipantsLoading(true);
    setParticipantsError(null);
    try {
      const res = await api.participants();
      setParticipants(res.participants);
    } catch (err) {
      setParticipantsError(err instanceof Error ? err.message : 'Could not load participants.');
    } finally {
      setParticipantsLoading(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setDuplicate(null);
    try {
      const result = await api.register({
        name: name.trim(),
        rollNo: rollNo.trim() || undefined,
        course,
        classLevel,
      });
      setSuccess({
        numberLabel: result.customer.numberLabel,
        name: result.customer.name,
        groupNumber: result.groupNumber,
        course: result.customer.course,
        classLevel: result.customer.classLevel,
        selected: result.selected,
      });
      setName('');
      setRollNo('');
      setCourse('');
      setClassLevel('');
      setStatus((current) =>
        current ? { ...current, registeredCustomers: current.registeredCustomers + 1 } : current,
      );

      // Every third registration completes a group: announce the random winner.
      if (result.groupComplete && result.selectedCustomer) {
        const picked = result.selectedCustomer;
        setWinner({
          groupNumber: result.groupNumber,
          numberLabel: picked.numberLabel,
          name: picked.name,
          you: result.selected,
        });
        speak(
          `Group ${result.groupNumber} is complete. ${picked.name}, customer number ${picked.numberLabel}, is selected for the lucky spin. Please come to the wheel.`,
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_CUSTOMER') {
        const details = err.details as { customerNumber?: number } | undefined;
        setDuplicate(details?.customerNumber ?? null);
      }
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const closed = status && (!status.registrationOpen || status.eventStatus !== 'active');

  return (
    <div className="mx-auto min-h-screen w-full max-w-md px-4 pb-12 pt-5">
      <header className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-300 text-lg shadow-glow">
            🎡
          </span>
          <div className="leading-tight">
            <p className="font-display text-base font-bold">{status?.eventName ?? 'Food Fest'}</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">Lucky spin</p>
          </div>
        </div>
        <Link to="/spin" className="btn-secondary px-3 py-2 text-xs">
          <Ticket size={14} /> Wheel
        </Link>
      </header>

      {liveSpin && (
        <Link
          to="/spin"
          className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-gold/35 bg-gold/10 px-4 py-3"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gold">
            <Dices size={17} className="shrink-0 animate-pulse" />
            <span className="truncate">
              Wheel spinning — {liveSpin.customerNumberLabel} {liveSpin.customerName}
            </span>
          </span>
          <span className="shrink-0 text-xs text-gold/80">Watch</span>
        </Link>
      )}

      {success ? (
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-6 text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
            <BadgeCheck size={30} />
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
            You are registered
          </p>
          <p className="mt-2 font-display text-7xl font-extrabold leading-none gold-text">
            {success.numberLabel}
          </p>
          <p className="mt-2 text-lg font-semibold">{success.name}</p>
          {(success.course || success.classLevel) && (
            <p className="mt-1 text-sm text-white/45">
              {[success.course, success.classLevel].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/60">
            Group {success.groupNumber}
            {success.selected ? ' · you were randomly selected to spin!' : ' · wait for your group draw.'}
          </p>

          {success.selected && (
            <button
              className="btn-primary mt-4 w-full py-3"
              onClick={() => {
                navigate('/spin?auto=1');
              }}
            >
              <Sparkles size={17} /> Go to the spinning wheel
            </button>
          )}

          <button className="btn-secondary mt-3 w-full" onClick={() => setSuccess(null)}>
            <UserPlus size={16} /> Register next participant
          </button>
        </motion.section>
      ) : (
        <section className="card p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">Participant details</h1>
              <p className="mt-1 text-xs text-white/45">
                Every 3 registrations pick one lucky participant at random.
              </p>
            </div>
            <button type="button" className="btn-secondary shrink-0 px-3 py-2 text-xs" onClick={() => void openParticipants()}>
              <Users size={14} /> {status?.registeredCustomers ?? 0}
            </button>
          </div>

          {closed ? (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5 text-sm text-amber-100">
              Registration is closed right now. Please contact the Food Fest help desk.
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3.5">
              <div>
                <label className="label" htmlFor="name">Name</label>
                <input
                  id="name"
                  required
                  minLength={2}
                  maxLength={80}
                  className="input py-3"
                  placeholder="Your full name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="rollNo">
                  Roll no <span className="font-normal normal-case tracking-normal text-white/25">(optional)</span>
                </label>
                <input
                  id="rollNo"
                  maxLength={20}
                  className="input py-3"
                  placeholder="e.g. 21CS045"
                  value={rollNo}
                  onChange={(event) => setRollNo(event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="course">Course</label>
                  <select
                    id="course"
                    required
                    className="input py-3"
                    value={course}
                    onChange={(event) => setCourse(event.target.value)}
                  >
                    <option value="">Select</option>
                    {COURSES.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="classLevel">Class</label>
                  <select
                    id="classLevel"
                    required
                    className="input py-3"
                    value={classLevel}
                    onChange={(event) => setClassLevel(event.target.value)}
                  >
                    <option value="">Select</option>
                    {CLASSES.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
              </div>

              {error && <ErrorNote message={error} />}
              {duplicate && (
                <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/50">
                  Already registered? Your number is{' '}
                  <span className="font-semibold text-gold">{String(duplicate).padStart(3, '0')}</span>.
                </p>
              )}

              <button type="submit" className="btn-primary w-full py-3.5 text-base" disabled={loading}>
                {loading ? <Spinner /> : <Ticket size={18} />}
                {loading ? 'Registering…' : 'Register'}
              </button>
            </form>
          )}
        </section>
      )}

      <footer className="mt-5 flex items-center justify-between px-1 text-[11px] text-white/30">
        <span>Numbers are sequential and never reused.</span>
        <Link to="/admin/login" className="hover:text-white/60">Admin</Link>
      </footer>

      {/* Winner announcement popup */}
      <Modal
        open={Boolean(winner)}
        onClose={() => setWinner(null)}
        title={winner ? `Group ${winner.groupNumber} complete` : ''}
      >
        {winner && (
          <div className="text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
              <Sparkles size={13} /> Randomly selected
            </p>
            <p className="mt-4 font-display text-6xl font-extrabold leading-none gold-text">
              {winner.numberLabel}
            </p>
            <p className="mt-2 text-xl font-bold">{winner.name}</p>
            <p className="mt-2 text-sm text-white/50">
              {winner.you
                ? 'You have the lucky number! Take the phone to the spinning wheel.'
                : 'Please come to the spinning wheel for the lucky draw.'}
            </p>

            <button
              className="btn-primary mt-5 w-full py-3 text-base"
              onClick={() => {
                setWinner(null);
                navigate('/spin?auto=1');
              }}
            >
              <Ticket size={18} /> Start the spinning wheel
            </button>

            <button
              className="btn-secondary mt-2 w-full"
              onClick={() => {
                if (speechSupported()) {
                  speak(
                    `${winner.name}, customer number ${winner.numberLabel}, is selected for the lucky spin. Please come to the wheel.`,
                  );
                }
              }}
            >
              <Volume2 size={16} /> Announce again
            </button>
          </div>
        )}
      </Modal>

      {/* Participation list */}
      <Modal
        open={participantsOpen}
        onClose={() => setParticipantsOpen(false)}
        title={`Participants (${participants.length})`}
      >
        {participantsLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner className="h-7 w-7" />
          </div>
        ) : participantsError ? (
          <ErrorNote message={participantsError} />
        ) : participants.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/40">No participants yet.</p>
        ) : (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {participants.map((participant) => (
              <li
                key={participant.numberLabel}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{participant.name}</p>
                  <p className="truncate text-[11px] text-white/40">
                    {[participant.rollNo, participant.course, participant.classLevel].filter(Boolean).join(' · ') || 'No details'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-xs text-gold">{participant.numberLabel}</p>
                  <p className="text-[10px] text-white/30">Group {participant.groupNumber}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
