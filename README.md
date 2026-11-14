<p align="center">
  <a href="https://github.com/actions/typescript-action/actions"><img alt="typescript-action status" src="https://github.com/Fernthedev/qpm-action/workflows/build-test/badge.svg"></a>
</p>

## QPM Github Action

Sets up [QPM2](https://github.com/QuestPackageManager/QPM.CLI) in Github Actions. It can restore, cache and publish your
package.

## Usage

```yaml
permissions:
  contents: write # needed to upload release assets

steps:
  - uses: actions/checkout@v4

  - name: QPM Action
    uses: Fernthedev/qpm-action@v2
    with:
      # required
      workflow_token: ${{secrets.GITHUB_TOKEN}}

      # QPM version. Uses the newest release in the range.
      # If no release matches yet, it uses the bleeding2 pre-release.
      # Use ref@main for a build from a branch or commit.
      qpm_version: 'version@^2.0.0'

      package_path: '.' # Folder with qpm2.json. Can be a subfolder (monorepo).
      restore: true # Run qpm2 restore
      cache: true # Cache dependencies and the NDK
      resolve_ndk: true # Download the NDK from qpm2.json. Does nothing if none is set.

      publish: 'late' # 'late' publishes at the end of the job. 'now' publishes in this step.
      publish_token: ${{secrets.QPM_TOKEN}} # Token for qpackages.com
      version: '1.0.0' # Optional. Overrides the version in qpm2.json. No "v".
      tag: 'v1.0.0' # Optional. Github release tag. Defaults to the version.

      upload_release: true # Upload files to the Github release. If false, nothing is published.
      upload_qmod: true # Build the qmod and upload it to the release
      upload_binaries: false # Upload workspace.outBinaries to the release
```

## Publishing

QPM2 publishes a QPKG. The action does not make git branches or commits.

When `publish` is set, the action:

1. Before restore, sets `version` and `additionalData.url` (only if empty) in `qpm2.json`.
2. If `upload_qmod` is on: runs `qpm2 qmod zip`, uploads the qmod, and saves its link in `qmod.downloadUrl`.
3. Runs `qpm2 qpkg` to build `{id}.qpkg`.
4. Uploads the binaries (if `upload_binaries` is on) and the QPKG to the Github release.
5. Runs `qpm2 publish` with the QPKG link from the upload.

All links come from the upload, they are not guessed.

Do not change `qpm2.json` after this action runs. `qpm2 publish` checks that the QPKG matches `qpm2.json`.

With `upload_release: false`, the qmod and QPKG are only built. Nothing is uploaded and `qpm2 publish` is skipped, because there is no QPKG link.

## Monorepos

Set `package_path` to the package folder. All `qpm2` commands run in that folder.

Many packages can use the same release tag. Each package's files have their own names (`{id}.qpkg`, the qmod and the
binaries). If a file with the same name is already in the release, it is replaced.

```yaml
- uses: Fernthedev/qpm-action@v2
  with:
    workflow_token: ${{secrets.GITHUB_TOKEN}}
    package_path: 'packages/my-lib'
    publish: 'late'
    publish_token: ${{secrets.QPM_TOKEN}}
    tag: 'v1.0.0'
```

## Migrating from v1

1. Change `Fernthedev/qpm-action@v1` to `Fernthedev/qpm-action@v2`.
2. Move your package to QPM2: `qpm.json` becomes `qpm2.json`. Run `qpm2 migrate` to convert it.
3. Remove `qpm_release_bin`, `qpm_debug_bin` and `qpm_qmod`. Use `upload_binaries` and `upload_qmod` instead.
4. Remove `qpm_version: 'version@^1.0.0'`, or set it to `'version@^2.0.0'`.
5. Add `permissions: contents: write` to the job, so the action can upload to the release.
6. v2 does not make `version/v*` branches anymore. You can delete old ones if you want.

`resolve_ndk` is now on by default.
