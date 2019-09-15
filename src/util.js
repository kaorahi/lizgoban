// utilities

const E = {}

E.to_i = x => (x | 0)
E.to_f = x => (x - 0)
E.to_s = x => (x + '')
E.xor = (a, b) => (!a === !!b)
E.truep = x => (x || x === 0 || x === '')
E.do_nothing = () => {}
E.identity = x => x
E.clip = (x, lower, upper) =>
    Math.max(lower, Math.min(x, E.truep(upper) ? upper : Infinity))
// E.sum = a => a.reduce((r,x) => r + x, 0)
// E.clone = x => JSON.parse(JSON.stringify(x))
E.merge = Object.assign
E.empty = a => !a || (a.length === 0)
E.last = a => a[a.length - 1]
E.flatten = a => [].concat(...a)
E.sort_by = (a, f) => a.slice().sort((x, y) => f(x) - f(y))
E.num_sort = a => sort_by(a, E.identity)
E.each_key_value = (h, f) => Object.keys(h).forEach(k => f(k, h[k]))
E.array2hash = a => {
    const h = {}; a.forEach((x, i) => (i % 2 === 0) && (h[x] = a[i + 1])); return h
}
E.mac_p = () => (process.platform === 'darwin')

// seq(3) = [ 0, 1, 2 ], seq(3, 5) = [ 5, 6, 7 ]
E.seq = (n, from) => [...Array(n)].map((_, i) => i + (from || 0))
E.do_ntimes = (n, f) => E.seq(n).forEach(f)

// array of array
E.aa_new = (m, n, f) => E.seq(m).map(i => E.seq(n).map(j => f(i, j)))
E.aa_ref = (aa, i, j) => truep(i) && (i >= 0) && aa[i] && aa[i][j]
E.aa_set = (aa, i, j, val) =>
    truep(i) && (i >= 0) && ((aa[i] = aa[i] || []), (aa[i][j] = val))
E.aa_each = (aa, f) => aa.forEach((row, i) => row.forEach((s, j) => f(s, i, j)))
E.aa_map = (aa, f) => aa.map((row, i) => row.map((s, j) => f(s, i, j)))
E.aa2hash = aa => {const h = {}; aa.forEach(([k, v]) => h[k] = v); return h}
E.around_idx_diff = [[1, 0], [0, 1], [-1, 0], [0, -1]]
E.around_idx = ([i, j]) => {
    const neighbor = ([di, dj]) => [i + di, j + dj]
    return around_idx_diff.map(neighbor)
}

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

E.make_speedometer = (interval_sec, premature_sec) => {
    let t0, k0, t1, k1  // t0 = origin, t1 = next origin
    const reset = () => {[t0, k0, t1, k1] = [Date.now(), NaN, null, null]}
    const per_sec = k => {
        const t = Date.now(), ready = !isNaN(k0), dt_sec = () => (t - t0) / 1000
        !ready && (dt_sec() >= premature_sec) && ([t0, k0, t1, k1] = [t, k, t, k])
        ready && (t - t1 >= interval_sec * 1000) && ([t0, k0, t1, k1] = [t1, k1, t, k])
        const ret = (k - k0) / dt_sec()
        return ready && !isNaN(ret) && (ret < Infinity) && ret
    }
    reset(); per_sec(0); return {reset, per_sec}
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
const normal_tag_letters = 'bdefghijklmnorstuwy'
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
