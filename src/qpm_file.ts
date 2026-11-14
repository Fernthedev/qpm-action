import * as fs from 'fs/promises'
import * as fsOld from 'fs'

/** qpm2.shared.json */
export interface QPMSharedPackage {
  config: QPMPackage
  restoredDependencies?: Record<string, unknown>
  env?: Record<string, string>
}

/** qpm2.json. Only the fields the action reads or writes are typed, the rest are preserved as-is */
export interface QPMPackage {
  id: string
  version: string
  dependenciesDirectory?: string
  sharedDirectory?: string
  additionalData?: {
    description?: string
    author?: string
    license?: string
    url?: string
    [key: string]: unknown
  }
  workspace?: {
    /** NDK version requirement */
    ndk?: string
    outBinaries?: string[]
    [key: string]: unknown
  }
  qmod?: {
    output?: string
    id?: string
    downloadUrl?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export const QPM_JSON = 'qpm2.json'
export const QPM_SHARED_JSON = 'qpm2.shared.json'

export async function readQPM<T extends QPMPackage | QPMSharedPackage>(file: fsOld.PathLike): Promise<T> {
  return JSON.parse((await fs.readFile(file, undefined)).toString())
}

export async function writeQPM(file: fsOld.PathLike, qpm: QPMPackage | QPMSharedPackage): Promise<void> {
  const qpmStr = JSON.stringify(qpm, null, 2)
  await fs.writeFile(file, qpmStr)
}
