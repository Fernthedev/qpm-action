<p align="center">
  <a href="https://github.com/actions/typescript-action/actions"><img alt="typescript-action status" src="https://github.com/Fernthedev/qpm-rust-action/workflows/build-test/badge.svg"></a>
</p>

## QPM Rust Github Action

Usage: 
```yaml
- name: QPM Rust Action
  uses: Fernthedev/qpm-rust-action@0.1.1
    #required
    workflow_token: ${{secrets.GITHUB_TOKEN}}
    
    restore: true # will run restore on download
    cache: true #will cache dependencies
    
    publish: true # Will publish the package at the end of the action run
    version: "1.0.0" # defaults to qpm-rust version, do not include v
    
    # set to true if applicable, ASSUMES the file is already a relaease asset
    qpm_release_bin: true 
    qpm_debug_bin: true

    # Name of qmod in release asset. Assumes exists, same as prior
    qpm_mod: "qmod_name" 