'use strict'

function get_amb_gain(game) {
    const ambiguity_gain = get_amb_gain_sub(h => h.stone_entropy, ['stone_entropy'], game)
    const moyolead_gain = get_moyolead_gain(game)
    return {ambiguity_gain, moyolead_gain}
}

function get_amb_gain_sub(f, keys, game) {
    // "recent" should be an even number so that the opponent's values
    // are kept unchanged.
    const recent = 50
    const weight_for = distance => 1 + Math.cos(Math.PI * distance / recent)
    const {move_count} = game
    const from = Math.max(game.init_len, move_count - recent)
    const rev = seq_from_to(from, move_count).toReversed().map(game.ref)
          .map(h => pick_keys(h, ...keys, 'move_count', 'is_black'))
    rev.map(f).forEach((z, k, a) => rev[k].gain = z - a[k + 1])
    return aa2hash([true, false].map(is_black => {
        const color_p = h => !xor(h.is_black, is_black)
        const hs = rev.filter(color_p).filter(h => truep(h.gain))
        const weights = hs.map(h => weight_for(hs[0].move_count - h.move_count))
        const average_gain = weighted_average(hs.map(h => h.gain), weights)
        return [is_black, average_gain]
    }))
}

function get_moyolead_gain(game) {
    const bmg = get_black_moyolead_gain(game)
    const b = bmg[true], w = bmg[false]
    return {true: b, false: - w}
}

function get_black_moyolead_gain(game) {
    const keys = [
        'black_settled_territory', 'white_settled_territory', 'score_without_komi'
    ]
    const f = h => (h.score_without_komi - game.komi)
          - (h.black_settled_territory - h.white_settled_territory)
    return get_amb_gain_sub(f, keys, game)
}

/////////////////////////////////////////////////
// exports

module.exports = {
    get_amb_gain,
}
