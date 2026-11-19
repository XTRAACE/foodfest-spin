let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

function tone(frequency: number, duration: number, type: OscillatorType, gainValue: number, delay = 0) {
  const ctx = audio();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  const start = ctx.currentTime + delay;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

let spinToken = 0;

export const sound = {
  tick(): void {
    tone(880 + Math.random() * 120, 0.045, 'square', 0.035);
  },
  spinStart(): void {
    tone(220, 0.35, 'sawtooth', 0.04);
    tone(330, 0.3, 'sine', 0.03, 0.08);
  },
  win(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      tone(frequency, 0.45, 'triangle', 0.07, index * 0.12);
    });
  },
  lose(): void {
    tone(392, 0.25, 'sine', 0.05);
    tone(311, 0.4, 'sine', 0.05, 0.16);
  },
  /** Wheel clicks for the whole spin: fast at the start, slowing to the end. */
  spin(durationMs = 6400): void {
    const token = ++spinToken;
    const startedAt = performance.now();
    const schedule = () => {
      if (token !== spinToken) return;
      const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
      sound.tick();
      if (progress >= 1) return;
      setTimeout(schedule, 38 + Math.pow(progress, 3) * 460);
    };
    schedule();
  },
  stopSpin(): void {
    spinToken += 1;
  },
};
