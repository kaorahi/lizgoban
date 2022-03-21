'use strict'

// ugly!
function globalize(...args) {Object.assign(global, ...args)}
module.exports = {globalize}
