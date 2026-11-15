import { jest } from '@jest/globals'

export const REPO = { owner: 'owner', repo: 'repo' }
export const SHA = 'abcdef1234567890'

/** Mocks @actions/core, silencing logs and recording calls */
export function mockCore(inputs: Record<string, string> = {}) {
  const core = {
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    setSecret: jest.fn(),
    addPath: jest.fn(),
    isDebug: jest.fn(() => false),
    group: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    getInput: jest.fn((name: string) => inputs[name] ?? ''),
    getBooleanInput: jest.fn((name: string) => inputs[name] === 'true'),
    getMultilineInput: jest.fn((name: string) => (inputs[name] ?? '').split('\n').filter(x => x !== ''))
  }
  jest.unstable_mockModule('@actions/core', () => core)
  return core
}

export type ExecCall = { command: string; args: string[]; cwd?: string }

/** Mocks @actions/exec, recording every command. `onExec` may emulate side effects of the command */
export function mockExec(onExec?: (call: ExecCall) => void | Promise<void>, stdout = '') {
  const calls: ExecCall[] = []
  const getExecOutput = jest.fn(async (command: string, args?: string[], options?: { cwd?: string }) => {
    const call = { command, args: args ?? [], cwd: options?.cwd }
    calls.push(call)
    await onExec?.(call)
    return { exitCode: 0, stdout, stderr: '' }
  })
  // other @actions packages (tool-cache) import exec too
  const exec = jest.fn(async (command: string, args?: string[], options?: { cwd?: string }) => {
    await getExecOutput(command, args, options)
    return 0
  })
  jest.unstable_mockModule('@actions/exec', () => ({ getExecOutput, exec }))
  return { calls, getExecOutput, exec }
}

export interface FakeAsset {
  id: number
  name: string
  browser_download_url: string
}

/** In-memory Github releases of the action's repository */
export function fakeOctokit(initial: { id: number; tag_name: string; assets?: FakeAsset[] }[] = []) {
  const releases = initial.map(r => ({ ...r, assets: r.assets ?? [] }))
  let nextId = 1000
  const notFound = () => Object.assign(new Error('Not Found'), { status: 404 })

  const rest = {
    repos: {
      getReleaseByTag: jest.fn(async ({ tag }: { tag: string }) => {
        const release = releases.find(r => r.tag_name === tag)
        if (!release) throw notFound()
        return { data: release }
      }),
      createRelease: jest.fn(async ({ tag_name }: { tag_name: string }) => {
        const release = { id: nextId++, tag_name, assets: [] as FakeAsset[] }
        releases.push(release)
        return { data: release }
      }),
      listReleaseAssets: jest.fn(),
      deleteReleaseAsset: jest.fn(async ({ asset_id }: { asset_id: number }) => {
        for (const r of releases) r.assets = r.assets.filter(a => a.id !== asset_id)
        return { data: undefined }
      }),
      uploadReleaseAsset: jest.fn(async ({ release_id, name }: { release_id: number; name: string; data: unknown }) => {
        const release = releases.find(r => r.id === release_id)
        if (!release) throw notFound()
        if (release.assets.some(a => a.name === name)) {
          throw Object.assign(new Error('already_exists'), { status: 422 })
        }
        const asset = {
          id: nextId++,
          name,
          browser_download_url: `https://github.com/${REPO.owner}/${REPO.repo}/releases/download/${release.tag_name}/${name}`
        }
        release.assets.push(asset)
        return { data: asset }
      })
    }
  }

  const octokit = {
    rest,
    paginate: jest.fn(async (method: unknown, params: { release_id: number }) => {
      if (method === rest.repos.listReleaseAssets) {
        return releases.find(r => r.id === params.release_id)?.assets ?? []
      }
      throw new Error('unexpected paginate')
    })
  }
  return { octokit, releases }
}

/** Mocks @actions/github with a fixed context and the given octokit */
export function mockGithub(octokit: unknown, ref = 'refs/heads/main') {
  const github = {
    context: { repo: REPO, sha: SHA, ref },
    getOctokit: jest.fn(() => octokit)
  }
  jest.unstable_mockModule('@actions/github', () => github)
  return github
}
