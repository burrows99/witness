import { Cli } from "./cli.ts";
import { fill } from "../config/index.ts";
import { identityCookies } from "../browser/identities.ts";
import { parseRunArgs, runActions } from "../actions/run.ts";
import type { System } from "../system.ts";

/**
 * The command line a description gives you.
 *
 * Not a method on `System`, because assembling a product's parts and deciding what a command line
 * looks like are two jobs: the composite root was 599 lines, of which 132 were this. Everything here
 * reads what the system already knows — it adds no knowledge of its own, which is why it can live
 * outside the class that holds it.
 */
export function commandsFor(system: System): Cli {

  const cli = new Cli({ name: system.config.name, stack: system.stack, trace: system.trace }).withDefaults({
    // Rendering is the system's own job, done in this process. Shelling out to a script that calls
    // back into it is a loop nobody should have to read.
    renderVideos: opts => system.renderVideos(opts),
    // Authenticated the way a declared operation would be — the client already knows how.
    api: system.hasApi ? (method, path, body) => system.api.request(path, { method, body }) : undefined,
    sql: system.hasDatabase ? (query: string, on?: string) => (on ? system.database(on) : system.db).sql(query) : undefined,
  });

  for (const [noun, group] of Object.entries(system.config.cli ?? {})) {
    cli.command(noun, {
      summary: group.summary ?? "",
      verbs: Object.fromEntries(
        Object.entries(group.verbs).map(([verb, spec]) => {
          const argNames = spec.args ?? [];
          return [
            verb,
            {
              summary: spec.summary ?? argNames.map(a => `<${a}>`).join(" "),
              run: (args: string[]) => {
                const params = Object.fromEntries(argNames.map((a, i) => [a, Cli.need(args[i], a)]));
                if (spec.query) return system.db.query(spec.query, params);
                if (spec.signIn) {
                  const site = system.apps[spec.signIn];
                  if (!site?.signInLink) throw new Error(`app "${spec.signIn}" declares no signIn`);
                  return site.signInLink(String(Object.values(params)[0] ?? ""));
                }
                const on = spec.client ? system.client(spec.client) : system.api;
                return on.call(spec.operation!, params);
              },
            },
          ];
        }),
      ),
    });
  }

  // Merged rather than replacing: a noun usually comes from the config, and code adds the one verb
  // that needed code.
  if (Object.keys(system.config.stubs ?? {}).length) {
    cli.command("stub", {
      summary: "the local stand-ins for third parties the app calls server-side",
      verbs: {
        list: {
          summary: "every stub this config declares, and where to point the app",
          run: () =>
            Object.entries(system.config.stubs ?? {}).map(
              ([stubName, spec]) =>
                `${stubName}  :${spec.port}  ${fill(spec.reachableAs ?? "", { port: spec.port })}  ${spec.why ?? ""}`,
            ),
        },
        show: { summary: "<stub> — its routes, as declared", run: (args: string[]) => system.config.stubs?.[Cli.need(args[0], "stub")] },
      },
    });
  }

  cli.command("check", {
    summary: "whether the description still matches what is running",
    verbs: {
      drift: {
        summary: "[<action that signs in>] — visit every declared route and count every declared locator",
        // What it prints IS the answer, so it is not wrapped in a record of a request nobody made.
        raw: true,
        run: async (args: string[]) => {
          const report = await system.checkDrift(args[0]);
          // So this can gate a pipeline. Set rather than exited, so the report is flushed first.
          if (!report.ok) process.exitCode = 1;
          return report.rendered;
        },
      },
    },
  });

  if (system.actions.names.length) {
    cli.command("action", {
      summary: "run one of the declared actions in a browser, and report everything it did",
      verbs: {
        list: {
          summary: "every action this config declares",
          run: () => system.actions.names.map(n => `${n}  ${system.config.actions?.[n].summary ?? ""}`).join("\n"),
        },
        show: {
          summary: "<action> — its steps, as declared",
          run: (args: string[]) => system.config.actions?.[Cli.need(args[0], "action")],
        },
        run: {
          summary: "<action…> [key=value…] [--parallel] [--retries N] — drive them and report everything they did",
          run: async (args: string[], flags: string[] = []) => {
            const { names, inputs } = parseRunArgs(args);
            if (!names.length) Cli.die("missing <action> — `action list` says which", 2);
            return runActions(system, {
              names,
              inputs,
              headed: process.env.HEADED === "1",
              // Side by side in one video, each in its own browser. What `--parallel` is FOR is
              // seeing two things happen at once, which is why it changes the recording.
              parallel: flags.includes("--parallel"),
              // What each pane says about itself. The summary is already written; a pane headed
              // with a bare action name makes the reader guess what they are looking at.
              labels: Object.fromEntries(
                Object.entries(system.config.actions ?? {}).flatMap(([action, spec]) => (spec.summary ? [[action, spec.summary]] : [])),
              ),
              retries: Number(flags.find(flag => flag.startsWith("--retries"))?.split("=")[1] ?? 0),
              cookies: identityCookies(system.config.identities),
            });
          },
        },
      },
    });
  }

  for (const [noun, spec] of Object.entries(system.added)) {
    const existing = system.config.cli?.[noun];
    cli.command(noun, {
      summary: spec.summary || existing?.summary || "",
      verbs: { ...(cli.verbs(noun) ?? {}), ...(spec.verbs ?? {}) },
      passthrough: spec.passthrough,
    });
  }
  return cli;

}
