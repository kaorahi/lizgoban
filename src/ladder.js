'use strict'

const {has_liberty} = require('./rule.js')

const too_short = 5

// wrap into array for convenience

let last_ladder_branches = [], last_ladder_prop = null, last_seen_ladder_prop = null
function set_last_ladder_branches(bs) {return last_ladder_branches = bs}

function ladder_branches(game, stones) {
    const orig_ladder = succeeding_ladder(game, stones)
    const ladder = orig_ladder ||
          try_ladder(null, last_seen_ladder_prop, game.move_count, stones)
    if (!ladder) {return set_last_ladder_branches([])}
    last_ladder_prop = ladder && ladder.prop
    const {moves} = ladder, ladder_game = game.shallow_copy()
    ladder_game.delete_future()
    ladder_game.trial = true
    const pre_ladder_moves = orig_ladder ? [] :
          missing_moves(stones, last_seen_ladder_prop)
    const extended_moves = [...pre_ladder_moves, ...moves]
    extended_moves.forEach(m => ladder_game.push(m))
    !orig_ladder && record_hit(extended_moves, [-1, -1])  // hide branch mark
    return set_last_ladder_branches([ladder_game])
}

function missing_moves(cur_stones, prop) {
    // .......
    // ...X...
    // ..XOX..
    // ..XO...   ? = in_ladder_quadrant
    // ...????
    // ...????
    const {idx, u, v, stones} = prop
    const [i0, j0] = idx, [i_sign, j_sign] = idx_plus(u, v)
    const front = (k, k0, sign) => (k - k0) * sign >= 0
    const in_ladder_quadrant = (i, j) => front(i, i0, i_sign) && front(j, j0, j_sign)
    const missing = (h, i, j) => !in_ladder_quadrant(i, j) &&
          h && h.stone && !(aa_ref(cur_stones, i, j) || {}).stone
    const move_for = (h, i, j) => ({
        move: idx2move(i, j), is_black: h.black, move_count: h.move_count
    })
    const pick = (h, i, j) => missing(h, i, j) && move_for(h, i, j)
    const unsorted_moves = aa_map(stones, pick).flat().filter(truep)
    return sort_by_key(unsorted_moves, 'move_count')
}

function ladder_is_seen() {last_seen_ladder_prop = last_ladder_prop}

//////////////////////////////////////
// ladder

function new_ladder(prop) {return {moves: [], prop}}

function new_prop(idx, is_black, attack_p, u, v, stones) {
    return {idx, is_black, attack_p, u, v, stones}
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
    const matched = check_pattern_around(e_idx, escape_pattern, escape_liberty_pattern,
                                         recent_two_moves, stones, u, v)
    const prop = new_prop(next_idx, escape_move.is_black, false, u, v, stones)
    return matched && try_ladder(null, prop, move_count, stones)
}

function try_to_capture(recent_two_moves, [a_idx, e_idx], move_count, stones) {
    const [attack_move, escape_move] = recent_two_moves
    const dame = dame_around(e_idx, stones)
    const keima = dame.filter(ij => keima_p(ij, a_idx))
    const valid = kosumi_p(e_idx, a_idx) && (dame.length === 2) && (keima.length === 1)
    if (!valid) {return null}
    const [next_idx] = keima
    const u = idx_minus(next_idx, e_idx), v = idx_plus(idx_minus(a_idx, e_idx), u)
    const matched = check_pattern_around(e_idx, attack_pattern, attack_liberty_pattern,
                                         recent_two_moves, stones, u, v)
    const prop = new_prop(next_idx, attack_move.is_black, true, u, v, stones)
    return matched && try_ladder(null, prop, move_count, stones)
}

function try_ladder(ladder, prop, move_count, stones) {
    if (!prop) {return null}
    const {idx, is_black, attack_p, u, v} = prop
    const {moves} = ladder || (ladder = new_ladder(prop))
    const hit = stopped(idx, is_black, u, v, stones)
    if (hit) {return moves.length <= too_short ? null : (record_hit(moves, hit), ladder)}
    ladder.moves.push({move: idx2move(...idx), is_black, move_count})
    const [offset, next_uv] = attack_p ? [idx_minus(v, u), [u, v]] : [v, [v, u]]
    const next_idx = idx_plus(idx, offset)
    const next_prop = new_prop(next_idx, !is_black, !attack_p, ...next_uv, stones)
    return try_ladder(ladder, next_prop, move_count + 1, stones)
}

function stopped(idx, is_black, u, v, stones) {
    const offsets = [idx_plus(u, v), u, v]
    const opponent_or_border = d =>
          color_stone_or_border(idx_plus(idx, d), !is_black, stones)
    return stone_or_border(idx, stones) || offsets.map(opponent_or_border).find(truep)
}

function record_hit(moves, idx) {
    merge(moves[0], {ladder_hit: idx2move(...idx) || 'nowhere', tag: ladder_tag_letter})
}

//////////////////////////////////////
// pattern match

// (in pattern)
// 1, 2: recent two moves
// 3: next move (not used at present)
// X, O: same color stone as 1, 2, respectively
// .: empty
// S, x, o: "X or O", "X or .", "O or ."
// ?: don't care

// (in liberty pattern)
// a, b: at most 1, 2 liberties
// 2, 3: at least 2, 3 liberties
// ?: don't care

// each position in 3x3 pattern corresponds to p u + q v for (p, q) = ...
//   (-1,-1) (-1,0) (-1,1)
//   (0,-1) (0,0) (0,1)
//   (1,-1) (1,0) (1,1)

function split_pattern(pat) {
    return pat.split("\n").filter(identity).map(s => s.split(""))
}

const attack_pattern = split_pattern(`
SO1
X2.
x3.
`)

const attack_liberty_pattern = split_pattern(`
??3
2b?
???
`)

const escape_pattern = split_pattern(`
SXO
O13
o2.
`)

const escape_liberty_pattern = split_pattern(`
??3
2a?
???
`)

function check_pattern_around(idx, pattern, liberty_pattern, recent_two_moves,
                              stones, u, v) {
    const [m1, m2] = recent_two_moves
    const [color1, color2] = recent_two_moves.map(m => m.is_black)
    const ij_from_offset = (p, q) =>
          idx_plus(idx, idx_plus(idx_mul(p, u), idx_mul(q, v)))
    const ij_from_ab = (a, b) => ij_from_offset(a - 1, b - 1)
    const check = (c, a, b) => {
        const ij = ij_from_ab(a, b), move = idx2move(...ij)
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
        case '.': case '3': return !stone
        case '?': return true
        }
    }
    const check_liberty = (c, a, b) => {
        const ij = ij_from_ab(a, b), has = k => has_liberty(ij, stones, k)
        switch (c) {
        case 'a': return !has(2)
        case 'b': return !has(3)
        case '2': return has(2)
        case '3': return has(3)
        case '?': return true
        }
    }
    const match_p = (pat, chk) => aa_map(pat, chk).flat().every(truep)
    return match_p(pattern, check) && match_p(liberty_pattern, check_liberty)
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
    ladder_is_seen,
    last_ladder_branches: () => last_ladder_branches,
}
