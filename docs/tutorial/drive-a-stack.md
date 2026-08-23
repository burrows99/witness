# Drive a stack, from nothing

Twenty minutes. At the end you will have driven four services, recorded it, and read what the run
wrote down. Everything here is in this repository — you can run each command as you read.

## 1. Bring the stack up

```bash
git clone https://github.com/burrows99/witness && cd witness
npm install
docker compose up -d
```

Four containers: a git forge (Gitea), the database it writes to (Postgres), the mail it sends
(Mailpit), and something watching (Grafana).

```bash
npx witness stack status
```

```
stack (primary) — resolved from /…/witness/.env
  gitea     http://localhost:3020    up       witness-gitea
  postgres  http://localhost:5441    up       witness-postgres
  mailpit   http://localhost:8025    up       witness-mailpit
  grafana   http://localhost:3010    up       witness-grafana
```

`up` means *ours* is answering — the port's real publisher is compared against the container name, so
another project on 3010 reads as `NOT OURS` rather than as a healthy Grafana.

## 2. Ask it something, without a browser

```bash
npx witness accounts count --quiet     # 0
npx witness mail list --quiet          # what the stack has sent
```

Those are not built in. They come from the `cli` block of `.witness/config.jsonc`, which maps a verb
onto a query or an operation. Most questions — *why is this empty*, *did that save* — are one command,
and writing a test to answer them is how an afternoon disappears.

## 3. Drive it

```bash
npx witness action run tour
```

A browser opens, registers an account, checks Postgres holds the row, makes a repository, asks Gitea's
own API whether it exists, makes the app send mail, and reads it in the catcher. Roughly 50 seconds.

## 4. Read what it left

```bash
cat .witness/artifacts/cli/tour/run/README.md
```

Every run writes that file. It says what is where, and the call tree:

```
tour  (21 frames)
  03-register  (9 frames)
  11-createrepo  (6 frames)
  18-askforareset  (4 frames)
  …
```

**The directory tree is the call tree** — an action a step composed sits inside that step, named for
it. Open `tour/debug.md` for the step-by-step with the network and console tied to each step, and
`video.mp4` for the recording.

## 5. Break something, and watch it say so

Open `.witness/config.jsonc`, find `gitea.createRepo`, and change the repository name it types from
`witness-demo` to `witness-demo-x`. Then:

```bash
npx witness check drift
```

It re-checks every claim the description makes without driving anything, and names the ones that no
longer hold. Put it back, and it goes quiet.

## Where to go next

- [Write an action](../how-to/write-an-action.md) — the step vocabulary
- [Describe a service](../how-to/describe-a-service.md) — add one of your own
- [Why there is no test file](../explanation/why-no-test-file.md) — the decision everything else follows from
