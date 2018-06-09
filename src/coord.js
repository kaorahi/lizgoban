// coordinates converter

// idx [i][j] of array: [0][0] = left top, [0][18] = right top
// coord (x, y) on canvas: (0, 0) = left top, (width, 0) = right top
// move: "A19" = left top, "T19" = right top
// sgfpos: "aa" = left top, "sa" = right top

const {to_i, to_f, xor, clone, merge, flatten, each_key_value, array2hash, seq, do_ntimes}
      = require('./util.js')

/////////////////////////////////////////////////
// idx <=> move

const col_name = 'ABCDEFGHJKLMNOPQRST'
const board_size = col_name.length

function idx2move(i, j) {
    return (0 <= i) && (i < board_size) && (0 <= j) && (j < board_size) &&
        col_name[j] + (board_size - i)
}

function move2idx(move) {
    // return [] if move is pass
    let m = move.match(/([A-HJ-T])((1[0-9])|[1-9])/), [dummy, col, row] = m || []
    return m ? [board_size - to_i(row), col_name.indexOf(col)] : []
}

/////////////////////////////////////////////////
// idx <=> coord

function translator_pair([from1, from2], [to1, to2]) {
    // [from1, from2] * scale + [shift, shift] = [to1, to2]
    let d = from2 - from1, scale = (to2 - to1) / d, shift = (from2 * to1 - from1 * to2) / d
    let trans = (x => x * scale + shift), inv = (z => (z - shift) / scale)
    return [trans, inv]
}

function idx2coord_translator_pair(canvas, xmargin, ymargin) {
    let [xtrans, xinv] = translator_pair([0, board_size - 1], [xmargin, canvas.width - xmargin])
    let [ytrans, yinv] = translator_pair([0, board_size - 1], [ymargin, canvas.height - ymargin])
    return [((i, j) => [xtrans(j), ytrans(i)]),
            ((x, y) => [Math.round(yinv(y)), Math.round(xinv(x))])]
}

/////////////////////////////////////////////////
// sgfpos (<=> idx) <=> move

const sgfpos_name = "abcdefghijklmnopqrs"

function idx2sgfpos(i, j) {
    return sgfpos_name[j] + sgfpos_name[i]
}

function sgfpos2idx(pos) {
    const [j, i] = pos.split('').map(c => sgfpos_name.indexOf(c))
    return [i, j]
}

function move2sgfpos(move) {
    return idx2sgfpos(...move2idx(move))
}

function sgfpos2move(pos) {
    return idx2move(...sgfpos2idx(pos))
}

module.exports = {
    idx2move, move2idx, idx2coord_translator_pair, board_size, sgfpos2move, move2sgfpos,
}
