import { adapterReport, type AdapterEnv } from '../probe-dap/index.js'

/**
 * Which languages this machine can actually instrument.
 *
 * `SUPPORTED_LANGUAGES` says what the design covers. It says nothing about
 * whether the adapter is installed, and the difference is not academic: `.js`
 * and `.ts` map to the `ts` bucket, so without this a JavaScript change was
 * treated as gateable, no probe could ever verify, every line reported SV011,
 * and a TypeScript repository could not pass the gate at all — while the
 * finding sent the reader chasing a path-mapping problem that did not exist.
 */
export function instrumentableLanguages(cwd: string, env: AdapterEnv): string[] {
  return adapterReport(cwd, env).filter((a) => a.available).map((a) => a.language)
}
