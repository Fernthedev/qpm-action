import * as fs from 'fs'

export interface QPMSharedPackage {
  config: QPMPackage
}

export interface QPMPackage {
  info: {
    name: string
    id: string
    version: string
    additionalData: {
      branchName?: string
      headersOnly?: boolean
      overrideSoName?: string
      overrideDebugSoName?: string
    }
  }
}

export async function readQPM(
  file: fs.PathOrFileDescriptor
): Promise<QPMPackage | QPMSharedPackage> {
  const fileData: string = await new Promise((resolve, reject) => {
    fs.readFile(file, undefined, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data.toString())
      }
    })
  })

  return JSON.parse(fileData)
}

export async function writeQPM(
  file: fs.PathOrFileDescriptor,
  qpm: QPMPackage | QPMSharedPackage
): Promise<void> {
  return new Promise((resolve, reject) => {
    const qpmStr = JSON.stringify(qpm)
    fs.writeFile(file, qpmStr, err => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}
