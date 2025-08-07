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

    qpm_version: 'version@^2.0.0' # Will download the newest qpm version which satisfies the range. By default, if empty, will download the latest release. use ref@main to download a workflow artifact from a branch or commit.

    restore: true # Run restore on download
    cache: true # Cache dependencies and any resolved ndk downloads
    resolve_ndk: true # Resolve the NDK version specified in the qpm.json file.
    publish: 'late' # Will publish the package at the end of the action run. `now` will publish the package at the end of the qpm step

    publish_token: ${{secrets.QPM_TOKEN}} # Token required for authorization publish to qpackages.com
    version: '1.0.0' # Defaults to qpm version, do not include v
    tag: 'v1.0.0' # Defaults to version, this is the Github Release TAG, not version!

    upload_qmod: true # When publishing, will try to upload all triplet qmods to release

    upload_binaries: false # When publishing, will try to upload all binaries to release

    qpkg_path: 'foo.qpkg' # When publishing, specifies where a QPKG will be stored. If the file does not exist or is unspecified, it will attempt to build the QPKG

    package_path: '.' # Specifies where the qpm.json etc. directory is.
```
