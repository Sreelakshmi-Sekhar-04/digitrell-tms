/** @type {import('tailwindcss').Config} */
// Tokens from the approved design system ("DigitRell TMS UI Design" › Design system).
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0E6B7A', dark: '#0A5360', tint: '#E6F2F3', soft: '#F3F8F7' },
        ink: { DEFAULT: '#17212B', soft: '#2A3642', muted: '#52606D' },
        canvas: '#F5F7F6',
        line: { DEFAULT: '#E1E7E5', strong: '#CBD5D1', faint: '#EEF2F1' },
        attention: '#B45309',
        tone: {
          'neutral-bg': '#EDF1F5', neutral: '#334155',
          'action-bg': '#FDF0DF', action: '#8A3B0B',
          'progress-bg': '#E1F0FA', progress: '#0B4F78',
          'success-bg': '#E4F4E9', success: '#166534',
          'danger-bg': '#FCE9E9', danger: '#9F1D1D',
          'billing-bg': '#ECE9FB', billing: '#4C2B9A',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-grotesk)', '"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { btn: '10px', card: '14px' },
      boxShadow: { float: '0 12px 32px rgba(23,33,43,.14)' },
    },
  },
  plugins: [],
};
