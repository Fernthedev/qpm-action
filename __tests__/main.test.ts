import { expect, it, jest } from '@jest/globals'
import path from 'node:path'
import type { githubExecAsync } from '../src/utils.js'

const directory = path.resolve('qpm-tool')
const setFailed = jest.fn()
const exec = jest.fn<typeof githubExecAsync>().mockImplementation(async (_command, args) => ({
  exitCode: 0,
  stdout: args?.[0] === 'cache' ? `Config path is: ${directory}` : '',
  stderr: ''
}))
const write = jest.fn<(file: string, qpm: { info: { version: string } }) => Promise<void>>()
const publish = jest.fn<() => Promise<void>>()

jest.unstable_mockModule('@actions/core', () => ({
  setFailed,
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  addPath: jest.fn()
}))
jest.unstable_mockModule('@actions/github', () => ({
  getOctokit: () => ({ rest: { repos: { getLatestRelease: async () => ({ data: { tag_name: 'v1.5.9' } }) } } })
}))
jest.unstable_mockModule('@actions/tool-cache', () => ({ find: () => directory }))
jest.unstable_mockModule('@actions/cache', () => ({ restoreCache: jest.fn(), saveCache: jest.fn() }))
jest.unstable_mockModule('fs', () => ({ existsSync: (file: string) => file === directory }))
jest.unstable_mockModule('../src/utils.js', () => ({
  getActionParameters: () => ({
    token: 'test-token',
    packagePath: 'package',
    version: '1.0.1',
    restore: true,
    cache: false,
    resolveNdk: false,
    publish: 'now'
  }),
  githubExecAsync: exec,
  PublishMode: { now: 'now', late: 'late' }
}))
jest.unstable_mockModule('../src/qpm_file.js', () => ({
  readQPM: async () => ({ info: { version: '1.0.0' } }),
  writeQPM: write
}))
jest.unstable_mockModule('../src/publish.js', () => ({ publishRun: publish }))
const { run } = await import('../src/main.js')

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => {
    resolve = yes
  })
  return { promise, resolve }
}

it('waits for the version write before restore and for immediate publishing before completing', async () => {
  const writeStarted = deferred()
  const writePending = deferred()
  const publishStarted = deferred()
  const publishPending = deferred()
  write.mockImplementation(() => {
    writeStarted.resolve()
    return writePending.promise
  })
  publish.mockImplementation(() => {
    publishStarted.resolve()
    return publishPending.promise
  })
  let completed = false
  const execution = run().then(() => {
    completed = true
  })
  try {
    await writeStarted.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(exec.mock.calls.filter(([, args]) => args?.[0] === 'restore')).toHaveLength(0)
    writePending.resolve()
    await publishStarted.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(completed).toBe(false)
  } finally {
    writePending.resolve()
    publishPending.resolve()
    await execution
  }
  expect(write).toHaveBeenCalledWith(path.join('package', 'qpm.json'), { info: { version: '1.0.1' } })
  expect(exec).toHaveBeenCalledWith(path.join(directory, 'qpm'), ['restore'], { cwd: 'package' })
  expect(setFailed).not.toHaveBeenCalled()
})
