# Evidence, not pass/fail

A test run answers one bit: did it pass. Almost every question anyone actually has needs more than
that bit.

- A reviewer asks *what does this look like now* — and gets a green tick.
- A pull request needs *before and after* — and someone records their screen by hand.
- A failure needs *what was the app doing* — and someone re-runs it with more logging.
- An agent needs *what is on that screen* — and gets a stack trace about a timeout.

Green is not the deliverable. The deliverable is the recording, the stills, the network tied to the
step, and a note a person can re-walk. A run that passes still produces all of it, because "it works"
is a claim somebody has to be able to check.

## What that changes

**A pass is not silent.** A run can be `ok` and still carry warnings — a locator that matched
something off-screen, a missing binary, a wait that only just made it. The bit says nothing; the
warnings say what it got away with.

**A failure is not a stack trace.** It is the step list up to the break, the frame from that moment,
and every request and console line tagged with the step that was running. That join is the work a
person does by hand across three panes, and it is the thing the harness is best placed to do.

**Both halves are kept.** `EVIDENCE=before` and `EVIDENCE=after` write to sibling directories. The
comparison is the artefact; neither cut is more real than the other.

**A retry does not erase its failure.** The failed attempt keeps its own directory. A green run with
nothing to explain it is worse than a red one.

## What it does not replace

This is not a test runner and should not become one. There is no assertion library, no fixtures, no
sharding, no flake dashboard. When the question genuinely is *did the suite pass*, a test runner
answers it better and is already installed.

Reach for this when the answer needs to be **watchable** — a demo, a review, a bug report, a
before/after — or when something that is not a person has to read it.
