import { publishRun } from './publish.js'
import { PublishMode, getActionParameters } from './utils.js'

const parameters = getActionParameters()

if (parameters.publish === PublishMode.late) {
  await publishRun(parameters)
}
