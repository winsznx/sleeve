import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['node_modules/**', '.next/**', '.next-*/**', '.open-next/**', '.wrangler/**', 'out/**', 'next-env.d.ts', 'src/styles/**', 'src/generated/**'],
  },
];

export default eslintConfig;
