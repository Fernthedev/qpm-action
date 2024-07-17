'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
const publish_1 = require('./publish')
const utils_1 = require('./utils')
const parameters = (0, utils_1.getActionParameters)()
if (parameters.publish) {
  ;(0, publish_1.publishRun)(parameters)
}
