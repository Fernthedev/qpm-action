import { exec } from 'child_process'
import { ExecOptions, ExecOutput, getExecOutput as githubExec } from '@actions/exec'
import * as core from '@actions/core'
import * as github from '@actions/github'
import semver from 'semver'
import stripAnsi from 'strip-ansi'

export enum PublishMode {
  now = 'now',
  late = 'late'
}

export async function execAsync(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, (err, stout, sterr) => {
      if (err) {
        reject(new Error(sterr))
      } else {
        resolve(stout)
      }
    })
  })
}
export async function githubExecAsync(
  command: string,
  args?: (string | false | undefined)[],
  options?: ExecOptions
): Promise<ExecOutput> {
  const output = await githubExec(
    command,
    // drop disabled (false/undefined) arguments
    args?.filter((x): x is string => !!x),
    options
  )
  output.stdout = stripAnsi(output.stdout)
  output.stderr = stripAnsi(output.stderr)
  return output
}

function stringOrUndefined(str: string): string | undefined {
  return str.trim() === '' ? undefined : str.trim()
}

/** Optional boolean input: empty is undefined, otherwise `true`/`false` like core.getBooleanInput */
function optionalBooleanInput(name: string): boolean | undefined {
  return stringOrUndefined(core.getInput(name)) === undefined ? undefined : core.getBooleanInput(name)
}

/** Tag and version of the git tag the workflow runs on (tag push or release event) */
export function gitTagVersion(ref: string | undefined): { tag?: string; version?: string } {
  if (!ref?.startsWith('refs/tags/')) return {}

  const tag = ref.slice('refs/tags/'.length)
  // v1.2.3 → 1.2.3, tags that are not versions give no version
  return { tag, version: semver.clean(tag) ?? undefined }
}

function parsePublishMode(value: string | undefined): PublishMode | undefined {
  if (value === undefined) return undefined
  const modes: string[] = Object.values(PublishMode)
  if (modes.includes(value)) return value as PublishMode
  throw new Error(`Invalid publish value "${value}", expected "late" or "now"`)
}

/** Inputs of the action, see action.yml */
export interface ActionParameters {
  qpmVersion: string | undefined
  packagePath: string | undefined
  tag: string | undefined
  /** Where version came from, for logging */
  versionSource: 'input' | 'git tag' | 'qpm2.json'
  uploadBinaries: boolean
  /** undefined: zip the qmod if the package has a mod template */
  uploadQmod: boolean | undefined
  uploadRelease: boolean
  token: string
  publish: PublishMode | undefined
  version: string | undefined
  resolveNdk: boolean
  cache: boolean
  restore: boolean
  publishToken: string | undefined
}

export function getActionParameters(): ActionParameters {
  const gitTag = gitTagVersion(github.context.ref)

  // the git tag is the default version and release tag
  const versionInput = stringOrUndefined(core.getInput('version'))
  const version = versionInput ?? gitTag.version
  const tag = stringOrUndefined(core.getInput('tag')) ?? gitTag.tag

  return {
    qpmVersion: stringOrUndefined(core.getInput('qpm_version')),
    packagePath: stringOrUndefined(core.getInput('package_path')),
    tag,
    version,
    versionSource: versionInput ? 'input' : version ? 'git tag' : 'qpm2.json',

    publish: parsePublishMode(stringOrUndefined(core.getInput('publish'))),
    publishToken: stringOrUndefined(core.getInput('publish_token')),
    uploadRelease: core.getBooleanInput('upload_release'),
    uploadQmod: optionalBooleanInput('upload_qmod'),
    uploadBinaries: core.getBooleanInput('upload_binaries'),

    resolveNdk: core.getBooleanInput('resolve_ndk'),
    cache: core.getBooleanInput('cache'),
    restore: core.getBooleanInput('restore'),

    // defaults to github.token in action.yml
    token: core.getInput('workflow_token')
  }
}
