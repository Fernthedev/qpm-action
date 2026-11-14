import * as fs from 'fs/promises'
import * as fsSync from 'fs'

import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import * as path from 'path'
import {
  QPM_BLEEDING_TAG,
  QPM_DEFAULT_VERSION_RANGE,
  QPM_REPOSITORY_BRANCH,
  QPM_REPOSITORY_NAME,
  QPM_REPOSITORY_OWNER,
  QPM_REPOSITORY_WORKFLOW_FILE
} from './constants.js'
import { githubExecAsync } from './utils.js'
import { GitHub } from '@actions/github/lib/utils.js'
import semver from 'semver'
import { getQPM_ArtifactExecutableName, getQPM_ReleaseExecutableName, QPM_EXECUTABLE_NAME } from './api.js'

const QPM_REPO = { owner: QPM_REPOSITORY_OWNER, repo: QPM_REPOSITORY_NAME }

export interface ReleaseLike {
  id: number
  tag_name: string
  draft?: boolean
}

export interface WorkflowRunLike {
  id: number
  head_branch?: string | null
  head_sha?: string
}

/** Parse a release tag such as `v2.1.0` into a version. Non-version tags (`bleeding2`) give null */
export function parseReleaseTag(tag: string): semver.SemVer | null {
  return semver.parse(tag.replace(/^v/, ''))
}

/** The highest non-draft release whose tag satisfies the range */
export function selectQpmRelease<T extends ReleaseLike>(releases: T[], range: semver.Range): T | undefined {
  return releases
    .filter(r => !r.draft)
    .map(r => ({ release: r, version: parseReleaseTag(r.tag_name) }))
    .filter((r): r is { release: T; version: semver.SemVer } => r.version !== null && range.test(r.version))
    .sort((a, b) => semver.rcompare(a.version, b.version))[0]?.release
}

/**
 * Version to store a bleeding build under in the tool cache.
 * tool-cache only finds explicit semver versions, so the build id is a prerelease identifier
 */
export function bleedingCacheVersion(buildId: string | number): string {
  return `0.0.0-bleeding.g${buildId}`
}

/** The newest successful run matching the ref (branch or commit sha prefix), or of main if no ref */
export function selectWorkflowRun<T extends WorkflowRunLike>(runs: T[], ref: string | undefined): T | undefined {
  const target = ref ?? QPM_REPOSITORY_BRANCH
  return runs.find(r => r.head_branch === target || (ref !== undefined && r.head_sha?.startsWith(ref)))
}

/** Return the path to the QPM executable if this version is already in the tool cache */
function findCachedQpm(version: string): string | undefined {
  const cachedPath = tc.find(QPM_EXECUTABLE_NAME, version)

  if (cachedPath && fsSync.existsSync(cachedPath)) {
    core.info(`Using cached ${QPM_EXECUTABLE_NAME} ${version}`)
    core.addPath(cachedPath)
    return path.join(cachedPath, QPM_EXECUTABLE_NAME)
  }

  return undefined
}

/** Download a zip containing the QPM executable, add it to the tool cache and PATH */
async function installQpmZip(url: string, token: string, cacheVersion: string): Promise<string> {
  core.info(`Downloading ${QPM_EXECUTABLE_NAME} from ${url}`)
  const qpmTool = await tc.downloadTool(url, undefined, `Bearer ${token}`)
  const qpmToolExtract = await tc.extractZip(qpmTool)

  const cachedPath = await tc.cacheDir(qpmToolExtract, QPM_EXECUTABLE_NAME, cacheVersion)
  core.addPath(cachedPath)
  core.info(`Added ${cachedPath} to path`)

  await core.group('cache files', async () => {
    for (const file of await fs.readdir(cachedPath)) {
      core.info(`${file} ${(await fs.stat(path.join(cachedPath, file))).isFile()}`)
    }
  })

  const execFile = path.join(
    cachedPath,
    process.platform === 'win32' ? `${QPM_EXECUTABLE_NAME}.exe` : QPM_EXECUTABLE_NAME
  )
  if (process.platform !== 'win32') {
    await githubExecAsync('chmod', ['+x', execFile])
  }
  return execFile
}

/** Download QPM from a workflow artifact of QPM.CLI, for `ref@` */
export async function downloadQpmBleeding(
  octokit: InstanceType<typeof GitHub>,
  token: string,
  ref: string | undefined
): Promise<string | undefined> {
  const runs = await octokit.rest.actions.listWorkflowRuns({
    ...QPM_REPO,
    workflow_id: QPM_REPOSITORY_WORKFLOW_FILE,
    status: 'success',
    exclude_pull_requests: true,
    // a sha ref can't be filtered by branch
    branch: ref === undefined ? QPM_REPOSITORY_BRANCH : undefined,
    per_page: 100
  })

  const run = selectWorkflowRun(runs.data.workflow_runs, ref)
  if (!run) {
    core.error(`No successful ${QPM_REPOSITORY_WORKFLOW_FILE} run found for ${ref ?? QPM_REPOSITORY_BRANCH}`)
    return undefined
  }

  const cacheVersion = bleedingCacheVersion(run.head_sha)
  const cached = findCachedQpm(cacheVersion)
  if (cached) return cached

  const expectedArtifactName = getQPM_ArtifactExecutableName()
  const artifacts = await octokit.rest.actions.listWorkflowRunArtifacts({ ...QPM_REPO, run_id: run.id })
  const artifact = artifacts.data.artifacts.find(a => a.name === expectedArtifactName)

  if (!artifact) {
    core.error(`No artifact ${expectedArtifactName} found in run ${run.id} (${run.head_sha})`)
    return undefined
  }

  return installQpmZip(artifact.archive_download_url, token, cacheVersion)
}

/**
 * Download the newest QPM release satisfying the range.
 * Until a release satisfies it, the bleeding pre-release is used instead
 */
export async function downloadQpmVersion(
  octokit: InstanceType<typeof GitHub>,
  token: string,
  versionReq: semver.Range = new semver.Range(QPM_DEFAULT_VERSION_RANGE)
): Promise<string | undefined> {
  const releases = await octokit.paginate(octokit.rest.repos.listReleases, { ...QPM_REPO, per_page: 100 })

  let release = selectQpmRelease(releases, versionReq)
  let cacheVersion: string

  if (release) {
    // selectQpmRelease only returns releases with a version tag
    cacheVersion = parseReleaseTag(release.tag_name)?.version ?? release.tag_name
  } else {
    core.warning(`No QPM release satisfies ${versionReq.raw}, falling back to ${QPM_BLEEDING_TAG}`)
    release = releases.find(r => r.tag_name === QPM_BLEEDING_TAG)
    if (!release) {
      core.error(`Unable to find a QPM release for ${versionReq.raw} or ${QPM_BLEEDING_TAG}`)
      return undefined
    }
    // the bleeding release is recreated for every build, so its id identifies the build
    cacheVersion = bleedingCacheVersion(release.id)
  }

  core.info(`Using QPM ${release.tag_name}`)

  const cached = findCachedQpm(cacheVersion)
  if (cached) return cached

  const expectedAssetName = getQPM_ReleaseExecutableName()
  const asset = release.assets.find(a => a.name === expectedAssetName)
  if (!asset) {
    core.error(
      `No asset ${expectedAssetName} found in ${QPM_REPOSITORY_OWNER}/${QPM_REPOSITORY_NAME}@${release.tag_name}`
    )
    return undefined
  }

  return installQpmZip(asset.browser_download_url, token, cacheVersion)
}
