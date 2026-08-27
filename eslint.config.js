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
  tseslint.configs.strictTypeChecked,
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

      // Both of these come from `strictTypeChecked` and both are off for the
      // same reason: `noUncheckedIndexedAccess` is on, and it is the stricter,
      // more valuable of the two settings.
      //
      // `no-non-null-assertion` fights it directly. Every `events[i]` in a
      // topological sort is `T | undefined` under that flag even where the
      // index is provably in range, and `!` is the documented way to say "I
      // checked". The alternative is a runtime branch that can never be taken
      // — which `no-unnecessary-condition` would then flag. The two rules
      // cannot both be satisfied here without rewriting the algorithm to avoid
      // indexing, which buys nothing.
      '@typescript-eslint/no-non-null-assertion': 'off',

      // `no-unnecessary-condition` reads the declared type, and at this
      // codebase's boundaries the declared type is the optimistic one. A story
      // and a plan arrive as parsed JSON: `FINDING_CATALOG[code]` is typed
      // total over `GateCode`, so `?.summary ?? ''` looks redundant — until a
      // story carries a code this build has never heard of. Deleting those
      // guards to satisfy the rule would trade a real runtime defence for a
      // type-level tidiness, at exactly the layer that treats its input as
      // hostile. It did find one genuinely dead branch when it was run, in
      // `runner/fixture.ts`; that is a reason to run it occasionally, not to
      // keep it on.
      '@typescript-eslint/no-unnecessary-condition': 'off',

      // Interpolating a number or a boolean is the normal way this codebase
      // builds a message. Interpolating an object is how `[object Object]`
      // reaches a finding's `message` and a reviewer learns nothing.
      '@typescript-eslint/restrict-template-expressions': ['error', {
        allowNumber: true,
        allowBoolean: true,
      }],

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
      '@typescript-eslint/unbound-method': 'off',
      // `run(...).json<Shape>()` is a type assertion wearing a type parameter,
      // which is exactly what the rule objects to — and exactly what a test
      // wants from a helper that parses the CLI's own output.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
    },
  },

  {
    files: ['*.js', '*.config.js', '*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
