import { getActionParameters, getReleaseDownloadLink, githubExecAsync } from './utils.js'

import * as core from '@actions/core'
import * as github from '@actions/github'
import { QPackage, QPMPackage, QPMSharedPackage, readQPM, TripletId, writeQPM } from './qpm.js'
import { QPM_COMMAND_PUBLISH } from './constants.js'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import { GitHub } from '@actions/github/lib/utils.js'
import path from 'path'
import { getOrMakeRelease, QPM_EXECUTABLE_NAME } from './api.js'

async function uploadReleaseAsset(
  octokit: InstanceType<typeof GitHub>,
  releaseId: number,
  filePath: string,
  fileName?: string
) {
  const contents = await fs.readFile(filePath, 'binary')

  const asset = await octokit.rest.repos.uploadReleaseAsset({
    data: contents,
    release_id: releaseId,
    name: fileName ?? path.basename(filePath),
    ...github.context.repo
  })

  return asset.data.browser_download_url
}

async function doPublish(
  octokit: InstanceType<typeof GitHub>,

  qpkgPath: string | undefined,

  uploadBinaries: boolean,
  uploadQmod: boolean,

  version: string | undefined,

  tag: string | undefined,

  package_path: string | undefined,
  ndk?: boolean
): Promise<void> {
  core.info('Publishing')
  const qpmSharedPath = path.join(package_path ?? '.', 'qpm.shared.json')
  const qpmPath = path.join(package_path ?? '.', 'qpm.json')
  //path.join(
  //  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  // process.env.GITHUB_WORKSPACE!,
  // 'qpm.shared.json'
  // )

  const qpmSharedFile = await readQPM<QPMSharedPackage>(qpmSharedPath)
  const qpmFile = await readQPM<QPMPackage>(qpmPath)

  if (version) {
    core.info(`Overwriting version with provided ${version}`)
    qpmSharedFile.config.version = version
  }
  version ??= qpmSharedFile.config.version

  const releaseId = await getOrMakeRelease(octokit, tag ?? version)

  core.info(`Using version ${version} for publishing`)

  let qmods: Record<TripletId, string | undefined> | undefined = undefined
  let binaries: Record<TripletId, string[] | undefined> | undefined = undefined
  if (uploadBinaries) {
    binaries = Object.fromEntries(
      Object.entries(qpmFile.triplets).map(([triplet, data]) => {
        return [triplet, data.outBinaries]
      })
    )
  }
  if (uploadQmod) {
    qmods = Object.fromEntries(
      Object.entries(qpmFile.triplets).map(([triplet, data]) => {
        return [triplet, data.qmod]
      })
    )
  }

  setupArtifacts(octokit, releaseId, qpmFile, binaries, qmods)

  await writeQPM(qpmSharedPath, qpmSharedFile)

  // now build
  if (!qpkgPath || !fsSync.existsSync(qpkgPath)) {
    qpkgPath ??= path.join(package_path ?? '.', qpmFile.id + '.qpkg')
    core.info(`Creating qpkg file at ${qpkgPath}`)

    await githubExecAsync(QPM_EXECUTABLE_NAME, ['qpkg', qpkgPath, uploadQmod && '--qmod', ndk && '--ndk', '-b'])
  }

  const url = await uploadReleaseAsset(octokit, releaseId, qpkgPath)

  core.info('Publishing qpkg file to qpackages')
  await githubExecAsync(QPM_EXECUTABLE_NAME, ['publish', url, '--backend', 'qpackages'])
}

async function setupArtifacts(
  octokit: InstanceType<typeof GitHub>,
  releaseId: number,

  qpmPackage: QPMPackage,

  binaries?: Record<TripletId, string[] | undefined> | undefined,
  qmods?: Record<TripletId, string | undefined> | undefined
) {
  if (binaries) {
    for (const [triplet, files] of Object.entries(binaries)) {
      if (!files || files.length === 0) continue

      for (const file of files) {
        if (!file) continue
        if (!fsSync.existsSync(file)) {
          core.warning(`File ${file} does not exist, skipping upload`)
          continue
        }

        await uploadReleaseAsset(octokit, releaseId, file, file)
      }
    }
  }

  if (qmods) {
    for (const [triplet, qmod] of Object.entries(qmods)) {
      if (!qmod) continue
      if (!fsSync.existsSync(qmod)) {
        core.warning(`Qmod file ${qmod} does not exist, skipping upload`)
        continue
      }

      const url = await uploadReleaseAsset(octokit, releaseId, qmod, `qmod-${triplet}.qmod`)

      qpmPackage.triplets[triplet].qmodUrl = url
    }
  }
}

export async function publishRun(params: ReturnType<typeof getActionParameters>): Promise<void> {
  const { token, uploadBinaries, uploadQmod, version, publishToken, tag, packagePath, qpkgPath } = params

  const octokit = github.getOctokit(token)

  await doPublish(octokit, qpkgPath, uploadBinaries, uploadQmod, version, tag, packagePath)
  await githubExecAsync(QPM_EXECUTABLE_NAME, [QPM_COMMAND_PUBLISH, publishToken ?? ''], {
    cwd: packagePath
  })
}
