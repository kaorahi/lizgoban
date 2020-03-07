// usage: node this_file

/////////////////////////
// setting

const engine_command = '/foo/bar/katago'
const engine_args = ['gtp',
                     '-model', '/foo/bar/baz.bin.gz',
                     '-config', '/foo/bar/qux.cfg']

const gtp_commands = 'kata-analyze interval 20 ownership true\n'

const overhead_centisec = 15

/////////////////////////
// util

function log(s) {console.log(`${(new Date()).toJSON()} ${s}`)}

function idle_loop(millisec) {
    for (const start = Date.now(); Date.now() - start < millisec; ) {}
}

/////////////////////////
// main

const opt = {}
const engine_process = require('child_process').spawn(engine_command, engine_args, opt)

function stdout_reader(stream) {
    const s = stream.toString()
    log(`${s.slice(0, 30)}... (${s.length} chars)`)
    if (s.match(/\r?\n/)) {
        log(`[begin idle loop]`)
        idle_loop(overhead_centisec * 10)
        log(`[end idle loop]`)
    }
}
function stderr_reader(stream) {
    const s = stream.toString()
    log(s)
    s.match(/(Setting max tree size)|(GTP ready)/) &&
        engine_process.stdin.write(gtp_commands)
}

engine_process.stdout.on('data', stdout_reader)
engine_process.stderr.on('data', stderr_reader)
