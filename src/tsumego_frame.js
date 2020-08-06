const {ij_flipper} = require('./random_flip.js')

//////////////////////////////////////
// main

function tsumego_frame(stones, komi, black_to_play_p, ko_p) {
    const filled_stones = tsumego_frame_stones(stones, komi, black_to_play_p, ko_p)
    const pick_stone = (s, i, j) => s.tsumego_frame && [i, j, s.black]
    return flatten(aa_map(filled_stones, pick_stone)).filter(truep)
}

function tsumego_frame_stones(stones, komi, black_to_play_p, ko_p) {
    const size = board_size()
    const ijs = flatten(aa_map(stones, (h, i, j) => h.stone && {i, j, black: h.black}))
          .filter(truep)
    if (empty(ijs)) {return []}
    // detect corner/edge/center problems
    // (avoid putting border stones on the first lines)
    const near_to_edge = 2
    const snapper = to => k => Math.abs(k - to) <= near_to_edge ? to : k
    const snap0 = snapper(0), snapS = snapper(size - 1)
    // find range of problem
    const top = min_by(ijs, z => z.i), bottom = min_by(ijs, z => - z.i)
    const left = min_by(ijs, z => z.j), right = min_by(ijs, z => - z.j)
    const imin = snap0(top.i), imax = snapS(bottom.i)
    const jmin = snap0(left.j), jmax = snapS(right.j)
    // flip/rotate for standard position
    const need_flip_p = (kmin, kmax) => (kmin < size - kmax - 1)
    const flip_spec = (imin < jmin) ? [false, false, true] :
          // don't mix flip and swap (FF = SS = identity, but SFSF != identity)
          [need_flip_p(imin, imax), need_flip_p(jmin, jmax), false]
    if (flip_spec.find(truep)) {
        const flip = ss => flip_stones(ss, flip_spec)
        const fill = ss => tsumego_frame_stones(ss, komi, black_to_play_p, ko_p)
        return flip(fill(flip(stones)))
    }
    // put outside stones
    const end = size - 1, margin = 2
    const i0 = imin - margin, i1 = imax + margin, j0 = jmin - margin, j1 = jmax + margin
    const frame_range = [i0, i1, j0, j1]
    const black_to_attack_p = guess_black_to_attack([top, bottom, left, right], size)
    put_border(stones, size, frame_range, black_to_attack_p)
    put_outside(stones, size, frame_range, black_to_attack_p, black_to_play_p, komi)
    put_ko_thread(stones, size, frame_range, black_to_attack_p, black_to_play_p, ko_p)
    return stones
}

function guess_black_to_attack(extrema, size) {
    const height = k => size - Math.abs(k - (size - 1) / 2)
    const height2 = z => height(z.i) + height(z.j)
    return sum(extrema.map(z => (z.black ? 1 : -1) * height2(z))) > 0
}

//////////////////////////////////////
// sub

function put_border(stones, size, frame_range, is_black) {
    const [i0, i1, j0, j1] = frame_range
    const ij_for = (k, at, reverse_p) => reverse_p ? [at, k] : [k, at]
    const put = (k, at, reverse_p) =>
          put_stone(stones, size, ...ij_for(k, at, reverse_p), is_black)
    const put_line = (from, to, at, reverse_p) =>
          seq_from_to(from, to).forEach(k => put(k, at, reverse_p))
    const put_twin = (from, to, at0, at1, reverse_p) =>
          [at0, at1].map(at => put_line(from, to, at, reverse_p))
    put_twin(i0, i1, j0, j1, false); put_twin(j0, j1, i0, i1, true)
}

function put_outside(stones, size, frame_range,
                     black_to_attack_p, black_to_play_p, komi) {
    let count = 0
    const offence_to_win = 5, offense_komi = (black_to_attack_p ? 1 : -1) * komi
    const defense_area = (size * size - offense_komi - offence_to_win) / 2
    const black_p = () => xor(black_to_attack_p, (++count <= defense_area))
    const put = (i, j) => !inside_p(i, j, frame_range) &&
          put_stone(stones, size, i, j, black_p(), (i + j) % 2 === 0)
    const [is, js] = seq(2).map(_ => seq_from_to(0, size - 1))
    is.forEach(i => js.forEach(j => put(i, j)))
}

// standard position:
// ? = problem, X = offense, O = defense
// OOOOOOOOOOOOO
// OOOOOOOOOOOOO
// OOOOOOOOOOOOO
// XXXXXXXXXXXXX
// XXXXXXXXXXXXX
// XXXX.........
// XXXX.XXXXXXXX
// XXXX.X???????
// XXXX.X???????

// [pattern, top_p, left_p]
const offense_ko_thread = [`
....OOOX.
.....XXXX
`, true, false]
const defense_ko_thread = [`
..
..
X.
XO
OO
.O
`, false, true]

// // more complicated ko threads
// const offense_ko_thread = [`
// ..OOX.
// ...XXX
// ......
// ......
// `, true, false]
// const defense_ko_thread = [`
// ....
// ....
// X...
// XO..
// OO..
// .O..
// `, false, true]

function put_ko_thread(stones, size, frame_range,
                       black_to_attack_p, black_to_play_p, ko_p) {
    const for_offense_p = xor(ko_p, xor(black_to_attack_p, black_to_play_p))
    const [pattern, top_p, left_p] = for_offense_p ?
          offense_ko_thread : defense_ko_thread
    const aa = pattern.split(/\n/).filter(identity).map(s => s.split(''))
    const width = aa[0].length, height = aa.length
    const put =  (ch, i, j) => {
        if (inside_p(i, j, frame_range)) {return}
        const conv = ([k, normal_p, len]) => (normal_p ? 0 : size - len) + k
        const ij = [[i, top_p, height], [j, left_p, width]].map(conv)
        const black = xor(black_to_attack_p, ch === 'O'), empty = (ch === '.')
        put_stone(stones, size, ...ij, black, empty)
    }
    aa_each(aa, put)
}

//////////////////////////////////////
// util

function flip_stones(stones, flip_spec) {
    const new_stones = [[]], new_ij = ij_flipper(...flip_spec)
    aa_each(stones, (z, ...ij) => aa_set(new_stones, ...new_ij(ij), z))
    return new_stones
}

function put_stone(stones, size, i, j, black, empty) {
    if (i < 0 || size <= i || j < 0 || size <= j) {return}
    aa_set(stones, i, j, empty ? {} : {tsumego_frame: true, black})
}

function inside_p(i, j, [i0, i1, j0, j1]) {
    return clip(i, i0, i1) === i && clip(j, j0, j1) === j
}

function seq_from_to(from, to) {return (from > to) ? [] : seq(to - from + 1, from)}

//////////////////////////////////////
// exports

module.exports = {
    tsumego_frame,
}
