import { getActionParameters, getReleaseDownloadLink, githubExecAsync } from './utils.js'

import * as core from '@actions/core'
import * as github from '@actions/github'
import { QPMPackage, QPMSharedPackage, readQPM, writeQPM } from './qpm.js'
import { QPM_COMMAND_PUBLISH } from './constants.js'
import * as fs from 'fs/promises'
import { GitHub } from '@actions/github/lib/utils.js'
import path from 'path'
import { getOrMakeRelease } from './api.js'

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
  version: string,
  tag: string | undefined,
  release: string | undefined,
  debug: string | undefined,
  qmod: string | undefined
): Promise<void> {
  core.info('Publishing')
  const qpmSharedPath = 'qpm.shared.json'
  const qpmPath = 'qpm.json'

  const qpmSharedFile = await readQPM<QPMSharedPackage>(qpmSharedPath)
  const qpmFile = await readQPM<QPMPackage>(qpmPath)

  if (version) {
    core.info(`Overwriting version with provided ${version}`)
    qpmSharedFile.config.info.version = version
  }
  version ??= qpmSharedFile.config.info.version

  core.info(`Using version ${version} for publishing`)

  const branch = `version/v${version.replace(/\./g, '_')}`
  qpmSharedFile.config.info.additionalData.branchName = branch

  setupArtifacts(octokit, qpmSharedFile, version, tag ?? version, release, debug, qmod)

  await writeQPM(qpmSharedPath, qpmSharedFile)

  const git = octokit.rest.git

  await core.group<void>('Publish', async () => {
    // create branch
    // reference https://github.com/peterjgrainger/action-create-branch/blob/c2800a3a9edbba2218da6861fa46496cf8f3195a/src/create-branch.ts#L3
    const branchHead = `heads/${branch}`
    const branchRef = `refs/${branchHead}`

    core.info('Getting data')
    // get current repo data
    const lastCommitSha = github.context.sha
    const lastCommit = await git.getCommit({
      ...github.context.repo,
      commit_sha: lastCommitSha
    })

    try {
      core.info('creating new branch')
      await git.createRef({
        ...github.context.repo,
        ref: branchRef,
        sha: lastCommitSha,
        key: branchRef
      })
    } catch (e) {
      core.warning(`Creating new branch ${branch} failed due to ${e}`)
    }

    core.info('Creating commit')
    // create commit
    const newTree = await git.createTree({
      ...github.context.repo,
      tree: [
        {
          content: JSON.stringify(qpmSharedFile),
          path: qpmSharedPath,
          mode: '100644'
        },
        {
          content: JSON.stringify(qpmFile),
          path: qpmPath,
          mode: '100644'
        }
      ],
      base_tree: lastCommit.data.tree.sha
    })
    const commit = await git.createCommit({
      ...github.context.repo,
      parents: [lastCommitSha],
      message: 'Update version and post restore',
      tree: newTree.data.sha
    })

    // update branch
    core.info(`Updating branch ${branchRef} ${commit.data.sha}`)
    await git.updateRef({
      ...github.context.repo,
      ref: branchHead,
      sha: commit.data.sha,
      force: true
    })
  })
  // do github stuff
}

async function setupArtifacts(
  octokit: InstanceType<typeof GitHub>,
  qpmSharedFile: QPMSharedPackage,
  version: string,
  tag: string,
  releaseBinary: string | undefined,
  debugBinary: string | undefined,
  qmodPath: string | undefined
) {
  const releaseId = await getOrMakeRelease(octokit, tag)

  const additionalData = qpmSharedFile.config.info.additionalData
  const fileId = qpmSharedFile.config.info.id
  const fixedFileVersion = version.replace(/\./g, '_')
  if (releaseBinary) {
    const versionedName = `lib${fileId}_${fixedFileVersion}.so`
    const name = additionalData.overrideSoName ?? versionedName
    // fixup path
    const filePath = path.join(path.dirname(releaseBinary), name)

    qpmSharedFile.config.info.additionalData.soLink = await uploadReleaseAsset(octokit, releaseId, filePath)
  }

  if (debugBinary) {
    const nameOverride = additionalData.overrideSoName && `debug_${additionalData.overrideSoName}`
    const debugVersionedName = `debug_lib${fileId}_${fixedFileVersion}.so`
    const name = additionalData.overrideDebugSoName ?? nameOverride ?? debugVersionedName

    // fixup path
    const filePath = path.join(path.dirname(debugBinary), name)

    qpmSharedFile.config.info.additionalData.debugSoLink = await uploadReleaseAsset(octokit, releaseId, filePath)
  }

  if (qmodPath) {
    qpmSharedFile.config.info.additionalData.modLink = await uploadReleaseAsset(octokit, releaseId, qmodPath)
  }
}

export async function publishRun(params: ReturnType<typeof getActionParameters>): Promise<void> {
  const { token, qpmDebugBin, qpmQmod, qpmReleaseBin, version, publishToken, tag } = params

  const octokit = github.getOctokit(token)

  if (!version) {
    throw new Error('No version specified in publish!')
  }

  await doPublish(octokit, version, tag, qpmReleaseBin, qpmDebugBin, qpmQmod)
  await githubExecAsync(`qpm ${QPM_COMMAND_PUBLISH} "${publishToken ?? ''}"`)
}
