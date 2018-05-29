// utilities

const to_i = x => (x | 0)
const to_f = x => (x - 0)
const xor = (a, b) => (a && !b) || (!a && b)
// const sum = a => a.reduce((r,x) => r + x, 0)
const clone = x => JSON.parse(JSON.stringify(x))
const flatten = a => [].concat(...a)
const each_key_value = (h, f) => Object.keys(h).forEach(k => f(k, h[k]))

// seq(3) = [ 0, 1, 2 ], seq(3, 5) = [ 5, 6, 7 ]
const seq = (n, from) => [...Array(n)].map((_, i) => i + (from || 0))
const do_ntimes = (n, f) => seq(n).forEach(f)

module.exports = {
    to_i: to_i,
    to_f: to_f,
    xor: xor,
    clone: clone,
    flatten: flatten,
    each_key_value: each_key_value,
    seq: seq,
    do_ntimes: do_ntimes,
}
