# QPM Github Action

[![CI](https://github.com/Fernthedev/qpm-action/actions/workflows/ci.yml/badge.svg)](https://github.com/Fernthedev/qpm-action/actions/workflows/ci.yml)

Sets up [QPM2](https://github.com/QuestPackageManager/QPM.CLI) in Github Actions. It restores and caches your
dependencies, downloads the NDK, and can publish your package to qpackages.com.

## Usage

Set up QPM and restore:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: Fernthedev/qpm-action@v2
  - run: qpm2 build
```

Publish when you push a tag like `v1.2.3`:

```yaml
on:
  push:
    tags: ['v*']

permissions:
  contents: write # to upload release assets

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Fernthedev/qpm-action@v2
        with:
          publish: late
          publish_token: ${{ secrets.QPM_TOKEN }}
```

The version (`1.2.3`) and the release tag (`v1.2.3`) come from the git tag.

## Inputs

| Input             | Default        | Meaning                                                                  |
| ----------------- | -------------- | ------------------------------------------------------------------------ |
| `qpm_version`     | `^2.0.0`       | QPM to use. A version range, `bleeding`, or a QPM.CLI branch or commit.  |
| `package_path`    | `.`            | Folder with `qpm2.json`. Can be a subfolder (monorepo).                  |
| `restore`         | `true`         | Run `qpm2 restore`.                                                      |
| `cache`           | `true`         | Cache dependencies and the NDK.                                          |
| `resolve_ndk`     | `true`         | Download the NDK from `qpm2.json`. Does nothing if none is set.          |
| `publish`         |                | `late`: publish at the end of the job. `now`: publish in this step.      |
| `publish_token`   |                | qpackages.com token. Required to publish.                                |
| `version`         | git tag        | Version to publish, without `v`. Falls back to `qpm2.json`.              |
| `tag`             | git tag        | Github release tag. Falls back to the version.                           |
| `upload_release`  | `true`         | Upload files to the Github release. If `false`, nothing is published.    |
| `upload_qmod`     | auto           | Build and upload the qmod. Auto: only if the package has a mod template. |
| `upload_binaries` | `true`         | Upload `workspace.outBinaries` to the Github release.                    |
| `workflow_token`  | `github.token` | Github token. Needs `contents: write` to publish.                        |

## Outputs

| Output     | Meaning                                     |
| ---------- | ------------------------------------------- |
| `qpm_path` | Path to the `qpm2` executable.              |
| `version`  | Package version used.                       |
| `qpkg_url` | Link to the uploaded QPKG. Only with `now`. |
| `qmod_url` | Link to the uploaded qmod. Only with `now`. |

## Publishing

The action does not make git branches or commits. When `publish` is set, it:

1. Before restore, sets `version` and `additionalData.url` (only if empty) in `qpm2.json`.
2. If the package has a mod template: runs `qpm2 qmod zip`, uploads the qmod, and saves its link in `qmod.downloadUrl`.
3. Runs `qpm2 qpkg` to build `{id}.qpkg`.
4. Uploads the binaries and the QPKG to the Github release.
5. Runs `qpm2 publish` with the QPKG link from the upload.

Do not change `qpm2.json` after this action runs. `qpm2 publish` checks that the QPKG matches `qpm2.json`.

With `upload_release: false`, the qmod and QPKG are only built. Nothing is uploaded and `qpm2 publish` is skipped.

## Monorepos

Set `package_path` to the package folder. All `qpm2` commands run in that folder.

Many packages can use the same release tag. Each package's files have their own names. If a file with the same name is
already in the release, it is replaced.

```yaml
- uses: Fernthedev/qpm-action@v2
  with:
    package_path: packages/my-lib
    publish: late
    publish_token: ${{ secrets.QPM_TOKEN }}
```

## Migrating from v1

1. Change `Fernthedev/qpm-action@v1` to `Fernthedev/qpm-action@v2`.
2. Move your package to QPM2: `qpm.json` becomes `qpm2.json`. Run `qpm2 migrate` to convert it.
3. Remove `qpm_release_bin`, `qpm_debug_bin` and `qpm_qmod`. Binaries are uploaded by default and the qmod is found
   automatically. Use `upload_binaries` and `upload_qmod` to change this.
4. Remove `qpm_version: 'version@^1.0.0'`. The default is `^2.0.0`.
5. Remove `workflow_token`. The default token works.
6. Add `permissions: contents: write` to the job, so the action can upload to the release.
7. On tag pushes, `version` and `tag` are not needed anymore.
8. v2 does not make `version/v*` branches. You can delete old ones if you want.
