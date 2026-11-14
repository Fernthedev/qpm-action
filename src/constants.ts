// Constants for QPM repository
export const QPM_REPOSITORY_OWNER = 'QuestPackageManager'
export const QPM_REPOSITORY_NAME = 'QPM.CLI'
/** Workflow producing the QPM build artifacts used by `ref@` */
export const QPM_REPOSITORY_WORKFLOW_FILE = 'cargo-build.yml'
export const QPM_REPOSITORY_BRANCH = 'main'

/** Pre-release rebuilt from QPM.CLI main, used until a release satisfying the requested range exists */
export const QPM_BLEEDING_TAG = 'bleeding2'
/** Default QPM version range when `qpm_version` is empty */
export const QPM_DEFAULT_VERSION_RANGE = '^2.0.0'

export const QPM_COMMAND_RESTORE = 'restore'
export const QPM_COMMAND_PUBLISH = 'publish'
export const QPM_COMMAND_CACHE_PATH = ['cache', 'path']
