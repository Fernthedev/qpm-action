import { getActionParameters, getReleaseDownloadLink, githubExecAsync } from './utils.js'

import * as core from '@actions/core'
import * as github from '@actions/github'
import { QPM_JSON, QPMPackage, readQPM, writeQPM } from './qpm_file.js'
import { QPM_COMMAND_PUBLISH } from './constants.js'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import { GitHub } from '@actions/github/lib/utils.js'
import path from 'path'
import { getOrMakeRelease, QPM_EXECUTABLE_NAME } from './api.js'

type ActionParameters = ReturnType<typeof getActionParameters>

/** Absolute path of the package directory */
function packageDir(packagePath: string | undefined): string {
  return path.resolve(packagePath ?? '.')
}

/**
 * Path of the package relative to the repository root, in posix form.
 * Empty when the package is at the root of the repository
 */
export function packageSubdirectory(packagePath: string | undefined): string {
  const repoRoot = path.resolve(process.env['GITHUB_WORKSPACE'] ?? '.')
  return path.relative(repoRoot, packageDir(packagePath)).split(path.sep).join('/')
}

/**
 * The Github release tag to publish to, defaulting to the package version.
 * Packages of a monorepo may share a release, their assets are named after the package
 */
export function releaseTag(qpm: QPMPackage, tag: string | undefined): string {
  return tag ?? qpm.version
}

/** Default qmod output of `qpm2 qmod zip`, relative to the package directory */
export function qmodPath(qpm: QPMPackage): string {
  const out = qpm.qmod?.output ?? `./${qpm.qmod?.id ?? qpm.id}`
  // same as Rust's Path::with_extension("qmod")
  return `${out.slice(0, out.length - path.extname(out).length)}.qmod`
}

function repoUrl(): string {
  return `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}`
}

/**
 * Writes publishing metadata into qpm2.json.
 *
 * QPM2 publishing checks that the config embedded in the qpkg matches qpm2.json exactly,
 * so this must run before restore/build, never after the qpkg is built.
 */
export async function preparePublish(params: ActionParameters): Promise<void> {
  const { packagePath, uploadQmod, tag } = params
  const qpmPath = path.join(packageDir(packagePath), QPM_JSON)
  const qpm = await readQPM<QPMPackage>(qpmPath)

  // assign to current github repo, pointing at the package's directory for monorepos
  qpm.additionalData ??= {}
  if (!qpm.additionalData.url) {
    const subdir = packageSubdirectory(packagePath)
    qpm.additionalData.url = subdir === '' ? repoUrl() : `${repoUrl()}/tree/HEAD/${subdir}`
    core.info(`Setting additionalData.url to ${qpm.additionalData.url}`)
  }

  if (uploadQmod) {
    const download = getReleaseDownloadLink(
      github.context.repo.owner,
      github.context.repo.repo,
      releaseTag(qpm, tag)
    )
    qpm.qmod ??= {}
    qpm.qmod.downloadUrl = `${download}/${encodeURIComponent(path.basename(qmodPath(qpm)))}`
    core.info(`Setting qmod.downloadUrl to ${qpm.qmod.downloadUrl}`)
  }

  await writeQPM(qpmPath, qpm)
}

export async function uploadReleaseAsset(
  octokit: InstanceType<typeof GitHub>,
  releaseId: number,
  filePath: string,
  fileName?: string
): Promise<string> {
  const name = fileName ?? path.basename(filePath)

  // replace assets from a previous run of the same release
  const assets = await octokit.paginate(octokit.rest.repos.listReleaseAssets, {
    release_id: releaseId,
    ...github.context.repo
  })
  const existing = assets.find(a => a.name === name)
  if (existing) {
    core.info(`Replacing existing release asset ${name}`)
    await octokit.rest.repos.deleteReleaseAsset({ asset_id: existing.id, ...github.context.repo })
  }

  core.info(`Uploading ${filePath} as ${name}`)
  const contents = await fs.readFile(filePath)
  const asset = await octokit.rest.repos.uploadReleaseAsset({
    // octokit accepts a Buffer at runtime, the types only declare string
    data: contents as unknown as string,
    release_id: releaseId,
    name,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': contents.length
    },
    ...github.context.repo
  })

  return asset.data.browser_download_url
}

async function uploadIfExists(
  octokit: InstanceType<typeof GitHub>,
  releaseId: number,
  file: string,
  kind: string
): Promise<void> {
  if (!fsSync.existsSync(file)) {
    core.warning(`${kind} ${file} does not exist, skipping upload`)
    return
  }
  await uploadReleaseAsset(octokit, releaseId, file)
}

export async function publishRun(params: ActionParameters): Promise<void> {
  const { token, uploadBinaries, uploadQmod, publishToken, tag, packagePath, resolveNdk } = params
  const octokit = github.getOctokit(token)

  const cwd = packageDir(packagePath)
  const qpm = await readQPM<QPMPackage>(path.join(cwd, QPM_JSON))

  core.info(`Publishing ${qpm.id} v${qpm.version}`)

  // build the qpkg unless one was provided. Paths are relative to the package directory
  const qpkgPath = path.resolve(cwd, params.qpkgPath ?? `${qpm.id}.qpkg`)
  if (!fsSync.existsSync(qpkgPath)) {
    core.info(`Creating qpkg file at ${qpkgPath}`)
    await githubExecAsync(
      QPM_EXECUTABLE_NAME,
      [
        'qpkg',
        path.relative(cwd, qpkgPath),
        uploadQmod && '--qmod',
        resolveNdk && qpm.workspace?.ndk !== undefined && '--resolve-ndk'
      ],
      { cwd }
    )
  }

  const releaseId = await getOrMakeRelease(octokit, releaseTag(qpm, tag))

  if (uploadBinaries) {
    for (const file of qpm.workspace?.outBinaries ?? []) {
      await uploadIfExists(octokit, releaseId, path.resolve(cwd, file), 'Binary')
    }
  }
  if (uploadQmod) {
    await uploadIfExists(octokit, releaseId, path.resolve(cwd, qmodPath(qpm)), 'Qmod')
  }

  const url = await uploadReleaseAsset(octokit, releaseId, qpkgPath)

  if (publishToken) {
    core.setSecret(publishToken)
  } else {
    core.warning('No publish_token provided, qpm2 will fall back to its stored publish key')
  }

  core.info(`Publishing qpkg ${url} to qpackages`)
  await githubExecAsync(
    QPM_EXECUTABLE_NAME,
    [QPM_COMMAND_PUBLISH, url, '--backend', 'qpackages', publishToken && '--token', publishToken],
    { cwd }
  )
}
