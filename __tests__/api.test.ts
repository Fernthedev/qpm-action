import { describe, it, expect, beforeEach } from '@jest/globals'
import { fakeOctokit, mockCore, mockGithub, SHA } from './helpers/mocks.js'

mockCore()
const fake = fakeOctokit()
mockGithub(fake.octokit)

const { getOrMakeRelease, getQPM_ArtifactExecutableName, getQPM_ReleaseExecutableName } = await import('../src/api.js')

type Octokit = Parameters<typeof getOrMakeRelease>[0]
const octokit = fake.octokit as unknown as Octokit

describe('QPM.CLI asset names', () => {
  it.each([
    ['linux', 'x64', 'qpm2-linux-x64'],
    ['win32', 'x64', 'qpm2-windows-x64'],
    ['win32', 'arm64', 'qpm2-windows-arm64'],
    ['darwin', 'arm64', 'qpm2-macos-arm64']
  ])('%s %s -> %s', (platform, arch, name) => {
    expect(getQPM_ArtifactExecutableName(platform, arch)).toBe(name)
    expect(getQPM_ReleaseExecutableName(platform, arch)).toBe(`${name}.zip`)
  })
})

describe('getOrMakeRelease', () => {
  beforeEach(() => {
    fake.releases.length = 0
  })

  it('reuses an existing release', async () => {
    fake.releases.push({ id: 7, tag_name: 'v1', assets: [] })

    expect(await getOrMakeRelease(octokit, 'v1')).toBe(7)
    expect(fake.octokit.rest.repos.createRelease).not.toHaveBeenCalled()
  })

  it('creates a release on the commit being built', async () => {
    const id = await getOrMakeRelease(octokit, 'v2')

    expect(fake.releases.find(r => r.tag_name === 'v2')?.id).toBe(id)
    expect(fake.octokit.rest.repos.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({ tag_name: 'v2', target_commitish: SHA })
    )
  })

  it('reuses a release created concurrently by another package', async () => {
    fake.octokit.rest.repos.createRelease.mockImplementationOnce(async ({ tag_name }) => {
      fake.releases.push({ id: 42, tag_name, assets: [] })
      throw Object.assign(new Error('already_exists'), { status: 422 })
    })

    expect(await getOrMakeRelease(octokit, 'v3')).toBe(42)
  })

  it('rethrows when the release still cannot be found', async () => {
    fake.octokit.rest.repos.createRelease.mockRejectedValueOnce(new Error('forbidden'))

    await expect(getOrMakeRelease(octokit, 'v4')).rejects.toThrow('forbidden')
  })
})
