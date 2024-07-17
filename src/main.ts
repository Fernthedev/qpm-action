import * as core from '@actions/core'
import * as github from '@actions/github'
import * as tc from '@actions/tool-cache'
import * as cache from '@actions/cache'
import * as fs from 'fs'
import * as path from 'path'

import {getQPM_RustExecutableName} from './api'
import {
  QPM_COMMAND_CACHE_PATH,
  QPM_COMMAND_RESTORE,
  QPM_REPOSITORY_BRANCH,
  QPM_REPOSITORY_NAME,
  QPM_REPOSITORY_OWNER,
  QPM_REPOSITORY_WORKFLOW_NAME
} from './const'
import {GitHub} from '@actions/github/lib/utils'
import {getActionParameters, githubExecAsync} from './utils'
import {QPMPackage, readQPM, writeQPM} from './qpmf'
import {publishRun} from './publish'
import stripAnsi from 'strip-ansi'

async function downloadQpm(
  octokit: InstanceType<typeof GitHub>,
  token: string
): Promise<string | undefined> {
  const expectedArtifactName = getQPM_RustExecutableName()
  core.debug(
    `Looking for ${expectedArtifactName} in ${QPM_REPOSITORY_OWNER}/${QPM_REPOSITORY_NAME}`
  )

  const branch = await octokit.rest.repos.getBranch({
    branch: QPM_REPOSITORY_BRANCH,
    owner: QPM_REPOSITORY_OWNER,
    repo: QPM_REPOSITORY_NAME
  })

  const qpmVersion = branch.data.commit.sha
  let cachedPath = tc.find('qpm', qpmVersion)

  if (fs.existsSync(cachedPath)) {
    core.debug('Using existing qpm tool cached')
    core.addPath(cachedPath)
    return path.join(cachedPath, 'qpm')
  }

  // List artifacts for the QPM repository
  const workflowRunsResult = await octokit.rest.actions.listWorkflowRunsForRepo(
    {
      owner: QPM_REPOSITORY_OWNER,
      repo: QPM_REPOSITORY_NAME,
      status: 'success',
      exclude_pull_requests: true,
      branch: QPM_REPOSITORY_BRANCH
    }
  )

  const workflowRuns = workflowRunsResult.data.workflow_runs.sort(
    (a, b) => a.run_number - b.run_number
  )

  // get latest workflow
  const workflowId = workflowRuns[workflowRuns.length - 1]

  const listedArtifacts = await octokit.rest.actions.listWorkflowRunArtifacts({
    owner: QPM_REPOSITORY_OWNER,
    repo: QPM_REPOSITORY_NAME,
    run_id: workflowId.run_number
  })
  const artifact = listedArtifacts.data.artifacts.find(
    e =>
      e.name === expectedArtifactName &&
      e.workflow_run?.head_branch === QPM_REPOSITORY_BRANCH
  )
  if (!artifact) {
    core.error(
      `No artifact found for ${QPM_REPOSITORY_OWNER}/${QPM_REPOSITORY_NAME}@${QPM_REPOSITORY_BRANCH} `
    )
  }

  const url = artifact!.archive_download_url
  // const url = `https://nightly.link/${QPM_REPOSITORY_OWNER}/${QPM_REPOSITORY_NAME}/workflows/${QPM_REPOSITORY_WORKFLOW_NAME}/${QPM_REPOSITORY_BRANCH}/${expectedArtifactName}.zip`

  core.debug(`Downloading from ${url}`)

  const qpmTool = await tc.downloadTool(url, undefined, `Bearer ${token}`)
  const qpmToolExtract = await tc.extractZip(qpmTool)
  cachedPath = await tc.cacheDir(qpmToolExtract, 'qpm', qpmVersion)

  // Add "$GITHUB_WORKSPACE/QPM/" to path
  core.addPath(cachedPath)
  core.debug(`Added ${cachedPath} to path`)

  await core.group('cache files', async () => {
    for (const file of fs.readdirSync(cachedPath)) {
      core.debug(`${file} ${fs.statSync(path.join(cachedPath, file)).isFile()}`)
    }
    return Promise.resolve()
  })

  const execFile = path.join(cachedPath, 'qpm')
  await githubExecAsync(`chmod +x ${execFile}`)
  await githubExecAsync(`ln ${execFile} ${path.join(cachedPath, 'qpm-rust')}`)

  return execFile
}

async function run(): Promise<void> {
  try {
    const qpmFilePath = 'qpm.json'
    const parameters = getActionParameters()
    const {restore, token, version} = parameters
    const octokit = github.getOctokit(token)
    const qpmRustPath = await downloadQpm(octokit, token)

    const cachePathOutput = stripAnsi(
      (await githubExecAsync(`${qpmRustPath} ${QPM_COMMAND_CACHE_PATH}`)).stdout
    )

    let paths: string[] = []
    let cacheKey: string | undefined
    const key = 'qpm-cache-'

    if (parameters.cache) {
      // Config path is: (fancycolor)E:\SSDUse\AppData\QPM_Temp
      const cachePath = cachePathOutput
        .split('Config path is: ')[1]
        // .substring(2) // substring to ignore fancy color
        .trim()

      paths = [cachePath]
      const restoreKeys = ['qpm-cache-', 'qpm-cache-']
      cacheKey = await cache.restoreCache(
        paths,
        key,
        restoreKeys,
        undefined,
        true
      )
    }

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

    if (parameters.eagerPublish) {
      publishRun(parameters)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    core.isDebug
  }
}

run()
