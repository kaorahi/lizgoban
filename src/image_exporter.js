'use strict'

const fs = require('fs')

function save_blob(blob, filename, callback) {
    const reader = new FileReader()
    reader.onload = function() {
        fs.writeFile(filename, Buffer.from(new Uint8Array(this.result)), callback)
    }
    reader.readAsArrayBuffer(blob)
}

module.exports = {save_blob}
