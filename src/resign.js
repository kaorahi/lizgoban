'use strict'

// Copied parameters from
// https://github.com/lightvector/KataGo/blob/v1.15.3/cpp/configs/gtp_human5k_example.cfg
const resign_threshold = 0.005
const resign_consec_turns = 20
const resign_min_score_difference = 40
const resign_min_moves_per_board_area = 0.4

const the_winrate_records = {true: [], false: []}

function get_record(bturn) {return the_winrate_records[!!bturn]}

function record_winrate(bturn, game, my_winrate) {
    const record = get_record(bturn)
    const head = record[0], cur = game.ref_current()
    head?.[0] === cur && record.shift()  // safety for duplicated call
    record.unshift([cur, my_winrate])  // record cur only for identity check
    record.splice(resign_consec_turns)
}

function is_record_hopeless(bturn, game) {
    const record = get_record(bturn)
    const hopeless = ([node, my_winrate], k) => {
        return game.ref(game.move_count - k * 2) === node &&
            my_winrate < 100 * resign_threshold
    }
    return record.length >= resign_consec_turns &&
        record.every(hopeless)
}

function should_resign_p(game, R) {
    const {bturn, b_winrate, score_without_komi, komi} = R
    if (!truep(b_winrate)) {return false}
    const score = true_or(score_without_komi, NaN) - komi
    const my_winrate = bturn ? b_winrate : 100 - b_winrate
    const my_score = !truep(score) ? - Infinity : bturn ? score : - score
    record_winrate(bturn, game, my_winrate)
    return is_record_hopeless(bturn, game) &&
        (my_score <= - resign_min_score_difference) &&
        game.movenum() >= game.board_size**2 * resign_min_moves_per_board_area
}

///////////////////////////////////////////////
// exports

module.exports = {
    should_resign_p,
}
