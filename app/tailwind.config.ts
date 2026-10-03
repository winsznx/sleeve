import type { Config } from 'tailwindcss';

import sleeveTheme from './src/styles/tailwind-theme.cjs';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    // Sleeve's semantic colors only. The stock palette is dropped so a raw palette class generates nothing.
    colors: {},
    extend: sleeveTheme,
  },
  plugins: [],
};

export default config;
