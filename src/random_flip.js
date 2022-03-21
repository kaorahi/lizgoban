'use strict'

// frontend

function random_flip_rotation(history) {
    return transform(history, coin_toss(), coin_toss(), coin_toss())
}

function horizontal_flip(history) {return transform(history, false, true, false)}
function vertical_flip(history) {return transform(history, true, false, false)}
function clockwise_rotation(history) {return transform(history, true, false, true)}
function counterclockwise_rotation(history) {return transform(history, false, true, true)}
function half_turn(history) {return transform(history, true, true, false)}

// backend

function transform(history, ...spec) {return convert(ij_flipper(...spec), history)}

function ij_flipper(flip_i, flip_j, swap_ij) {
    const fl = (k, bool) => bool ? (board_size() - 1 - k) : k
    const sw = (i, j, bool) => bool ? [j, i] : [i, j]
    return ([i, j]) => sw(fl(i, flip_i), fl(j, flip_j), swap_ij)
}

function convert(f, history) {
    const conv1 = ({move, is_black, move_count}) => {
        const ij = move2idx(move), pass = !idx2move(...ij)
        return {is_black, move_count, move: (pass ? move : idx2move(...f(ij)))}
    }
    return history.map(conv1)
}

function coin_toss() {return Math.random() < 0.5}

module.exports = {
    random_flip_rotation, horizontal_flip, vertical_flip,
    clockwise_rotation, counterclockwise_rotation, half_turn,
    ij_flipper,
}
