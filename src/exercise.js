'use strict'

const log_length_per_exercise = 2

/////////////////////////////////////////////////
// file name format

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
// metadata

const stored_exercise_info = new ELECTRON_STORE({name: 'lizgoban_exercise_info'})
function get_metadata() {return stored_exercise_info.get('metadata', {})}
function set_metadata(metadata) {stored_exercise_info.set('metadata', metadata)}
function update_metadata(updater) {
    const md = get_metadata(); updater(md); set_metadata(md); return md
}

function initial_exercise_metadata() {return {stars: 0, seen_at: []}}

function update_exercise_metadata_for(filename, {seen_at, stars}) {
    const updater = metadata => {
        const prop = hash_ref(metadata, filename, initial_exercise_metadata)
        seen_at && prepend_log(hash_ref(prop, 'seen_at', []), seen_at)
        truep(stars) && merge(prop, {stars})
    }
    return update_metadata(updater)[filename]
}

function hash_ref(hash, key, missing) {
    let val = hash[key], valid = (val !== undefined)
    return valid ? val : (hash[key] = functionp(missing) ? missing() : missing)
}

function prepend_log(log, value) {
    log.unshift(value); log.splice(log_length_per_exercise)
}

/////////////////////////////////////////////////
// exports

module.exports = {
    exercise_filename,
    is_exercise_filename,
    exercise_move_count,
    exercise_board_size,
    update_exercise_metadata_for,
    get_all_exercise_metadata: get_metadata,
}
