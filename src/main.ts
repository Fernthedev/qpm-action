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
import { GitHub } from '@actions/github/lib/utils'
import { QPMSharedPackage, readQPM, writeQPM } from './qpmf'

function stringOrUndefined(str: string): string | undefined {
  return str === "" ? undefined : str
}

// why
// eslint-disable-next-line no-shadow
enum UploadMode {
  Release = "release",
  Artifact = "artifact",
  None = "none"
}

async function downloadQpm(octokit: InstanceType<typeof GitHub>): Promise<void> {
  const artifacts = await octokit.rest.actions.listArtifactsForRepo({
    owner: QPM_REPOSITORY_OWNER,
    repo: QPM_REPOSITORY_NAME,
  })

  const expectedArtifactName = getQPM_RustExecutableName()
  core.debug(`Looking for ${expectedArtifactName} in ${QPM_REPOSITORY_OWNER}/${QPM_REPOSITORY_NAME}`)
  const artifactToDownload = artifacts.data.artifacts.find(e => e.name === expectedArtifactName)

  if (artifactToDownload === undefined) throw new Error(`Unable to find artifact ${expectedArtifactName}`)

  core.debug(`Downloading from ${artifactToDownload.archive_download_url}`)
  const artifactZipData = await octokit.rest.actions.downloadArtifact({
    owner: QPM_REPOSITORY_OWNER,
    repo: QPM_REPOSITORY_NAME,
    artifact_id: artifactToDownload.id,
    archive_format: "zip"
  })

  const artifactZip = new zip.ZipReader(new zip.Uint8ArrayReader(artifactZipData.data as never))

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const extractDirectory = path.join(process.env.GITHUB_WORKSPACE!, "QPM")
  await io.mkdirP(extractDirectory)

  
  core.debug("Unzipping")

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
}

async function doPublish(octokit: InstanceType<typeof GitHub>, version?: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const qpmSharedPath = path.join(process.env.GITHUB_WORKSPACE!, "qpm.shared.json")
  const qpmFile = await readQPM(qpmSharedPath) as QPMSharedPackage

  if (version) {
    qpmFile.config.info.version = version
  }
  version ??= qpmFile.config.info.version

  const branch = `version-${version}`
  qpmFile.config.info.additionalData.branchName = branch

  // TODO: Debug SO link
  // TODO: Release SO link
  await writeQPM(qpmSharedPath, qpmFile)

  const git = octokit.rest.git
  
  // create commit
  const blob = await git.createBlob({
    ...github.context.repo,
    content: JSON.stringify(qpmFile)
  })
  const commit = await git.createCommit({
    ...github.context.repo,
    parents: [github.context.ref],
    message: "Update version and post restore",
    tree: blob.data.sha // ?
  })

  git.updateRef({
    ...github.context.repo,
    ref: github.context.ref,
    sha: commit.data.sha
  })

  // create tag
  await git.createTag({
    ...github.context.repo,
    tag: version,
    message: "Version",
    object: commit.data.sha,
    type: "commit"
  })


  // create branch
  // reference https://github.com/peterjgrainger/action-create-branch/blob/c2800a3a9edbba2218da6861fa46496cf8f3195a/src/create-branch.ts#L3
  const ref = `refs/heads/${branch}`

  try {
    await git.deleteRef({
      ...github.context.repo,
      ref,
    })
  } catch (e) {
    core.warning(`Deleting existing branch failed due to ${e}`)
  }

  await git.createRef({
    ...github.context.repo,
    ref,
    sha: commit.data.sha
  })

  // do github stuff
}



async function run(): Promise<void> {
  try {
    const publish: boolean = core.getBooleanInput("publish") ?? false
    const version: string | undefined = stringOrUndefined(core.getInput("version"))
    const uploadMode = stringOrUndefined(core.getInput("upload_mode")) ?? UploadMode.None as UploadMode

    // This should be a token with access to your repository scoped in as a secret.
    // The YML workflow will need to set myToken with the GitHub Secret Token
    // myToken: ${{ secrets.GITHUB_TOKEN }}
    // https://help.github.com/en/actions/automating-your-workflow-with-github-actions/authenticating-with-the-github_token#about-the-github_token-secret
    const myToken = core.getInput('workflow_token')
    const octokit = github.getOctokit(myToken)
    await downloadQpm(octokit)

    // const ms: string = core.getInput('milliseconds')
    // core.debug(`Waiting ${ms} milliseconds ...`) // debug is only output if you set the secret `ACTIONS_STEP_DEBUG` to true
    // core.debug(new Date().toTimeString())
    // core.debug(new Date().toTimeString())
    // core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    core.isDebug
  }
}

run()
