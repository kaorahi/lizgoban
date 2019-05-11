// utilities

const E = {}

E.to_i = x => (x | 0)
E.to_f = x => (x - 0)
E.to_s = x => (x + '')
E.xor = (a, b) => (!a === !!b)
E.truep = x => (x || x === 0 || x === '')
E.do_nothing = () => {}
E.clip = (x, lower, upper) => Math.max(lower, Math.min(x, upper || Infinity))
// E.sum = a => a.reduce((r,x) => r + x, 0)
// E.clone = x => JSON.parse(JSON.stringify(x))
E.merge = Object.assign
E.empty = a => !a || (a.length === 0)
E.last = a => a[a.length - 1]
E.flatten = a => [].concat(...a)
E.each_key_value = (h, f) => Object.keys(h).forEach(k => f(k, h[k]))
E.array2hash = a => {
    const h = {}; a.forEach((x, i) => (i % 2 === 0) && (h[x] = a[i + 1])); return h
}

// seq(3) = [ 0, 1, 2 ], seq(3, 5) = [ 5, 6, 7 ]
E.seq = (n, from) => [...Array(n)].map((_, i) => i + (from || 0))
E.do_ntimes = (n, f) => E.seq(n).forEach(f)

// array of array
E.aa_new = (m, n, f) => E.seq(m).map(i => E.seq(n).map(j => f(i, j)))
E.aa_ref = (aa, i, j) => truep(i) && (i >= 0) && aa[i] && aa[i][j]
E.aa_set = (aa, i, j, val) =>
    truep(i) && (i >= 0) && ((aa[i] = aa[i] || []), (aa[i][j] = val))
E.aa2hash = aa => {const h = {}; aa.forEach(([k, v]) => h[k] = v); return h}

// str_uniq('zabcacd') = 'zabcd'
E.str_uniq = str => [...new Set(str.split(''))].join('')

let debug_log_p = false
E.debug_log = (arg, limit_len) => (typeof arg === 'boolean') ?
    (debug_log_p = arg) : (debug_log_p && do_debug_log(arg, limit_len))
function do_debug_log(arg, limit_len) {
    const HALF = Math.floor((limit_len || Infinity) / 2)
    const s = E.to_s(arg), over = s.length - HALF * 2
    const snip = str => str.slice(0, HALF) + `{...${over}...}` + str.slice(- HALF)
    console.log(over <= 0 ? s : snip(s))
}

// [d_f, d_g] = deferred_procs([f, 200], [g, 300])
// d_f(1,2,3) ==> f(1,2,3) is called after 200 ms
// d_f(1,2,3) and then d_g(4,5) within 200 ms
//   ==> f is cancelled and g(4,5) is called after 300 ms
E.deferred_procs = (...proc_delay_pairs) => {
    let timer
    return proc_delay_pairs.map(([proc, delay]) => ((...args) => {
        clearTimeout(timer); timer = setTimeout(() => proc(...args), delay)
    }))
}

// for engine (chiefly)
E.common_header_length = (a, b) => {
    const eq = (x, y) => (!!x.is_black === !!y.is_black && x.move === y.move)
    const k = a.findIndex((x, i) => !eq(x, b[i] || {}))
    return (k >= 0) ? k : a.length
}
E.each_line = (f) => {
    let buf = ''
    return stream => {
        const a = stream.toString().split(/\r?\n/), rest = a.pop()
        !empty(a) && (a[0] = buf + a[0], buf = '', a.forEach(f))
        buf += rest
    }
}
E.set_error_handler = (process, handler) => {
    ['stdin', 'stdout', 'stderr'].forEach(k => process[k].on('error', handler))
    process.on('exit', handler)
}

// avoid letters for keyboard operation in renderer.js
const normal_tag_letters = 'bcdefghijklmnorstuvwy'
const last_loaded_element_tag_letter = '.'
const start_moves_tag_letter = "'"
const endstate_diff_tag_letter = "/"
const tag_letters = normal_tag_letters + last_loaded_element_tag_letter +
      start_moves_tag_letter + endstate_diff_tag_letter
const common_constants = {
    normal_tag_letters, last_loaded_element_tag_letter,
    start_moves_tag_letter, endstate_diff_tag_letter,
    tag_letters,
}

require('./globally.js').export_globally(module, E.merge(E, common_constants))
