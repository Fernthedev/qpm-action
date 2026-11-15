import { describe, it, expect } from '@jest/globals'
import { mockCore, mockGithub } from './helpers/mocks.js'

const inputs: Record<string, string> = {}
mockCore(inputs)
const github = mockGithub({})

const { getActionParameters, gitTagVersion, PublishMode } = await import('../src/utils.js')

/** Inputs with the action.yml defaults */
function setInputs(overrides: Record<string, string> = {}): void {
  for (const key of Object.keys(inputs)) delete inputs[key]
  Object.assign(
    inputs,
    {
      qpm_version: '^2.0.0',
      package_path: '.',
      restore: 'true',
      cache: 'true',
      resolve_ndk: 'true',
      upload_release: 'true',
      upload_qmod: '',
      upload_binaries: 'true',
      workflow_token: 'gh-token'
    },
    overrides
  )
}

describe('gitTagVersion', () => {
  it('reads the version from a tag ref', () => {
    expect(gitTagVersion('refs/tags/v1.2.3')).toEqual({ tag: 'v1.2.3', version: '1.2.3' })
    expect(gitTagVersion('refs/tags/1.2.3')).toEqual({ tag: '1.2.3', version: '1.2.3' })
  })

  it('keeps the tag but gives no version for non-version tags', () => {
    expect(gitTagVersion('refs/tags/latest')).toEqual({ tag: 'latest', version: undefined })
  })

  it('is empty for branches', () => {
    expect(gitTagVersion('refs/heads/main')).toEqual({})
    expect(gitTagVersion(undefined)).toEqual({})
  })
})

describe('getActionParameters', () => {
  it('uses the defaults', () => {
    setInputs()
    github.context.ref = 'refs/heads/main'

    expect(getActionParameters()).toEqual({
      qpmVersion: '^2.0.0',
      packagePath: '.',
      tag: undefined,
      version: undefined,
      versionSource: 'qpm2.json',
      publish: undefined,
      publishToken: undefined,
      uploadRelease: true,
      uploadQmod: undefined,
      uploadBinaries: true,
      resolveNdk: true,
      cache: true,
      restore: true,
      token: 'gh-token'
    })
  })

  it('defaults version and tag to the git tag', () => {
    setInputs()
    github.context.ref = 'refs/tags/v1.2.3'

    const params = getActionParameters()
    expect(params).toMatchObject({ version: '1.2.3', tag: 'v1.2.3', versionSource: 'git tag' })
  })

  it('lets inputs override the git tag', () => {
    setInputs({ version: '2.0.0', tag: 'release-2' })
    github.context.ref = 'refs/tags/v1.2.3'

    expect(getActionParameters()).toMatchObject({ version: '2.0.0', tag: 'release-2', versionSource: 'input' })
  })

  it('parses publish and upload_qmod', () => {
    setInputs({ publish: 'late', upload_qmod: 'false' })
    expect(getActionParameters()).toMatchObject({ publish: PublishMode.late, uploadQmod: false })

    setInputs({ publish: 'now', upload_qmod: 'true' })
    expect(getActionParameters()).toMatchObject({ publish: PublishMode.now, uploadQmod: true })
  })

  it('rejects unknown publish values', () => {
    setInputs({ publish: 'true' })
    expect(() => getActionParameters()).toThrow('Invalid publish value "true"')
  })
})
