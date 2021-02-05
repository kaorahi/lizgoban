'use strict'

//////////////////////////////////////
// exports

let exercise_mtime

module.exports = (...a) => {
    [exercise_mtime] = a
    return {
        exercise_filename,
        is_exercise_filename,
        exercise_move_count,
        exercise_board_size,
        update_exercise_metadata_for,
        get_all_exercise_metadata: get_metadata,
        random_exercise_chooser,
        recent_exercise_chooser,
        recently_seen_exercises_in,
    }
}

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

const log_length_per_exercise = 2

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
// chooser

function random_exercise_chooser(a, metadata)  {
    const coin_toss = (Math.random() < 0.5)
    const prefer_recent = coin_toss ? 0 : 0.1, prefer_stars = Math.log(2)
    const recently_seen = fn => {
        const last_seen = ((metadata[fn] || {}).seen_at || [])[0]
        return - new Date(last_seen || exercise_mtime(fn))
    }
    const sorted = sort_by(a, recently_seen)
    const weight_of = (fn, k) => {
        const {stars} = metadata[fn] || {}
        const preferred = prefer_recent * (- k) + prefer_stars * (stars || 0)
        return Math.exp(preferred)
    }
    return weighted_random_choice(sorted, weight_of)
}

function recent_exercise_chooser(a) {
    const neg_mtime = fn => - exercise_mtime(fn)
    return min_by(a, neg_mtime)
}

/////////////////////////////////////////////////
// seen

function recently_seen_exercises_in(exercises, metadata, hours) {
    const now = new Date(), ms_in_h = 60 * 60 * 1000, recent = hours * ms_in_h
    const recent_p = fn => {
        const last_seen = ((metadata[fn] || {}).seen_at || [])[0]
        return (now - new Date(last_seen || 0) < recent)
    }
    return exercises.filter(recent_p)
}
