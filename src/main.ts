import * as core from '@actions/core'
import * as github from "@actions/github"
import * as artifact from "@actions/artifact"
import * as io from "@actions/io"
import * as fs from "fs"
import * as path from "path"
import * as process from "process"
import * as zip from "@zip.js/zip.js"
import { getQPM_RustExecutableName } from './api'
import { QPM_REPOSITORY_NAME, QPM_REPOSITORY_OWNER } from './const'
import axios from 'axios'

// why
// eslint-disable-next-line no-shadow
enum UploadMode {
  Release = "release",
  Artifact = "artifact",
  None = "none"
}

async function run(): Promise<void> {
  try {
    const publish: boolean = core.getBooleanInput("publish") ?? false
    const version: string = core.getInput("version")
    const uploadMode = core.getInput("upload_mode") ?? UploadMode.None as UploadMode

    // This should be a token with access to your repository scoped in as a secret.
    // The YML workflow will need to set myToken with the GitHub Secret Token
    // myToken: ${{ secrets.GITHUB_TOKEN }}
    // https://help.github.com/en/actions/automating-your-workflow-with-github-actions/authenticating-with-the-github_token#about-the-github_token-secret
    const myToken = core.getInput('workflow_token')
    const octokit = github.getOctokit(myToken)

    const artifacts = await octokit.rest.actions.listArtifactsForRepo({
      owner: QPM_REPOSITORY_OWNER,
      repo: QPM_REPOSITORY_NAME,
    })

    const expectedArtifactName = getQPM_RustExecutableName()
    core.debug(`Looking for ${expectedArtifactName} in ${QPM_REPOSITORY_OWNER}/${QPM_REPOSITORY_NAME}`)
    const artifactToDownload = artifacts.data.artifacts.find(e => e.name === expectedArtifactName)

    if (artifactToDownload === undefined) throw new Error(`Unable to find artifact ${expectedArtifactName}`)

 
    const artifactZipData = await axios.get(artifactToDownload.archive_download_url)
    const artifactZip = new zip.ZipReader(new zip.Uint8ArrayReader(artifactZipData.data))

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const extractDirectory = path.join(process.env.GITHUB_WORKSPACE!, "QPM")
    await io.mkdirP(extractDirectory)

    // get all entries from the zip
    for (const entry of await artifactZip.getEntries()) {
      const text = await entry.getData?.(
        // writer
        new zip.Uint8ArrayWriter(),
      )
      // text contains the entry data as a String
      const fileStream = fs.createWriteStream(path.join(extractDirectory, entry.filename))
      fileStream.write(text)
      fileStream.end()
    }

    // close the ZipReader
    await artifactZip.close()

    // Add "$GITHUB_WORKSPACE/QPM/" to path
    core.addPath(extractDirectory)
    core.debug(`Added ${extractDirectory} to path`)
    
    

    // const ms: string = core.getInput('milliseconds')
    // core.debug(`Waiting ${ms} milliseconds ...`) // debug is only output if you set the secret `ACTIONS_STEP_DEBUG` to true
    // core.debug(new Date().toTimeString())
    // core.debug(new Date().toTimeString())
    // core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
