import {exec} from 'child_process'
import {exec as githubExec} from '@actions/exec'
import * as core from '@actions/core'


export function getReleaseDownloadLink(
    user: string,
    repo: string,
    version: string,
) {
    return `https://github.com/${user}/${repo}/releases/download/${version}`
}

export async function execAsync(command: string) {
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
export async function githubExecAsync(command: string) {
  return await githubExec(command)
}

function stringOrUndefined(str: string): string | undefined {
  return str.trim() === '' ? undefined : str
}

export function getActionParameters() {
  const publish: boolean = core.getBooleanInput('publish') ?? false
  const version: string | undefined = stringOrUndefined(
    core.getInput('version')
  )

  const qpmReleaseBin = core.getBooleanInput('qpm_release_bin') ?? false
  const qpmDebugBin = core.getBooleanInput('qpm_debug_bin') ?? false
  const qpmQmod = stringOrUndefined(core.getInput('qpm_qmod'))

  const qpmPath = stringOrUndefined(core.getInput('qpm_json')) ?? 'qpm.json'

  const cache = core.getBooleanInput('cache') ?? true
  const cacheLockfile = core.getBooleanInput('cache_lockfile') ?? true
  const restore = core.getBooleanInput('restore') ?? true

  // This should be a token with access to your repository scoped in as a secret.
  // The YML workflow will need to set myToken with the GitHub Secret Token
  // myToken: ${{ secrets.GITHUB_TOKEN }}
  // https://help.github.com/en/actions/automating-your-workflow-with-github-actions/authenticating-with-the-github_token#about-the-github_token-secret
  const myToken = core.getInput('workflow_token')

  return {
    qpmDebugBin,
    qpmReleaseBin,
    qpmQmod,
    qpmPath,
    token: myToken,
    publish,
    version,
    cache,
    cacheLockfile,
    restore
  }
}
