// coordinates converter

// idx [i][j] of array: [0][0] = left top, [0][18] = right top
// coord (x, y) on canvas: (0, 0) = left top, (width, 0) = right top
// move: "A19" = left top, "T19" = right top

const col_name = 'ABCDEFGHJKLMNOPQRST'
const board_size = col_name.length

function idx2move(i, j) {return col_name[j] + (board_size - i)}

function move2idx(move) {
    let [_, col, row] = move.match(/([A-HJ-T])((1[0-9])|[1-9])/)
    return [board_size - to_i(row), col_name.indexOf(col)]
}

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

module.exports = {
    idx2move: idx2move,
    move2idx: move2idx,
    idx2coord_translator_pair: idx2coord_translator_pair,
    board_size: board_size,
}
