import { GitHub } from '@actions/github/lib/utils.js'
import { getOctokit } from '@actions/github'

import { publishRun } from './publish.js'
import { getActionParameters } from './utils.js'

const parameters = getActionParameters()

if (parameters.publish) {
  publishRun(parameters)
}
