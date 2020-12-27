'use strict'

const {captured_from} = require('./rule.js')

const too_short = 5

// wrap into array for convenience

let last_ladder_branches = []
function set_last_ladder_branches(bs) {return last_ladder_branches = bs}

function ladder_branches(game, stones) {
    const ladder = succeeding_ladder(game, stones)
    if (!ladder) {return set_last_ladder_branches([])}
    const {moves} = ladder, ladder_game = game.shallow_copy()
    ladder_game.delete_future()
    ladder_game.trial = true
    moves.forEach(m => ladder_game.push(m))
    return set_last_ladder_branches([ladder_game])
}

//////////////////////////////////////
// ladder

function new_ladder(prop) {return {moves: [], prop}}

function new_prop(idx, is_black, attack_p, u, v) {
    return {idx, is_black, attack_p, u, v}
}

//////////////////////////////////////
// main

function succeeding_ladder(game, stones) {
    const {move_count} = game
    const recent_two_moves = game.array_until(move_count).slice(-2)
    const valid = (recent_two_moves.length === 2) && recent_two_moves.every(truep) &&
          xor(...recent_two_moves.map(m => m.is_black))
    if (!valid) {return null}
    const indices = recent_two_moves.map(m => move2idx(m.move))
    const args = [recent_two_moves, indices, move_count + 1, stones]
    return try_to_escape(...args) || try_to_capture(...args)
}

function try_to_escape(recent_two_moves, [e_idx, a_idx], move_count, stones) {
    const [escape_move, attack_move] = recent_two_moves
    const dame = dame_around(e_idx, stones)
    const valid = touch_p(e_idx, a_idx) && (dame.length === 1)
    if (!valid) {return null}
    const [next_idx] = dame
    const u = idx_minus(a_idx, e_idx), v = idx_minus(next_idx, e_idx)
    const matched =
          check_pattern_around(e_idx, escape_pattern, recent_two_moves, stones, u, v)
    const captured_if = is_captured_if(e_idx, next_idx, attack_move.is_black, stones)
    const prop = new_prop(next_idx, escape_move.is_black, false, u, v)
    return matched && captured_if && try_ladder(null, prop, move_count, stones)
}

function try_to_capture(recent_two_moves, [a_idx, e_idx], move_count, stones) {
    const [attack_move, escape_move] = recent_two_moves
    const dame = dame_around(e_idx, stones)
    const keima = dame.filter(ij => keima_p(ij, a_idx))
    const valid = kosumi_p(e_idx, a_idx) && (dame.length === 2) && (keima.length === 1)
    if (!valid) {return null}
    const [next_idx] = keima
    const u = idx_minus(next_idx, e_idx), v = idx_plus(idx_minus(a_idx, e_idx), u)
    const matched =
          check_pattern_around(e_idx, attack_pattern, recent_two_moves, stones, u, v)
    const prev_e_idx = idx_minus(e_idx, u)
    const captured_if = is_captured_if(prev_e_idx, e_idx, attack_move.is_black, stones)
    const prop = new_prop(next_idx, attack_move.is_black, true, u, v)
    return matched && captured_if && try_ladder(null, prop, move_count, stones)
}

function try_ladder(ladder, prop, move_count, stones) {
    const {idx, is_black, attack_p, u, v} = prop
    const {moves} = ladder || (ladder = new_ladder(prop))
    const hit = stopped(idx, is_black, u, v, stones)
    if (hit) {return moves.length <= too_short ? null : (record_hit(moves, hit), ladder)}
    ladder.moves.push({move: idx2move(...idx), is_black, move_count})
    const [offset, next_uv] = attack_p ? [idx_minus(v, u), [u, v]] : [v, [v, u]]
    const next_idx = idx_plus(idx, offset)
    const next_prop = new_prop(next_idx, !is_black, !attack_p, ...next_uv)
    return try_ladder(ladder, next_prop, move_count + 1, stones)
}

function stopped(idx, is_black, u, v, stones) {
    const offsets = [idx_plus(u, v), u, v]
    const opponent_or_border = d =>
          color_stone_or_border(idx_plus(idx, d), !is_black, stones)
    return stone_or_border(idx, stones) || offsets.map(opponent_or_border).find(truep)
}

function record_hit(moves, idx) {
    merge(moves[0], {ladder_hit: idx2move(...idx), tag: ladder_tag_letter})
}

//////////////////////////////////////
// pattern match

// 1, 2: recent two moves
// 3: next move (not used at present)
// X, O: same color stone as 1, 2, respectively
// .: empty
// S, x, o: "X or O", "X or .", "O or ."
// ?: don't care

// each position in 3x3 pattern corresponds to p u + q v for (p, q) = ...
//   (-1,-1) (-1,0) (-1,1)
//   (0,-1) (0,0) (0,1)
//   (1,-1) (1,0) (1,1)

function split_pattern(pat) {
    return pat.replace("3", ".").split("\n").filter(identity).map(s => s.split(""))
}

const attack_pattern = split_pattern(`
SO1
X2.
x3.
`)

const escape_pattern = split_pattern(`
SXO
O13
o2.
`)

function check_pattern_around(idx, pattern, recent_two_moves, stones, u, v) {
    const [m1, m2] = recent_two_moves
    const [color1, color2] = recent_two_moves.map(m => m.is_black)
    const ij_from_offset = (p, q) =>
          idx_plus(idx, idx_plus(idx_mul(p, u), idx_mul(q, v)))
    const check = (c, a, b) => {
        const ij = ij_from_offset(a - 1, b - 1), move = idx2move(...ij)
        const h = aa_ref(stones, ...ij); if (!h) {return false}
        const {stone, black} = h
        const [is_color1, is_color2] = [color1, color2].map(col => !xor(black, col))
        switch (c) {
        case '1': return move === m1.move
        case '2': return move === m2.move
        case 'X': return stone && is_color1
        case 'O': return stone && is_color2
        case 'x': return !stone || is_color1
        case 'o': return !stone || is_color2
        case 'S': return stone
        case '.': return !stone
        case '?': return true
        }
    }
    return aa_map(pattern, check).flat().every(truep)
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

function is_captured_if(stone_idx, move_idx, move_black, stones) {
    const h = aa_ref(stones, ...stone_idx)
    const valid = h && h.stone && xor(h.black, move_black)
    const eq = ij => idx_eq(ij, stone_idx)
    const is_captured = ss => captured_from(stone_idx, !move_black, ss).find(eq)
    return valid && with_temporary_stone(move_idx, move_black, stones, is_captured)
}

// internal

function pred_or_border([i, j], stones, pred) {
    const inside = 0 < i && i < stones.length - 1 && 0 < j && j < stones[0].length - 1
    return (!inside || pred(aa_ref(stones, i, j))) && [i, j]
}

function with_temporary_stone(idx, black, stones, f) {
    const orig = aa_ref(stones, ...idx)
    aa_set(stones, ...idx, {stone:true, black})
    const ret = f(stones)
    aa_set(stones, ...idx, orig)
    return ret
}

//////////////////////////////////////
// idx utils

function idx_plus(a, b) {return idx_trans_map(a, b, (p, q) => p + q)}
function idx_mul(coef, a) {return a.map(z => coef * z)}
// function idx_minus(a, b) {return idx_plus(a, idx_mul(-1, b))}
function idx_minus(a, b) {return idx_trans_map(a, b, (p, q) => p - q)}
function idx_diff(a, b) {return idx_minus(a, b).map(Math.abs)}
// function idx_eq(a, b) {return !idx_diff(a, b).some(identity)}
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
