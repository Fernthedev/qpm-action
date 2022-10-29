import { publishRun } from "./publish"
import { getActionParameters } from "./utils"

const parameters = getActionParameters()
if (parameters.publish) {
  publishRun(parameters)
}
