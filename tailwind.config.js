/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        elevated: v('elevated'),
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3') },
        accent: v('accent'),
        'on-accent': v('on-accent'),
        green: v('green'),
        red: v('red'),
        orange: v('orange'),
        purple: v('purple'),
        teal: v('teal'),
        pink: v('pink'),
        indigo: v('indigo'),
        line: 'var(--line)',
        fill: 'var(--fill)',
        'fill-2': 'var(--fill-2)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          'Inter',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'sheet-in': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'pop-in': {
          from: { opacity: 0, transform: 'scale(.96) translateY(8px)' },
          to: { opacity: 1, transform: 'scale(1) translateY(0)' },
        },
        'toast-in': {
          from: { opacity: 0, transform: 'translateY(-12px) scale(.96)' },
          to: { opacity: 1, transform: 'translateY(0) scale(1)' },
        },
        pulse_ring: {
          '0%': { transform: 'scale(1)', opacity: 0.5 },
          '100%': { transform: 'scale(1.25)', opacity: 0 },
        },
      },
      animation: {
        'fade-in': 'fade-in .2s ease-out',
        'sheet-in': 'sheet-in .32s cubic-bezier(.32,.72,0,1)',
        'pop-in': 'pop-in .24s cubic-bezier(.32,.72,0,1)',
        'toast-in': 'toast-in .3s cubic-bezier(.32,.72,0,1)',
        'pulse-ring': 'pulse_ring 2s cubic-bezier(.2,.6,.4,1) infinite',
      },
    },
  },
  plugins: [],
};
