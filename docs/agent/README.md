# For whoever is driving

Two files, and they are not the same kind of thing.

- **[workflow.md](workflow.md)** — the process. How a change gets made here, start to finish.
  Stable; it changes when the process changes.
- **[knowledge.md](knowledge.md)** — what has been learned. Appended to at the end of every run
  that learned something. It is expected to grow.

`.claude/commands/flow.md` is the executable form of `workflow.md`. If the two disagree, the command
is what runs — fix the prose.

## Why this instead of a root instruction file

A single instruction file at the repository root has to be *the* process, *the* conventions and
*the* accumulated scar tissue all at once. It gets long, nobody trims it, and the process becomes
harder to find inside it every time something is learned.

Splitting them means a run can append to knowledge without touching the process, and the process can
be read in one sitting.
