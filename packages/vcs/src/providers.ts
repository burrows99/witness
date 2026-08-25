import type { Bypass, GateResult } from '@swe-verify/core'
import { DEFAULT_BYPASS_LABEL, explicitBypass, labelBypass } from './bypass.js'
import { headline, markdownReport, textReport } from './render.js'
import type { ChangeContext, ProviderName, ProviderOptions, PublishTarget, VcsProvider } from './types.js'

abstract class BaseProvider implements VcsProvider {
  abstract readonly name: ProviderName
  constructor(protected readonly options: ProviderOptions) {}

  protected get env() { return this.options.env }
  protected get label() { return this.options.bypassLabel ?? DEFAULT_BYPASS_LABEL }

  abstract describe(): Promise<ChangeContext>

  async resolveBypass(): Promise<Bypass | null> {
    // An explicit `--bypass "<reason>"` wins everywhere: it is the only
    // mechanism that works with no host at all (US-3).
    return explicitBypass(this.options.bypassReason)
  }

  abstract publish(result: GateResult, target: PublishTarget): Promise<void>
}

/**
 * `local` — no host, no token, no network. The full gate suite runs under it;
 * if it cannot, a host has become load-bearing (TDD §7.7).
 */
export class LocalProvider extends BaseProvider {
  readonly name = 'local' as const

  async describe(): Promise<ChangeContext> {
    return { provider: 'local', ...(this.env.USER ? { actor: this.env.USER } : {}) }
  }

  async publish(result: GateResult, target: PublishTarget): Promise<void> {
    for (const line of textReport(result)) target.write(line)
  }
}

interface GithubEvent {
  pull_request?: { number?: number; labels?: Array<{ name?: string }>; body?: string; user?: { login?: string } }
}

/**
 * `github` — publishes through workflow commands and the job summary file,
 * both of which are stdout/file writes. No API call, so the free path holds
 * NFR-4 (zero network egress) even on a host.
 */
export class GithubProvider extends BaseProvider {
  readonly name = 'github' as const

  private event(): GithubEvent | null {
    const raw = this.env.SWE_VERIFY_EVENT
    if (!raw) return null
    try { return JSON.parse(raw) as GithubEvent } catch { return null }
  }

  async describe(): Promise<ChangeContext> {
    const pr = this.event()?.pull_request
    const fromRef = /^(\d+)\/merge$/.exec(this.env.GITHUB_REF_NAME ?? '')?.[1]
    const changeId = pr?.number !== undefined ? String(pr.number) : fromRef
    return {
      provider: 'github',
      ...(changeId ? { changeId } : {}),
      ...(this.env.GITHUB_ACTOR ? { actor: this.env.GITHUB_ACTOR } : {}),
      ...(this.env.GITHUB_REPOSITORY ? { repo: this.env.GITHUB_REPOSITORY } : {}),
    }
  }

  override async resolveBypass(): Promise<Bypass | null> {
    const explicit = await super.resolveBypass()
    if (explicit) return explicit
    const pr = this.event()?.pull_request
    if (!pr) return null
    const labels = (pr.labels ?? []).map((l) => l.name ?? '')
    return labelBypass(labels, this.label, pr.body, pr.user?.login ?? this.env.GITHUB_ACTOR)
  }

  async publish(result: GateResult, target: PublishTarget): Promise<void> {
    target.write(headline(result))
    for (const f of result.findings) {
      const command = f.severity === 'error' ? 'error' : 'warning'
      const parts = [
        f.locus?.file ? `file=${f.locus.file}` : '',
        f.locus?.line !== undefined ? `line=${f.locus.line}` : '',
        `title=${f.code}`,
      ].filter(Boolean).join(',')
      target.write(`::${command} ${parts}::${f.message} — ${f.remedy}`)
    }
    target.summary(markdownReport(result))
  }
}

/** `gitlab` — commit status plus an MR note; labels arrive as env vars. */
export class GitlabProvider extends BaseProvider {
  readonly name = 'gitlab' as const

  async describe(): Promise<ChangeContext> {
    return {
      provider: 'gitlab',
      ...(this.env.CI_MERGE_REQUEST_IID ? { changeId: this.env.CI_MERGE_REQUEST_IID } : {}),
      ...(this.env.GITLAB_USER_LOGIN ? { actor: this.env.GITLAB_USER_LOGIN } : {}),
      ...(this.env.CI_PROJECT_PATH ? { repo: this.env.CI_PROJECT_PATH } : {}),
    }
  }

  override async resolveBypass(): Promise<Bypass | null> {
    const explicit = await super.resolveBypass()
    if (explicit) return explicit
    const labels = (this.env.CI_MERGE_REQUEST_LABELS ?? '').split(',').map((l) => l.trim()).filter(Boolean)
    return labelBypass(labels, this.label, this.env.CI_MERGE_REQUEST_DESCRIPTION, this.env.GITLAB_USER_LOGIN)
  }

  async publish(result: GateResult, target: PublishTarget): Promise<void> {
    for (const line of textReport(result)) target.write(line)
    target.summary(markdownReport(result))
  }
}

/**
 * `bitbucket` — build status plus a report. Bitbucket Pipelines exposes no
 * label in the environment, so the bypass signal there is the explicit
 * `--bypass` flag or `SWE_VERIFY_BYPASS_REASON`. Documented rather than
 * papered over with an API call that would break NFR-4.
 */
export class BitbucketProvider extends BaseProvider {
  readonly name = 'bitbucket' as const

  async describe(): Promise<ChangeContext> {
    return {
      provider: 'bitbucket',
      ...(this.env.BITBUCKET_PR_ID ? { changeId: this.env.BITBUCKET_PR_ID } : {}),
      ...(this.env.BITBUCKET_STEP_TRIGGERER_UUID ? { actor: this.env.BITBUCKET_STEP_TRIGGERER_UUID } : {}),
      ...(this.env.BITBUCKET_REPO_FULL_NAME ? { repo: this.env.BITBUCKET_REPO_FULL_NAME } : {}),
    }
  }

  override async resolveBypass(): Promise<Bypass | null> {
    const explicit = await super.resolveBypass()
    if (explicit) return explicit
    return explicitBypass(this.env.SWE_VERIFY_BYPASS_REASON)
  }

  async publish(result: GateResult, target: PublishTarget): Promise<void> {
    for (const line of textReport(result)) target.write(line)
    target.summary(markdownReport(result))
  }
}
