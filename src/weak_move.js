'use strict'

///////////////////////////////////////////////
// main

// public

function select_weak_move(...args) {
    const [state, ..._] = args
    const then = ret => {
        const {move, comment} = ret
        const selected = {...ret, comment: prepend_common_comment(move, comment, ...args)}
        state.cont(selected)
    }
    get_move_etc(...args, then)
}

function weak_move_prop(prop, weaken) {
    const prop_table = {
        has_option_p: ['persona'],
        force_ownership_p: ['persona'],
        sanity_p: ['persona'],
    }
    return prop_table[prop].includes(weaken[0])
}

// private

function get_move_etc(state, weaken_method, weaken_args, then) {
    const f = {
        random_candidate: weak_move,
        lose_score: weak_move_by_score,
        random_opening: random_opening_move,
        policy: random_move_by_policy,
        persona: weak_move_etc_by_persona,
    }[weaken_method] || best_move
    const ret = f(state, ...weaken_args)
    return functionp(ret) ? ret(then) :
        stringp(ret) ? then(parse_commented_move(ret)) : then(ret)
}

function prepend_common_comment(move, comment, state, weaken_method, weaken_args) {
    const {orig_suggest, preset_label_text} = state
    const ai = `by ${state.preset_label_text}`
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
    const {orig_suggest, movenum, random_opening, normal_move_in_random_opening} = state
    const suggest = orig_suggest, param = random_opening
    const p_until = param.prior_until_movenum, r_until = param.random_until_movenum
    const discount = clip(1 - movenum / r_until, 0)
    const best = suggest[0]
    const top_visits = Math.max(...suggest.map(s => s.visits))
    const log = (selected, label, val) => selected !== best && debug_log(`random_opening_move: movenum=${movenum + 1}, order=${selected.order}, ${label}=${JSON.stringify(val)}, visits=${selected.visits}, w_loss=${best.winrate - selected.winrate}, s_loss=${best.scoreMean - selected.scoreMean}`)
    // main
    if (movenum < p_until && best.prior) {
        const selected = select_randomly_by_prior(suggest)
        const {move, prior} = selected
        log(selected, 'prior', prior)
        const com = `Play randomly by the policy in the first ${p_until} moves.` +
              ` (policy = ${prior.toFixed(2)})`
        return make_commented_move(move, com)
    }
    if (Math.random() >= discount) {
        if (normal_move_in_random_opening) {return normal_move_in_random_opening}
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
    const candidates = suggest.filter(admissible)
    const selected = random_choice(candidates)
    log(selected, 'candidates', candidates.map(h => h.order))
    const cs = candidates.map(c => c.move).join(','), clen = candidates.length
    const com = (clen === 1) ? 'Only this move is acceptable.' :
          `Select a random move unifromly` +
          ` from ${clen} admissible candidates (${cs}).`
    return make_commented_move(selected.move, com)
}

function select_randomly_by_prior(suggest, reverse_temperature) {
    const weight_of = s => temperature_scaling(s.prior, reverse_temperature)
    return weighted_random_choice(suggest, weight_of)
}

function temperature_scaling(p, reverse_temperature) {
    const rev_temp = true_or(reverse_temperature, 1)
    return valid_numberp(p) ? clip(p, 0) ** rev_temp : 0
}

///////////////////////////////////////////////
// strategy: policy

function random_move_by_policy(state, reverse_temperature) {
    const {default_policy, orig_suggest} = state, rev_temp = reverse_temperature
    if (!default_policy) {
        const {move, prior} = select_randomly_by_prior(orig_suggest, rev_temp)
        const com = `Play randomly by the policy in ${orig_suggest.length} moves.` +
              ` (policy = ${prior.toFixed(2)})`
        return commented_best_move(state, com)
    }
    const weight_for = p => temperature_scaling(p, reverse_temperature)
    const weights = default_policy.map(weight_for)
    const k = weighted_random_choice(seq(weights.length), l => weights[l])
    const move = serial2move(k)
    const com = `Policy = ${default_policy[k].toFixed(5)}, ` +
          `Policy order = ${order_of_kth(k, weights)}, ` +
          `Weight = ${weights[k].toExponential(2)}, ` +
          `Reverse temperature = ${rev_temp}`
    return make_commented_move(move, com)
}

function order_of_kth(k, ary) {
    return num_sort(ary).reverse().indexOf(ary[k])
}

///////////////////////////////////////////////
// strategy: random_candidate

function weak_move(state, weaken_percent) {
    // (1) Converge winrate to 0 with move counts
    // (2) Occasionally play good moves with low probability
    // (3) Do not play too bad moves
    const {orig_suggest, movenum, last_move, orig_winrate} = state
    const r = clip((weaken_percent || 0) / 100, 0, 1)
    const initial_target_winrate = 40 * 10**(- r)
    const target = initial_target_winrate * 2**(- movenum / 100)  // (1)
    const flip_maybe = x => is_bturn() ? x : 100 - x
    const current_winrate = flip_maybe(orig_winrate)
    const u = Math.random()**(1 - r) * r  // (2)
    const next_target = current_winrate * (1 - u) + target * u  // (3)
    const {selected, not_too_bad} =
          select_nearest_move_to_winrate(orig_suggest, next_target, last_move)
    const {move, winrate} = selected, f = Math.round
    const com = `\
winrates: move=${f(winrate)}%, target=${f(next_target)}%, long_target=${f(target)}%
candidates = ${not_too_bad.length}\
`
    return make_commented_move(move, com)
}

function select_nearest_move_to_winrate(orig_suggest, target_winrate, last_move) {
    const suggest = weak_move_candidates(orig_suggest, last_move)
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
    const {orig_suggest, is_bturn, last_move, orig_score_without_komi, katago_p} = state
    if (!katago_p) {
        const com = 'Play normally because "lose_score" is not supported for this engine.'
        return commented_best_move(state, com)
    }
    const suggest = weak_move_candidates(orig_suggest, last_move)
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

function weak_move_etc_by_persona(state, persona_code, current_sanity, adjust_sanity_p) {
    if (state.movenum < 10) {
        const {move, prior} = select_randomly_by_prior(state.orig_suggest)
        const com = `Play randomly by the policy in first moves.`
        return make_commented_move(move, com)
    }
    const new_sanity = adjust_sanity_p && adjust_sanity(state, current_sanity)
    const sanity = true_or(new_sanity, current_sanity)
    const {generate_persona_param} = state
    const typical_order = 1, threshold_range = [1e-3, 0.3]
    const param = generate_persona_param(persona_code).get()
    const log_threshold_range = threshold_range.map(Math.log)
    const [trans, ] = translator_pair(sanity_range, log_threshold_range)
    const threshold = Math.exp(trans(sanity))
    const {suggest, order, ordered, persona_failed} =
          select_weak_move_by_moves_ownership(state, param, typical_order, threshold)
    if (persona_failed) {
        const com = `Play normally because persona is not supported for this ${persona_failed}.`
        return commented_best_move(state, com)
    }
    const {move} = suggest
    const new_weaken_args = truep(new_sanity) && [persona_code, new_sanity, adjust_sanity_p]
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
    const com_persona =
          `Persona "${persona_code}" = ${persona_param_str(param)}`
    // (total comment)
    const comment = [com_move, com_sanity, com_persona].join("\n")
    // final check
    const sec = 0.5, max_winrate_loss = 30.0, max_score_loss = 10.0
    const sanity_coef = translator_pair(sanity_range, [1, 0.01])[0](sanity)
    const loss_threshold = {
        winrate: max_winrate_loss * sanity_coef,
        score: max_score_loss * sanity_coef,
    }
    const selected = {move, comment, new_sanity, new_weaken_args}
    return then => final_check(selected, state, sec, loss_threshold, then)
}

function persona_param_str(param) {
    const f = (k, name) => `${name}:[${param[k].map(z => z.toFixed(1)).join(",")}]`
    return `{${f(0, "my")}, ${f(1, "your")}, ${f(2, "space")}}`
}

function final_check(selected, state, sec, loss_threshold, then) {
    // At this time, I'm opting to endure the complexity of
    // callback hell rather than using async/await. [2023-12-27]
    // (Asynchrony)
    // The surrounding code, which is part of the frequently used
    // core features, has been written synchronously. Introducing
    // async/await could unintentionally change behavior and risk
    // creating race condition bugs.
    // (Memory leak)
    // In AI.analyze_move(), the callback is discarded if it's
    // interrupted by other operations. Using async/await raises
    // concerns about not releasing resources in such scenarios.
    const {move, comment} = selected
    const is_black = state.is_bturn, sign = is_black ? +1 : -1
    const callback = ({b_winrate, score_without_komi}) => {
        const best = state.orig_suggest[0]
        const winrate_loss = (best.winrate - 50) - sign * (b_winrate - 50)
        const score_loss = sign * (best.score_without_komi - score_without_komi)
        const ok = (best.move === move) ||
              (winrate_loss < loss_threshold.winrate &&
               score_loss < loss_threshold.score)
        const finally_selected = ok ? selected :
              commented_best_move(state, `Play normally because ${move} was too bad in the final check. (winrate_loss=${winrate_loss.toFixed(1)}, score_loss=${score_loss.toFixed(1)})\nInfo of refused ${move}:\n${comment || ''}`)
        then(finally_selected)
    }
    AI.analyze_move(move, is_black, sec, callback)
}

function adjust_sanity(state, sanity) {
    const eta_s = 0.01, eta_ds = 0.1
    const s_cur = state.my_current_score, s_prev = state.my_previous_score
    if (![s_cur, s_prev].every(truep)) {return null}
    const round = (z, k) => Math.round(z * 10**k) / 10**k
    const ds = s_cur - s_prev, d_san = - (eta_s * s_cur + eta_ds * ds)
    return clip(round(sanity + d_san, 4), ...sanity_range)
}

function select_weak_move_by_moves_ownership(state, param, typical_order, threshold) {
    // goodness = sum of evaluation over the board
    // evaluation = weight * ownership_from_my_side (= AI side)
    // weight = MY (on my stone), YOUR (on your stone), or SPACE
    // (ex.) your = [1.0, 0.1] means "Try to kill your stones
    // eagerly if they seems alive and slightly if they seems rather dead".
    const {orig_suggest, is_bturn, last_move, stones, is_moves_ownership_supported} = state
    if (!is_moves_ownership_supported) {return {persona_failed: 'engine'}}
    if (!orig_suggest?.[0]?.movesOwnership) {return {persona_failed: 'analysis cache'}}
    const [my, your, space] = param
    const goodness = suggest =>
          eval_with_persona(suggest.movesOwnership, stones, param, is_bturn)
    debug_log(`select_weak_move_by_moves_ownership: ${JSON.stringify({my, your, space, typical_order, threshold})}`)
    return select_weak_move_by_goodness_order(orig_suggest, goodness, typical_order, last_move, threshold)
}

function eval_with_persona(ownership, stones, param, is_bturn) {
    const [my, your, space] = param
    const sign_for_me = is_bturn ? 1 : -1
    const my_color_p = z => !xor(z.black, is_bturn)
    const my_ownership_p = es => sign_for_me * es > 0
    const weight = (z, es) => {
        const w = !z.stone ? space : my_color_p(z) ? my : your
        const [u, v] = is_a(w, 'number') ? [w, 0] : w
        return [u + v, u - v]
    }
    const evaluate = (z, es) => {
        const [a, b] = weight(z, es)
        const entropy_term = (z.stone ? 1 : es) * endstate_entropy(es)
        return sign_for_me * (a * es + b * entropy_term)
    }
    const sum_on_stones = f => sum(aa_map(stones, f).flat().filter(truep))
    const endstate = endstate_from_ownership(ownership)
    return sum_on_stones((z, i, j) => evaluate(z, endstate[i][j]))
}

function select_weak_move_by_goodness_order(orig_suggest, goodness, typical_order, last_move, threshold) {
    // shuffle candidates so that "goodness = const." corresponds to "random"
    const candidates = sort_by(weak_move_candidates(orig_suggest, last_move, threshold), Math.random)
    const evaluated = candidates.map(s => ({suggest: s, bad: - goodness(s)}))
    const ordered = sort_by_key(evaluated, 'bad').map((h, k) => ({...h, order: k}))
    const weight = h => Math.exp(- h.order / typical_order)
    const {suggest, order, bad} = weighted_random_choice(ordered, weight)
    debug_log(`select_weak_move_by_goodness_order: goodness_order=${order} engine_order=${suggest.order} goodness=${- bad} candidates=${candidates.length} all=${orig_suggest.length}`)
    return {suggest, order, bad, ordered}
}

///////////////////////////////////////////////
// util

function weak_move_candidates(suggest, last_move, threshold) {
    const too_small_visits = (suggest[0] || {}).visits * (threshold || 0.02)
    const acceptable = s => s.order === 0 ||
          s.visits > too_small_visits && natural_pv_p(s, last_move)
    return suggest.filter(acceptable)
}
function natural_pv_p(s, last_move) {
    if (!last_move) {return true}
    const tenuki_threshold = 4.0, tenuki_distance = tenuki_threshold * 1.01
    const distance = (a, b) => {
        const [[ai, aj], [bi, bj]] = [a, b].map(move2idx)
        const pass_distance = Infinity
        return (ai < 0 || bi < 0) ? pass_distance :
            Math.abs(ai - bi) + Math.abs(aj - bj)
    }
    const [my_move, your_next_move] = s.pv
    const my_distance = distance(my_move, last_move)
    if (!your_next_move) {return my_distance < tenuki_distance}
    const your_distance = distance(your_next_move, last_move)
    const is_tenuki_punished = my_distance > your_distance * tenuki_threshold
    return !is_tenuki_punished
}

function make_commented_move(move, comment) {return move + '#' + comment}
function parse_commented_move(commented_move) {
    const [move, ...rest] = commented_move.split('#'), comment = rest.join('#')
    return {move, comment}
}

function commented_best_move(state, comment) {
    return {move: best_move(state), comment}
}

///////////////////////////////////////////////
// exports

module.exports = {
    select_weak_move,
    weak_move_prop,
}
