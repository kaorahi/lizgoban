'use strict'

///////////////////////////////////////////////
// copy

function copy_stones(stones, analysis_region) {
    const aa = from_stones(slice_stones(stones, analysis_region))
    return to_text(aa)
}

function slice_stones(stones, analysis_region) {
    const bsize = board_size(), m = bsize - 1
    const [[i1, i2], [j1, j2]] = analysis_region || [[0, m], [0, m]]
    return stones.slice(i1, i2 + 1).map(row => row.slice(j1, j2 + 1))
}

function from_stones(stones) {
    const to_ch = h => !h.stone ? '.' : h.black ? 'X' : 'O'
    return stones.map(row => row.map(to_ch))
}

function to_text(aa) {return aa.map(a => a.join('')).join('\n')}

///////////////////////////////////////////////
// paste

function paste_stones(stones, analysis_region, text, bturn, [i_sign, j_sign]) {
    const bsize = board_size(), m = bsize - 1
    const pat = from_text(text), pat_h = pat.length, pat_w = pat[0].length
    const [[i1, i2], [j1, j2]] = analysis_region || [[0, m], [0, m]]
    const base = (k1, k2, k_sign, len) => k_sign > 0 ? k1 : k2 - len + 1
    const top = base(i1, i2, i_sign, pat_h), left = base(j1, j2, j_sign, pat_w)
    return paste_stones_sub(stones, analysis_region, pat, bturn, top, left)
}

function paste_stones_sub(stones, analysis_region, pat, bturn, i1, j1) {
    const aa = paste_to(from_stones(stones), pat, i1, j1)
    return to_sgf(aa, bturn)
}

function from_text(text) {
    return text.split('\n').filter(identity).map(s => s.split(''))
}

function paste_to(aa, pat, i1, j1) {
    // side effect: aa and pat are modified
    pat.splice(aa.length - i1)
    seq(pat.length).forEach(di => {
        const row = aa[i1 + di]
        const p = pat[di]; p.splice(row.length - j1)
        row.splice(j1, p.length, ...p)
    })
    return aa
}

function to_sgf(aa, bturn) {
    const a = aa_map(aa, (c, i, j) => [c, i, j]).flat()
    const is_stone = xo => ([c, i, j]) => c === xo
    const sgfpos = ([c, i, j]) => `[${move2sgfpos(idx2move(i, j))}]`
    const maybe = (prop, val) => val ? prop + val : ''
    const prop = ([ident, xo]) =>
          maybe(ident, a.filter(is_stone(xo)).map(sgfpos).join(''))
    const [ab, aw] = [['AB', 'X'], ['AW', 'O']].map(prop)
    return `(;SZ[${aa.length}]PL[${bturn ? 'B' : 'W'}]${ab}${aw})`
}

///////////////////////////////////////////////
// exports

module.exports = {
    copy_stones,
    paste_stones,
}
