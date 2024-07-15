import {GitHub} from '@actions/github/lib/utils'
import {publishRun} from './publish'
import {getActionParameters} from './utils'
import {getOctokit} from '@actions/github'

const parameters = getActionParameters()

if (parameters.publish) {
  publishRun(parameters)
}
