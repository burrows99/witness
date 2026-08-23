# What we have learned

Appended to at the end of any run that learned something. Newest at the bottom of each section.

One entry = the trap, and **why** it is a trap. An entry without a why gets deleted the first time
somebody disagrees with it.

---

## Verifying

**Read the exit code, never the tail of the output.** `npm run check | grep …` and
`gh pr checks --watch | tail -3` both hide a non-zero exit. Twice: once merging on a red check, once
shipping with an undeclared binary that CI then caught. If a pipeline is needed, capture `${PIPESTATUS[0]}`.

**A green run can produce evidence that contradicts its own caption.** Twice in one session: a
caption over the wrong scroll position, and "two ways back" written over a frame showing one. Open
the frames whose captions make a claim.

**Pull the real payload before diagnosing.** A cause inferred from a screenshot got written, merged
and deployed before anyone looked at the actual response, which said something else and would have
said it in ten seconds.

**A test that seeds what it tests proves nothing.** A helper that authored the required content
before every run made the walk green against a state only the run had created. A missing precondition
is an assertion, not something to repair.

**Consistency tests only prove consistency.** A check comparing descriptors to schema keys cannot see
a field missing from both. Count against the real thing.

---

## Changing this repository

**Do not change behaviour to satisfy a linter.** `String(x)` → `JSON.stringify(x)` silenced a rule
and quoted every string, breaking a test. Suppress the rule or restructure; never let the tool pick
the semantics.

**Per-instance state breaks under `--parallel`.** Frame counters counted to one and stopped (a new
`Evidence` per call); a warning leaked between lanes (engine fields). Both are module-level or
threaded now. Anything that must be per-*run* rather than per-*object* has to say so explicitly.

**Registered names need a test that enumerates them.** `records?: "browser" | "terminal"` type-checked
perfectly and threw at runtime, because `"browser"` was never registered. The type said one thing and
the registry another.

**Evidence and the `finally` block.** Slide cards, the catalogue and the render all belong in
`finally`. A failing run is exactly when the evidence matters; cards spliced only on success was a
real bug.

**A grep with a lazy pattern will confidently mislead you.** `[a-z]+` missed `apiKey` and nearly
"corrected" a correct provider table. Same shape as filtering paths with `grep -iv test`, which also
strips `TestResults/`.

---

## Publishing

**The secret scanner scans content, not just values.** A build was blocked by the *word* `password`
as a type/field name, with no value anywhere near it. The fix was renaming to `credential`, which was
a better name anyway — the field holds a *source*. Two dead ends first: claiming a stale incident
(wrong, it was scanning), and adding an ignore path (the app does not honour it). Bisect with
single-commit probe branches.

**A scanner sees every commit in a pull request**, not just the tip. Rewriting history is a
legitimate fix; a fixup commit on top is not.

**`gh` cannot upload an image asset.** A body citing a local path renders nothing — the evidence
silently vanishes and the comment reads as if it had none. Mint a real attachment URL through a
logged-in browser and put *that* in the body. `require-evidence.sh` enforces this.

---

## Writing for an agent

**Everything an agent does with this tool, it does from the skill alone.** Three real defects came
from cold-start agents given the skill and nothing else: a path that no longer existed, a verb
described as authenticated that sent none, and a starter config that failed on every command. Two
cold-agent runs produced about ten pull requests.

**A path in the skill is a promise.** When the artifact layout dropped its `actions/` segment, the
skill kept sending readers to it. Nothing type-checks a string in a document.

**A demo that waits too little proves nothing.** The first `after` recording caught the frame before
a 10-second crawl printed anything, so a green run produced a video of a command with no output. The
recording is the deliverable; its timing is part of the work, not an afterthought.

**Progress on stdout breaks the consumer.** Results are stdout, progress and warnings are stderr, or
`| jq` fails for reasons nobody can see.

---

## Gates

**A gate is only worth having if it can be right.** The before/after gate's third rule — "the after
must post-date the last edit" — needs a heuristic for "was that command an edit?", and the heuristic
fired twice on its first run: once on `grep foo bar.sh`, once on the hook being edited. The version
that would not misfire (count only the Edit tool) would have been inert, because most editing here is
a heredoc. Dropped to two rules and one written-down discipline rule. An inert gate that looks active
is worse than no gate.

**Exempt the same paths both ways.** Whatever a gate excuses from *triggering* a requirement must
also be excused from *invalidating* it, or the two halves disagree and the gate blocks its own author.

---

## Generating things

**Read the first output, not the exit code.** The first fragment `config explore` produced was green
and contained routes called `0` and `02` (a star-count link), a locator truncated mid-word to
`aPainlessSelfHostedGit`, and three identical lines about `/user/login` in its skipped list. All
three are invisible to a test that only asks whether it ran.

**A generated identifier has to be one.** Start-with-a-letter, and cut at a word rather than a
character. Both rules came from that first fragment.

**Never write over the file.** A generated name is worse than the one a person would choose, so
`explore` prints a fragment. A tool that overwrites hand-tuned names gets run once.

**Say what you left out.** A fragment that stopped at a cap looks exactly like one that found
everything.

**Generate from what already describes the thing.** The compose file holds the ports, the container
names, which service is a database and where the credentials live. Walking a browser while ignoring
the file beside it was a whole afternoon spent producing four fields.

**Run the generated artefact, do not just look at it.** The first config `init` generated was correct
and broke every command — including `help` — because it named a database. Two real defects, both
invisible until something loaded the file:

- a `containerEnv` credential was resolved when the System was **built**, so building one shelled
  into a container that was not running
- a service that publishes no port got `http://localhost:undefined`, and `new URL()` threw

Both are lazily-resolve-it bugs, and both only exist for configs a person would not have hand-written.
Generating input is also generating new *shapes* of input.

---

## Judgement calls that keep coming back

**A checker that cries wolf is worse than none.** Drift's first design swept every locator across
every route and reported eight findings against a correct description. It now verifies only the
claims the description actually makes.

**Prefer waiting for a thing over waiting for time.** A `wait: 600` after typing into a search box
stored 226 unfiltered rows on a slow run, under an assertion loose enough to pass.

**A locator you have not run is a guess.** Five of the first nine actions written here named
something that did not exist. `npx playwright codegen` writes real ones.
