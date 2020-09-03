const fs = require('fs')

function save_blob(blob, filename) {
    const reader = new FileReader()
    reader.onload = function() {
        fs.writeFileSync(filename, Buffer.from(new Uint8Array(this.result)))
    }
    reader.readAsArrayBuffer(blob)
}

module.exports = {save_blob}
