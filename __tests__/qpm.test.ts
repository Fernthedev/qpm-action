import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import semver from 'semver'
import { mockCore, mockExec } from './helpers/mocks.js'

const core = mockCore()
mockExec()

const toolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qpm-tool-'))
const tc = {
  find: jest.fn<(tool: string, version: string) => string>(() => ''),
  downloadTool: jest.fn<(url: string, dest?: string, auth?: string) => Promise<string>>(async () =>
    path.join(toolDir, 'download.zip')
  ),
  extractZip: jest.fn<(file: string) => Promise<string>>(async () => toolDir),
  cacheDir: jest.fn<(dir: string, tool: string, version: string) => Promise<string>>(async dir => dir)
}
jest.unstable_mockModule('@actions/tool-cache', () => tc)

const {
  parseQpmVersion,
  bleedingCacheVersion,
  downloadQpmBleeding,
  downloadQpmVersion,
  parseReleaseTag,
  selectQpmRelease,
  selectWorkflowRun
} = await import('../src/qpm.js')
const { getQPM_ArtifactExecutableName, getQPM_ReleaseExecutableName } = await import('../src/api.js')

type Octokit = Parameters<typeof downloadQpmVersion>[0]

function release(id: number, tag_name: string, extra: { draft?: boolean } = {}) {
  return {
    id,
    tag_name,
    ...extra,
    assets: [{ name: getQPM_ReleaseExecutableName(), browser_download_url: `https://example.com/${tag_name}.zip` }]
  }
}

const v1 = release(1, 'v1.5.12')
const bleeding = release(2, 'bleeding2')
const bleedingV1 = release(3, 'bleeding')

function releasesOctokit(releases: ReturnType<typeof release>[]): Octokit {
  return { rest: { repos: { listReleases: jest.fn() } }, paginate: jest.fn(async () => releases) } as unknown as Octokit
}

beforeEach(() => {
  tc.find.mockImplementation(() => '')
})

describe('selectQpmRelease', () => {
  const range = new semver.Range('^2.0.0')

  it('ignores non-version tags such as bleeding2', () => {
    expect(parseReleaseTag('bleeding2')).toBeNull()
    expect(selectQpmRelease([v1, bleeding, bleedingV1], range)).toBeUndefined()
  })

  it('picks the highest satisfying release', () => {
    const releases = [release(4, 'v2.0.0'), release(5, 'v2.10.0'), release(6, 'v2.9.1'), release(7, 'v3.0.0')]
    expect(selectQpmRelease(releases, range)?.tag_name).toBe('v2.10.0')
  })

  it('skips drafts', () => {
    expect(selectQpmRelease([release(4, 'v2.0.0'), release(5, 'v2.1.0', { draft: true })], range)?.tag_name).toBe(
      'v2.0.0'
    )
  })
})

describe('selectWorkflowRun', () => {
  const runs = [
    { id: 3, head_branch: 'feature', head_sha: 'ccc333' },
    { id: 2, head_branch: 'main', head_sha: 'bbb222' },
    { id: 1, head_branch: 'main', head_sha: 'aaa111' }
  ]

  it('defaults to the newest main run', () => {
    expect(selectWorkflowRun(runs, undefined)?.id).toBe(2)
  })

  it('matches a branch or sha prefix', () => {
    expect(selectWorkflowRun(runs, 'feature')?.id).toBe(3)
    expect(selectWorkflowRun(runs, 'aaa')?.id).toBe(1)
    expect(selectWorkflowRun(runs, 'nope')).toBeUndefined()
  })
})

describe('bleedingCacheVersion', () => {
  it('is an explicit semver version so tool-cache can find it', () => {
    expect(semver.valid(bleedingCacheVersion(123))).not.toBeNull()
    expect(semver.valid(bleedingCacheVersion('0123abc'))).not.toBeNull()
  })
})

describe('parseQpmVersion', () => {
  const range = (input: string | undefined) => {
    const spec = parseQpmVersion(input)
    return spec.kind === 'release' ? spec.range.raw : spec
  }

  it('defaults to the newest 2.x release', () => {
    expect(range(undefined)).toBe('^2.0.0')
    expect(range('  ')).toBe('^2.0.0')
  })

  it('treats semver ranges and versions as releases', () => {
    expect(range('^2.1.0')).toBe('^2.1.0')
    expect(range('2.1.0')).toBe('2.1.0')
    expect(range('>=2 <3')).toBe('>=2 <3')
  })

  it('maps bleeding to the bleeding pre-release', () => {
    expect(parseQpmVersion('bleeding')).toEqual({ kind: 'bleeding' })
    expect(parseQpmVersion('bleeding2')).toEqual({ kind: 'bleeding' })
  })

  it('treats anything else as a branch or commit', () => {
    expect(parseQpmVersion('main')).toEqual({ kind: 'ref', ref: 'main' })
    expect(parseQpmVersion('abc123f')).toEqual({ kind: 'ref', ref: 'abc123f' })
  })

  it('still accepts the old prefixes', () => {
    expect(range('version@^2.0.0')).toBe('^2.0.0')
    expect(range('version@')).toBe('^2.0.0')
    expect(parseQpmVersion('ref@main')).toEqual({ kind: 'ref', ref: 'main' })
    expect(parseQpmVersion('ref@')).toEqual({ kind: 'ref', ref: undefined })
  })
})

describe('downloadQpmVersion', () => {
  it('downloads bleeding2 directly when asked, without warning', async () => {
    await downloadQpmVersion(releasesOctokit([release(9, 'v2.0.1'), bleeding]), 'token', 'bleeding')

    expect(tc.downloadTool).toHaveBeenCalledWith('https://example.com/bleeding2.zip', undefined, 'Bearer token')
    expect(core.warning).not.toHaveBeenCalled()
  })

  it('falls back to bleeding2 until a 2.x release exists', async () => {
    const exe = await downloadQpmVersion(releasesOctokit([v1, bleedingV1, bleeding]), 'token')

    expect(tc.downloadTool).toHaveBeenCalledWith('https://example.com/bleeding2.zip', undefined, 'Bearer token')
    expect(tc.cacheDir).toHaveBeenCalledWith(toolDir, 'qpm2', bleedingCacheVersion(bleeding.id))
    expect(exe).toBe(path.join(toolDir, process.platform === 'win32' ? 'qpm2.exe' : 'qpm2'))
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('bleeding2'))
  })

  it('uses a satisfying release over bleeding2', async () => {
    await downloadQpmVersion(releasesOctokit([v1, bleeding, release(9, 'v2.0.1')]), 'token')

    expect(tc.downloadTool).toHaveBeenCalledWith('https://example.com/v2.0.1.zip', undefined, 'Bearer token')
    expect(tc.cacheDir).toHaveBeenCalledWith(toolDir, 'qpm2', '2.0.1')
  })

  it('never picks qpm1 releases by default', async () => {
    await downloadQpmVersion(releasesOctokit([v1, bleeding]), 'token')

    expect(tc.downloadTool).not.toHaveBeenCalledWith(expect.stringContaining('v1.5.12'), undefined, expect.anything())
  })

  it('reuses the tool cache', async () => {
    tc.find.mockImplementation((tool, version) => (tool === 'qpm2' && version === '2.0.1' ? toolDir : ''))

    const exe = await downloadQpmVersion(releasesOctokit([release(9, 'v2.0.1')]), 'token')

    expect(exe).toBe(path.join(toolDir, 'qpm2'))
    expect(tc.downloadTool).not.toHaveBeenCalled()
  })

  it('fails without a satisfying release or bleeding2', async () => {
    expect(await downloadQpmVersion(releasesOctokit([v1]), 'token')).toBeUndefined()
    expect(core.error).toHaveBeenCalled()
  })
})

describe('downloadQpmBleeding', () => {
  function artifactsOctokit(): Octokit {
    return {
      rest: {
        actions: {
          listWorkflowRuns: jest.fn(async () => ({
            data: { workflow_runs: [{ id: 11, head_branch: 'main', head_sha: 'deadbeef' }] }
          })),
          listWorkflowRunArtifacts: jest.fn(async () => ({
            data: {
              artifacts: [
                { name: 'installer-windows-x64', archive_download_url: 'https://example.com/installer.zip' },
                { name: getQPM_ArtifactExecutableName(), archive_download_url: 'https://example.com/artifact.zip' }
              ]
            }
          }))
        }
      }
    } as unknown as Octokit
  }

  it('downloads the platform artifact of the newest Cargo Build run on main', async () => {
    const octokit = artifactsOctokit()
    await downloadQpmBleeding(octokit, 'token', undefined)

    expect(octokit.rest.actions.listWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({ workflow_id: 'cargo-build.yml', branch: 'main', status: 'success' })
    )
    expect(tc.downloadTool).toHaveBeenCalledWith('https://example.com/artifact.zip', undefined, 'Bearer token')
    expect(tc.cacheDir).toHaveBeenCalledWith(toolDir, 'qpm2', bleedingCacheVersion('deadbeef'))
  })

  it('does not filter by branch for a sha ref', async () => {
    const octokit = artifactsOctokit()
    await downloadQpmBleeding(octokit, 'token', 'deadbe')

    expect(octokit.rest.actions.listWorkflowRuns).toHaveBeenCalledWith(expect.objectContaining({ branch: undefined }))
    expect(tc.downloadTool).toHaveBeenCalled()
  })
})
