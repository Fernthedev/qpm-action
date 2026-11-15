import * as github from '@actions/github'
import * as core from '@actions/core'

import * as node_os from 'os'

/** Authenticated Github client */
export type Octokit = ReturnType<typeof github.getOctokit>

export const QPM_EXECUTABLE_NAME = 'qpm2'

/** OS + arch suffix used by QPM.CLI builds, e.g. `linux-x64` */
export function getQPM_PlatformSuffix(platform: string = node_os.platform(), arch: string = node_os.arch()): string {
  let os = platform
  if (os === 'win32') os = 'windows'
  if (os === 'darwin') os = 'macos'

  return `${os}-${arch}`
}

/** Workflow artifact name of QPM.CLI's `Cargo Build`, e.g. `qpm2-linux-x64` */
export function getQPM_ArtifactExecutableName(platform?: string, arch?: string): string {
  return `${QPM_EXECUTABLE_NAME}-${getQPM_PlatformSuffix(platform, arch)}`
}

/** Release asset name, e.g. `qpm2-linux-x64.zip` */
export function getQPM_ReleaseExecutableName(platform?: string, arch?: string): string {
  return `${getQPM_ArtifactExecutableName(platform, arch)}.zip`
}

async function findReleaseId(octokit: Octokit, releaseTag: string): Promise<number | undefined> {
  try {
    const release = await octokit.rest.repos.getReleaseByTag({
      tag: releaseTag,
      ...github.context.repo
    })
    return release.data.id
  } catch (e) {
    core.debug(`Fetching release ${releaseTag} failed: ${String(e)}`)
    return undefined
  }
}

/**
 * Get the release for the tag, creating it if missing.
 * Several packages may share a release, so a release created concurrently by another job is reused
 */
export async function getOrMakeRelease(octokit: Octokit, releaseTag: string): Promise<number> {
  const existing = await findReleaseId(octokit, releaseTag)
  if (existing !== undefined) return existing

  core.info(`Creating release ${releaseTag}`)
  try {
    const release = await octokit.rest.repos.createRelease({
      tag_name: releaseTag,
      // tag the commit being built rather than the default branch head
      target_commitish: github.context.sha,
      ...github.context.repo
    })
    return release.data.id
  } catch (e) {
    const raced = await findReleaseId(octokit, releaseTag)
    if (raced !== undefined) return raced
    throw e
  }
}
