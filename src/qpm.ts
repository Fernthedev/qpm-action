import * as fs from 'fs/promises'
import * as fsOld from 'fs'

import * as core from '@actions/core'
import * as github from '@actions/github'
import * as tc from '@actions/tool-cache'
import * as cache from '@actions/cache'
import * as path from 'path'
import {
  QPM_REPOSITORY_BRANCH,
  QPM_REPOSITORY_NAME,
  QPM_REPOSITORY_OWNER,
  QPM_REPOSITORY_WORKFLOW_NAME
} from './constants.js'
import { githubExecAsync } from './utils.js'
import { GitHub } from '@actions/github/lib/utils.js'
import semver from 'semver'
import { getQPM_ArtifactExecutableName, getQPM_ReleaseExecutableName } from './api.js'

export interface QPMSharedPackage {
  config: QPMPackage
}

export interface QPMPackage {
  info: {
    name: string
    id: string
    version: string
    additionalData: {
      branchName?: string
      headersOnly?: boolean
      overrideSoName?: string
      overrideDebugSoName?: string
      soLink?: string
      debugSoLink?: string
      modLink?: string
    }
  }
}

export async function readQPM<T extends QPMPackage | QPMSharedPackage>(file: fsOld.PathLike): Promise<T> {
  return JSON.parse((await fs.readFile(file, undefined)).toString())
}

export async function writeQPM(file: fsOld.PathLike, qpm: QPMPackage | QPMSharedPackage): Promise<void> {
  const qpmStr = JSON.stringify(qpm)
  await fs.writeFile(file, qpmStr)
}

type WorkflowRun = {
  /** @example 10 */
  id?: number
  /** @example 42 */
  repository_id?: number
  /** @example 42 */
  head_repository_id?: number
  /** @example main */
  head_branch?: string | null
  /** @example 009b8a3a9ccbb128af87f9b1c0f4c62e8a304f6d */
  head_sha?: string
}

function lookForRef(e: WorkflowRun, ref: string) {
  return e?.head_sha?.startsWith(ref) || e?.head_branch === ref
}
function lookForLatestBranch(e: WorkflowRun) {
  return e?.head_branch === QPM_REPOSITORY_BRANCH
}

/** Check if the QPM version already exists in the cache
 * Return the path if QPM exists, otherwise return undefined
 **/
async function checkIfQpmExists(version: string) {
  const cachedPath = tc.find('qpm', version)

  if (fsOld.existsSync(cachedPath)) {
    core.debug('Using existing qpm tool cached')
    core.addPath(cachedPath)
    return path.join(cachedPath, 'qpm')
  }

  return undefined
}

async function fixupQpm(execFile: string) {
  const parent = path.dirname(execFile)
  await githubExecAsync(`chmod +x ${execFile}`)
  await githubExecAsync(`ln ${execFile} ${path.join(parent, 'qpm-rust')}`)
}

// Function to download QPM
export async function downloadQpmBleeding(
  octokit: InstanceType<typeof GitHub>,
  token: string,
  ref: string | undefined
): Promise<string | undefined> {
  // Get the branch information for QPM repository
  const qpmBranch = await octokit.rest.repos.getBranch({
    branch: QPM_REPOSITORY_BRANCH,
    owner: QPM_REPOSITORY_OWNER,
    repo: QPM_REPOSITORY_NAME
  })

  // Determine the target version based on the provided ref or use the latest commit SHA
  const qpmTargetVersion = ref ?? qpmBranch.data.commit.sha
  core.debug(`Looking for qpm in cache version ${qpmTargetVersion}`)

  // Check if QPM is already in the cache
  let cachedPath = await checkIfQpmExists(qpmTargetVersion)
  if (cachedPath) {
    return cachedPath
  }

  // Get the expected artifact name for QPM
  const expectedArtifactName = getQPM_ArtifactExecutableName()
  core.debug(`Looking for ${expectedArtifactName} in ${QPM_REPOSITORY_OWNER}/${QPM_REPOSITORY_NAME}`)

  // List artifacts for the QPM repository
  const workflowRunsResult = await octokit.rest.actions.listWorkflowRuns({
    owner: QPM_REPOSITORY_OWNER,
    repo: QPM_REPOSITORY_NAME,
    workflow_id: QPM_REPOSITORY_WORKFLOW_NAME
  })

  const workflowRuns = workflowRunsResult.data.workflow_runs
    .filter(e => matchCheck(e))
    .sort((a, b) => a.run_number - b.run_number)

  // get latest workflow
  const workflowId = workflowRuns[workflowRuns.length - 1]

  const listedArtifacts = await octokit.rest.actions.listWorkflowRunArtifacts({
    owner: QPM_REPOSITORY_OWNER,
    repo: QPM_REPOSITORY_NAME,
    run_id: workflowId.run_number
  })

  // Choose the matching workflow run based on the provided ref or the latest branch
  const matchCheck = ref !== undefined ? (e: WorkflowRun) => lookForRef(e, ref) : lookForLatestBranch

  // Find the QPM artifact in the list
  const artifact = listedArtifacts.data.artifacts.find(
    e => e.name === expectedArtifactName && e.workflow_run && matchCheck(e.workflow_run)
  )

  // Handle the case when no artifact is found
  if (!artifact) {
    core.error(`No artifact found for ${QPM_REPOSITORY_OWNER}/${QPM_REPOSITORY_NAME}@${QPM_REPOSITORY_BRANCH}`)
  }

  // Download the QPM artifact
  const url = artifact!.archive_download_url
  core.debug(`Downloading from ${url}`)

  const qpmTool = await tc.downloadTool(url, undefined, `Bearer ${token}`)
  const qpmToolExtract = await tc.extractZip(qpmTool)
  cachedPath = await tc.cacheDir(qpmToolExtract, 'qpm', 'qpm', qpmTargetVersion)

  // Add the QPM path to the system path
  core.addPath(cachedPath)
  core.debug(`Added ${cachedPath} to path`)

  // Display information about cached files
  await core.group('cache files', async () => {
    for (const file of fsOld.readdirSync(cachedPath!)) {
      core.debug(`${file} ${fsOld.statSync(path.join(cachedPath!, file)).isFile()}`)
    }
    return Promise.resolve()
  })

  // Perform any necessary fix-ups for QPM
  const execFile = path.join(cachedPath, 'qpm')
  await fixupQpm(execFile)

  return execFile
}

export async function downloadQpmVersion(
  octokit: InstanceType<typeof GitHub>,
  token: string,
  versionReq: semver.Range | undefined
): Promise<string | undefined> {
  // Determine the target version based on the provided ref or use the latest release
  let qpmTargetReleaseTag: string
  if (versionReq === undefined) {
    // Get the branch information for QPM repository
    const qpmRelease = await octokit.rest.repos.getLatestRelease({
      branch: QPM_REPOSITORY_BRANCH,
      owner: QPM_REPOSITORY_OWNER,
      repo: QPM_REPOSITORY_NAME
    })
    qpmTargetReleaseTag = qpmRelease.data.tag_name
  } else {
    // Get the branch information for QPM repository
    const qpmReleases = await octokit.rest.repos.listReleases({
      branch: QPM_REPOSITORY_BRANCH,
      owner: QPM_REPOSITORY_OWNER,
      repo: QPM_REPOSITORY_NAME
    })
    qpmReleases.data.sort((a, b) => a.tag_name.localeCompare(b.tag_name)).reverse()
    const targetQpmRelease = qpmReleases.data.find(x => semver.satisfies(semver.coerce(x.tag_name)!, versionReq))
    if (targetQpmRelease === undefined) {
      core.error(`Unable to find valid qpm version for ${versionReq}`)
    }

    qpmTargetReleaseTag = targetQpmRelease?.tag_name!
  }

  core.debug(`Looking for qpm in cache version ${qpmTargetReleaseTag}`)

  // Check if QPM is already in the cache
  let cachedPath = await checkIfQpmExists(qpmTargetReleaseTag)
  if (cachedPath) {
    return cachedPath
  }

  // Get the expected artifact name for QPM
  const expectedArtifactName = getQPM_ReleaseExecutableName()
  core.debug(`Looking for ${expectedArtifactName} in ${QPM_REPOSITORY_OWNER}/${QPM_REPOSITORY_NAME}`)

  // List artifacts for the QPM repository
  const qpmRelease = await octokit.rest.repos.getReleaseByTag({
    owner: QPM_REPOSITORY_OWNER,
    repo: QPM_REPOSITORY_NAME,
    tag: qpmTargetReleaseTag
  })

  // Find the QPM artifact in the list
  const artifact = qpmRelease.data.assets.find(a => a.name === expectedArtifactName)

  // Handle the case when no artifact is found
  if (!artifact) {
    core.error(`No artifact found for ${QPM_REPOSITORY_OWNER}/${QPM_REPOSITORY_NAME}@${qpmTargetReleaseTag}`)
  }

  // Download the QPM artifact
  const url = artifact!.browser_download_url
  core.info(`Downloading from ${url}`)

  const qpmTool = await tc.downloadTool(url, undefined, `Bearer ${token}`)
  core.info(`Downloaded to ${qpmTool}, extracting`)

  const qpmToolExtract = await tc.extractZip(qpmTool)

  core.info(`Extracted to ${qpmToolExtract}, adding to cache`)
  cachedPath = await tc.cacheDir(qpmToolExtract, 'qpm', 'qpm', qpmTargetReleaseTag)

  // Add the QPM path to the system path
  core.addPath(cachedPath)
  core.info(`Added ${cachedPath} to path`)

  // Display information about cached files
  await core.group('cache files', async () => {
    for (const file of fsOld.readdirSync(cachedPath!)) {
      core.debug(`${file} ${fsOld.statSync(path.join(cachedPath!, file)).isFile()}`)
    }
    return Promise.resolve()
  })

  // Perform any necessary fix-ups for QPM
  const execFile = path.join(cachedPath, 'qpm')
  await fixupQpm(execFile)

  return execFile
}
