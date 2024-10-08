'use strict'

const {eval_with_persona, persona_param_str} = require('./weak_move.js')
const {generate_persona_param} = require('./persona_param.js')

///////////////////////////////////////////////
// main

async function get_rankcheck_move(rank_profile,
                                  peek_kata_raw_human_nn, update_ponder_surely) {
    const policy_profile = rank_profile || 'rank_9d'
    const rank_delta = 2, profile_pair = profiles_around(policy_profile, rank_delta)
    const eval_move = async (move, peek) =>
          eval_rankcheck_move(move, profile_pair, peek)
    const comment_title = `rankcheck ${profile_pair.join('/')}`
    const reverse_temperature = 0.9
    return get_move_gen({policy_profile, reverse_temperature, eval_move, comment_title,
                         peek_kata_raw_human_nn, update_ponder_surely})
}

async function get_move_gen(arg) {
    // "eval_move" is an async function that returns [badness, ...rest],
    // where "badness" is the target value which should be minimized
    // and "rest" is only used in the move comment.
    const {policy_profile, reverse_temperature, eval_move, comment_title,
           peek_kata_raw_human_nn, update_ponder_surely} = arg
    // param
    const max_candidates = 8, policy_move_prob = 0.1, policy_move_max_candidates = 50
    // util
    const peek = (moves, profile) =>
          new Promise((res, rej) => peek_kata_raw_human_nn(moves, profile || '', res))
    const evaluate = async move => eval_move(move, peek)
    const ret = (move, comment) => (update_ponder_surely(), [move, comment])
    const scaling = p => (p || 0) ** reverse_temperature
    // proc
    const p0 = get_extended_policy(await peek([], policy_profile))
    const sorted_p0 = sort_policy(p0).slice(0, policy_move_max_candidates)
    const randomly_picked_policy = weighted_random_choice(sorted_p0, scaling)
    const randomly_picked_move = serial2move(p0.indexOf(randomly_picked_policy))
    // To avoid becoming too repetitive,
    // occasionally play randomly_picked_policy move.
    if (Math.random() < policy_move_prob || randomly_picked_move === pass_command) {
        const order = sorted_p0.indexOf(randomly_picked_policy)
        const comment = `(${comment_title}) by ${policy_profile} policy: ` +
              `${round(randomly_picked_policy)} (order ${order})`
        return ret(randomly_picked_move, comment)
    }
    // To exclude minor moves naturally,
    // use randomly_picked_policy as the lower bound.
    const top_indices_raw = get_top_indices(p0, max_candidates)
    const top_indices = top_indices_raw.filter(k => p0[k] >= randomly_picked_policy)
    const top_policies = top_indices.map(k => p0[k])
    const top_moves = top_indices.map(serial2move)
    const evals = await ordered_async_map(top_moves, evaluate)
    const selected = min_by(top_moves, (_, k) => - evals[k][0])  // find max
    const comment = `(${comment_title}) ` +
          `Select ${selected} from [${top_moves.join(',')}].\n` +
          `policy = [${round(top_policies).join(', ')}]\n` +
          `eval = ${JSON.stringify(round(evals))}`
    return ret(selected, comment)
}

async function eval_rankcheck_move(move, profile_pair, peek) {
    // param
    const winrate_samples = 5, evenness_coef = 0.1
    const winrate_profile = null  // null = normal katago
    // util
    const peek_policies = async profiles => {
        const f = async prof => get_extended_policy(await peek([move], prof))
        return ordered_async_map(profiles, f)
    }
    const peek_winrates = async ms => {
        const f = async m =>
              [m, (await peek([move, m], winrate_profile)).whiteWin[0]]
        return aa2hash(await ordered_async_map(ms, f))
    }
    const get_candidates = p => {
        const indices = get_top_indices(p, winrate_samples)
        const moves = indices.map(serial2move)
        const policies = indices.map(k => p[k])
        return {indices, moves, policies}
    }
    const expected_white_winrate = (candidates, union_wwin) => {
        const {moves, policies} = candidates
        const wwin = moves.map(m => union_wwin[m])
        return sum(moves.map((_, k) => wwin[k] * policies[k])) / sum(policies)
    }
    // proc
    const policies_pair = await peek_policies(profile_pair)
    const candidates_pair = policies_pair.map(get_candidates)
    const union_moves = uniq(candidates_pair.flatMap(c => c.moves))
    const union_wwin = await peek_winrates(union_moves)
    const white_winrate_pair =
          candidates_pair.map(c => expected_white_winrate(c, union_wwin))
    // eval from opponent (= human) side
    const from_white_p = is_bturn(), flip = ww => from_white_p ? ww : 1 - ww
    const [wr_s, wr_w] = white_winrate_pair.map(flip)
    const mean = (wr_s + wr_w) / 2, diff = wr_s - wr_w
    // maximize "diff" and keep "mean" near 0.5
    const badness = (diff - 1)**2 + evenness_coef * (mean - 1/2)**2
    return [- badness, wr_s, wr_w]
}

///////////////////////////////////////////////
// variations

async function get_center_move(policy_profile,
                               peek_kata_raw_human_nn, update_ponder_surely) {
    return get_move_by_height(+1, policy_profile, 'center',
                              peek_kata_raw_human_nn, update_ponder_surely)
}

async function get_edge_move(policy_profile,
                             peek_kata_raw_human_nn, update_ponder_surely) {
    return get_move_by_height(-1, policy_profile, 'edge',
                              peek_kata_raw_human_nn, update_ponder_surely)
}

async function get_move_by_height(sign, policy_profile, comment_title,
                                  peek_kata_raw_human_nn, update_ponder_surely) {
    const reverse_temperature = 0.9
    const eval_move = (move, _peek) => [sign * move_height(move)]
    return get_move_gen({policy_profile, reverse_temperature, eval_move, comment_title,
                         peek_kata_raw_human_nn, update_ponder_surely})
}

function move_height(move) {
    const bsize = board_size()
    const hs = move2idx(move).map(k => Math.min(k + 1, bsize - k))
    return Math.min(...hs) + 0.01 * sum(hs)
}

///////////////////////////////////////////////
// persona

async function get_hum_persona_move(policy_profile,
                                    peek_kata_raw_human_nn, update_ponder_surely,
                                    dummy_profile, code) {
    const reverse_temperature = 0.9
    const param = generate_persona_param(code).get()
    const desc = persona_param_str(param)
    const eval_move = persona_evaluator(param)
    const comment_title = `persona: ${policy_profile}, ${code} = ${desc}`
    return get_move_gen({policy_profile, reverse_temperature, eval_move, comment_title,
                         peek_kata_raw_human_nn, update_ponder_surely})
}

function persona_evaluator(param) {
    return async (move, peek) => {
        const profile = null  // null = normal katago
        const ownership = (await peek([move], profile)).whiteOwnership.map(o => - o)
        return eval_with_persona(ownership, R.stones, param, is_bturn())
    }
}

///////////////////////////////////////////////
// util

function profiles_around(rank_profile, delta) {
    return [-1, +1].map(sign => prof_add(rank_profile, sign * delta))
}

function prof_add(rank_profile, delta) {
    const a = humansl_rank_profiles, k = a.indexOf(rank_profile) + delta
    return a[clip(k, 0, a.length - 1)]
}

function get_extended_policy(raw_nn_output) {
    return [...raw_nn_output.policy, ...raw_nn_output.policyPass]
}

function sort_policy(a) {return num_sort(a.filter(truep)).reverse()}

function get_top_indices(a, k) {
    return sort_policy(a).slice(0, k).map(z => a.indexOf(z))
}

function round(z) {return is_a(z, 'number') ? to_f(z.toFixed(3)) : z.map(round)}

async function ordered_async_map(a, f) {
    const iter = async (acc, ...args) => {
        const prev = await acc; return [...prev, await f(...args)]
    }
    return a.reduce(iter, Promise.resolve([]))
}

///////////////////////////////////////////////
// exports

module.exports = {
    get_rankcheck_move,
    get_center_move,
    get_edge_move,
    get_hum_persona_move,
}
