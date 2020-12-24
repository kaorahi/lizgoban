'use strict'

const too_short = 5

// wrap into array for convenience

let last_ladder_branches = []
function set_last_ladder_branches(bs) {return last_ladder_branches = bs}

function ladder_branches(game, stones) {
    const moves = succeeding_ladder_moves(game, stones)
    if (!moves) {return set_last_ladder_branches([])}
    const ladder_game = game.shallow_copy()
    ladder_game.delete_future()
    ladder_game.trial = true
    moves.forEach(m => ladder_game.push(m))
    return set_last_ladder_branches([ladder_game])
}

//////////////////////////////////////
// main

function succeeding_ladder_moves(game, stones) {
    const {move_count} = game
    const recent_two_moves = game.array_until(move_count).slice(-2)
    const valid = (recent_two_moves.length === 2) && recent_two_moves.every(truep) &&
          xor(...recent_two_moves.map(m => m.is_black))
    if (!valid) {return null}
    const indices = recent_two_moves.map(m => move2idx(m.move))
    const args = [recent_two_moves, indices, move_count + 1, stones]
    return moves_to_escape(...args) || moves_to_capture(...args)
}

function moves_to_escape([escape_move, attack_move], [e_idx, a_idx], move_count, stones) {
    const dame = dame_around(e_idx, stones)
    const valid = touch_p(e_idx, a_idx) && (dame.length === 1)
    if (!valid) {return null}
    const [next_idx] = dame
    const u = idx_minus(a_idx, e_idx), v = idx_minus(next_idx, e_idx)
    return try_next([], next_idx, move_count, escape_move.is_black, false, u, v, stones)
}

function moves_to_capture([attack_move, escape_move], [a_idx, e_idx], move_count, stones) {
    const dame = dame_around(e_idx, stones)
    const keima = dame.filter(ij => keima_p(ij, a_idx))
    const valid = kosumi_p(e_idx, a_idx) && (dame.length === 2) && (keima.length === 1)
    if (!valid) {return null}
    const [next_idx] = keima
    const u = idx_minus(next_idx, e_idx), v = idx_plus(idx_minus(a_idx, e_idx), u)
    return try_next([], next_idx, move_count, attack_move.is_black, true, u, v, stones)
}

function try_next(ret, idx, move_count, is_black, attack_p, u, v, stones) {
    const hit = stopped(idx, is_black, u, v, stones), tag = ladder_tag_letter
    if (hit) {
        return ret.length <= too_short ? null : (merge(ret[0], {ladder_hit: idx2move(...hit), tag}), ret)
    }
    const next_ret = [...ret, {move: idx2move(...idx), is_black, move_count}]
    const [offset, next_uv] = attack_p ? [idx_minus(v, u), [u, v]] : [v, [v, u]]
    const next_idx = idx_plus(idx, offset)
    return try_next(next_ret, next_idx, move_count + 1, !is_black, !attack_p, ...next_uv, stones)
}

function stopped(idx, is_black, u, v, stones) {
    // const offsets = [u, v, idx_plus(u, v)]
    const offsets = [idx_plus(u, v), u, v]
    const opponent_or_border = d =>
          color_stone_or_border(idx_plus(idx, d), !is_black, stones)
    return stone_or_border(idx, stones) || offsets.map(opponent_or_border).find(truep)
}

//////////////////////////////////////
// stone utils

function dame_p(h) {return h && !h.stone}

function stone_or_border(idx, stones) {
    return pred_or_border(idx, stones, h => !h || h.stone)
}
function color_stone_or_border(idx, black, stones) {
    return pred_or_border(idx, stones, h => !h || (h.stone && !xor(h.black, black)))
}

// internal

function pred_or_border([i, j], stones, pred) {
    const inside = 0 < i && i < stones.length - 1 && 0 < j && j < stones[0].length - 1
    return (!inside || pred(aa_ref(stones, i, j))) && [i, j]
}

//////////////////////////////////////
// idx utils

function idx_plus(a, b) {return idx_trans_map(a, b, (p, q) => p + q)}
function idx_minus(a, b) {return idx_trans_map(a, b, (p, q) => p - q)}
function idx_diff(a, b) {return idx_minus(a, b).map(Math.abs)}
function idx_eq(a, b) {return idx_trans_map(a, b, (p, q) => p === q).every(identity)}

function touch_p(a, b) {return is_idx_diff(a, b, [0, 1])}
function kosumi_p(a, b) {return is_idx_diff(a, b, [1, 1])}
function keima_p(a, b) {return is_idx_diff(a, b, [1, 2])}

function dame_around(idx, stones) {
    return around_idx(idx).filter(ij => dame_p(aa_ref(stones, ...ij)))
}

// internal

function idx_trans_map(a, b, f) {return aa_transpose([a, b]).map(ary => f(...ary))}
function is_idx_diff(a, b, diff) {return idx_eq(idx_diff(a, b).sort(), diff)}

//////////////////////////////////////
// exports

module.exports = {
    ladder_branches,
    last_ladder_branches: () => last_ladder_branches,
}
