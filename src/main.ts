import * as core from '@actions/core'
import * as github from '@actions/github'
import * as tc from '@actions/tool-cache'
import * as cache from '@actions/cache'
import * as fs from 'fs'
import * as fsAsync from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'

import { getQPM_ArtifactExecutableName, getQPM_ReleaseExecutableName, QPM_EXECUTABLE_NAME } from './api.js'
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

type WorkflowRun = {
  /** @example 10 */
  id?: number
  /** @example 42 */
  repository_id?: number
  /** @example 42 */
  head_repository_id?: number
  /** @example main */
  head_branch?: string | null
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

  if (await fs.existsSync(cachedPath)) {
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

async function resolveNDK(ndkPath: string, useCache: boolean) {
  const ndk = path.basename((await githubExecAsync(QPM_EXECUTABLE_NAME!, ['ndk', 'resolve'])).stdout.trim())

  const ndkCacheKey = `qpm-ndk-${ndk}`
  let cacheHit: string | undefined = undefined

  if (useCache) {
    core.info(`Restoring NDK cache for ${ndk}`)
    cacheHit = await cache.restoreCache([ndkPath], ndkCacheKey, ['qpm-ndk-'])
  }

  core.info(`Resolving NDK for ${ndk}`)
  await githubExecAsync(QPM_EXECUTABLE_NAME!, ['ndk', 'resolve', '-d'])

  if (useCache && !cacheHit) {
    core.info(`Saving NDK cache for ${ndk}`)
    await cache.saveCache([ndkPath], ndkCacheKey)
  }
}

export async function run(): Promise<void> {
  try {
    const parameters = getActionParameters()
    const { restore, token, version, resolveNdk, qpmVersion, packagePath } = parameters

    const qpmFilePath = path.join(packagePath ?? '.', 'qpm2.json')
    const sharedQpmFilePath = path.join(packagePath ?? '.', 'qpm2.shared.json')

    const sharedQpmFileHash = await (async () => {
      if (fs.existsSync(sharedQpmFilePath)) {
        return crypto
          .createHash('sha256')
          .update(await fsAsync.readFile(sharedQpmFilePath))
          .digest('hex')
      }
      return null
    })()

    const octokit = github.getOctokit(token)

    // download QPM
    let qpmBinaryPath: string | undefined

    if (qpmVersion === undefined || qpmVersion.startsWith('version@')) {
      const versionReq = qpmVersion?.split('version@')[1]
      const versionRange = versionReq ? new semver.Range(versionReq) : undefined

      qpmBinaryPath = await downloadQpmVersion(octokit, token, versionRange)
    } else if (qpmVersion.startsWith('ref@')) {
      let ref: string | undefined = qpmVersion.split('ref@')[1]
      if (ref.trim() === '') ref = undefined

      qpmBinaryPath = await downloadQpmBleeding(octokit, token, ref)
    } else {
      core.error('Unable to parse qpm version, skipping')
    }

    if (!qpmBinaryPath) {
      core.setFailed('Unable to download QPM, failing')
      return
    }

    let cachePathOutput = (await githubExecAsync(qpmBinaryPath!, QPM_COMMAND_CACHE_PATH)).stdout

    cachePathOutput = stripAnsi(cachePathOutput)

    // Config path is: (fancycolor)E:\SSDUse\AppData\QPM_Temp
    const cachePath = cachePathOutput.split('Config path is: ')[1].trim()

    const paths = [cachePath]
    const key = `qpm-cache-${sharedQpmFileHash ?? ''}`
    if (parameters.cache) {
      core.info(`Restoring cache at ${paths}`)
      const restoreKeys = ['qpm-cache-']
      await cache.restoreCache(paths, key, restoreKeys, undefined, true)
    }

    // use existing Actions NDK path if available
    let ndkCache = process.env['ANDROID_NDK_LATEST_HOME']
    ndkCache = ndkCache ? path.dirname(ndkCache) : undefined
    if (ndkCache) {
      await githubExecAsync(qpmBinaryPath, ['config', 'ndk-path', ndkCache])
    }
    ndkCache = ndkCache ?? path.join(cachePath, 'ndk')

    // Resolve the NDK and download it if necessary
    if (resolveNdk) {
      // set NDK path to the one provided by GitHub actions if available
      await resolveNDK(ndkCache, parameters.cache)
    }

    // Update version
    if (version) {
      core.info(`Using version ${version}`)
      const qpm = await readQPM<QPMPackage>(qpmFilePath)

      qpm.version = version

      writeQPM(qpmFilePath, qpm)
    }

    if (restore) {
      await githubExecAsync(qpmBinaryPath!, [QPM_COMMAND_RESTORE], {
        cwd: packagePath
      })
    }

    if (parameters.cache) {
      await cache.saveCache(paths, key)
    }

    if (parameters.publish === PublishMode.now) {
      publishRun(parameters)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    core.isDebug
  }
}
