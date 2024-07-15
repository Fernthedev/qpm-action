import * as node_os from 'os'

// Helper function to get the expected QPM artifact name
export function getQPM_ArtifactExecutableName() {
  let os: string = node_os.platform()

  if (os === 'win32') os = 'windows'
  if (os === 'darwin') os = 'macos'

  return `${os}-qpm`
}
// Helper function to get the expected QPM artifact name
export function getQPM_ReleaseExecutableName() {
  let os: string = node_os.platform()
  const arch = node_os.arch()

  if (os === 'win32') os = 'windows'
  if (os === 'darwin') os = 'macos'

  return `qpm-${os}-${arch}.zip`
}
