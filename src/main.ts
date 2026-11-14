import * as core from '@actions/core'
import * as github from '@actions/github'
import * as cache from '@actions/cache'
import * as fs from 'fs'
import * as fsAsync from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'

import { QPM_COMMAND_CACHE_PATH, QPM_COMMAND_RESTORE } from './constants.js'
import { PublishMode, getActionParameters, githubExecAsync } from './utils.js'
import { downloadQpmBleeding, downloadQpmVersion } from './qpm.js'
import { QPM_JSON, QPM_SHARED_JSON, QPMPackage, readQPM, writeQPM } from './qpm_file.js'
import { preparePublish, publishRun } from './publish.js'
import stripAnsi from 'strip-ansi'
import semver from 'semver'

/**
 * Resolve the NDK required by qpm2.json, downloading it if necessary.
 * Does nothing if no NDK is specified. An installed NDK satisfying the requirement is reused
 */
export async function resolveNDK(
  qpmBinaryPath: string,
  qpmFilePath: string,
  ndkPath: string,
  useCache: boolean,
  cwd: string
): Promise<void> {
  const qpm = await readQPM<QPMPackage>(qpmFilePath)
  const ndk = qpm.workspace?.ndk

  if (!ndk) {
    core.info(`No NDK specified in ${QPM_JSON}, skipping NDK resolution`)
    return
  }

  // cache keys cannot contain commas
  const ndkCacheKey = `qpm-ndk-${ndk.replace(/,/g, '_')}`
  let cacheHit: string | undefined = undefined

  if (useCache) {
    core.info(`Restoring NDK cache for ${ndk}`)
    cacheHit = await cache.restoreCache([ndkPath], ndkCacheKey, ['qpm-ndk-'])
  }

  core.info(`Resolving NDK for ${ndk}`)
  await githubExecAsync(qpmBinaryPath, ['ndk', 'resolve', '-d'], { cwd })

  if (useCache && !cacheHit) {
    core.info(`Saving NDK cache for ${ndk}`)
    await cache.saveCache([ndkPath], ndkCacheKey)
  }
}

export async function run(): Promise<void> {
  try {
    const parameters = getActionParameters()
    const { restore, token, version, resolveNdk, qpmVersion, packagePath } = parameters

    const packageDir = path.resolve(packagePath ?? '.')
    const qpmFilePath = path.join(packageDir, QPM_JSON)
    const sharedQpmFilePath = path.join(packageDir, QPM_SHARED_JSON)

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

    let cachePathOutput = (await githubExecAsync(qpmBinaryPath, QPM_COMMAND_CACHE_PATH)).stdout

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
      await resolveNDK(qpmBinaryPath, qpmFilePath, ndkCache, parameters.cache, packageDir)
    }

    // Update version
    if (version) {
      core.info(`Using version ${version}`)
      const qpm = await readQPM<QPMPackage>(qpmFilePath)

      qpm.version = version

      await writeQPM(qpmFilePath, qpm)
    }

    // qpm2.json must be final before the qpkg is built, so publish metadata is written now
    if (parameters.publish) {
      await preparePublish(parameters)
    }

    if (restore) {
      await githubExecAsync(qpmBinaryPath, [QPM_COMMAND_RESTORE], {
        cwd: packageDir
      })
    }

    if (parameters.cache) {
      await cache.saveCache(paths, key)
    }

    if (parameters.publish === PublishMode.now) {
      await publishRun(parameters)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}
