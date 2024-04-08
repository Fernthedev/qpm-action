import * as core from '@actions/core'
import * as github from '@actions/github'
import * as tc from '@actions/tool-cache'
import * as cache from '@actions/cache'
import * as fs from 'fs'
import * as path from 'path'

import { getQPM_ArtifactExecutableName, getQPM_ReleaseExecutableName } from './api.js'
import {
  QPM_COMMAND_CACHE_PATH,
  QPM_COMMAND_RESTORE,
  QPM_REPOSITORY_BRANCH,
  QPM_REPOSITORY_NAME,
  QPM_REPOSITORY_OWNER
} from './constants.js'
import { GitHub } from '@actions/github/lib/utils.js'
import { PublishMode, getActionParameters, githubExecAsync } from './utils.js'
import { QPMPackage, readQPM, writeQPM } from './qpm_file.js'
import { publishRun } from './publish.js'
import stripAnsi from 'strip-ansi'
import semver from 'semver'

type WorkflowRun = {
  /** @example 10 */
  id?: number
  /** @example 42 */
  repository_id?: number
  /** @example 42 */
  head_repository_id?: number
  /** @example main */
  head_branch?: string
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

  if (fs.existsSync(cachedPath)) {
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
async function downloadQpmBleeding(
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
  const listedArtifacts = await octokit.rest.actions.listArtifactsForRepo({
    owner: QPM_REPOSITORY_OWNER,
    repo: QPM_REPOSITORY_NAME
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
  cachedPath = await tc.cacheFile(qpmToolExtract, 'qpm', 'qpm', qpmTargetVersion)

  // Add the QPM path to the system path
  core.addPath(cachedPath)
  core.debug(`Added ${cachedPath} to path`)

  // Display information about cached files
  await core.group('cache files', async () => {
    for (const file of fs.readdirSync(cachedPath!)) {
      core.debug(`${file} ${fs.statSync(path.join(cachedPath!, file)).isFile()}`)
    }
    return Promise.resolve()
  })

  // Perform any necessary fix-ups for QPM
  const execFile = path.join(cachedPath, 'qpm')
  await fixupQpm(execFile)

  return execFile
}

async function downloadQpmVersion(
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
  const url = artifact!.url
  core.info(`Downloading from ${url}`)

  const qpmTool = await tc.downloadTool(url, undefined, `Bearer ${token}`)
  const qpmToolExtract = await tc.extractZip(qpmTool)
  cachedPath = await tc.cacheFile(qpmToolExtract, 'qpm', 'qpm', qpmTargetReleaseTag)

  // Add the QPM path to the system path
  core.addPath(cachedPath)
  core.debug(`Added ${cachedPath} to path`)

  // Display information about cached files
  await core.group('cache files', async () => {
    for (const file of fs.readdirSync(cachedPath!)) {
      core.debug(`${file} ${fs.statSync(path.join(cachedPath!, file)).isFile()}`)
    }
    return Promise.resolve()
  })

  // Perform any necessary fix-ups for QPM
  const execFile = path.join(cachedPath, 'qpm')
  await fixupQpm(execFile)

  return execFile
}

export async function run(): Promise<void> {
  try {
    const qpmFilePath = 'qpm.json'
    const parameters = getActionParameters()
    const { restore, token, version, qpmVersion } = parameters
    const octokit = github.getOctokit(token)
    let qpmRustPath: string | undefined

    if (qpmVersion === undefined || qpmVersion.startsWith('version@')) {
      const versionReq = qpmVersion?.split('version@')[1]
      const versionRange = versionReq ? new semver.Range(versionReq) : undefined

      qpmRustPath = await downloadQpmVersion(octokit, token, versionRange)
    } else if (qpmVersion.startsWith('ref@')) {
      let ref: string | undefined = qpmVersion.split('ref@')[1]
      if (ref.trim() === '') ref = undefined

      qpmRustPath = await downloadQpmBleeding(octokit, token, ref)
    } else {
      core.error('Unable to parse qpm version, skipping')
    }

    const cachePathOutput = stripAnsi((await githubExecAsync(`${qpmRustPath} ${QPM_COMMAND_CACHE_PATH}`)).stdout)

    // Config path is: (fancycolor)E:\SSDUse\AppData\QPM_Temp
    const cachePath = cachePathOutput.split('Config path is: ')[1].trim()

    const paths = [cachePath]
    let cacheKey: string | undefined
    const key = 'qpm-cache-'
    if (parameters.cache) {
      const restoreKeys = ['qpm-cache-', 'qpm-cache-']
      cacheKey = await cache.restoreCache(paths, key, restoreKeys, undefined, true)
    }

    // Update version
    if (version) {
      core.info(`Using version ${version}`)
      const qpm = await readQPM<QPMPackage>(qpmFilePath)

      qpm.info.version = version

      writeQPM(qpmFilePath, qpm)
    }

    if (restore) {
      await githubExecAsync(`${qpmRustPath} ${QPM_COMMAND_RESTORE}`)
    }

    if (parameters.cache) {
      await cache.saveCache(paths, cacheKey ?? key)
    }

    if (parameters.publish == PublishMode.now) {
      publishRun(parameters)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    core.isDebug
  }
}
