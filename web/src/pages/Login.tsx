import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, LockKeyhole, Sparkles } from 'lucide-react';
import { api, getToken, setToken } from '../lib/api';
import { ErrorNote, Spinner } from '../components/ui';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@foodfest.local');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getToken()) navigate('/admin', { replace: true });
  }, [navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await api.login(email, password);
      setToken(result.token);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <Link to="/" className="mb-6 inline-flex items-center gap-2 text-xs text-white/45 hover:text-white">
          <ArrowLeft size={14} /> Back to registration
        </Link>

        <div className="card p-7">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-300 text-2xl shadow-glow">
              🎡
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold/80">Food Fest</p>
              <h1 className="font-display text-2xl font-bold leading-none">Admin sign in</h1>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                className="input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@foodfest.local"
              />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                required
                className="input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && <ErrorNote message={error} />}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? <Spinner /> : <LockKeyhole size={16} />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-5 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-white/45">
            <Sparkles size={14} className="mt-0.5 shrink-0 text-gold" />
            First run creates <span className="text-white/70">admin@foodfest.local</span> with the password
            from <span className="text-white/70">ADMIN_PASSWORD</span> (default <span className="text-white/70">admin12345</span>).
            Change it in Settings after signing in.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
