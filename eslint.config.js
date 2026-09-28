import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // noUncheckedIndexedAccess is on; `!` on in-bounds typed-array reads is intentional.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
