import * as core from '@actions/core'
import * as github from '@actions/github'
import * as artifact from '@actions/artifact'
import * as cache from '@actions/cache'
import * as io from '@actions/io'
import * as fs from 'fs'
import * as path from 'path'
import * as process from 'process'
import * as zip from '@zip.js/zip.js'
import {getQPM_RustExecutableName} from './api'
import {
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

  core.debug(`Downloading from ${artifactToDownload.archive_download_url}`)
  const artifactDownload = await octokit.rest.actions.downloadArtifact({
    owner: QPM_REPOSITORY_OWNER,
    repo: QPM_REPOSITORY_NAME,
    artifact_id: artifactToDownload.id,
    archive_format: 'zip'
  })

  const artifactZipData = artifactDownload.data as ArrayBuffer

  core.debug(`Type of response download data: ${typeof artifactZipData}`)
  core.debug(`Data: ${(artifactZipData as object).constructor.name}`)

  const artifactZip = new zip.ZipReader(
    new zip.Uint8ArrayReader(new Uint8Array(artifactZipData))
  )

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const extractDirectory = path.join(process.env.GITHUB_WORKSPACE!, 'QPM')
  await io.mkdirP(extractDirectory)

  core.debug('Unzipping')

  let qpm_exec: string | undefined = undefined

  // get all entries from the zip
  for (const entry of await artifactZip.getEntries()) {
    if (!entry.getData) continue
    if (!(entry instanceof zip.fs.ZipFileEntry)) continue

    core.debug(`Extracting ${entry.filename}`)

    const data = await entry.getUint8Array()
    // text contains the entry data as a String
    const fileStream = fs.createWriteStream(
      path.join(extractDirectory, entry.filename),
      {
        autoClose: true
      }
    )

    core.debug(`Extracting ${entry.filename} to ${fileStream.path}`)

    if (entry.filename.startsWith('qpm-rust')) {
      qpm_exec = fileStream.path as string
    }

    fileStream.write(data)
    fileStream.end()
  }

  // close the ZipReader
  await artifactZip.close()

  // Add "$GITHUB_WORKSPACE/QPM/" to path
  core.addPath(extractDirectory)
  core.debug(`Added ${extractDirectory} to path`)

  return qpm_exec
}

async function run(): Promise<void> {
  try {
    const {restore, token} = getActionParameters()

    const octokit = github.getOctokit(token)
    const qpm_exec = await downloadQpm(octokit)

    const paths = ['qpm.shared.json']
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
