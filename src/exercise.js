'use strict'

const exercise_format = {pre: 'exercise', sep: '_', post: '.sgf'}
function exercise_filename(game, format) {
    const {pre, sep, post} = format || exercise_format
    const mc = to_s(game.move_count).padStart(3, '0')
    const ti = (new Date()).toJSON().replace(/:/g, '') // cannot use ":" in Windows
    return `${pre}${board_size()}${sep}${ti}${sep}${mc}${post}`
}
function is_exercise_filename(filename) {
    const {pre, sep, post} = exercise_format
    return filename.startsWith(pre) && filename.endsWith(post)
}
function exercise_move_count(filename) {
    const {pre, sep, post} = exercise_format
    return to_i(last(filename.split(sep)).split(post)[0])
}
function exercise_board_size(filename) {
    const {pre, sep, post} = exercise_format
    return to_i(filename.split(sep)[0].split(pre)[1] || 19)
}

/////////////////////////////////////////////////
// exports

module.exports = {
    exercise_filename,
    is_exercise_filename,
    exercise_move_count,
    exercise_board_size,
}
