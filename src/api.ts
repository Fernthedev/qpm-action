import { GitHub } from '@actions/github/lib/utils.js'
import * as github from '@actions/github/'
import * as core from '@actions/core/'

import * as node_os from 'os'

// Helper function to get the expected QPM artifact name
export function getQPM_ArtifactExecutableName() {
  let os: string = node_os.platform()

  if (os === 'win32') os = 'windows'
  if (os === 'darwin') os = 'macos'

  return `${os}-qpm`
}
// Helper function to get the expected QPM artifact name
export function getQPM_ReleaseExecutableName() {
  let os: string = node_os.platform()
  const arch = node_os.arch()

  if (os === 'win32') os = 'windows'
  if (os === 'darwin') os = 'macos'

  return `qpm-${os}-${arch}.zip`
}

export async function getOrMakeRelease(octokit: InstanceType<typeof GitHub>, releaseTag: string) {
  try {
    const release = await octokit.rest.repos.getReleaseByTag({
      tag: releaseTag,
      ...github.context.repo
    })

    return release.data.id
  } catch (e) {
    core.info(`Found error ${e} when fetching release, creating`)
  }

  const release = await octokit.rest.repos.createRelease({
    tag_name: releaseTag,
    ...github.context.repo
  })

  return release.data.id
}
