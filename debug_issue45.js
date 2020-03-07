const engine_command = '/foo/bar/katago'
const engine_args = ['gtp',
                     '-model', '/foo/bar/baz.bin.gz',
                     '-config', '/foo/bar/qux.cfg']
const opt = {}

const gtp_commands = 'lz-analyze interval 20\n'

/////////////////////////

const engine_process = require('child_process').spawn(engine_command, engine_args, opt)

function stdout_reader(stream) {
    const s = stream.toString()
    console.log(`${(new Date()).toJSON()} ${s.slice(0, 30)}... (${s.length} chars)`)
}
function stderr_reader(stream) {
    const s = stream.toString()
    console.log(s)
    s.match(/(Setting max tree size)|(GTP ready)/) &&
        engine_process.stdin.write(gtp_commands)
}

engine_process.stdout.on('data', stdout_reader)
engine_process.stderr.on('data', stderr_reader)
