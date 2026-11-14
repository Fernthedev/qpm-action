import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { mockCore, mockExec } from './helpers/mocks.js'

mockCore()
const exec = mockExec()
const cache = {
  restoreCache: jest.fn<(paths: string[], key: string, restoreKeys?: string[]) => Promise<string | undefined>>(
    async () => undefined
  ),
  saveCache: jest.fn<(paths: string[], key: string) => Promise<number>>(async () => 1)
}
jest.unstable_mockModule('@actions/cache', () => cache)

const { resolveNDK } = await import('../src/main.js')

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qpm-ndk-'))
  exec.calls.length = 0
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function writePackage(workspace: Record<string, unknown>): string {
  const file = path.join(dir, 'qpm2.json')
  fs.writeFileSync(file, JSON.stringify({ id: 'x', version: '1.0.0', workspace }))
  return file
}

describe('resolveNDK', () => {
  it('skips packages without an NDK requirement', async () => {
    await resolveNDK('qpm2', writePackage({}), '/ndk', true, dir)

    expect(exec.calls).toEqual([])
    expect(cache.restoreCache).not.toHaveBeenCalled()
  })

  it('downloads the NDK in the package directory and caches it', async () => {
    await resolveNDK('qpm2', writePackage({ ndk: '^27.2.0' }), '/ndk', true, dir)

    expect(exec.calls).toEqual([{ command: 'qpm2', args: ['ndk', 'resolve', '-d'], cwd: dir }])
    expect(cache.restoreCache).toHaveBeenCalledWith(['/ndk'], 'qpm-ndk-^27.2.0', ['qpm-ndk-'])
    expect(cache.saveCache).toHaveBeenCalledWith(['/ndk'], 'qpm-ndk-^27.2.0')
  })

  it('does not save the cache on a hit', async () => {
    cache.restoreCache.mockResolvedValueOnce('qpm-ndk-^27.2.0')
    await resolveNDK('qpm2', writePackage({ ndk: '^27.2.0' }), '/ndk', true, dir)

    expect(cache.saveCache).not.toHaveBeenCalled()
  })

  it('makes NDK ranges valid cache keys', async () => {
    await resolveNDK('qpm2', writePackage({ ndk: '>=27, <28' }), '/ndk', true, dir)

    expect(cache.saveCache).toHaveBeenCalledWith(['/ndk'], 'qpm-ndk->=27_ <28')
  })
})
