/**
 * Tokens de design — TC Smart Eligibility
 *
 * ATENÇÃO: os valores de marca abaixo são um ponto de partida na família cromática
 * da Cielo (azul + verde), não os tokens oficiais. Ver docs/design/TOKENS.md.
 * Ao substituir pelos valores reais, altere SOMENTE este arquivo e rode de novo o
 * validador de paleta do skill `dataviz`.
 *
 * Uso no app (React + Tailwind):
 *   // tailwind.config.js
 *   const tokens = require('../../docs/design/tailwind.tokens');
 *   module.exports = { presets: [tokens], content: ['./src/**\/*.{ts,tsx}'] };
 *
 * Os modos claro e escuro trocam por CSS custom properties, não por classes `dark:`
 * espalhadas — assim o tema do visualizador e a preferência do SO funcionam nos dois
 * sentidos, e o componente é escrito contra papéis, não contra hex.
 */

const withAlpha = (v) => `rgb(from var(${v}) r g b / <alpha-value>)`;

/** Valores crus — a fonte da verdade. O CSS de :root é gerado a partir daqui. */
const raw = {
  light: {
    brand: '#0057b8',
    'brand-alt': '#00a758',
    'brand-ink': '#003a7a',

    bg: '#f4f6f9',
    surface: '#ffffff',
    sunken: '#e8ecf2',
    ink: '#0b1a2b',
    'ink-2': '#44566b',
    muted: '#7a8b9c',
    line: '#d7dee7',
  },
  dark: {
    brand: '#2e86e0',
    'brand-alt': '#14a05f',
    'brand-ink': '#4c9ee8',

    bg: '#0a1119',
    surface: '#101b26',
    sunken: '#0d1620',
    ink: '#eef3f8',
    'ink-2': '#a2b3c4',
    muted: '#6d8095',
    line: '#1c2b3a',
  },
  /** Semânticas: fixas nos dois modos, sempre acompanhadas de rótulo ou ícone. */
  status: {
    good: '#0ca30c',
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b',
  },
};

const roles = [...Object.keys(raw.light), ...Object.keys(raw.status)];

module.exports = {
  raw,

  theme: {
    extend: {
      colors: Object.fromEntries(roles.map((r) => [r, withAlpha(`--c-${r}`)])),

      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },

      fontSize: {
        display: ['clamp(29px, 4.4vw, 45px)', { lineHeight: '1.02', letterSpacing: '-0.035em', fontWeight: '760' }],
        h2: ['clamp(19px, 2.4vw, 24px)', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '660' }],
        h3: ['15px', { lineHeight: '1.3', letterSpacing: '-0.008em', fontWeight: '620' }],
        body: ['15px', { lineHeight: '1.55' }],
        support: ['13px', { lineHeight: '1.5' }],
        label: ['10px', { lineHeight: '1.4', letterSpacing: '0.14em' }],
      },

      borderRadius: { none: '0', sm: '2px', DEFAULT: '3px' },
    },
  },

  plugins: [
    /** Publica os papéis como custom properties e liga os dois mecanismos de tema. */
    function ({ addBase }) {
      const vars = (set) => Object.fromEntries(Object.entries(set).map(([k, v]) => [`--c-${k}`, v]));

      addBase({
        ':root': { colorScheme: 'light', ...vars(raw.light), ...vars(raw.status) },
        // preferência do sistema, sem sobrepor um tema estampado explicitamente
        '@media (prefers-color-scheme: dark)': {
          ':root:where(:not([data-theme="light"]))': { colorScheme: 'dark', ...vars(raw.dark) },
        },
        // alternador do visualizador — precisa vencer nos dois sentidos
        ':root[data-theme="dark"]': { colorScheme: 'dark', ...vars(raw.dark) },
        ':root[data-theme="light"]': { colorScheme: 'light', ...vars(raw.light) },
      });
    },
  ],
};
