import { base } from './base.mjs';
import tseslint from 'typescript-eslint';

export const api = tseslint.config(...base, {
  files: ['src/**/*.ts', 'test/**/*.ts'],
  extends: [...tseslint.configs.recommendedTypeChecked],
  languageOptions: { parserOptions: { projectService: true } },
  rules: { '@typescript-eslint/consistent-type-imports': 'off' },
});
