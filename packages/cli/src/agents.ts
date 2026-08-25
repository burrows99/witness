/**
 * Steering surfaces — `AGENTS.md` and vendor hooks.
 *
 * Both are advisory. `AGENTS.md` is portable and does not bind; a vendor hook
 * binds but is not portable. Only CI is both, which is why the gate lives
 * there and these exist purely as fast feedback (TDD §4).
 *
 * They are generated from one source so what they claim cannot drift from
 * what the gate does, and so adding a vendor is a template rather than code.
 */

export const AGENTS_BEGIN = '<!-- swe-verify:begin (generated — edits inside this block are overwritten) -->'
export const AGENTS_END = '<!-- swe-verify:end -->'

export function renderAgentsBlock(): string {
  return `${AGENTS_BEGIN}
## Verification (swe-verify)

Changing code here means proving it ran. One command does both:

\`\`\`bash
swe-verify verify --plan <plan-id> --json
\`\`\`

If no plan covers what you are changing, write one first — it is committed
alongside the change, and a reviewer reads it before they look at whether the
run went green:

\`\`\`bash
swe-verify plan --intent "<what this change proves>" --scope "<glob>" --json
\`\`\`

Read the JSON verdict. Every finding carries a \`remedy\` saying what to do next.
The gate blocks when:

- a changed line was **never executed** (\`SV010\`) — add a step that reaches it,
  or waive it with a dated reason;
- a probe was accepted but **never verified** (\`SV011\`) — that is a path-mapping
  problem, run \`swe-verify doctor\`;
- the evidence is **stale** (\`SV003\`) — the code changed after the run, so run it again;
- an **assertion failed** (\`SV020\`).

Exit codes: \`0\` allow · \`2\` block · \`3\` usage/config · \`4\` harness failure (our bug,
not yours) · \`5\` bypassed and recorded.

The same gate runs in CI whether or not you run it locally. Running it here is
how you find out before review, not a way around it. Never narrow a plan's
scope or delete its assertions to turn a red gate green.
${AGENTS_END}
`
}

/**
 * Insert or replace the managed block, leaving everything a human wrote
 * around it untouched. A generator that clobbers the file gets deleted.
 */
export function upsertAgentsBlock(existing: string): string {
  const block = renderAgentsBlock()
  const start = existing.indexOf(AGENTS_BEGIN)
  const end = existing.indexOf(AGENTS_END)

  if (start >= 0 && end > start) {
    return existing.slice(0, start) + block.trimEnd() + existing.slice(end + AGENTS_END.length)
  }
  const prefix = existing.trimEnd()
  return prefix ? `${prefix}\n\n${block}` : block
}

export interface VendorHook {
  vendor: string
  /** Where the shim goes, relative to the repository root. */
  path: string
  /** File mode, for hooks that must be executable. */
  mode?: number
  render(): string
}

/**
 * `gate --quiet` at commit time: fast feedback on the developer's machine.
 *
 * Exit 4 deliberately does not block a commit. "Our debugger failed to
 * attach" is not the developer's problem to solve at commit time, and a hook
 * that blocks on it gets uninstalled within a day (M5, R3).
 */
export function renderPreCommitHook(): string {
  return `#!/bin/sh
# swe-verify — advisory pre-commit check (generated).
#
# This is fast feedback, not the gate. CI runs the same binary and is what
# actually blocks a merge; this hook only saves you a round trip.
#
# Exit codes: 0 allow · 2 block · 3 usage/config · 4 harness failure · 5 bypassed.
command -v swe-verify >/dev/null 2>&1 || exit 0

swe-verify gate --quiet
status=$?

case "$status" in
  0|5) exit 0 ;;
  4)
    echo "swe-verify: harness failure (exit 4) — not blocking your commit; CI will report it." >&2
    exit 0
    ;;
  *)
    echo "swe-verify: blocked (exit $status). Run 'swe-verify verify --plan <plan>' to see why." >&2
    exit 2
    ;;
esac
`
}

function renderClaudeCodeHook(): string {
  // A settings fragment rather than a settings file: the user's own settings
  // are theirs, and merging is their decision.
  return `${JSON.stringify(
    {
      // JSON carries no comments, so the note is a key: anyone reading this
      // file has to be able to tell it is advisory, not the gate.
      '//': 'swe-verify — advisory fast feedback. CI runs the same binary and is what blocks a merge.',
      hooks: {
        Stop: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: 'swe-verify gate --json || true',
                timeout: 120,
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  )}
`
}

function renderCursorRule(): string {
  return `# swe-verify (generated)

Advisory fast feedback; CI runs the same binary and is what blocks a merge.

After changing code, run:

    swe-verify verify --plan <plan-id> --json

Read the JSON verdict and act on each finding's \`remedy\`. Do not narrow a
plan's scope or remove assertions to turn a red gate green.
`
}

export const VENDOR_HOOKS: VendorHook[] = [
  { vendor: 'git', path: '.git/hooks/pre-commit', mode: 0o755, render: renderPreCommitHook },
  { vendor: 'claude-code', path: '.claude/swe-verify.settings.json', render: renderClaudeCodeHook },
  { vendor: 'cursor', path: '.cursor/rules/swe-verify.md', render: renderCursorRule },
]
