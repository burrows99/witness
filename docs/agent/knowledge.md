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

**An injectable seam means the default is the one thing nothing runs.** `Compose.read(root, run =
Compose.docker)` is injected by every test in its file, so `Compose.docker` — the only line of it that
ever executes in production — was never called by one. Deleting `--no-interpolate` from it left 424
tests passing and every generated config silently without its `portVar`, which is invisible until a
second checkout runs its own ports. The seam that makes a parser testable is the same seam that hides
the caller, and the fix is one size lower: inject the `execFile`, and assert the ARGV rather than the
answer, the way `docker.test.ts` already does. Anywhere a default parameter exists so tests can avoid
the real thing, ask what still covers the real thing.

**A key that repeats is not a key, and a gate keyed on one can be passed with the wrong thing.**
`require-evidence.sh` matched a frame against its read-back by BASENAME, and every terminal recording
writes its still as `video.png` — so `<action>/before/video.png` and `<action>/after/video.png` were
one key, and Reading the before frame satisfied the gate for the after frame. The gate exists to stop
exactly one failure, a caption placed over the wrong frame, which this repository has committed twice;
it could be passed with the wrong frame, systematically, for most of its own evidence. Resolve to a
full path instead — and `realpath`, not `abspath`: on macOS `/tmp` is a symlink to `/private/tmp`, so
one file arrives spelled two ways and an exact match on the spelling is not one. The general shape:
before trusting a lookup, ask whether two different things can produce the same key.

**A step that sweeps a directory touches evidence from runs it knows nothing about.** The renderer
walked every directory under `artifacts/test-results` and re-rendered all of them, so running one
action rewrote another action's `before/video.mp4` and its still. A `before` is a record of the code
as it WAS; one that can be silently regenerated after the change is the same failure as a stale after,
arriving from the other direction, and it is the one rule `require-before-after.sh` deliberately does
not check. It was caught here in the act: a run of `theCommandsItAdvertises` moved the mtime of a
frame that had been published as evidence on a pull request twenty minutes earlier. It also moved the
capture time of frames the evidence hook then demanded be re-Read for no reason, which is how a gate
gets learned as noise. Render what this run recorded; a raw recording older than the video made from
it has nothing new to say. And when the sweep is somebody's actual request — `witness video` says
*rebuild* — that wants a flag, not the default.

**A fixture in an order the real thing never produces cannot reproduce an ordering bug.** The `STACK`
fixture in `compose.test.ts` is documented as "what `docker compose config` gives back", and it listed
`postgres` before `mariadb`. Compose sorts alphabetically and never returns that, so the one defect the
whole first-declared-wins rule can have — the default database decided by the letter `m` — could not
happen inside the file whose job is catching it. The order of a fixture is part of its content whenever
anything downstream reads it in order, and "realistic values" is not the same claim as "realistic
shape".

**A cast at the call site makes an optional field of everything.** `runActions(system as never, …)`
silenced not just the mismatched `run` signature it was written for but every other missing property,
so `actionConfig` — the field the terminal recorder branches on — went unsupplied by four fixtures.
The production type then followed the fixtures rather than the callers: it was declared optional and
read with `?.`, so `actionConfig` could be made to answer `undefined` for every action alive and 424
tests still passed, with every `records: "terminal"` action quietly filming a blank browser instead of
the shell. Export the parameter type and ANNOTATE the fixture rather than casting it: an annotation
checks what is missing, and a cast is a promise that nothing is. Removing this one immediately found a
second omission nobody had noticed — every fake result was missing `warnings`.

**A test helper can swallow the argument that does the work.** `recorders.test.ts` wrapped `asTape`
in a helper that hard-coded its `values` to `{}` — the argument `runActions` fills from the run's
inputs, and the whole reason a step can say `{table}` or a shell can say `docker exec -it {container}
bash`. With it hard-coded, `fill` could be deleted from `asTape` outright and every assertion in the
file still passed, while every placeholder was typed into the recording literally. A helper that
"simplifies" a call by fixing one of its arguments has removed that argument from the test suite.

**A helper tested with the argument its CALLER cleans up is tested with the wrong argument.**
`scoped(name, scope)` had a test passing `"grafana"`, a service name. Every real caller is the engine,
which passes `"grafana.signIn"` — an ACTION name — and `System.secret` cuts the service off the front
of it before calling `scoped`. That cut is the whole of the service-owned reorganisation's headline
behaviour, and nothing tested it: remove it and every `{secret.…}` written inside a service's own
action stops resolving, with `no secret "adminKey" — declared: grafana.adminKey`, which reads as the
config being wrong rather than the tool. Third instance of one shape in this file, after
`Explore.likelyApp` and the `RunnableSystem` fixtures: test the unit with what its caller hands it, or
test through the caller.

**The seam that makes something testable is the reason the real thing is not tested — and closing it
can need a binary rather than a refactor.** `Drift.check` takes its `routeOf`, its page factory and
its sign-in as parameters, and ten tests drove it with their own. `Drift.sweep` is what `witness check
drift` actually runs: it is the half that builds `routeOf` out of `system.routeUrl`, launches the
browser, carries the identity cookies and drives the sign-in action, and no test called it at all.
Replace the body of that `routeOf` with `undefined` and the checker resolves nothing, collects no
claims, prints `all 0 claims still hold` and exits 0 — completely inert, green, 424 tests passing.
Second instance of the `Compose.docker` entry above, with that entry's remedy ruled out: there is no
size lower than a browser to inject, so the test has to launch one, at a `node:http` server it starts.
Which turned up the other half. CI installs `@playwright/test` explicitly so that "nothing is skipped
here" — and installing that package downloads **no browser**, verified against a scratch prefix rather
than against this machine, which had browsers and had got them some other way. The skip guard the
suite already had would have skipped the one test that matters in the one place it matters, silently,
and the pull request would have gone green on it. A test that needs a binary needs a line in the
workflow that installs the binary; the package is not the binary.

**A wired fixture is not a runnable one, and the compose file cannot tell you which it is.** Grafana
was pointed at the stack's identity provider so that a sign-in leaving the app would be permanently
reproducible, and that half is: `/login/generic_oauth` answers 302 and a browser lands on Keycloak's
origin. Nothing past that leg works, for two reasons neither of which is visible in the file that set
it up. Keycloak's master realm keeps `sslRequired: external`, so every OIDC endpoint — the login
form, the token exchange, the admin API — answers plain HTTP with `HTTPS required`; and the
`witness-demo` client the compose file names Grafana's client as was never registered anywhere,
because a `start-dev` container imports no realm and nobody created one. So the round trip #76 exists
for can be *described* end to end and can only be *run* as far as the provider's error page. An hour
went into planning a demo of the callback before anyone asked the provider a question. Curl the
fixture before building on it: `wired` is a statement about one file, `works` is a statement about
two processes.

**`action run` exited 0 on an action that failed.** *(Fixed in #127. Kept because the rule it broke is
this file's first entry.)* `runActions` catches a failing action so its evidence still gets rendered,
and the command line printed that result and returned — so `./bin/witness action run x; echo
"exit=$?"` printed `exit=0` directly underneath `"ok": false`, with `witness help` saying
`0 ok · 1 failed` three lines further down. It was caught filming: a terminal recording of a run of an
action that does not exist showed the error and `exit=0` in the same frame, which is evidence
contradicting itself in the one place this repository can least afford it. Same family as `gh pr
checks` — a green from a command that was never asked the question. The fix is the line `check drift`
has had all along (`process.exitCode = 1`, set rather than exited, so the JSON, the video and the
debug story still land) and a test that drives a deliberately failing action through the real binary,
because what let it live this long was that nothing ran the verb. **A `before` cut of a bug now exits
`1`, and that is the run working**: read the frames, not the code, when the failure is the thing being
recorded. The rule a repository opens its documentation with is the one to grep its own code for.

**A fixture cannot test the step that decides what goes IN a fixture.** Twenty-two tests asked
`Explore.forms` questions and every one passed while the crawler could not see a labelled input,
because each was handed a list of fields somebody had typed and the whole defect was the CSS selector
that builds that list: `input[placeholder], textarea[placeholder]`, so an input with no placeholder
was invisible however well labelled. Same shape as the tape that keeps its backslash — every
assertion available without leaving the process is downstream of the bug, and passes against it. The
test that catches this one opens a browser and reads markup lifted off the real apps, which means CI
has to install the binary: a skip is exactly where the coverage was missing. And the first real run
of the fixed code immediately produced a second thing no fixture would have contained — linkding's
tag box carries `placeholder=" "`, which had been going into fragments as `"tagString": " "`, a
described field that resolves to whatever the page happens to have.

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

**Opening a browser is already writing evidence, so a check that comes after one has published a
lie.** `action run <name>` resolved the name inside the engine — after the context and its video
recorder were up — so a name that named nothing was filmed anyway: `cli/<the name that was rejected>/`
with a 3.6 KB video of a blank page in it, sitting beside the real action's directory and reading as a
second cut of it. Anything that can refuse a run belongs before the first thing that writes; the
inputs check was already there, one line further down, saying so.

**A branch that cannot be reached reads as a feature the thing does not have.** The same error carried
a `(tried "<resolved>" too)` clause that could never print: resolution returned the scoped name only
when it was declared, so wherever the message was built the two were equal by construction. It looked
like the command line had a fallback for bare names. It did not — and the generated skill told its
readers to write one, which is how #141 was found. Grep for what a message CLAIMS before believing it.

**`x ??= await f()` is not a memo, and under `--parallel` it opened a browser per lane.** The check
happens, the `await` suspends, and only then is the variable assigned — so every lane that asked while
the first launch was in flight found nothing there and started one of its own. The last one to settle
was the one closed; the rest stayed up holding the event loop, and the command printed its whole
result and then never exited: no exit code at all, which is worse than the wrong one #127 was about
and hid behind it. Memoise the PROMISE (`opening ??= launch()`), and await it once at the end to close
what it opened. Found by running `action run a b --parallel` while checking that a failed lane reports
a failure — the case the fix was about was fine and the command it was in could not answer at all.

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

**The door is on the compare page, not the issue page.** The entry above says find a path the upload
tool accepts; the half it is missing is that the tool needs a `<input type="file">` to hand the file
to, and GitHub's rebuilt issue and pull-request views have none in the DOM at all —
`document.querySelectorAll("input[type=file]")` answers `0`, so no `read_page` or `find` can produce a
ref, and the only "Add Files" control is a button whose click opens a native picker nothing in the
browser can see. The classic **compare** page still has the real one:
`/compare/<base>...<branch>?expand=1` carries `input.fc-pull_request_body`, hidden. Un-hide it from
the page, `find` it by the `aria-label` you just gave it, upload, and read the minted URL back out of
`textarea[name="pull_request[body]"]` — then clear the textarea and close the tab, because nothing has
to be submitted there for the asset to exist. Read it back with a **regex for the asset id**: the
extension refuses to return the whole field (`[BLOCKED: Cookie/query string data]`), which reads like
the upload failing when it has already succeeded. And on this machine the tool accepted a path outside
the session's project directory, so the constraint in the entry above is not universal — try the real
path before copying anything.

**Two frames uploaded from one action arrive with the same filename.** Every terminal recording writes
its still as `video.png`, so `before/video.png` and `after/video.png` upload as `video.png` and
`video.png` and the only thing separating them afterwards is which order you did them in — which is
precisely the mistake this file records twice already, arriving through a third door. `curl -sL -w
"%{size_download}"` on each minted URL and compare against the bytes on disk. It is one command, it
runs after the body is published, and it is the only check that cannot be talked into agreeing with
you.

**A synthetic paste carrying real `File`s does work, and it needs no particular page.** The two
entries above are both true and both about finding GitHub's own file input. There is a third door,
and it mints four assets in one call from the ordinary issue comment box: create your own
`<input type="file">` in the page, upload into **that** with the browser tool (it is a real input, so
`find` gives a ref and the extension attaches real `File` objects), then dispatch
`new ClipboardEvent("paste", { clipboardData: dt })` at the comment `textarea` with those files in a
`DataTransfer`. GitHub's editor uploads them and writes the `user-attachments` URLs into the field,
where the page's own JavaScript can read them. "A synthetic `⌘V` carries no clipboard" is what the
first entry says and it is right — a synthesised *keystroke* carries nothing. A synthesised *paste
event* carries whatever you put in it, and the files it puts there came from the one tool that can
read a local path. Nothing is submitted; clear the textarea and the assets still exist.

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

**A generated description has to be the same twice, and no per-function test can tell you it is not.**
Twenty-two tests asked twenty-two questions of `explore` and every one passed while three separate
defects made two runs of the same command against an unchanged app disagree — an id in a route, a spam
score in a locator's name, a page recorded where it was asked for rather than where it landed. Each is
invisible to a test that hands one function one input, because each needs two runs and a diff to have
a shape at all. The fix is one test: render a whole crawl twice with the app's live values moved on,
and compare the strings. Anything committed and later regenerated needs that test, or the churn in the
diff is the first anyone hears about it.

**A rule that only half its callers got is worse than one nobody wrote.** `operations` has collapsed
`/repos/7/issues` and `/repos/12/issues` into `{id}` since the day it was written; `routes` never
learned to, so one fragment folded eleven observed API calls back into the single operation they came
from and, four lines above, wrote down a route to one email that would be deleted that week. Nothing
looked wrong: the half that was right made the file read as if the rule were being applied. When a
rule turns out to be needed twice, move it and take both callers — a copy of the reasoning in a
comment is not the same as a call.

**A stack you chose is a stack that cannot surprise you.** Gitea, grafana, mailpit and directus all
put placeholders on their inputs and all have large ANONYMOUS surfaces, so for as long as those four
were the measure, `config explore` looked good on both counts: gitea yields twelve routes and a
`forms` block. Neither number was about the tool. Three applications picked for obscurity rather than
quality — a household ERP, a bookmark manager, a pastebin — produced `"forms": {}` on two ordinary
`name="username"` login forms and `Walked 1 page` on an app with a whole domain behind it, in one
afternoon. The stronger version of the entry above about a service nothing uses: it is not enough for
the stack to contain the shape, the apps in it have to be ones nobody here picked, because the ones
you pick are the ones whose habits you already build for. The first defect was live on gitea's own
`/user/login` and `/user/sign_up` the whole time — neither carries a placeholder — and it took the
three obscure ones to make anybody look.

**"Say what you left out" is also a rule about the first of something.** `init` read `ports[0]` and
stopped, on a comment reasoning that a service publishing several has one a description is about.
That reads fine and is untrue of the ordinary dev-mode container — a UI on one port and its API on
the other, out of one image — which came back described as the UI, with the whole API missing and the
run saying `Read 1 service(s)`. Every failure of this rule so far has been a cap or a limit, which is
at least visible in the code as a number; taking the first is the same omission with nothing to
notice. Where a generator takes one of several, either take all of them or name the ones you did not.

---

## Judgement calls that keep coming back

**A checker that cries wolf is worse than none.** Drift's first design swept every locator across
every route and reported eight findings against a correct description. It now verifies only the
claims the description actually makes.

**Prefer waiting for a thing over waiting for time.** A `wait: 600` after typing into a search box
stored 226 unfiltered rows on a slow run, under an assertion loose enough to pass.

**Counting what you skipped is not saying what went unchecked, and it can invent an omission.**
`check drift` answered `7 terminal actions skipped, having no screen to check` — honest, and wrong in
both directions at once. It never named the sentence that went unverified, so a reader with a real
`expect` in a tape learned only that a number had gone up; and every one of this repository's ten
terminal actions asserts nothing at all, so the line reported ten silences as ten omissions. Reading
them costs nothing and says both things properly: an action that claims nothing had nothing skipped,
and one that claims something gets its claim quoted with what would have to happen to judge it. The
general shape — a count is a summary of findings you have not made, and a summary of nothing looks
identical to a summary of something.

**A locator you have not run is a guess.** Five of the first nine actions written here named
something that did not exist. `npx playwright codegen` writes real ones.

**A list only code can reach is documentation, not vocabulary.** `api.operations` is the config's
answer to "what can this thing do", and `Operations.operation()` has resolved a name to one — with a
good error listing the rest — since the day it was written. The command line never reached it: the
`api` verb was wired straight to the raw request, so `api get listProjects` was concatenated onto the
base URL and came back as `Failed to parse URL from http://localhost:5001listProjects`. Declaring ten
operations with summaries and then typing their paths by hand at the prompt is the shape of the
problem — the block was being read rather than used, by the surface most likely to want it. Found
driving a third-party app with 59 routes, where naming them once is the entire point of naming them.
The general shape: when a docstring promises "the same list drives X", grep X for the call, because
the promise is the thing nobody rechecks.

**An error that names a string the caller never typed points at the wrong half of the system.**
`${baseUrl}${path}` assumes a leading slash and never checks, so the one argument shape it is wrong
for produces something that is not a URL at all, and `Failed to parse URL from …` reads as a bad base
URL or a service that is down. It cost a second run with a known-good path to establish that the tool
was fine and the argument was the whole story. Normalising a join costs two `replace`s; an error
about a string nobody wrote costs whoever reads it their first guess.

**One reading applied to every kind of node is wrong for three of them, and only one of the three is
empty.** `store` and `expect` both asked an element for its `textContent`, which an `<input>` does not
have — so a settings dialog's prefilled endpoint stored `""` and no claim could be made about any form
field, which is the failure that got reported. The other two are the reason it is worth an entry. A
`<textarea>`'s text content is what the MARKUP shipped with, so a `store` after a `type` step read a
plausible, stale, wrong value and looked right doing it. And a `<select>`'s is every option it offers
concatenated — `"OpenAIGemini"` — so `"contains": "OpenAI"` PASSED on a picker with Gemini chosen: a
green assertion about the opposite of what happened, which is worse than the one that was filed. The
empty string is the only one of the three that anybody notices, so the bug that gets reported is not
the size of the bug. Whenever one accessor is used for a whole class of thing, list the members of the
class and ask what that accessor returns for each; the dangerous answers are the plausible ones.
