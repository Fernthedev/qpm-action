import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fakeOctokit, mockCore, mockExec, mockGithub, ExecCall, REPO } from './helpers/mocks.js'

const core = mockCore()
let onExec: ((call: ExecCall) => void) | undefined
const exec = mockExec(call => onExec?.(call))
const { octokit, releases } = fakeOctokit()
mockGithub(octokit)

const { packageSubdirectory, preparePublish, publishRun, qmodPath, releaseTag } = await import('../src/publish.js')
type Params = import('../src/utils.js').ActionParameters

let repoRoot: string

function params(overrides: Partial<Params> = {}): Params {
  return {
    qpmVersion: undefined,
    packagePath: repoRoot,
    tag: undefined,
    uploadBinaries: false,
    uploadQmod: undefined,
    uploadRelease: true,
    token: 'gh-token',
    publish: undefined,
    version: undefined,
    versionSource: 'qpm2.json',
    resolveNdk: false,
    cache: false,
    restore: false,
    publishToken: 'qpm-token',
    ...overrides
  }
}

function writePackage(dir: string, qpm: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'qpm2.json'),
    JSON.stringify({
      id: 'my-lib',
      version: '1.2.3',
      dependenciesDirectory: 'extern',
      sharedDirectory: 'shared',
      ...qpm
    })
  )
}

function readPackage(dir: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(dir, 'qpm2.json'), 'utf8'))
}

/** qpm2 commands run, ignoring anything else exec'd */
function qpmCalls(): ExecCall[] {
  return exec.calls.filter(c => c.command === 'qpm2')
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qpm-action-'))
  process.env['GITHUB_WORKSPACE'] = repoRoot
  exec.calls.length = 0
  releases.length = 0
  onExec = undefined
})

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true })
})

describe('releaseTag', () => {
  it('defaults to the package version', () => {
    expect(releaseTag({ id: 'a', version: '1.0.0' }, undefined)).toBe('1.0.0')
  })

  it('uses the provided tag, shared by every package', () => {
    expect(releaseTag({ id: 'a', version: '1.0.0' }, 'v5')).toBe('v5')
    expect(releaseTag({ id: 'b', version: '2.0.0' }, 'v5')).toBe('v5')
  })
})

describe('qmodPath', () => {
  it('defaults to the package id', () => {
    expect(qmodPath({ id: 'my-lib', version: '1.0.0' })).toBe('./my-lib.qmod')
  })

  it('prefers the qmod id', () => {
    expect(qmodPath({ id: 'my-lib', version: '1.0.0', qmod: { id: 'MyMod' } })).toBe('./MyMod.qmod')
  })

  it('replaces the extension of qmod.output like Path::with_extension', () => {
    expect(qmodPath({ id: 'x', version: '1.0.0', qmod: { output: 'build/out' } })).toBe('build/out.qmod')
    expect(qmodPath({ id: 'x', version: '1.0.0', qmod: { output: 'build/out.zip' } })).toBe('build/out.qmod')
    expect(qmodPath({ id: 'x', version: '1.0.0', qmod: { output: 'build/out.qmod' } })).toBe('build/out.qmod')
  })
})

describe('packageSubdirectory', () => {
  it('is empty at the repository root', () => {
    expect(packageSubdirectory(repoRoot)).toBe('')
  })

  it('is the posix path of a monorepo package', () => {
    expect(packageSubdirectory(path.join(repoRoot, 'packages', 'my-lib'))).toBe('packages/my-lib')
  })
})

describe('preparePublish', () => {
  it('points additionalData.url at the repository', async () => {
    writePackage(repoRoot, {})
    await preparePublish(params())

    expect(readPackage(repoRoot).additionalData.url).toBe(`https://github.com/${REPO.owner}/${REPO.repo}`)
  })

  it('points additionalData.url at the package directory in a monorepo', async () => {
    const pkg = path.join(repoRoot, 'packages', 'my-lib')
    writePackage(pkg, {})
    await preparePublish(params({ packagePath: pkg }))

    expect(readPackage(pkg).additionalData.url).toBe(
      `https://github.com/${REPO.owner}/${REPO.repo}/tree/HEAD/packages/my-lib`
    )
  })

  it('keeps an existing additionalData.url and other fields', async () => {
    writePackage(repoRoot, { additionalData: { url: 'https://example.com', author: 'me' }, workspace: { ndk: '^27' } })
    await preparePublish(params())

    const qpm = readPackage(repoRoot)
    expect(qpm.additionalData).toEqual({ url: 'https://example.com', author: 'me' })
    expect(qpm.workspace).toEqual({ ndk: '^27' })
  })

  it('does not guess qmod.downloadUrl before the qmod is uploaded', async () => {
    writePackage(repoRoot, {})
    await preparePublish(params({ uploadQmod: true }))

    expect(readPackage(repoRoot).qmod).toBeUndefined()
  })
})

describe('publishRun', () => {
  const qpkgUrl = (tag: string, name: string): string =>
    `https://github.com/${REPO.owner}/${REPO.repo}/releases/download/${tag}/${name}`

  /** Emulates qpm2 creating the qmod and qpkg files. Records qpm2.json as seen by `qpm2 qpkg` */
  let qpkgConfig: Record<string, any> | undefined
  function emulateQpm(): void {
    qpkgConfig = undefined
    onExec = call => {
      if (call.command !== 'qpm2') return
      if (call.args[0] === 'qpkg') {
        qpkgConfig = readPackage(call.cwd!)
        fs.writeFileSync(path.join(call.cwd!, call.args[1]), 'qpkg')
      }
      if (call.args[0] === 'qmod' && call.args[1] === 'zip') {
        const qpm = readPackage(call.cwd!)
        fs.writeFileSync(path.join(call.cwd!, `${qpm.qmod?.output ?? qpm.id}.qmod`), 'qmod')
      }
    }
  }

  beforeEach(emulateQpm)

  it('builds the qpkg, uploads it as a release asset and publishes its url', async () => {
    writePackage(repoRoot, {})

    await publishRun(params())

    expect(qpmCalls()).toEqual([
      { command: 'qpm2', args: ['qpkg', 'my-lib.qpkg'], cwd: repoRoot },
      {
        command: 'qpm2',
        args: ['publish', qpkgUrl('1.2.3', 'my-lib.qpkg'), '--backend', 'qpackages', '--token', 'qpm-token'],
        cwd: repoRoot
      }
    ])
    expect(releases).toHaveLength(1)
    expect(releases[0].tag_name).toBe('1.2.3')
    expect(releases[0].assets.map(a => a.name)).toEqual(['my-lib.qpkg'])
    expect(core.setSecret).toHaveBeenCalledWith('qpm-token')
  })

  it('publishes the url returned by the upload', async () => {
    writePackage(repoRoot, {})
    octokit.rest.repos.uploadReleaseAsset.mockImplementationOnce(async () => ({
      data: { id: 1, name: 'my-lib.qpkg', browser_download_url: 'https://cdn.example.com/my-lib.qpkg' }
    }))

    await publishRun(params())

    expect(qpmCalls()[1].args[1]).toBe('https://cdn.example.com/my-lib.qpkg')
  })

  it('zips and uploads the qmod before building the qpkg, with qmod.downloadUrl from the upload', async () => {
    writePackage(repoRoot, { qmod: { output: 'MyMod' } })
    octokit.rest.repos.uploadReleaseAsset.mockImplementationOnce(async () => ({
      data: { id: 1, name: 'MyMod.qmod', browser_download_url: 'https://cdn.example.com/MyMod.qmod' }
    }))

    await publishRun(params({ uploadQmod: true }))

    expect(qpmCalls().map(c => c.args.slice(0, 2))).toEqual([
      ['qmod', 'zip'],
      ['qpkg', 'my-lib.qpkg'],
      ['publish', qpkgUrl('1.2.3', 'my-lib.qpkg')]
    ])
    expect(qpkgConfig?.qmod.downloadUrl).toBe('https://cdn.example.com/MyMod.qmod')
    expect(readPackage(repoRoot).qmod.downloadUrl).toBe('https://cdn.example.com/MyMod.qmod')
  })

  it('uploads binaries as release assets', async () => {
    writePackage(repoRoot, { workspace: { outBinaries: ['build/libmy-lib.so'] } })
    fs.mkdirSync(path.join(repoRoot, 'build'))
    fs.writeFileSync(path.join(repoRoot, 'build', 'libmy-lib.so'), 'so')

    await publishRun(params({ uploadBinaries: true }))

    expect(releases[0].assets.map(a => a.name).sort()).toEqual(['libmy-lib.so', 'my-lib.qpkg'])
    const upload = octokit.rest.repos.uploadReleaseAsset.mock.calls.find(([c]) => c.name === 'libmy-lib.so')![0]
    expect(Buffer.from(upload.data as Buffer).toString()).toBe('so')
  })

  it('warns instead of failing when a binary or qmod is missing', async () => {
    writePackage(repoRoot, { workspace: { outBinaries: ['build/missing.so'] } })
    onExec = call => {
      if (call.command === 'qpm2' && call.args[0] === 'qpkg') fs.writeFileSync(path.join(call.cwd!, call.args[1]), '')
    }

    await publishRun(params({ uploadBinaries: true, uploadQmod: true }))

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('missing.so'))
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('my-lib.qmod'))
    expect(releases[0].assets.map(a => a.name)).toEqual(['my-lib.qpkg'])
  })

  it('replaces release assets from a previous run', async () => {
    writePackage(repoRoot, {})
    releases.push({ id: 1, tag_name: '1.2.3', assets: [{ id: 2, name: 'my-lib.qpkg', browser_download_url: 'old' }] })

    await publishRun(params())

    expect(octokit.rest.repos.deleteReleaseAsset).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 2 }))
    expect(releases[0].assets).toHaveLength(1)
    expect(releases[0].assets[0].id).not.toBe(2)
  })

  it('runs every command in a monorepo package directory and shares the release with other packages', async () => {
    const libA = path.join(repoRoot, 'packages', 'lib-a')
    const libB = path.join(repoRoot, 'packages', 'lib-b')
    writePackage(libA, { id: 'lib-a' })
    writePackage(libB, { id: 'lib-b' })

    await publishRun(params({ packagePath: libA, tag: 'v1' }))
    await publishRun(params({ packagePath: libB, tag: 'v1' }))

    expect(qpmCalls().map(c => c.cwd)).toEqual([libA, libA, libB, libB])
    expect(releases).toHaveLength(1)
    expect(releases[0].assets.map(a => a.name)).toEqual(['lib-a.qpkg', 'lib-b.qpkg'])
  })

  it('only builds and skips publishing when release upload is disabled', async () => {
    writePackage(repoRoot, {})

    await publishRun(params({ uploadRelease: false, uploadQmod: true }))

    expect(qpmCalls().map(c => c.args.slice(0, 2))).toEqual([
      ['qmod', 'zip'],
      ['qpkg', 'my-lib.qpkg']
    ])
    expect(releases).toHaveLength(0)
    expect(octokit.rest.repos.createRelease).not.toHaveBeenCalled()
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('upload_release'))
  })

  it('resolves the NDK while building only when the package requires one', async () => {
    writePackage(repoRoot, { workspace: { ndk: '^27.0.0' } })
    await publishRun(params({ resolveNdk: true }))
    expect(qpmCalls()[0].args).toContain('--resolve-ndk')

    exec.calls.length = 0
    releases.length = 0
    writePackage(repoRoot, {})
    await publishRun(params({ resolveNdk: true }))
    expect(qpmCalls()[0].args).not.toContain('--resolve-ndk')
  })

  it('omits --token without a publish token', async () => {
    writePackage(repoRoot, {})

    await publishRun(params({ publishToken: undefined }))

    expect(qpmCalls()[1].args).not.toContain('--token')
  })

  it('zips the qmod when the package has a mod template', async () => {
    writePackage(repoRoot, {})
    fs.writeFileSync(path.join(repoRoot, 'mod.template.json'), '{}')

    const result = await publishRun(params())

    expect(qpmCalls().map(c => c.args.slice(0, 2))).toEqual([
      ['qmod', 'zip'],
      ['qpkg', 'my-lib.qpkg'],
      ['publish', qpkgUrl('1.2.3', 'my-lib.qpkg')]
    ])
    expect(result.qmodUrl).toBe(qpkgUrl('1.2.3', 'my-lib.qmod'))
    expect(result.qpkgUrl).toBe(qpkgUrl('1.2.3', 'my-lib.qpkg'))
  })

  it('uses qmod.template for detection', async () => {
    writePackage(repoRoot, { qmod: { template: 'templates/mod.json' } })
    fs.mkdirSync(path.join(repoRoot, 'templates'))
    fs.writeFileSync(path.join(repoRoot, 'templates', 'mod.json'), '{}')

    await publishRun(params())

    expect(qpmCalls()[0].args).toEqual(['qmod', 'zip'])
  })

  it('skips the qmod for libraries without a mod template', async () => {
    writePackage(repoRoot, {})

    const result = await publishRun(params())

    expect(qpmCalls().map(c => c.args[0])).toEqual(['qpkg', 'publish'])
    expect(result.qmodUrl).toBeUndefined()
  })

  it('lets upload_qmod override the detection', async () => {
    writePackage(repoRoot, {})
    fs.writeFileSync(path.join(repoRoot, 'mod.template.json'), '{}')

    await publishRun(params({ uploadQmod: false }))
    expect(qpmCalls().map(c => c.args[0])).toEqual(['qpkg', 'publish'])

    exec.calls.length = 0
    releases.length = 0
    fs.rmSync(path.join(repoRoot, 'mod.template.json'))

    await publishRun(params({ uploadQmod: true }))
    expect(qpmCalls()[0].args).toEqual(['qmod', 'zip'])
  })
})
