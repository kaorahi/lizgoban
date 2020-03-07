// usage: node this_file

/////////////////////////
// setting

const engine_command = '/foo/bar/katago'
const engine_args = ['gtp',
                     '-model', '/foo/bar/baz.bin.gz',
                     '-config', '/foo/bar/qux.cfg']

const gtp_commands = 'kata-analyze interval 20 ownership true\n'

const use_each_line = true

const overhead_centisec = 20

/////////////////////////
// util

function log(s) {console.log(`${(new Date()).toJSON()} ${s}`)}

const empty = a => !a || (a.length === 0)
const each_line = (f) => {
    let buf = ''
    return stream => {
        const raw_str = stream.toString()
        if (!use_each_line) {f(raw_str); return}
        log(`each_line: received ${raw_str.length} chars`)
        const a = raw_str.split(/\r?\n/), rest = a.pop()
        log(`each_line: ${a.length} lines + ${rest.length} chars`)
        !empty(a) && (a[0] = buf + a[0], buf = '', a.forEach(f))
        buf += rest
    }
}

function idle_loop(millisec) {
    for (const start = Date.now(); Date.now() - start < millisec; ) {}
}

/////////////////////////
// main

const opt = {}
const engine_process = require('child_process').spawn(engine_command, engine_args, opt)

function stdout_reader(s) {
    log(`${s.slice(0, 30)}... (${s.length} chars)`)
    log(`[begin idle loop]`)
    idle_loop(overhead_centisec * 10)
    log(`[end idle loop]`)
}
function stderr_reader(stream) {
    const s = stream.toString()
    log(s)
    s.match(/(Setting max tree size)|(GTP ready)/) &&
        engine_process.stdin.write(gtp_commands)
}

engine_process.stdout.on('data', each_line(stdout_reader))
engine_process.stderr.on('data', stderr_reader)
