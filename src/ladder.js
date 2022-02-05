'use strict'

const {has_liberty} = require('./rule.js')

const too_short = 5

// wrap into array for convenience

let last_ladder_branches = [], last_ladder_prop = null, last_seen_ladder_prop = null
function set_last_ladder_branches(bs) {return last_ladder_branches = bs}

function ladder_branches(game, stones) {
    const orig_ladder = succeeding_ladder(game, stones)
    const ladder = orig_ladder ||
          try_ladder(last_seen_ladder_prop, game.move_count, stones)
    if (!ladder) {return set_last_ladder_branches([])}
    last_ladder_prop = ladder.prop
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
    const move_for = (h, i, j) => make_ladder_move(i, j, h.black, h.move_count)
    const pick = (h, i, j) => missing(h, i, j) && move_for(h, i, j)
    const unsorted_moves = aa_map(stones, pick).flat().filter(truep)
    return sort_by_key(unsorted_moves, 'move_count')
}

function make_ladder_move(i, j, is_black, move_count) {
    return {move: idx2move(i, j), is_ladder_move: true, is_black, move_count}
}

function cancel_ladder_hack(game) {
    game.forEach((h, k) => {
        if (!h.is_ladder_move) {return}
        delete h.is_ladder_move
        delete h.ladder_hit
        h.move_count = k + 1
        h.tag && (h.tag = h.tag.replace(ladder_tag_letter, game.new_tag_maybe(true, null)))
    })
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
    const args = [last(recent_two_moves), move_count + 1, stones]
    return try_to_escape(...args) || try_to_capture(...args)
}

function try_to_escape(recent_move, move_count, stones) {
    return try_to_escape_or_capture(recent_move, move_count, stones,
                                    escape_pattern, escape_liberty_pattern, false)
}
function try_to_capture(recent_move, move_count, stones) {
    return try_to_escape_or_capture(recent_move, move_count, stones,
                                    attack_pattern, attack_liberty_pattern, true)
}
function try_to_escape_or_capture(recent_move, move_count, stones,
                                  pattern, liberty_pattern, attack_p) {
    const matched = match_pattern(recent_move, pattern, liberty_pattern, stones)
    if (!matched) {return null}
    const [uv, next_idx] = matched
    const prop = new_prop(next_idx, !recent_move.is_black, attack_p, ...uv, stones)
    return try_ladder(prop, move_count, stones)
}

function try_ladder(prop, move_count, stones) {
    if (!prop) {return null}
    return continue_ladder(new_ladder(prop), prop, move_count, stones)
}
function continue_ladder(ladder, prop, move_count, stones) {
    const {idx, is_black, u, v} = prop
    const {moves} = ladder
    const hit = stopped(idx, is_black, u, v, stones)
    if (hit) {return moves.length <= too_short ? null : (record_hit(moves, hit), ladder)}
    ladder.moves.push(make_ladder_move(...idx, is_black, move_count))
    return continue_ladder(ladder, next_prop(prop, stones), move_count + 1, stones)
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

function next_prop(prop, stones) {
    const {idx, is_black, attack_p, u, v} = prop
    const [offset, next_uv] = attack_p ? [idx_minus(v, u), [u, v]] : [v, [v, u]]
    const next_idx = idx_plus(idx, offset)
    return new_prop(next_idx, !is_black, !attack_p, ...next_uv, stones)
}

//////////////////////////////////////
// pattern match

// (in pattern)
// 1, 2: recent two moves (1 can be a past move actually)
// 3: next move
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
?S1
X2.
x3.
`)

const attack_liberty_pattern = split_pattern(`
??3
2b?
???
`)

const escape_pattern = split_pattern(`
?SO
S13
?2?
`)

const escape_liberty_pattern = split_pattern(`
??3
?a?
?3?
`)

// (bug) This @ is detected as a ladder move.
// XOO
// OX.
// X@.
// (;SZ[19]KM[6.5];B[dd];W[ed];B[ec];W[dc];B[de];W[eb];B[fd])

const uv_candidates = seq(8).map(k => {
    const [flip_u, flip_v, swap_uv] = [1, 2, 4].map(mask => mask & k)
    const sign = flip => flip ? +1 : -1
    const u = [sign(flip_u), 0], v = [0, sign(flip_v)]
    return swap_uv ? [v, u] : [u, v]
})

function match_pattern(recent_move, pattern, liberty_pattern, stones) {
    const {move, is_black} = recent_move
    const recent_move_idx = move2idx(move), recent_move_color = is_black
    const shift_pq = idx_mul(-1, get_pattern_offset(pattern, '2'))
    const hit_p = uv =>
          match_pattern_sub(recent_move_idx, recent_move_color, shift_pq, uv,
                            pattern, liberty_pattern, stones)
    const found_uv = uv_candidates.find(hit_p); if (!found_uv) {return null}
    const next_offset = idx_plus(shift_pq, get_pattern_offset(pattern, '3'))
    const next_idx = ij_plus_pq(recent_move_idx, next_offset, found_uv)
    return [found_uv, next_idx]
}

function match_pattern_sub(recent_move_idx, recent_move_color, shift_pq, uv,
                           pattern, liberty_pattern, stones) {
    const color2 = recent_move_color, color1 = !color2
    const pattern_center_idx = ij_plus_pq(recent_move_idx, shift_pq, uv)
    const ij_from_ab = (a, b) => ij_plus_pq(pattern_center_idx, [a - 1, b - 1], uv)
    const check = (c, a, b) => {
        const ij = ij_from_ab(a, b)
        const h = aa_ref(stones, ...ij); if (!h) {return false}
        const {stone, black} = h
        const [is_color1, is_color2] = [color1, color2].map(col => !xor(black, col))
        switch (c) {
        case 'X': case '1': return stone && is_color1
        case 'O': case '2': return stone && is_color2
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

function get_pattern_offset(pattern, letter) {
    const scanned = aa_map(pattern, (z, a, b) => (z === letter) && [a, b])
    return scanned.flat().find(truep).map(k => k - 1)
}

function ij_plus_pq(ij, [p, q], [u, v]) {
    return idx_plus(ij, idx_plus(idx_mul(p, u), idx_mul(q, v)))
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
// function idx_diff(a, b) {return idx_minus(a, b).map(Math.abs)}
// function idx_eq(a, b) {return !idx_diff(a, b).some(identity)}
function idx_eq(a, b) {return idx_trans_map(a, b, (p, q) => p === q).every(identity)}

// internal

function idx_trans_map(a, b, f) {return aa_transpose([a, b]).map(ary => f(...ary))}

//////////////////////////////////////
// exports

module.exports = {
    ladder_branches,
    ladder_is_seen,
    last_ladder_branches: () => last_ladder_branches,
    cancel_ladder_hack,
}
