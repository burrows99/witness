---
name: proving-ground
description: Point witness at third-party OSS applications running in containers — generate a description, drive them, debug them, and produce proofs. Use when evaluating what witness can and cannot do, before a release, or after changing config generation. Trigger with /proving-ground.
---

# Proving ground

Spin up applications **nobody here designed**, and make witness earn every claim against them.

A stack we built ourselves can only confirm what we already assumed. The first run of this exercise
found fifteen defects, three of them blockers — and the largest one was invisible on the demo stack
because the demo stack is two server-rendered apps, and the bug only affects single-page apps.

**The chain under test is one chain.** Explore → generate a config → drive the app with it → debug it
→ produce proof. A link that breaks makes everything downstream untestable, so the links are tested
in order and a break is reported, not worked around silently.

---

## The fleet

`docker-compose.yml` at the repo root. Every service is here because it breaks the tool in a
different way — not because it was convenient.

| service | stack | what it stresses |
|---|---|---|
| gitea | server-rendered Go | the easy case: real links, real forms |
| mailpit | SPA with server links | a second UI and a second API |
| grafana | React SPA | **client-rendered** — nothing exists at `domcontentloaded` |
| adminer | PHP, no JavaScript | a login form and not one XHR |
| uptime-kuma | Vue SPA + websockets | an SPA behind a setup wizard |
| keycloak | Java, OIDC | a sign-in that **leaves the app**, on a second origin |
| directus | Node, API-first | screens that are a thin client over a REST API |
| postgres | not HTTP | a database with a published port |
| mariadb | not HTTP, **no `container_name`** | a *second* database, and compose-default naming |
| redis | not HTTP, no `container_name` | two ways to get a probe wrong at once |

**Adding one is the point.** When a defect is found in the wild, add the smallest OSS app that
reproduces it, so the fleet grows into the shape of what actually goes wrong. Pick for
*architectural difference*, never for familiarity: a fourth server-rendered Go app teaches nothing.

```bash
docker compose up -d
docker compose ps --format '{{.Name}}\t{{.Status}}'
```

Wait until they answer — several are slow (keycloak is a JVM, directus bootstraps a database).

---

## The rounds

Each round has a **pass condition that names an artefact**. A command exiting 0 is not a pass.

### Round 1 — generate

```bash
mkdir -p /tmp/pg && cd /tmp/pg && git init -q .
cp <repo>/docker-compose.yml <repo>/.env .
witness init .
```

**Pass:** every compose service appears, with a port, a container, and a probe that could succeed.

Check each row against `docker compose config --format json` — that document holds the truth, and it
holds the compose **project name**, which is what compose-default container names are built from.

**Then use it, do not read it:**

```bash
witness stack status
```

**Pass:** every row matches reality. Cross-check against `docker ps`. A `DOWN` next to a running
container is a defect; so is an `up` next to a stopped one. Count them — "7 of 10 correct" is the
finding, and nothing in the output distinguishes the three.

> A generated config that the tool then refuses to load is the worst outcome and has happened three
> times. Run a command — any command — before believing the file.

### Round 2 — explore, once per app with screens

```bash
for s in gitea mailpit grafana adminer uptime-kuma keycloak directus; do
  witness config explore "$s" --pages=6 > "/tmp/pg/explore-$s.txt" 2>&1
done
```

**Pass:** a table, and the table is the finding.

| app | rendering | walked | routes | locators | forms | operations |
|---|---|---|---|---|---|---|

**Read it along the rendering axis.** If the server-rendered apps look good and the SPAs look empty,
the crawl is snapshotting before the app has drawn itself, not discovering that the app is small.
Prove it rather than assuming — navigate, snapshot, wait for the network to settle, snapshot again,
and compare node counts.

**Then check what it brought back is actually ours:**

```bash
grep -o '"name": "[^"]*"' /tmp/pg/explore-*.txt | sort -u
```

Anything naming a company that is not the app under test means the crawl left the origin. It has
happened: a same-origin `/auth/idp/microsoft/start` link 307s to `login.microsoftonline.com`, and
that page ends up in the description.

### Round 3 — drive

Take the **generated** config, add actions by hand, and run them. Hand-written config here defeats
the purpose: the question is whether what was *generated* is good enough to build on.

Per app, at least: reach a screen · fill and submit a form · assert something on the result · assert
across two layers (`check` a stored value against what the API or database says).

```bash
witness action run <action>
witness action run <a> <b> --parallel
witness action run <flaky> --retries=2
```

**Pass:** a video per run, a panel video for `--parallel`, and a kept `<action>-retry-N/` directory.
**Open the frames.** A green run whose frames show a login screen is a failed run that exited 0.

### Round 4 — debug

Break something deliberately — a locator that no longer matches, a form field renamed, a service
stopped mid-run — and see what comes back.

**Pass:** `debug.md` names the failing step, the frame from that moment, and the network and console
**tied to that step**. If reproducing the failure needs a re-run with more logging, that is the
finding.

```bash
docker compose stop redis   # then run something that needs it
```

### Round 5 — drift

```bash
witness check drift            # expect: all claims hold
# now rename a locator in the description
witness check drift; echo "exit=$?"
```

**Pass:** the break is found in seconds, named precisely, and the exit code is 1. Compare against how
long a run takes to find the same break — that ratio is the feature's whole argument.

### Round 6 — proofs

The deliverable is not a verdict, it is a bundle somebody can look at without running anything:

- `EVIDENCE=before` / `EVIDENCE=after` around one real change, per app
- the `video.mp4` **and** a frame from it — the video is the deliverable, the frame is what a reader skims
- `debug.md` from the deliberate break in round 4
- the generated config beside the hand-corrected one, diffed: the diff **is** the list of what
  generation got wrong

### Round 7 — the cold agent

Hand a fresh agent the generated `SKILL.md` and the running stack, and nothing else. No source, no
context from this session, no help. Every question it has to ask is a gap in the skill.

Highest-yield round, historically. Run it last, so the skill under test is the one this exercise
produced.

---

## Recording what is found

One file, appended as you go — **before** working around anything, because a gap that gets worked
around silently stops existing.

```markdown
## <id> — <one line, what is wrong> · blocker | high | medium | low

<the command, and its actual output>

**Why it matters:** who this costs, and how much.
**Fix:** the real one. If the generator is producing bad input for a limitation, the limitation is
usually what is wrong.
**Workaround used to proceed:** ...
```

Record the wins too, in the same file. A one-sided list gets discounted, and the wins are the argument
for fixing the rest: on one stack the derivation found **19 services where a hand-written description
had 9**, and got details wrong on nearly half of them. Both halves are true and both belong.

Then file each as an issue, ranked, with a tracking epic linking them.

---

## Rules

- **Never name a client application** in an issue, a commit, or anything in this repo. Describe the
  shape: "a nineteen-service stack", "an application with social sign-in".
- **The artefact is the pass**, not the exit code. Read exit codes directly — never through `| tail`
  or `| grep`, both of which have hidden a failure here.
- **Open every frame you make a claim about.** No hook can check that a picture shows what the caption
  says.
- **Do not fix while measuring.** Findings go in the register; the register gets read; then things get
  fixed. Fixing mid-run destroys the comparison and biases what you look for next.
- **Clean up:** `docker compose down`, remove `/tmp/pg`, restore any service stopped or port collided
  during the run.
