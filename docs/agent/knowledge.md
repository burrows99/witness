# What we have learned

Appended to at the end of any run that learned something. Newest at the bottom of each section.

One entry = the trap, and **why** it is a trap. An entry without a why gets deleted the first time
somebody disagrees with it.

---

## Verifying

**Read the exit code, never the tail of the output.** `npm run check | grep …` and
`gh pr checks --watch | tail -3` both hide a non-zero exit — a pipeline reports the code of its last
command, which is the one you added. Twice: once merging on a red check, once shipping with an
undeclared binary that CI then caught. Do not pipe: redirect, then read the file.

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

**A test that builds its own input can pin a shape nothing produces.** `Explore.likelyApp` was covered
by a test handing it `{ services: { web: { app: … } } }` — the shape a config is WRITTEN in. Every real
caller hands it the shape `loadConfig` RETURNS, where `app` has been hoisted into `apps` and removed
from the service, so the function found nothing, silently fell back to the first service, and the test
stayed green throughout. Same family as the entry above: when the fixture and the code agree about a
shape, neither of them is checking it. Build the fixture through the loader, or assert against what
the loader returns.

**A service in the stack that nothing uses proves nothing.** The compose file has shipped an identity
provider since the day the third-party services went in — "a sign-in that LEAVES the app, on a second
origin, on purpose" — and not one service was pointed at it. So the single case the crawler most needed
to get right could not happen here, and arrived instead as a bug report from somebody else's app, where
it had already described Microsoft's login screen as that product's own. Wiring Grafana to it was five
environment variables. A stack that cannot produce the shape cannot catch the bug.

**What is on this machine is not evidence of what an installer does.** The global install here had
`@playwright/test` sitting inside it, which got read as "npm installs optional peers" and written into
a source comment as fact. npm does not — `npm i -g --prefix /tmp/… <tarball>` added one package and
nothing else, and the copy on this machine had arrived some other way. Same family as inferring a
cause from a screenshot: the state in front of you is a result, and more than one thing produces it. A
scratch prefix costs a second and is the only thing that can answer a question about installing.

**A test on the recording cannot catch a recorder that alters what it records.** The obvious test for
"a `Type` step must keep its backslash" reads the tape and asserts it says `\n` — and the tape DID say
`\n`, in the `\\n` form `JSON.stringify` writes, which VHS then typed as two characters. Every
assertion available without leaving the process passes against the defect, because the tape is exactly
what the bug leaves intact. The test that catches it runs vhs for real on a step that writes its own
argument to a file, and asserts on the file: the shell is the only witness to what the shell received.
Same family as building a fixture in the shape the code expects — and it generalises past this repo, to
anything whose output is a rendering of an instruction rather than the instruction.

**The idiom this file used to recommend for pipelines is one an agent cannot type.**
`${PIPESTATUS[0]}` is the textbook answer to a pipeline hiding an exit code, and three agents reported
that their harness refuses to run any command containing a `${…[0]}` subscript — the whole command,
before it runs. So the headline verification rule came with a fallback that fails on arrival, and what
is left is eyeballing the output, which is the habit the rule exists to prevent. Redirect instead:
`cmd > /tmp/x.log 2>&1; echo "exit=$?"`, then grep the file. No pipeline, no array, and the code still
belongs to the command that was run. An instruction the reader cannot execute is worse than none —
it does not fail loudly, it fails back to the old habit.

**`gh pr checks` answers about the checks that EXIST, which is not the question.** For the first
minute or two after a push ours have not been created, so the rollup holds whichever third-party app
answered first: nothing red, nothing pending, exit `0`. `--watch` cannot help — there is nothing to
wait for, so it returns immediately. On a pull request GitHub calls `CONFLICTING` this is not a race
but a settled state: `check` and `analyze` are never queued at all, and the `0` is permanent. Three
agents read that as "the tests passed" in one day, and phase 7 was telling them to. The exit code was
honest about the question it was asked. Ask a better one: `.claude/pr-green.sh <n>` requires the jobs
this repository's workflows define, by name, waits for them to be created, and only then watches. Same
family as reading the tail of a pipe — a green from a command that was never asked what you wanted to
know.

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

**Two constructions of the same thing will disagree, and the second one is the one nobody runs.**
`bin/cli.ts` built the command line twice — once for `Cli.main` and once, freshly, inside `describe()`
— so the instructions handed to an agent described the CLI minus the three nouns the entry point adds
itself. Both were correct in isolation and neither was checked against the other. Build it once and
pass it, or write the test that compares them; a comment saying they must stay in step is not either
of those.

**Evidence and the `finally` block.** Slide cards, the catalogue and the render all belong in
`finally`. A failing run is exactly when the evidence matters; cards spliced only on success was a
real bug.

**A grep with a lazy pattern will confidently mislead you.** `[a-z]+` missed `apiKey` and nearly
"corrected" a correct provider table. Same shape as filtering paths with `grep -iv test`, which also
strips `TestResults/`.

**A file needing to know where it lives cannot use `import.meta`, and `argv[1]` is not enough on its
own.** `import.meta.url` is the obvious way and type-checks, lints and passes every test near the file
it is in; only `src/index.test.ts` catches it, because a spec transpiled to CommonJS cannot *parse* the
token and one such file reachable from the barrel breaks every spec in every consuming project. The
replacement is `realpathSync(process.argv[1])`, and the `realpathSync` is load-bearing rather than
tidiness: a global `bin/` entry is a symlink, Node leaves `argv[1]` unresolved, and the unresolved path
walks up an entirely different tree — `<prefix>/bin/…` instead of `<prefix>/lib/node_modules/…`, which
finds nothing and looks exactly like not being installed.

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

**The tagline lives in six places and two of them are not in git.** The README's first line, the
banner HTML *and* the PNG it has to be regenerated into, `package.json`'s description, the GitHub
repository description, and the GitHub topics. A diff can only ever show four, so the two that are
repository settings drift with nothing to catch them. A dozen files under `src/` and `docs/` already
justified a design decision by what an agent cannot do, while every front door still described a
config-driven test harness. Change the sentence, grep the repository for the old one, and set the two
that live in repository settings over the API in the same run.

**A browser upload tool takes a path inside the project, and refuses every other one.** "Mint the URL
through a logged-in browser" is the right instruction with a constraint missing from it, and the
constraint cost two agents an afternoon each: the tool accepts what the session was started on and
rejects the rest, so a frame under `/tmp` — or in the worktree the change was made in, beside the
project rather than in it — cannot be uploaded from where it was recorded, however correct the path
is. Copy it in first and upload the copy. Note that this puts two of our own rules in tension:
`require-evidence.sh` requires the image to have been Read before it goes anywhere, and it will
approve a path the uploader then refuses. And there is no way round it from inside the page — GitHub's
CSP blocks a `fetch` of a local server and of a `data:` URI, a synthetic `⌘V` carries no clipboard, and
its own uploader ignores a synthetic `drop`. A file the upload tool will accept is the only door.

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

**A terminal recording ends on the tail, and the headline is at the top.** The `after` cut of a
fragment longer than the pane finished showing its last thirty lines — and the line the whole claim
rested on, `Walked 4 pages`, had scrolled off before the recording ended. The output arrives in one
write, so there is no intermediate frame to fall back on: the claim is either on the final screen or
it is nowhere. The default pane is 1280x900 at 20pt — about thirty rows, and fewer as soon as
anything wraps — so make the pane fit: `"pane": { "height": …, "fontSize": … }`, on the service or on
the one action. The first fix for this was a `head -N` inside the step, which truncates the thing
being demonstrated to fit the thing filming it and hides a statement about pane geometry in a
description; the pane was the part that was wrong.

**Progress on stdout breaks the consumer.** Results are stdout, progress and warnings are stderr, or
`| jq` fails for reasons nobody can see.

**`npx witness` is not a command in this checkout.** npm links a package's own `bin` for whatever
DEPENDS on it, never for the package itself — so there is no `node_modules/.bin/witness` here and
`npx` goes to the registry looking for an unrelated package named `witness`, which is worse than
failing. `./bin/witness` is what /flow, `docs/agent/` and the tutorial say; `npx witness` stays right
in `README.md`, `docs/how-to/` and `docs/reference/`, which are written for somebody whose project has
this as a dependency. Two audiences, one string, and the only way to keep both honest is to know which
document is addressed to which.

**Generated instructions can carry a bug the generator has no idea about.** The skill's own examples
came from `Skill.invocation()`, which asks npm how it was launched — and answers `npx witness` for
anything npm did not launch. So `./bin/witness skill` produced a file telling this checkout's reader
to type the one command that does not work here, twenty-seven times, and the copy committed to the
repository had been saying it since PR #56. A generator only removes the staleness it was told to look
for.

**Do not transcribe what the tool can be asked.** The `## Commands` section is a copy of a list
`witness help` prints from the registry, and the copy is what drifted — three nouns missing, in the
file that is the only thing an agent reads. The list is still worth keeping (it is read before
anything has been run) but it must say where the real one is, or a reader told a verb does not exist
concludes the tool cannot do it rather than asking.

**A second reader of a field does not learn what the first one knows.** `records: "terminal"` says an
action has no screen, and `run` had short-circuited on it since terminal recording went in. `check
drift` was written against browser actions and never asked: pointed at a terminal one it opened a
browser, spent thirty seconds on `locator('prompt')`, and reported the action as **broken** — the
checker's own assumption wearing the words of a finding, which is the "cries wolf" the drift design
exists to avoid, arriving from the other side. Fixed in #95: skipped, and the count said out loud,
because the other way to be wrong here was to skip in silence and answer "all 4 claims still hold"
about a description whose other half was never opened. When a field changes what a thing IS, grep
every reader of it — not the one the change was about.

**A `Type` step loses a backslash, and a `{…}` inside one is read as a parameter.** *(Both fixed —
see the entry at the end of this section. Kept because the way it was FOUND is the point.)* A step
typing `tr '\n' ' '` reached the shell as `tr '\\n' ' '` — a tape has no escapes inside a `Type`
string, so `JSON.stringify` doubling the backslash typed two characters — and `tr` maps every `n` AND
every backslash to a space, on the one screen whose whole job was being compared with `docker ps` line
by line. And `docker ps --format '{{.Names}}'` never ran at all: a step's text goes through `fill()`,
which read `{.Names}` as a parameter nobody supplied and threw. Neither was visible in the tape or the
exit code; both were obvious in the pixels. Which is the argument for opening the frame, not an
argument about escaping.

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

**A metadata-only change trips the code gate, and the hatch is the honest way out.** `package.json`
is not in the before/after exemption, so editing its `description` — which nothing in `src/` reads —
demands two recordings. Making them would produce a before and an after that are identical, and this
file already has an entry about evidence that contradicts what is written over it: a cut nobody could
learn anything from reads exactly like one somebody could. `[no-evidence: <reason>]` is for this, and
it leaves the reason in the diff where a reviewer can disagree with it.

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

**A same-origin check on the href is not a same-origin check.** `config explore` asked where a link
POINTED and then walked it, so `/api/auth/idp/microsoft/start` — a path on the app's own origin —
took the crawl to login.microsoftonline.com, and the description of a git forge offered "Email, phone,
or Skype". Where a navigation LANDS is the only version of the question that can be answered, and it
cannot be asked until after the navigation. Same family as checking a URL by substring: the string is
not the request. And the check that arrives too late is not the whole fix — an OAuth start endpoint is
a same-origin link on the login page of a very large number of applications, so the shapes that begin
a handoff are skipped before anything is sent. A tool that walks a stack on request must reach nobody
the person did not point it at.

**A compose file copied somewhere else is a different project.** `docker compose config` reports
`name` from the DIRECTORY it runs in, and that name is the prefix compose puts on every container it
names itself. So a description generated from a copy of the compose file in `/tmp/scratch` derives
`scratch-redis-1` — a correct description of a project nobody is running, which reads on the board
exactly like a wrong one. Generate where the stack was brought up, or name the directory after the
project. The same fact is why nine services in a nineteen-service stack had no `container` at all: the
name is only ever in the compose file when somebody typed it there, and most of the time nobody did.

---

## Judgement calls that keep coming back

**A checker that cries wolf is worse than none.** Drift's first design swept every locator across
every route and reported eight findings against a correct description. It now verifies only the
claims the description actually makes.

**Prefer waiting for a thing over waiting for time.** A `wait: 600` after typing into a search box
stored 226 unfiltered rows on a slow run, under an assertion loose enough to pass.

**A locator you have not run is a guess.** Five of the first nine actions written here named
something that did not exist. `npx playwright codegen` writes real ones.
