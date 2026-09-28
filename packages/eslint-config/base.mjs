import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export const base = tseslint.config(
  { ignores: ['dist/**', 'dist-test/**', '.next/**', 'src/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
