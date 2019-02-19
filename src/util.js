// utilities

const E = module.exports

E.to_i = x => (x | 0)
E.to_f = x => (x - 0)
E.xor = (a, b) => (!a === !!b)
E.truep = x => (x || x === 0 || x === '')
E.clip = (x, lower, upper) => Math.max(lower, Math.min(x, upper))
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
