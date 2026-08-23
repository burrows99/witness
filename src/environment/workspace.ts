import * as fs from "node:fs";
import * as path from "node:path";

/**
 * `.witness/` — one directory in a project, holding everything this tool reads and writes.
 *
 * The convention every tool that lives beside a codebase settles on, for the same reason: `.github/`,
 * `.claude/`, `.opencode/`, `.vscode/`. A single well-known name means nothing has to be configured
 * before anything can be found, and a person opening the repository can see what is there.
 *
 * Found the way git finds a repository: walk up from the working directory and take the FIRST one.
 * Nearest wins, so a nested project inside a monorepo gets its own, and a worktree gets the copy in
 * the worktree rather than the one in the primary checkout. The walk stops at the filesystem root and
 * nothing is inherited from a parent — an ambiguous answer here is worse than no answer.
 *
 *     <root>/                     the checkout: `.env`, docker-compose.yml, the app
 *       .witness/
 *         config.jsonc            the description of this product
 *         app.ts                  the entry point specs import
 *         specs/                  what it can prove
 *         stubs/                  pages the declared stand-ins serve
 *         fixtures/               files an `upload` step attaches — a seed document, a sample import
 *         artifacts/              what runs leave behind — generated, and ignored by the .gitignore beside it
 *
 * The order is fixed and asking is free (`witness config where`):
 *
 *   1. `--config <file>`      an explicit file, for a project that keeps its description elsewhere
 *   2. `WITNESS_CONFIG`       the same, from the environment
 *   3. `WITNESS_DIR`          a directory to use instead of the one that would be found
 *   4. the nearest `.witness/` above the working directory
 */
export class Workspace {
  /** The directory's name. One name, so nothing has to be configured before anything can be found. */
  static readonly DIRECTORY = ".witness";
  /** Config file names, in the order they are tried. */
  static readonly CONFIG_NAMES = ["config.jsonc", "config.json"];
  /**
   * Where the files an `upload` step attaches are kept.
   *
   * Beside the description that names them rather than anywhere on the machine, so a step saying
   * `"upload": "seed.pdf"` means one file in every checkout. A path that resolves only where it was
   * written is the failure this exists to rule out.
   */
  static readonly FIXTURES = "fixtures";

  /** Everything witness reads and writes is under here. */
  readonly dir: string;
  readonly configFile: string;
  /** How this one was arrived at, for `config where` and for an error worth reading. */
  readonly found: "--config" | "WITNESS_CONFIG" | "WITNESS_DIR" | ".witness";

  constructor(opts: { dir: string; configFile: string; found: Workspace["found"] }) {
    this.dir = opts.dir;
    this.configFile = opts.configFile;
    this.found = opts.found;
  }

  /**
   * The checkout the directory belongs to, when the directory itself says which one.
   *
   * `<root>/.witness` names its own root: the parent. A description kept somewhere else cannot, so
   * that layout still finds the root by walking up for the markers its config declares.
   */
  get root(): string | undefined {
    return path.basename(this.dir) === Workspace.DIRECTORY ? path.dirname(this.dir) : undefined;
  }

  /** Where this workspace is, from anywhere. Absolute paths are left alone. */
  resolve(target = "."): string {
    return path.isAbsolute(target) ? target : path.join(this.dir, target);
  }

  static find(opts: { config?: string; from?: string; env?: Record<string, string | undefined> } = {}): Workspace {
    const env = opts.env ?? process.env;
    const from = opts.from ?? process.cwd();

    const file = opts.config ?? env.WITNESS_CONFIG;
    if (file) {
      const resolved = path.isAbsolute(file) ? file : path.join(from, file);
      return new Workspace({
        dir: path.dirname(resolved),
        configFile: resolved,
        found: opts.config ? "--config" : "WITNESS_CONFIG",
      });
    }

    if (env.WITNESS_DIR) {
      const dir = path.isAbsolute(env.WITNESS_DIR) ? env.WITNESS_DIR : path.join(from, env.WITNESS_DIR);
      return new Workspace({ dir, configFile: Workspace.configIn(dir), found: "WITNESS_DIR" });
    }

    const found = Workspace.locate(from);
    if (!found) {
      throw new Error(
        `no ${Workspace.DIRECTORY}/ in ${from} or any directory above it.\n` +
          "Run `witness init` to make one, or pass --config <file> for a description kept elsewhere.",
      );
    }
    return new Workspace({ dir: found, configFile: Workspace.configIn(found), found: ".witness" });
  }

  /** The nearest `.witness/` at or above a directory. */
  static locate(from: string): string | undefined {
    let at = path.resolve(from);
    for (;;) {
      const candidate = path.join(at, Workspace.DIRECTORY);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
      const up = path.dirname(at);
      if (up === at) return undefined;
      at = up;
    }
  }

  /** The config inside a directory. The first name that exists, and the first name if none do. */
  static configIn(dir: string): string {
    const found = Workspace.CONFIG_NAMES.find(name => fs.existsSync(path.join(dir, name)));
    return path.join(dir, found ?? Workspace.CONFIG_NAMES[0]);
  }

  /**
   * Make one, without overwriting anything already there.
   *
   * Returns the files it wrote, so the caller can say — a command that silently does nothing because
   * everything already existed is indistinguishable from one that failed.
   */
  static create(root: string, files: Record<string, string>): { workspace: Workspace; written: string[] } {
    const dir = path.join(path.resolve(root), Workspace.DIRECTORY);
    fs.mkdirSync(dir, { recursive: true });
    const written: string[] = [];
    for (const [name, content] of Object.entries(files)) {
      const at = path.join(dir, name);
      if (fs.existsSync(at)) continue;
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(at, content);
      written.push(at);
    }
    return { workspace: new Workspace({ dir, configFile: Workspace.configIn(dir), found: ".witness" }), written };
  }
}
