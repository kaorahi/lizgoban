'use strict'

///////////////////////////////////////////////
// main

// public

function select_weak_move(...args) {
    const [move, comment] = parse_commented_move(get_commented_move(...args))
    return [move, prepend_common_comment(move, comment, ...args)]
}

function adjust_weaken_args(weaken_method, weaken_args, adjust_sanity) {
    const copied_args = weaken_args.slice()
    switch (weaken_method) {
    case 'persona':
        overwrite_weaken_args_by_persona(copied_args, adjust_sanity()); break
    }
    return copied_args
}

// private

function get_commented_move(state, weaken_method, weaken_args) {
    const a = [state, ...weaken_args]
    return weaken_method === 'random_candidate' ? weak_move(...a) :
        weaken_method === 'lose_score' ? weak_move_by_score(...a) :
        weaken_method === 'random_opening' ? random_opening_move(...a) :
        weaken_method === 'persona' ? weak_move_by_persona(...a) :
        best_move(...a)
}

function prepend_common_comment(move, comment, state, weaken_method, weaken_args) {
    const {orig_suggest, preset_label_text} = state
    const ai = `by ${AI.engine_info().really_current.preset_label_text}`
    const {order} = orig_suggest.find(s => s.move === move) || {}
    const ord = !truep(order) ? '(outside the candidates)':
          (order > 0) ? `(order = ${order + 1})` : null
    const weak = weaken_method &&
          `[${[weaken_method, ...weaken_args.map(JSON.stringify)].join(' ')}]`
    const join_by = (sep, ...a) => a.filter(identity).join(sep)
    const common_comment = join_by(' ', ai, ord, weak)
    return join_by("\n", common_comment, comment)
}

///////////////////////////////////////////////
// strategy: best move

function best_move(state) {return state.orig_suggest[0].move}

///////////////////////////////////////////////
// strategy: random_opening

function random_opening_move(state) {
    // const
    const {orig_suggest, movenum, random_opening} = state
    const suggest = orig_suggest, param = random_opening
    const p_until = param.prior_until_movenum, r_until = param.random_until_movenum
    const discount = clip(1 - movenum / r_until, 0)
    const best = suggest[0]
    const top_visits = Math.max(...suggest.map(s => s.visits))
    const log = (selected, label, val) => selected !== best && debug_log(`random_opening_move: movenum=${movenum + 1}, order=${selected.order}, ${label}=${JSON.stringify(val)}, visits=${selected.visits}, w_loss=${best.winrate - selected.winrate}, s_loss=${best.scoreMean - selected.scoreMean}`)
    // main
    if (movenum < p_until && best.prior) {
        const selected = weighted_random_choice(suggest, s => s.prior)
        const {move, prior} = selected
        log(selected, 'prior', prior)
        const com = `Play randomly by the policy in the first ${p_until} moves.` +
              ` (policy = ${prior.toFixed(2)})`
        return make_commented_move(move, com)
    }
    if (Math.random() >= discount) {
        const com = (discount <= 0) ? `Play normally after ${r_until} moves.` :
              `Play normally with probability ${(1 - discount).toFixed(2)}.`
        return make_commented_move(best.move, com)
    }
    const admissible = s => {
        if (s === best) {return true}
        const ok = (key, limit, sign) =>
              (best[key] - s[key]) * (sign || 1) < param[limit] * discount
        const o_ok = ok('order', 'max_order', -1)
        const w_ok = ok('winrate', 'winrate_loss')
        const s_ok = !truep(best.scoreMean) || ok('scoreMean', 'score_loss')
        const v_ok = s.visits >= top_visits * param.relative_visits
        return o_ok && w_ok && s_ok && v_ok
    }
    const candidates = suggest.filter(admissible), uniform = () => 1
    const selected = weighted_random_choice(candidates, uniform)
    log(selected, 'candidates', candidates.map(h => h.order))
    const cs = candidates.map(c => c.move).join(','), clen = candidates.length
    const com = (clen === 1) ? 'Only this move is acceptable.' :
          `Select a random move unifromly` +
          ` from ${clen} admissible candidates (${cs}).`
    return make_commented_move(selected.move, com)
}

///////////////////////////////////////////////
// strategy: random_candidate

function weak_move(state, weaken_percent) {
    // (1) Converge winrate to 0 with move counts
    // (2) Occasionally play good moves with low probability
    // (3) Do not play too bad moves
    const {orig_suggest, movenum, orig_winrate} = state
    const r = clip((weaken_percent || 0) / 100, 0, 1)
    const initial_target_winrate = 40 * 10**(- r)
    const target = initial_target_winrate * 2**(- movenum / 100)  // (1)
    const flip_maybe = x => is_bturn() ? x : 100 - x
    const current_winrate = flip_maybe(orig_winrate)
    const u = Math.random()**(1 - r) * r  // (2)
    const next_target = current_winrate * (1 - u) + target * u  // (3)
    const {selected, not_too_bad} =
          select_nearest_move_to_winrate(orig_suggest, next_target)
    const {move, winrate} = selected, f = Math.round
    const com = `\
winrates: move=${f(winrate)}%, target=${f(next_target)}%, long_target=${f(target)}%
candidates = ${not_too_bad.length}\
`
    return make_commented_move(move, com)
}

function select_nearest_move_to_winrate(orig_suggest, target_winrate) {
    const suggest = weak_move_candidates(orig_suggest)
    const not_too_bad = suggest.filter(s => s.winrate >= target_winrate)
    const selected = min_by(empty(not_too_bad) ? suggest : not_too_bad,
                            s => Math.abs(s.winrate - target_winrate))
    debug_log(`weak_move: target_winrate=${target_winrate} ` +
              `move=${selected.move} winrate=${selected.winrate} ` +
              `visits=${selected.visits} order=${selected.order} ` +
              `winrate_order=${selected.winrate_order}`)
    return {selected, not_too_bad}
}

///////////////////////////////////////////////
// strategy: lose_score

function weak_move_by_score(state, average_losing_points) {
    const {orig_suggest, is_bturn, orig_score_without_komi, katago_p} = state
    if (!katago_p) {
        const com = 'Play normally because "lose_score" is not supported for this engine.'
        return make_commented_move(best_move(state), com)
    }
    const suggest = weak_move_candidates(orig_suggest)
    const current_score = orig_score_without_komi || 0
    const losing_points = Math.random() * average_losing_points * 2
    const sign = is_bturn ? 1 : -1
    const target_score = current_score - losing_points * sign
    const selected =
          min_by(suggest, s => Math.abs(s.score_without_komi - target_score))
    debug_log(`weak_move_by_score: current_score=${current_score} ` +
              `target_score=${target_score} ` +
              `move=${selected.move} score=${selected.score_without_komi} ` +
              `visits=${selected.visits} order=${selected.order} ` +
              `winrate_order=${selected.winrate_order}`)
    const {move, score_without_komi} = selected
    const actual_loss = (score_without_komi - current_score) * sign
    const com = `Searched ${suggest.length} candidates` +
          ` for -${losing_points.toFixed(2)}pts` +
          ` and found -${actual_loss.toFixed(2)}pts actually.`
    return make_commented_move(move, com)
}

///////////////////////////////////////////////
// strategy: persona

function overwrite_weaken_args_by_persona(weaken_args, new_sanity) {
    weaken_args[1] = new_sanity
}

function weak_move_by_persona(state, persona_code, sanity) {
    const {orig_suggest, generate_persona_param} = state
    const typical_order = 1, threshold_range = [1e-3, 0.3]
    const param = generate_persona_param(persona_code).get()
    const log_threshold_range = threshold_range.map(Math.log)
    const [trans, ] = translator_pair(sanity_range, log_threshold_range)
    const threshold = Math.exp(trans(sanity))
    const {suggest, order, ordered} =
          select_weak_move_by_moves_ownership(state, param, typical_order, threshold)
    if (!suggest) {
        const com = 'Play normally because persona is not supported for this engine.'
        return make_commented_move(best_move(state), com)
    }
    // (move comment)
    const com_candidates_len = 5
    const candidate_moves =
          ordered.slice(0, com_candidates_len).map(h => h.suggest.move).join(',') +
          (ordered.length > com_candidates_len ? ',..' : '')
    const com_move = ordered.length === 1 ? 'Only this move is acceptable.' :
          `Order of preference = ${order + 1}` +
          ` in ${ordered.length} candidates ${candidate_moves}.`
    // (sanity comment)
    const com_sanity = `(visits threshold = ${(threshold * 100).toFixed(1)}%` +
          ` for sanity ${sanity.toFixed(2)})`
    // (persona comment)
    const f = (k, name) => `${name}:[${param[k].map(z => z.toFixed(1)).join(",")}]`
    const com_persona =
          `Persona "${persona_code}" = {${f(0, "my")}, ${f(1, "your")}, ${f(2, "space")}}`
    // (total comment)
    const com = [com_move, com_sanity, com_persona].join("\n")
    return make_commented_move(suggest.move, com)
}

function select_weak_move_by_moves_ownership(state, param, typical_order, threshold) {
    // goodness = sum of evaluation over the board
    // evaluation = weight * ownership_from_my_side (= AI side)
    // weight = MY (on my stone), YOUR (on your stone), or SPACE
    // (ex.) your = [1.0, 0.1] means "Try to kill your stones
    // eagerly if they seems alive and slightly if they seems rather dead".
    const {orig_suggest, is_bturn, stones, is_moves_ownership_supported} = state
    if (!AI.is_moves_ownership_supported) {return {}}
    const [my, your, space] = param
    const sign_for_me = is_bturn ? 1 : -1
    const my_color_p = z => !xor(z.black, is_bturn)
    const my_ownership_p = es => sign_for_me * es > 0
    const weight = (z, es) => {
        const w = !z.stone ? space : my_color_p(z) ? my : your
        return is_a(w, 'number') ? w : w[my_ownership_p(es) ? 0 : 1]
    }
    const evaluate = (z, es) => sign_for_me * weight(z, es) * es
    const sum_on_stones = f => sum(aa_map(stones, f).flat().filter(truep))
    const goodness = suggest => {
        const copied_ownership = [...suggest.movesOwnership]
        const endstate = endstate_from_ownership_destructive(copied_ownership)
        return sum_on_stones((z, i, j) => evaluate(z, endstate[i][j]))
    }
    debug_log(`select_weak_move_by_moves_ownership: ${JSON.stringify({my, your, space, typical_order, threshold})}`)
    return select_weak_move_by_goodness_order(orig_suggest, goodness, typical_order, threshold)
}

function select_weak_move_by_goodness_order(orig_suggest, goodness, typical_order, threshold) {
    // shuffle candidates so that "goodness = const." corresponds to "random"
    const candidates = sort_by(weak_move_candidates(orig_suggest, threshold), Math.random)
    const evaluated = candidates.map(s => ({suggest: s, bad: - goodness(s)}))
    const ordered = sort_by_key(evaluated, 'bad').map((h, k) => ({...h, order: k}))
    const weight = h => Math.exp(- h.order / typical_order)
    const {suggest, order, bad} = weighted_random_choice(ordered, weight)
    debug_log(`select_weak_move_by_goodness_order: goodness_order=${order} engine_order=${suggest.order} goodness=${- bad} candidates=${candidates.length} all=${orig_suggest.length}`)
    return {suggest, order, bad, ordered}
}

///////////////////////////////////////////////
// util

function weak_move_candidates(suggest, threshold) {
    const too_small_visits = (suggest[0] || {}).visits * (threshold || 0.02)
    return suggest.filter(s => s.visits > too_small_visits)
}

function make_commented_move(move, comment) {return move + '#' + comment}
function parse_commented_move(commented_move) {
    const [move, ...rest] = commented_move.split('#'), comment = rest.join('#')
    return [move, comment]
}

///////////////////////////////////////////////
// exports

module.exports = {
    select_weak_move,
    adjust_weaken_args,
}
