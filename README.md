<p align="center">
  <a href="https://github.com/actions/typescript-action/actions"><img alt="typescript-action status" src="https://github.com/Fernthedev/qpm-action/workflows/build-test/badge.svg"></a>
</p>

## QPM Rust Github Action

Usage:

```yaml
- name: QPM Action
  uses: Fernthedev/qpm-action@v2
  with:
    #required
    workflow_token: ${{secrets.GITHUB_TOKEN}}

    qpm_version: 'version@^2.0.0' # Will download the newest qpm release which satisfies the range (default ^2.0.0). Falls back to the bleeding2 pre-release until a satisfying release exists. Use ref@main to download a workflow artifact from a branch or commit.

    restore: true # Run restore on download
    cache: true # Cache dependencies and any resolved ndk downloads
    resolve_ndk: true # Resolve the NDK version specified in qpm2.json. Skipped if none is specified. Defaults to true
    publish: 'late' # Will publish the package at the end of the action run. `now` will publish the package at the end of the qpm step

    publish_token: ${{secrets.QPM_TOKEN}} # Token required for authorization publish to qpackages.com
    version: '1.0.0' # Defaults to qpm version, do not include v
    tag: 'v1.0.0' # Defaults to version, this is the Github Release TAG, not version! Monorepo packages may share it

    upload_qmod: true # When publishing, builds and uploads the qmod to the release and sets qmod.downloadUrl

    upload_binaries: false # When publishing, uploads workspace.outBinaries to the release

    qpkg_path: 'foo.qpkg' # When publishing, where the QPKG is stored, relative to package_path. If the file does not exist, it is built with `qpm2 qpkg`. Defaults to {id}.qpkg

    package_path: '.' # Directory containing qpm2.json. Can be a subdirectory for monorepos; all qpm2 commands run there.
```

### Publishing

QPM2 publishes a QPKG, no git branches or commits are created. When `publish` is set, the action:

1. Writes publishing metadata into `qpm2.json` before restore: `version`, `additionalData.url` (if unset) and
   `qmod.downloadUrl` (if `upload_qmod`). This must happen first, since `qpm2 publish` requires the config inside the
   QPKG to match `qpm2.json` exactly. Don't edit `qpm2.json` between this action and the publish.
2. Builds the QPKG with `qpm2 qpkg` unless `qpkg_path` already exists.
3. Uploads the QPKG (and qmod/binaries if enabled) to the Github release.
4. Runs `qpm2 publish <qpkg url>` in `package_path`.

### Monorepos

Set `package_path` to the package's subdirectory; every `qpm2` command runs there and `additionalData.url` points to the
package's directory in the repository. Packages can share the same release tag: the QPKG, qmod and binaries uploaded as
release assets are named after each package (`{id}.qpkg`, `{qmod id}.qmod`, binary file names), and an asset with the same name from a previous run is replaced.

```yaml
- uses: Fernthedev/qpm-action@v2
  with:
    workflow_token: ${{secrets.GITHUB_TOKEN}}
    package_path: 'packages/my-lib'
    publish: 'late'
    publish_token: ${{secrets.QPM_TOKEN}}
    tag: 'v1.0.0' # shared with the other packages of the repository
```

### Release permissions

Publishing uploads to a Github release, so `workflow_token` needs `contents: write`:

```yaml
permissions:
  contents: write
```
