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

## Who reads it

**An agent, mostly — and a person checking the same thing.** They need different shapes of the same
run, which is why one directory carries both.

An agent cannot watch a video or open a network tab. It lists a directory, reads `debug.md`, and gets
the requests, the console lines and the step each was tagged to. Denied that, it does the only thing
left: it infers from the diff and the exit code and reports a conclusion it never checked. That
failure mode is quiet — an inaccurate answer arrives in exactly the tone of an accurate one, and the
reader downstream has no way to tell which they were handed.

A person will not read forty JSON payloads. They open `video.mp4`, or the single frame the story
names, and see it in a second.

Neither reader is the secondary one, and neither artefact is a by-product of making the other.

## What it does not replace

This is not a test runner and should not become one. There is no assertion library, no fixtures, no
sharding, no flake dashboard. When the question genuinely is *did the suite pass*, a test runner
answers it better and is already installed.

Reach for this when the answer needs to be **watchable** — a demo, a review, a bug report, a
before/after — or when the thing that has to read it is an agent, which cannot watch anything and has
to be handed the same proof in a form it can parse.
