import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Static analysis, tuned for what can actually go wrong here.
 *
 * The rules that earn their place are the type-aware ones. This codebase is
 * asynchronous end to end — a DAP session, a browser, a fixture process, a
 * gate — and a dropped promise does not throw. It produces a story missing the
 * probe hits that arrived late, which the gate then reports as a line that
 * never ran. That is a false block with no stack trace, so `no-floating-
 * promises` is an error, not a warning.
 *
 * Style is deliberately not enforced. A formatter would rewrite six thousand
 * lines to settle questions that have never cost this project anything.
 */
export default tseslint.config(
  {
    // `worktrees/` holds external repositories cloned for verification
    // experiments. They are someone else's code with someone else's rules.
    ignores: ['**/dist/**', '**/node_modules/**', '.venv/**', 'fixtures/**', '.witness/**', 'worktrees/**', '.evidence/**'],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // `projectService` resolves each file to its nearest tsconfig, and the
        // build configs include only src/ — so tests would resolve to a
        // project that excludes them. One program over the whole repo avoids
        // that, and the repo is small enough that the cost is invisible.
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Correctness, in the order these have actually bitten.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],
      // Off, not on: implementing an async interface synchronously is normal
      // and correct here. `VcsProvider.describe` returns a promise because a
      // host provider may need to; `local` does not, and rewriting it to
      // satisfy the rule would say the opposite of what is true.
      '@typescript-eslint/require-await': 'off',

      // The story event union has six members. A switch that silently ignores
      // a new one is how a viewer stops rendering an event type nobody
      // notices is missing. A `default` clause counts as handling the rest —
      // a pass-through switch is a deliberate shape, not an oversight.
      '@typescript-eslint/switch-exhaustiveness-check': ['error', {
        considerDefaultExhaustiveForUnions: true,
        allowDefaultCaseForExhaustiveSwitch: true,
      }],

      // A story is untrusted input. `any` from JSON.parse spreading through
      // the code is exactly how a validated boundary stops being one.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',

      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],

      // `Array<{ file: string; line: number }>` reads better than the postfix
      // form for an inline object type, and worse for a simple one.
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],

      // Reads worse than the explicit form in the code this project writes.
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/consistent-indexed-object-style': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    // Tests reach into internals, build hostile inputs on purpose, and assert
    // on things a rule would call redundant.
    files: ['**/test/**/*.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  {
    files: ['*.js', '*.config.js', '*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
