// utilities

const E = module.exports

E.to_i = x => (x | 0)
E.to_f = x => (x - 0)
E.xor = (a, b) => (a && !b) || (!a && b)
// E.sum = a => a.reduce((r,x) => r + x, 0)
E.clone = x => JSON.parse(JSON.stringify(x))
E.flatten = a => [].concat(...a)
E.each_key_value = (h, f) => Object.keys(h).forEach(k => f(k, h[k]))

// seq(3) = [ 0, 1, 2 ], seq(3, 5) = [ 5, 6, 7 ]
E.seq = (n, from) => [...Array(n)].map((_, i) => i + (from || 0))
E.do_ntimes = (n, f) => E.seq(n).forEach(f)
