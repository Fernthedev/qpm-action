import * as core from '@actions/core'
import * as github from '@actions/github'
import * as tc from '@actions/tool-cache'
import * as cache from '@actions/cache'
import * as io from '@actions/io'
import * as fs from 'fs'
import * as path from 'path'
import * as process from 'process'

import {getQPM_RustExecutableName} from './api'
import {
  QPM_COMMAND_CACHE_PATH,
  QPM_COMMAND_RESTORE,
  QPM_REPOSITORY_NAME,
  QPM_REPOSITORY_OWNER
} from './const'
import {GitHub} from '@actions/github/lib/utils'
import {getActionParameters, githubExecAsync} from './utils'

async function downloadQpm(
  octokit: InstanceType<typeof GitHub>
): Promise<string | undefined> {
  const artifacts = await octokit.rest.actions.listArtifactsForRepo({
    owner: QPM_REPOSITORY_OWNER,
    repo: QPM_REPOSITORY_NAME
  })

  const expectedArtifactName = getQPM_RustExecutableName()
  core.debug(
    `Looking for ${expectedArtifactName} in ${QPM_REPOSITORY_OWNER}/${QPM_REPOSITORY_NAME}`
  )
  const artifactToDownload = artifacts.data.artifacts.find(
    e => e.name === expectedArtifactName
  )

  if (artifactToDownload === undefined)
    throw new Error(`Unable to find artifact ${expectedArtifactName}`)

  let cachedPath = tc.find('qpm-rust', artifactToDownload.id.toString())

  if (fs.existsSync(cachedPath)) {
    core.debug('Using existing qpm-rust tool cached')
    core.addPath(cachedPath)
    return path.join(cachedPath, 'qpm-rust')
  }
  core.debug(`Downloading from ${artifactToDownload.archive_download_url}`)
  const artifactDownload = await octokit.rest.actions.getArtifact({
    owner: QPM_REPOSITORY_OWNER,
    repo: QPM_REPOSITORY_NAME,
    artifact_id: artifactToDownload.id,
    archive_format: 'zip'
  })

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const extractDirectory = path.join(process.env.GITHUB_WORKSPACE!, 'QPM')

  const qpmTool = await tc.downloadTool(artifactDownload.data.archive_download_url)
  const qpmToolExtract = await tc.extractZip(qpmTool)
  cachedPath = await tc.cacheDir(
    qpmToolExtract,
    'qpm',
    artifactToDownload.id.toString()
  )

  // Add "$GITHUB_WORKSPACE/QPM/" to path
  core.addPath(cachedPath)
  core.debug(`Added ${extractDirectory} to path`)

  return path.join(cachedPath, 'qpm-rust')
}

async function run(): Promise<void> {
  try {
    const {restore, token} = getActionParameters()

    const octokit = github.getOctokit(token)
    const qpm_exec = await downloadQpm(octokit)

    const cachePathOutput = (
      await githubExecAsync(`${qpm_exec} ${QPM_COMMAND_CACHE_PATH}`)
    ).stdout

    // Config path is: E:\SSDUse\AppData\QPM_Temp
    const cachePath = cachePathOutput.split('Config path is: ')[1]

    const paths = [cachePath]
    const key = 'qpm-cache'
    const restoreKeys = ['qpm-cache-', 'qpm-rust-cache-']

    const cacheKey = await cache.restoreCache(paths, key, restoreKeys)

    if (restore) {
      await githubExecAsync(`${qpm_exec} ${QPM_COMMAND_RESTORE}`)
    }

    await cache.saveCache(paths, cacheKey ?? key)

    // const ms: string = core.getInput('milliseconds')
    // core.debug(`Waiting ${ms} milliseconds ...`) // debug is only output if you set the secret `ACTIONS_STEP_DEBUG` to true
    // core.debug(new Date().toTimeString())
    // core.debug(new Date().toTimeString())
    // core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    core.isDebug
  }
}

run()
