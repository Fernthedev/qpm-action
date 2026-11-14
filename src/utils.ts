import { exec } from 'child_process'
import { ExecOptions, ExecOutput, getExecOutput as githubExec } from '@actions/exec'
import * as core from '@actions/core'
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
  return str.trim() === '' ? undefined : str
}

/** Inputs of the action, see action.yml */
export interface ActionParameters {
  qpmVersion: string | undefined
  packagePath: string | undefined
  tag: string | undefined
  uploadBinaries: boolean
  uploadQmod: boolean
  uploadRelease: boolean
  token: string
  publish: PublishMode | undefined
  version: string | undefined
  resolveNdk: boolean
  cache: boolean
  cacheLockfile: boolean
  restore: boolean
  publishToken: string | undefined
}

export function getActionParameters(): ActionParameters {
  const publish: PublishMode | undefined = stringOrUndefined(core.getInput('publish')) as PublishMode | undefined
  const qpmVersion: string | undefined = stringOrUndefined(core.getInput('qpm_version'))

  // publish version
  const version: string | undefined = stringOrUndefined(core.getInput('version'))
  const tag: string | undefined = stringOrUndefined(core.getInput('tag'))

  // use NDK in project
  const resolveNdk = core.getBooleanInput('resolve_ndk')
  const publishToken = stringOrUndefined(core.getInput('publish_token'))

  const packagePath = stringOrUndefined(core.getInput('package_path'))

  const cache = core.getBooleanInput('cache')
  const cacheLockfile = core.getBooleanInput('cache_lockfile')
  const restore = core.getBooleanInput('restore')

  const uploadQmod = core.getBooleanInput('upload_qmod')
  const uploadBinaries = core.getBooleanInput('upload_binaries')

  const uploadRelease = core.getBooleanInput('upload_release')

  // This should be a token with access to your repository scoped in as a secret.
  // The YML workflow will need to set myToken with the GitHub Secret Token
  // myToken: ${{ secrets.GITHUB_TOKEN }}
  // https://help.github.com/en/actions/automating-your-workflow-with-github-actions/authenticating-with-the-github_token#about-the-github_token-secret
  const myToken = core.getInput('workflow_token')

  return {
    qpmVersion,
    packagePath,
    tag,
    uploadBinaries,
    uploadQmod,
    uploadRelease,
    token: myToken,
    publish,
    version,
    resolveNdk,
    cache,
    cacheLockfile,
    restore,
    publishToken
  }
}
