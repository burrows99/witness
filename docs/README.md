# Documentation

Organised by [Diátaxis](https://diataxis.fr): four kinds of document that answer four different
questions, kept apart because mixing them is what makes documentation unreadable.

| | you are | it answers |
|---|---|---|
| **[tutorial/](tutorial)** | learning | "take me through it once" |
| **[how-to/](how-to)** | working | "I need to do this specific thing" |
| **[reference/](reference)** | working | "what exactly does this field do" |
| **[explanation/](explanation)** | studying | "why is it built this way" |

Two more, which Diátaxis does not have and this project needs:

| | |
|---|---|
| **[internals/](internals)** | one page per source area, for somebody changing the tool itself |
| **[agent/](agent)** | what an agent working on this repository has learned — see [agent/knowledge.md](agent/knowledge.md) |

The [README](../README.md) is the front door and stays short. Anything longer than a paragraph
belongs here.

## Where things are

```
docs/
  tutorial/     drive-a-stack.md          from nothing to a recorded run
  how-to/       describe-a-service.md     add a service to a description
                write-an-action.md        the step vocabulary, in use
                record-a-terminal.md      a service with no screen
                run-things-in-parallel.md panes, and what they cost
                check-for-drift.md        find what stopped matching
                debug-a-failing-run.md    read what a run left behind
  reference/    config.md                 every field of the description
                steps.md                  every step verb
                cli.md                    every command
                providers.md              every pluggable point
                artifacts.md              what a run writes, and where
  explanation/  why-no-test-file.md       the central decision
                evidence-not-passfail.md  what this is for
                recorder-vs-video.md      two stages people confuse
                the-directory-is-the-tree.md  why artifacts nest
  internals/    README.md                 the map: src/ in eleven areas
                system.md config.md actions.md browser.md http.md
                database.md environment.md evidence.md diagnostics.md
                providers.md cli.md skill.md
  agent/        workflow.md               how a change gets made here
                knowledge.md              what we have learned, appended each iteration
```

`/flow` in `.claude/commands/` is the executable form of `agent/workflow.md`, and two hooks in
`.claude/hooks/` enforce the parts of it that prose could not.
