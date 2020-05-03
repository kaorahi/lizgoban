function tsumego_frame(stones) {
    const size = board_size()
    const ijs = flatten(aa_map(stones, (h, i, j) => h.stone && {i, j, black: h.black}))
          .filter(truep)
    if (empty(ijs)) {return []}
    const top = min_by(ijs, z => z.i), bottom = min_by(ijs, z => - z.i)
    const left = min_by(ijs, z => z.j), right = min_by(ijs, z => - z.j)
    const imin = top.i, imax = bottom.i, jmin = left.j, jmax = right.j
    const end = size - 1, margin = 2
    const i0 = imin - margin, i1 = imax + margin, j0 = jmin - margin, j1 = jmax + margin
    const [left_fill, left_gap]
          = checker_vertical([0, 0], [end, j0], !left.black, true)
    const [right_fill, right_gap]
          = checker_vertical([0, j1], [end, end], right.black, false)
    const [top_fill, top_gap]
          = checker_horizontal([0, jmin], [i0, jmax], !top.black, true)
    const [bottom_fill, bottom_gap]
          = checker_horizontal([i1, jmin], [end, jmax], bottom.black, false)
    const fill = [...left_fill, ...right_fill, ...top_fill, ...bottom_fill]
    const gap = [...left_gap, ...right_gap, ...top_gap, ...bottom_gap]
    return {fill, gap}
}

function seq_from_to(from, to) {return (from > to) ? [] : seq(to - from + 1, from)}

function checker_horizontal([i0, j0], [i1, j1], is_black, middle_p) {
    if (i1 - i0 < 4) {return [[], []]}
    const mid = (i0 + i1) / 2, m = to_i(mid)
    const [a, gap_rows, b] =
          (m === mid) ? [m - 1, [m], m + 1] :
          middle_p ? [m, [m + 1], m + 2] : [m - 1, [m], m + 1]
    const fill = [...checker_rect([i0, j0], [a, j1], is_black),
                  ...checker_rect([b, j0], [i1, j1], !is_black)]
    const gap_for = i => seq_from_to(j0, j1).map(j => [i, j])
    const gap = flatten(gap_rows.map(gap_for))
    return [fill, gap]
}

function checker_vertical ([i0, j0], [i1, j1], is_black, middle_p) {
    const transpose = ([j, i, ...rest]) => [i, j, ...rest]
    const transpose_all = a => a.map(transpose)
    return checker_horizontal([j0, i0], [j1, i1], is_black, middle_p).map(transpose_all)
}

function checker_rect([i0, j0], [i1, j1], is_black) {
    return flatten(seq_from_to(i0, i1).map(i => checker_row(i, j0, j1, is_black)))
        .filter(truep)
}

function checker_row(i, j0, j1, is_black) {
    return seq_from_to(j0, j1).map(j => (i + j) % 2 !== 0 && [i, j, is_black])
}

//////////////////////////////////////
// exports

module.exports = {
    tsumego_frame,
}
