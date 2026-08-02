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
    blue: '#0a6aea',
    cyan: '#00aeef',
    navy: '#12263f',
    lime: '#c8d400',

    bg: '#ffffff',
    band: '#f0f2f4',
    surface: '#ffffff',
    tint: '#eef2f7',
    ink: '#12263f',
    'ink-2': '#4a5a6a',
    muted: '#7b8896',
    line: '#dde3e9',
  },
  dark: {
    blue: '#4a9bff',
    cyan: '#33c3f2',
    navy: '#eef3f8',
    lime: '#c8d400',

    bg: '#0a1420',
    band: '#0e1b2b',
    surface: '#122236',
    tint: '#17293e',
    ink: '#eef3f8',
    'ink-2': '#9fb1c4',
    muted: '#6b7f94',
    line: '#1e3048',
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
        display: ['clamp(30px, 4.4vw, 46px)', { lineHeight: '1.08', fontWeight: '700' }],
        h2: ['clamp(21px, 2.6vw, 30px)', { lineHeight: '1.18', fontWeight: '700' }],
        h3: ['17px', { lineHeight: '1.3', fontWeight: '600' }],
        body: ['16px', { lineHeight: '1.55' }],
        support: ['14px', { lineHeight: '1.5' }],
        label: ['11px', { lineHeight: '1.4', letterSpacing: '0.12em' }],
      },

      // linguagem de forma da Cielo: botões em pílula, cantos generosos nos cartões
      borderRadius: { none: '0', sm: '8px', DEFAULT: '12px', lg: '16px', full: '9999px' },
      boxShadow: { card: '0 2px 14px rgba(18,38,63,.07)' },
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
