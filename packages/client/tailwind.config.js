/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Anthropic Sans"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Menlo', 'monospace'],
      },
      colors: {
        primary: {
          50:  '#fdf8f3',
          100: '#f9edd9',
          200: '#f3d9b9',
          300: '#e8be95',
          400: '#d4a27f',
          500: '#c4875f',
          600: '#b06844',
          700: '#8c4e2c',
          800: '#6b3819',
          900: '#4d270d',
        },
        dark: {
          base:   '#09090b',
          nav:    '#0b0c0e',
          panel:  '#0f1013',
          card:   '#141417',
          input:  '#111215',
          border: '#222226',
          hover:  '#1a1a1e',
          active: '#252527',
        },
        ink: {
          primary:   '#dedede',
          secondary: '#9e9e9e',
          muted:     '#505050',
        },
      },
      keyframes: {
        'dot-bounce': {
          '0%, 80%, 100%': { transform: 'scale(0.6)', opacity: '0.4' },
          '40%': { transform: 'scale(1)', opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'cursor-blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
      animation: {
        'dot-bounce': 'dot-bounce 1.4s infinite ease-in-out both',
        'fade-in': 'fade-in 0.25s ease-out',
        'cursor-blink': 'cursor-blink 1s step-end infinite',
      },
    },
  },
  plugins: [],
};
