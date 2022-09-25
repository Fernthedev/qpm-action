import * as node_os from 'os'

export function getQPM_RustExecutableName() {
  let os: string = node_os.platform()

  if (os === 'win32') os = 'windows'
  if (os === 'darwin') os = 'macos'

  return `${os}-qpm-rust`
}
