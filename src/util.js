const CRYPTO = require('crypto')

// utilities

const E = {}

E.sha256sum = x => CRYPTO.createHash('sha256').update(x).digest('hex')

E.to_i = x => (x | 0)  // to_i(true) is 1!
E.to_f = x => (x - 0)  // to_f(true) is 1!
E.to_s = x => (x + '')
E.xor = (a, b) => (!a === !!b)
// truep() returns BOOLEAN so that availability() is safely serialized and
// passed to renderer in main.js. [2020-09-05]
E.truep = x => (!!x || x === 0 || x === '')
E.true_or = (x, y) => E.truep(x) ? x : y
E.finitep = x => E.truep(x) && x !== Infinity
E.finite_or = (x, y) => E.finitep(x) ? x : y
E.do_nothing = () => {}
E.identity = x => x
E.is_a = (obj, type) => (typeof obj === type)
E.stringp = obj => E.is_a(obj, 'string')
E.valid_numberp = obj => E.is_a(obj, 'number') && !isNaN(obj)
E.functionp = obj => E.is_a(obj, 'function')
E.clip = (x, lower, upper) =>
    Math.max(lower, Math.min(x, E.truep(upper) ? upper : Infinity))
E.sum = a => a.reduce((r,x) => r + x, 0)
E.average = a => E.sum(a) / a.length
E.weighted_average = (a, w) => E.sum(a.map((z, k) => z * w[k])) / E.sum(w)
// E.clone = x => JSON.parse(JSON.stringify(x))
E.merge = Object.assign
E.empty = a => !a || (a.length === 0)
E.last = a => a.at(-1)
E.uniq = a => [...new Set(a)]
E.sort_by = (a, f) => a.slice().sort((x, y) => f(x) - f(y))
E.sort_by_key = (a, key) => sort_by(a, h => h[key])
E.num_sort = a => sort_by(a, E.identity)
E.argmin_by = (a, f) => {const b = a.map(f), m = Math.min(...b); return b.indexOf(m)}
E.min_by = (a, f) => a[E.argmin_by(a, f)]
E.replace_header = (a, header) => a.splice(0, header.length, ...header)
E.each_key_value = (h, f) => Object.keys(h).forEach(k => f(k, h[k]))
E.map_key_value = (h, f) => Object.keys(h).map(k => f(k, h[k]))
E.each_value = (h, f) => each_key_value(h, (_, v) => f(v))  // for non-array
E.array2hash = a => {
    // array2hash(['a', 3, 'b', 1, 'c', 4]) ==> {a: 3, b: 1, c: 4}
    const h = {}; a.forEach((x, i) => (i % 2 === 0) && (h[x] = a[i + 1])); return h
}
E.pick_keys = (h, ...keys) => {
    const picked = {}; keys.forEach(k => picked[k] = h[k]); return picked
}
E.ref_or_create = (h, key, default_val) => h[key] || (h[key] = default_val)
E.safely = (proc, ...args) => E.safely_or(proc, args, e => null)
E.verbose_safely = (proc, ...args) => E.safely_or(proc, args, console.log)
E.safely_or = (proc, args, catcher) => {
    try {return proc(...args)} catch(e) {return catcher(e)}
}

E.mac_p = () => (process.platform === 'darwin')
E.leelaz_komi = 7.5
E.handicap_komi = -0.5
E.default_gorule = 'chinese'
E.blunder_threshold = -2
E.big_blunder_threshold = -5
E.blunder_low_policy = 0.1
E.blunder_high_policy = 0.75
E.black_to_play_p = (forced, bturn) => forced ? (forced === 'black') : bturn

// seq(3) = [ 0, 1, 2 ], seq(3, 5) = [ 5, 6, 7 ], seq(-2) = []
// seq_from_to(3,5) = [3, 4, 5], seq_from_to(5,3) = []
E.seq = (n, from) => [...Array(E.clip(n, 0))].map((_, i) => i + (from || 0))
E.seq_from_to = (from, to) => E.seq(to - from + 1, from)
E.do_ntimes = (n, f) => E.seq(n).forEach(f)

// change_points('aaabcc'.split('')) ==> [3, 4]
// unchanged_ranges('aaabcc'.split('')) ==> [['a', 0, 2], ['b', 3, 3], ['c', 4, 5]]
E.change_points = a => a.map((z, k) => k > 0 && a[k - 1] !== a[k] && k).filter(truep)
E.unchanged_periods =
    a => empty(a) ? [] : [0, ...change_points([...a, {}])].map((k, l, cs) => {
        const next = cs[l + 1]
        return next && [a[k], k, next - 1]
    }).filter(truep)

// "magic" in ai.py of KaTrain
// seq(1000).map(_ => weighted_random_choice([1,2,3,4], identity)).filter(x => x === 3).length
// ==> around 300
E.weighted_random_choice = (ary, weight_of) => {
    const magic = (...args) => - Math.log(Math.random()) / (weight_of(...args) + 1e-18)
    return E.min_by(ary, magic)
}
E.random_choice = ary => weighted_random_choice(ary, () => 1)

// array of array
E.aa_new = (m, n, f) => E.seq(m).map(i => E.seq(n).map(j => f(i, j)))
E.aa_ref = (aa, i, j) => truep(i) && (i >= 0) && aa[i] && aa[i][j]
E.aa_set = (aa, i, j, val) =>
    truep(i) && (i >= 0) && ((aa[i] = aa[i] || []), (aa[i][j] = val))
E.aa_each = (aa, f) => aa.forEach((row, i) => row.forEach((s, j) => f(s, i, j)))
E.aa_map = (aa, f) => aa.map((row, i) => row.map((s, j) => f(s, i, j)))
E.aa_transpose = aa => empty(aa) ? [] : aa[0].map((_, k) => aa.map(a => a[k]))
E.aa_dup_hash = aa => E.aa_map(aa, h => ({...h}))
E.aa2hash = aa => {const h = {}; aa.forEach(([k, v]) => h[k] = v); return h}
E.around_idx_diff = [[1, 0], [0, 1], [-1, 0], [0, -1]]
E.around_idx = ([i, j]) => {
    const neighbor = ([di, dj]) => [i + di, j + dj]
    return around_idx_diff.map(neighbor)
}

// [0,1,2,3,4,5,6,7,8,9,10,11,12].map(k => kilo_str(10**k))  ==>
// ['1','10','100','1.0K','10K','100K','1.0M','10M','100M','1.0G','10G','100G','1000G']
E.kilo_str = x => kilo_str_sub(x, [[1e9, 'G'], [1e6, 'M'], [1e3, 'k']])

function kilo_str_sub(x, rules) {
    if (empty(rules)) {return to_s(x)}
    const [[base, unit], ...rest] = rules
    if (x < base) {return kilo_str_sub(x, rest)}
    // +0.1 for "1.0K" instead of "1K"
    const y = (x + 0.1) / base, z = Math.floor(y)
    return (y < 10 ? to_s(y).slice(0, 3) : to_s(z)) + unit
}

// str_sort_uniq('zabcacd') = 'abcdz'
E.str_sort_uniq = str => E.uniq(str.split('')).sort().join('')

E.remarkable_aggressiveness = (aggressive_policy, defensive_policy, prior) => {
    const valid = truep(aggressive_policy) && truep(defensive_policy)
    if (!valid) {return null}
    const [bot, mid, top] = [aggressive_policy, defensive_policy, prior].sort()
    if (top === prior) {return 1.0}
    const tm = top / mid
    const agg = (top === aggressive_policy) ? tm : (1 / tm), max = Number.MAX_VALUE
    return clip(agg, 0, max)
}

let debug_log_p = false
let debug_log_prev_category = null
let debug_log_snipped_lines = 0, debug_log_last_snipped_line = null
E.debug_log = (arg, limit_len, category) => is_a(arg, 'boolean') ?
    (debug_log_p = arg) : (debug_log_p && do_debug_log(arg, limit_len, category))
function do_debug_log(arg, limit_len, category) {
    const sec = `(${(new Date()).toJSON().replace(/(.*:)|(.Z)/g, '')}) `
    const line = sec + snip(E.to_s(arg), limit_len)
    const same_category_p = (category && (category === debug_log_prev_category))
    debug_log_prev_category = category
    if (same_category_p) {
        debug_log_snipped_lines++ === 0 && console.log('...snipping lines...')
        debug_log_last_snipped_line = line
        return
    }
    --debug_log_snipped_lines > 0 &&
        console.log(`...${debug_log_snipped_lines} lines are snipped.`)
    debug_log_snipped_lines = 0
    debug_log_last_snipped_line && console.log(debug_log_last_snipped_line)
    debug_log_last_snipped_line = null
    console.log(line)
}
E.snip = (str, limit_len) => {
    const half = Math.floor((limit_len || Infinity) / 2)
    return snip_text(str, half, half, over => `{...${over}...}`)
}
E.snip_text = (str, head, tail, dots) => {
    const over = str.length - (head + tail), raw = stringp(dots)
    return over <= 0 ? str :
        str.slice(0, head) + (raw ? dots : dots(over)) + (tail > 0 ? str.slice(- tail) : '')
}

E.orig_suggest_p = s => s.order >= 0

E.endstate_from_ownership_destructive =
    ownership => aa_new(board_size(), board_size(), () => ownership.shift())

E.endstate_entropy = es => {
    const log2 = p => Math.log(p) / Math.log(2)
    const h = p => (p > 0) ? (- p * log2(p)) : 0
    const entropy = p => h(p) + h(1 - p)
    return entropy((es + 1) / 2)
}

E.cached = f => {
    let cache = {}; return key => cache[key] || (cache[key] = f(key))
}

E.change_detector = init_val => {
    let prev
    const is_changed = val => {const changed = (val != prev); prev = val; return changed}
    const reset = () => (prev = init_val); reset()
    return {is_changed, reset}
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

// v = vapor_var(500, 'foo'); v('bar'); v() ==> 'bar'
// (after 500ms) v() ==> 'foo'
E.vapor_var = (millisec, default_val) => {
    let val
    const recover = () => {val = default_val}
    const [recover_later] = deferred_procs([recover, millisec])
    const obj = new_val =>
          (new_val === undefined ? val : (val = new_val, recover_later()))
    recover(); return obj
}

E.make_speedometer = (interval_sec, premature_sec) => {
    let t0, k0, t1, k1  // t0 = origin, t1 = next origin
    let the_latest = null
    const reset = () => {[t0, k0, t1, k1] = [Date.now(), NaN, null, null]}
    const per_sec = k => {
        const t = Date.now(), ready = !isNaN(k0), dt_sec = () => (t - t0) / 1000
        !ready && (dt_sec() >= premature_sec) && ([t0, k0, t1, k1] = [t, k, t, k])
        ready && (t - t1 >= interval_sec * 1000) && ([t0, k0, t1, k1] = [t1, k1, t, k])
        const ret = (k - k0) / dt_sec()
        return ready && !isNaN(ret) && (ret < Infinity) && (the_latest = ret)
    }
    const latest = () => the_latest
    reset(); per_sec(0); return {reset, per_sec, latest}
}

// for engine (chiefly)
E.common_header_length = (a, b, strictly) => {
    const same_move = (x, y) => (!!x.is_black === !!y.is_black && x.move === y.move)
    const eq = strictly ? ((x, y) => (x === y)) : same_move
    const k = a.findIndex((x, i) => !eq(x, b[i] || {}))
    return (k >= 0) ? k : a.length
}
E.each_line = (f) => {
    let buf = ''
    return chunk => {
        const a = chunk.toString().split(/\r?\n/), rest = a.pop()
        !empty(a) && (a[0] = buf + a[0], buf = '', a.forEach(f))
        buf += rest
    }
}
E.set_error_handler = (process, handler) => {
    ['stdin', 'stdout', 'stderr'].forEach(k => process[k].on('error', handler))
    process.on('exit', handler)
}

E.exec_command = (com, f) => {
    const callback = (err, stdout, stderror) => !err && f && f(stdout)
    require('child_process').exec(com, callback)
}

E.initial_sanity = 10
E.sanity_range = [0, 20]

// avoid letters for keyboard operation in renderer.js
const normal_tag_letters = 'defghijklmnorstuy'
const last_loaded_element_tag_letter = '.'
const start_moves_tag_letter = "'"
const endstate_diff_tag_letter = "/"
const branching_tag_letter = ":", unnamed_branch_tag_letter = "^"
const ladder_tag_letter = "="
const tag_letters = normal_tag_letters + last_loaded_element_tag_letter +
      start_moves_tag_letter + endstate_diff_tag_letter +
      branching_tag_letter + unnamed_branch_tag_letter + ladder_tag_letter
const implicit_tag_letters = endstate_diff_tag_letter + branching_tag_letter
      + last_loaded_element_tag_letter + ladder_tag_letter
function exclude_implicit_tags(tags) {
    return implicit_tag_letters.split('').reduce((acc, t) => acc.replaceAll(t, ''), tags)
}
const common_constants = {
    normal_tag_letters, last_loaded_element_tag_letter,
    start_moves_tag_letter, endstate_diff_tag_letter,
    branching_tag_letter, unnamed_branch_tag_letter,
    ladder_tag_letter,
    tag_letters, exclude_implicit_tags,
}

module.exports = E.merge(E, common_constants)
