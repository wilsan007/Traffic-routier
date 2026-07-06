import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          500: '#2f5fdb',
          600: '#254bb0',
          700: '#1c3985',
          900: '#0f1f4a',
        },
      },
    },
  },
  plugins: [],
};

export default config;
