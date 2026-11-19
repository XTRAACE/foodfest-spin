/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: '#120709',
        plum: '#1c0b12',
        ember: '#f97316',
        chili: '#ef4444',
        gold: '#fbbf24',
        cream: '#fff7ed',
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        display: ['"Baloo 2"', 'Outfit', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 60px rgba(249, 115, 22, 0.35)',
        wheel: '0 30px 80px -20px rgba(0,0,0,0.85), 0 0 0 12px rgba(251, 191, 36, 0.08)',
      },
      backgroundImage: {
        'fest-radial':
          'radial-gradient(circle at 20% 10%, rgba(239,68,68,0.22), transparent 45%), radial-gradient(circle at 85% 0%, rgba(251,191,36,0.18), transparent 40%), radial-gradient(circle at 50% 100%, rgba(249,115,22,0.16), transparent 55%)',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
      },
      animation: {
        'glow-pulse': 'glow-pulse 3s ease-in-out infinite',
        float: 'float 5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
