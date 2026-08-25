import { BitbucketProvider, GithubProvider, GitlabProvider, LocalProvider } from './providers.js'
import type { ProviderName, ProviderOptions, ProviderSelector, VcsEnv, VcsProvider } from './types.js'

export * from './types.js'
export * from './render.js'
export * from './bypass.js'
export { LocalProvider, GithubProvider, GitlabProvider, BitbucketProvider } from './providers.js'
export { StreamTarget, CollectTarget, ciTarget } from './target.js'

/** Every provider the contract suite runs against. `local` comes first. */
export const PROVIDERS: readonly ProviderName[] = ['local', 'github', 'gitlab', 'bitbucket']

/** Selected by `--vcs`, else detected from the environment, else local. */
export function detectProvider(env: VcsEnv, selector: ProviderSelector = 'auto'): ProviderName {
  if (selector !== 'auto') return selector
  if (env.GITHUB_ACTIONS) return 'github'
  if (env.GITLAB_CI) return 'gitlab'
  if (env.BITBUCKET_BUILD_NUMBER || env.BITBUCKET_PIPELINE_UUID) return 'bitbucket'
  return 'local'
}

export function createProvider(name: ProviderName, options: ProviderOptions): VcsProvider {
  switch (name) {
    case 'github': return new GithubProvider(options)
    case 'gitlab': return new GitlabProvider(options)
    case 'bitbucket': return new BitbucketProvider(options)
    case 'local': return new LocalProvider(options)
  }
}
