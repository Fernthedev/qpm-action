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
  QPM_REPOSITORY_OWNER,
  QPM_REPOSITORY_WORKFLOW_NAME
} from './constants.js'
import { GitHub } from '@actions/github/lib/utils.js'
import { PublishMode, getActionParameters, githubExecAsync } from './utils.js'
import { downloadQpmBleeding, downloadQpmVersion, QPMPackage, readQPM, writeQPM } from './qpm.js'
import { publishRun } from './publish.js'
import stripAnsi from 'strip-ansi'
import semver from 'semver'

export async function run(): Promise<void> {
  try {
    const qpmFilePath = 'qpm.json'
    const parameters = getActionParameters()
    const { restore, token, version, qpmVersion } = parameters
    const octokit = github.getOctokit(token)
    let qmBinaryPath: string | undefined

    if (qpmVersion === undefined || qpmVersion.startsWith('version@')) {
      const versionReq = qpmVersion?.split('version@')[1]
      const versionRange = versionReq ? new semver.Range(versionReq) : undefined

      qmBinaryPath = await downloadQpmVersion(octokit, token, versionRange)
    } else if (qpmVersion.startsWith('ref@')) {
      let ref: string | undefined = qpmVersion.split('ref@')[1]
      if (ref.trim() === '') ref = undefined

      qmBinaryPath = await downloadQpmBleeding(octokit, token, ref)
    } else {
      core.error('Unable to parse qpm version, skipping')
    }

    const cachePathOutput = stripAnsi((await githubExecAsync(`${qmBinaryPath} ${QPM_COMMAND_CACHE_PATH}`)).stdout)

    // Config path is: (fancycolor)E:\SSDUse\AppData\QPM_Temp
    const cachePath = cachePathOutput.split('Config path is: ')[1].trim()

    const paths = [cachePath]
    let cacheKey: string | undefined
    const key = 'qpm-cache-'
    if (parameters.cache) {
      core.info(`Restoring cache at ${paths}`)
      const restoreKeys = ['qpm-cache-']
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
      await githubExecAsync(`${qmBinaryPath} ${QPM_COMMAND_RESTORE}`)
    }

    if (parameters.cache) {
      await cache.saveCache(paths, cacheKey ?? key)
    }

    if (parameters.publish === PublishMode.now) {
      publishRun(parameters)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    core.isDebug
  }
}
