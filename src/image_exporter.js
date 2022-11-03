const fs = require('fs')

function save_blob(blob, filename, callback) {
    const reader = new FileReader()
    reader.onload = function() {
        fs.writeFile(filename, Buffer.from(new Uint8Array(this.result)), callback)
    }
    reader.readAsArrayBuffer(blob)
}

function save_dataURL(url, filename, callback) {
    const write = ab => fs.writeFile(filename, Buffer.from(ab), callback)
    fetch(url).then(res => res.arrayBuffer().then(write))
}

module.exports = {save_blob, save_dataURL}
