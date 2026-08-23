# skill

`src/skill/skill.ts` (469 lines) — the instructions this tool hands whoever is driving it.

Written for an agent, and **generated** for the same reason the config template is: a page of prose
about what a tool can do is wrong the week after it is written, and wrong instructions are worse than
none — they send someone to a verb that no longer exists.

So the verb list comes from the CLI it is describing. Add a noun and the skill mentions it.

## What it has to get right

Everything an agent will do with the tool, it will do from this text alone. That makes it the highest
leverage file in the repository and the one most easily wrong in ways nothing else catches:

- a **path that no longer exists** — the layout dropped its `actions/` segment and this still sent
  readers there
- a **verb described as authenticated** that sent no auth
- a starter config that produced `no client provider "…"` on every command

All three came from cold-start agents given the skill and nothing else. That is the only test that
works here: someone who has never seen the tool, following the text, hitting the wall.

Two cold-agent runs produced about ten pull requests between them.

## Rules

- describe what exists **now**, never a plan
- give the exact command, not a description of one
- when a path is named, name the file the reader should open **first**
- prose that could be a verb list should be a verb list
