import { exec } from 'child_process'
import { ExecOutput, getExecOutput as githubExec } from '@actions/exec'
import * as core from '@actions/core'
import stripAnsi from 'strip-ansi'

export enum PublishMode {
  now = 'now',
  late = 'late'
}

export function getReleaseDownloadLink(user: string, repo: string, version: string): string {
  return `https://github.com/${user}/${repo}/releases/download/${version}`
}

export async function execAsync(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, (err, stout, sterr) => {
      if (err) {
        reject(sterr)
      } else {
        resolve(stout)
      }
    })
  })
}
export async function githubExecAsync(command: string): Promise<ExecOutput> {
  const output = await githubExec(command)
  output.stdout = stripAnsi(output.stdout)
  output.stderr = stripAnsi(output.stderr)
  return output
}

function stringOrUndefined(str: string): string | undefined {
  return str.trim() === '' ? undefined : str
}

//eslint-ignore @typescript-eslint/explicit-function-return-type
export function getActionParameters() {
  const publish: PublishMode | undefined = stringOrUndefined('publish') as PublishMode
  const qpmVersion: string | undefined = stringOrUndefined(core.getInput('qpm_version'))
  const version: string | undefined = stringOrUndefined(core.getInput('version'))
  const tag: string | undefined = stringOrUndefined(core.getInput('tag'))
  const publishToken = stringOrUndefined(core.getInput('publish_token'))

  const qpmReleaseBin = core.getBooleanInput('qpm_release_bin')
  const qpmDebugBin = core.getBooleanInput('qpm_debug_bin')
  const qpmQmod = stringOrUndefined(core.getInput('qpm_qmod'))

  const cache = core.getBooleanInput('cache')
  const cacheLockfile = core.getBooleanInput('cache_lockfile')
  const restore = core.getBooleanInput('restore')

  // This should be a token with access to your repository scoped in as a secret.
  // The YML workflow will need to set myToken with the GitHub Secret Token
  // myToken: ${{ secrets.GITHUB_TOKEN }}
  // https://help.github.com/en/actions/automating-your-workflow-with-github-actions/authenticating-with-the-github_token#about-the-github_token-secret
  const myToken = core.getInput('workflow_token')

  return {
    qpmDebugBin,
    qpmReleaseBin,
    qpmQmod,
    qpmVersion,
    token: myToken,
    publish,
    version,
    tag,
    cache,
    cacheLockfile,
    restore,
    publishToken
  }
}
