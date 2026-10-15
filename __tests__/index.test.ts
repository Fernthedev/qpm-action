import { expect, it, jest } from '@jest/globals'

const run = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
jest.unstable_mockModule('../src/main.js', () => ({ run }))

it('calls run when the entrypoint is imported', async () => {
  await import('../src/index.js')
  expect(run).toHaveBeenCalledTimes(1)
})
