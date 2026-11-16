import { afterEach, describe, expect, it } from '@jest/globals'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { create } from '@actions/glob'

let cacheDir: string | undefined

afterEach(() => {
  if (cacheDir) fs.rmSync(cacheDir, { recursive: true, force: true })
})

describe('cache path discovery', () => {
  it('traverses partial glob matches and excludes unrelated files', async () => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qpm-cache-glob-'))
    const packageDir = path.join(cacheDir, 'fmt', '12.2.1')
    fs.mkdirSync(packageDir, { recursive: true })
    const manifest = path.join(packageDir, 'qpm2.json')
    fs.writeFileSync(manifest, '{}')
    fs.writeFileSync(path.join(packageDir, 'ignored.txt'), '')
    fs.mkdirSync(path.join(cacheDir, 'excluded'))
    fs.writeFileSync(path.join(cacheDir, 'excluded', 'qpm2.json'), '{}')

    const patterns = [path.join(cacheDir, '**', '*.json'), `!${path.join(cacheDir, 'excluded', '**')}`]
    const globber = await create(patterns.join('\n'), { implicitDescendants: false })

    expect(await globber.glob()).toEqual([manifest])
  })

  it('discovers a populated cache directory using the real glob dependency', async () => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qpm-cache-glob-'))
    const packageDir = path.join(cacheDir, 'fmt', '12.2.1')
    fs.mkdirSync(packageDir, { recursive: true })
    const manifest = path.join(packageDir, 'qpm2.json')
    fs.writeFileSync(manifest, '{}')

    const globber = await create(cacheDir, { implicitDescendants: false })
    const files = await globber.glob()

    expect(files.map(file => path.resolve(file))).toEqual([cacheDir])
  })
})
