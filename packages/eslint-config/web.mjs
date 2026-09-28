import next from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

export const web = [
  ...next,
  ...typescript,
  { ignores: ['.next/**', 'next-env.d.ts', 'dist/**'] },
  { rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  prettier,
];
