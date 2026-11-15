import { ActionParameters, githubExecAsync } from './utils.js'

import * as core from '@actions/core'
import * as github from '@actions/github'
import { QPM_JSON, QPMPackage, readQPM, writeQPM } from './qpm_file.js'
import { QPM_COMMAND_PUBLISH } from './constants.js'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import path from 'path'
import { getOrMakeRelease, QPM_EXECUTABLE_NAME, Octokit } from './api.js'

/** Release to upload assets to */
type Release = { octokit: Octokit; releaseId: number }

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

/** Whether the package has a mod template, so `qpm2 qmod zip` can make a qmod */
export function hasQmodTemplate(qpm: QPMPackage, cwd: string): boolean {
  // same default as QPM.CLI's qmod manifest
  return fsSync.existsSync(path.resolve(cwd, qpm.qmod?.template ?? 'mod.template.json'))
}

/** Urls of the uploaded release assets */
export interface PublishResult {
  qpkgUrl?: string
  qmodUrl?: string
}

/** Url of the repository running the action */
function repoUrl(): string {
  return `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}`
}

/** The qpkg built by the action, `{id}.qpkg` in the package directory */
function qpkgFile(qpm: QPMPackage, packagePath: string | undefined): string {
  return path.join(packageDir(packagePath), `${qpm.id}.qpkg`)
}

/**
 * Writes publishing metadata into qpm2.json before restore.
 *
 * QPM2 publishing checks that the config embedded in the qpkg matches qpm2.json exactly,
 * so it must be final before the qpkg is built.
 */
export async function preparePublish(params: ActionParameters): Promise<void> {
  const { packagePath } = params
  const qpmPath = path.join(packageDir(packagePath), QPM_JSON)
  const qpm = await readQPM<QPMPackage>(qpmPath)

  // assign to current github repo, pointing at the package's directory for monorepos
  qpm.additionalData ??= {}
  if (!qpm.additionalData.url) {
    const subdir = packageSubdirectory(packagePath)
    qpm.additionalData.url = subdir === '' ? repoUrl() : `${repoUrl()}/tree/HEAD/${subdir}`
    core.info(`Setting additionalData.url to ${qpm.additionalData.url}`)
    await writeQPM(qpmPath, qpm)
  }
}

/** Upload a file to the release, returning the download url Github gives back */
export async function uploadReleaseAsset(
  octokit: Octokit,
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

  // upload the file as raw bytes
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

/** Upload the file if it exists, returning its download url */
async function uploadIfExists(
  octokit: Octokit,
  releaseId: number,
  file: string,
  kind: string
): Promise<string | undefined> {
  if (!fsSync.existsSync(file)) {
    core.warning(`${kind} ${file} does not exist, skipping upload`)
    return undefined
  }
  return uploadReleaseAsset(octokit, releaseId, file)
}

/**
 * Build the qmod and qpkg, uploading them and the binaries to the release when `release` is set.
 * The qmod is uploaded before the qpkg is built, so qmod.downloadUrl in the qpkg is the url Github returned.
 * Returns the uploaded qpkg url
 */
async function buildAndUpload(
  qpm: QPMPackage,
  params: ActionParameters,
  release: Release | undefined
): Promise<PublishResult> {
  const { uploadBinaries, packagePath, resolveNdk } = params
  const cwd = packageDir(packagePath)
  const result: PublishResult = {}

  // upload_qmod overrides the template detection
  const zipQmod = params.uploadQmod ?? hasQmodTemplate(qpm, cwd)
  if (!zipQmod) {
    core.info(params.uploadQmod === false ? 'upload_qmod is false, skipping qmod' : 'No mod template, skipping qmod')
  }

  if (zipQmod) {
    // build the mod and zip the qmod
    await githubExecAsync(QPM_EXECUTABLE_NAME, ['qmod', 'zip'], { cwd })

    const qmodUrl =
      release && (await uploadIfExists(release.octokit, release.releaseId, path.resolve(cwd, qmodPath(qpm)), 'Qmod'))
    result.qmodUrl = qmodUrl

    // save the real qmod url, so the qpkg built next contains it
    if (qmodUrl && qpm.qmod?.downloadUrl !== qmodUrl) {
      core.info(`Setting qmod.downloadUrl to ${qmodUrl}`)
      qpm.qmod ??= {}
      qpm.qmod.downloadUrl = qmodUrl
      await writeQPM(path.join(cwd, QPM_JSON), qpm)
    }
  }

  // build and pack the qpkg with the final qpm2.json
  const qpkgPath = qpkgFile(qpm, packagePath)
  await githubExecAsync(
    QPM_EXECUTABLE_NAME,
    ['qpkg', path.basename(qpkgPath), resolveNdk && qpm.workspace?.ndk !== undefined && '--resolve-ndk'],
    { cwd }
  )

  // nothing to upload when release upload is off
  if (!release) return result

  if (uploadBinaries) {
    for (const file of qpm.workspace?.outBinaries ?? []) {
      await uploadIfExists(release.octokit, release.releaseId, path.resolve(cwd, file), 'Binary')
    }
  }

  result.qpkgUrl = await uploadReleaseAsset(release.octokit, release.releaseId, qpkgPath)
  return result
}

/** Build, upload to the Github release and publish the package to qpackages */
export async function publishRun(params: ActionParameters): Promise<PublishResult> {
  const { publishToken, packagePath, token, tag } = params

  const cwd = packageDir(packagePath)
  const qpm = await readQPM<QPMPackage>(path.join(cwd, QPM_JSON))

  core.info(`Publishing ${qpm.id} v${qpm.version}`)

  // get or create the release, it may be shared with other packages
  let release: Release | undefined
  if (params.uploadRelease) {
    const octokit = github.getOctokit(token)
    release = { octokit, releaseId: await getOrMakeRelease(octokit, releaseTag(qpm, tag)) }
  }

  const result = await buildAndUpload(qpm, params, release)
  const { qpkgUrl } = result
  // qpm2 publish needs a qpkg url, which only exists after uploading
  if (!qpkgUrl) {
    core.warning('upload_release is false, so there is no qpkg url to publish. Skipping qpm2 publish')
    return result
  }

  // hide the token from the logs
  if (publishToken) core.setSecret(publishToken)

  core.info(`Publishing qpkg ${qpkgUrl} to qpackages`)
  await githubExecAsync(
    QPM_EXECUTABLE_NAME,
    [QPM_COMMAND_PUBLISH, qpkgUrl, '--backend', 'qpackages', publishToken && '--token', publishToken],
    { cwd }
  )
  return result
}
