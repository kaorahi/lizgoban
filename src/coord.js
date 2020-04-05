// coordinates converter

// idx [i][j] of array: [0][0] = left top, [0][18] = right top
// coord (x, y) on canvas: (0, 0) = left top, (width, 0) = right top
// move: "A19" = left top, "T19" = right top
// sgfpos: "aa" = left top, "sa" = right top

/////////////////////////////////////////////////
// board_size

// Caution: need to call set_board_size in *each* process

let the_board_size = 19
function board_size() {return the_board_size}
function set_board_size(n) {the_board_size = n}

function with_board_size(bsize, proc, ...args) {
    const previous = board_size(); set_board_size(bsize)
    const ret = proc(...args); set_board_size(previous); return ret
}

/////////////////////////////////////////////////
// idx <=> move

const col_name = 'ABCDEFGHJKLMNOPQRST'
const idx_pass = [-1, -1]
const stars = {
    19: [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]],
    13: [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]],
    9: [[4,4]],
}

function idx2rowcol(i, j) {
    const bsize = board_size()
    return (0 <= i) && (i < bsize) && (0 <= j) && (j < bsize) ?
        [to_s(bsize - i), col_name[j]] : [null, null]
}

function idx2move(i, j) {
    const [row, col] = idx2rowcol(i, j); return truep(row) && (col + row)
}

function move2idx(move) {
    const m = move.match(/([A-HJ-T])((1[0-9])|[1-9])/), [dummy, col, row] = m || []
    return m ? [board_size() - to_i(row), col_name.indexOf(col)] : idx_pass
}

/////////////////////////////////////////////////
// idx <=> coord

function translator_pair([from1, from2], [to1, to2]) {
    // [from1, from2] * scale + [shift, shift] = [to1, to2]
    const d = from2 - from1, scale = (to2 - to1) / d, shift = (from2 * to1 - from1 * to2) / d
    const trans = (x => x * scale + shift), inv = (z => (z - shift) / scale)
    return [trans, inv]
}

function idx2coord_translator_pair(canvas, xmargin, ymargin, is_square) {
    // u = j, v = i
    const [uv2xy, xy2uv] =
          uv2coord_translator_pair(canvas, [0, board_size() - 1], [0, board_size() - 1],
                                   xmargin, ymargin, is_square)
    return [((i, j) => uv2xy(j, i)), ((x, y) => xy2uv(x, y).reverse())]
}

function uv2coord_translator_pair(canvas, u_min_max, v_min_max, xmargin, ymargin,
                                  is_square) {
    // u: horizontal, v: vertical
    let w = canvas.width, h = canvas.height
    is_square && (w = h = Math.min(w, h))
    const [xtrans, xinv] = translator_pair(u_min_max, [xmargin, w - xmargin])
    const [ytrans, yinv] = translator_pair(v_min_max, [ymargin, h - ymargin])
    const to = (u, v) => [xtrans(u), ytrans(v)]
    const from = (x, y) => [Math.round(xinv(x)), Math.round(yinv(y))]
    return [to, from]
}

/////////////////////////////////////////////////
// sgfpos (<=> idx) <=> move

// https://www.red-bean.com/sgf/go.html
// A pass move is shown as '[]' or alternatively as '[tt]' (only for boards <= 19x19)

const sgfpos_name = "abcdefghijklmnopqrs"
const sgfpos_pass = "tt", sgfpos_pass_FF4 = ""

function idx2sgfpos(i, j) {
    return sgfpos_name[j] + sgfpos_name[i]
}

function sgfpos2idx(pos) {
    if (pos === sgfpos_pass || pos === sgfpos_pass_FF4) {return idx_pass}
    const [j, i] = pos.split('').map(c => sgfpos_name.indexOf(c))
    return [i, j]
}

function move2sgfpos(move) {
    // pass = 'tt'
    const [i, j] = move2idx(move)
    return i >= 0 ? idx2sgfpos(i, j) : sgfpos_pass
}

function sgfpos2move(pos) {
    return idx2move(...sgfpos2idx(pos))
}

module.exports = {
    idx2rowcol,
    idx2move, move2idx, idx2coord_translator_pair, uv2coord_translator_pair,
    translator_pair,
    board_size, set_board_size, with_board_size, sgfpos2move, move2sgfpos, stars,
}
