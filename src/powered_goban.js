// powered_goban.js: board renderer + analysis engine
// 
// set_board() indirectly updates displayed board,
// starts analysis of given game state, and updates displayed suggestions.

const {create_game} = require('./game.js')
const {endstate_clusters_for} = require('./area.js')
const {get_amb_gain} = require('./amb_gain.js')

// state
let endstate_diff_interval = 12, showing_until = null, the_move_count_for_suggestion = null
let game = create_game()  // dummy empty game until first set_board()

/////////////////////////////////////////////////
// basic

function set_board(given_game) {
    game = given_game; set_board_size(game.board_size)
    const hist = game.array_until(game.move_count)
    R.move_count = game.move_count = hist.length
    R.bturn = game.is_bturn()
    R.visits = null
    set_stones(game.stones_and_hama_at(game.move_count))
    return hist.filter(h => !h.illegal)
}

function set_stones(stones_and_hama) {
    merge(R, stones_and_hama); add_info_to_stones(R.stones, game)
    R.prev_endstate_clusters = null
    // avoid flicker of ownerships
    AI.support_endstate_p() && set_tentative_endstate_maybe()
}

function renew_game() {set_endstate_obsolete(); clear_endstate()}

/////////////////////////////////////////////////
// receive analysis from leelaz

// (obsolete comment & variable. but keep conventional code as far as possible here.)
// This is not equal to R.move_count and game.move_count
// for repeated (fast) undo/redo since showboard is deferred
// in this case for efficiency.
let leelaz_move_count = 0

// (obsolete. but keep conventional code as far as possible here.)
function endstate_handler(h) {
    if (M.is_pausing()) {return}
    const endstate_setter = update_p => {
        const leelaz_move_count = R.endstate_move_count
        const add_endstate_to_history = z => {
            z.endstate = R.endstate; if (!update_p) {return}
            z.endstate_sum = sum(R.endstate.flat())
        }
        // need add_endstate_to_history before add_endstate_to_stones
        // because update_endstate_diff depends on game.ref_current().endstate
        leelaz_move_count > 0 && add_endstate_to_history(game.ref(leelaz_move_count))
        add_endstate_to_stones(R.stones, R.endstate, null, leelaz_move_count, update_p)
        set_endstate_uptodate(R.endstate, leelaz_move_count)
    }
    set_renderer_state(h)
    AI.another_leelaz_for_endstate_p() && endstate_setter(!!h.endstate)
}

const hold_suggestion_millisec = 1000
const is_holding_suggestion = vapor_var(hold_suggestion_millisec, false)
function hold_suggestion_for_a_while() {is_holding_suggestion(true)}

// keys0: same as keys1. false, null, undefined are also valid.
const suggest_keys0 = ['engine_bturn']
// keys1: required. individual plot for each engine.
const suggest_keys1 = ['suggest', 'visits', 'b_winrate', 'komi', 'gorule']
// keys2: optional. single global plot.
const suggest_keys2 = [
    'endstate', 'endstate_stdev', 'score_without_komi', 'ambiguity',
    'stone_entropy',
    'endstate_surprise',
    'score_stdev',
    'black_settled_territory', 'white_settled_territory', 'area_ambiguity_ratio',
    'shorttermScoreError',
]

const too_small_prior = 1e-3
function suggest_handler(h) {
    if (finitep(get_showing_until()) || is_holding_suggestion()) {return}
    const considerable = z => z.visits > 0 || z.prior >= too_small_prior
    const mc = game.move_count, cur = game.ref(mc) || {}, {engine_id} = h
    h.suggest = h.suggest.filter(considerable)
    h.ownership && (h.endstate = endstate_from_ownership_destructive(h.ownership))
    h.ownership_stdev &&
        (h.endstate_stdev = endstate_from_ownership_destructive(h.ownership_stdev))
    h.endstate && (h.endstate_surprise = endstate_surprise(h.endstate))
    !empty(h.suggest) && (h.score_stdev = h.suggest[0].scoreStdev)
    !cur.by && (cur.by = {}); !cur.by[engine_id] && (cur.by[engine_id] = {})
    const cur_by_engine = cur.by[engine_id]
    const prefer_cached_p = cur_by_engine.visits > h.visits &&
          (!AI.katago_p() || cur_by_engine.komi === h.komi) &&
          (!AI.is_gorule_supported() || !cur_by_engine.gorule || cur_by_engine.gorule === h.gorule)
    const preferred_h = !R.use_cached_suggest_p ? h :
          prefer_cached_p ? {...h, ...cur_by_engine} : h
    // do not use suggest_keys1 for background_visits etc.
    // because we need to copy falsy value too.
    preferred_h.background_visits =
        cur.background_visits = ((h !== preferred_h) && h.visits)
    const copy_vals = (keys, to, allow_false_p) =>
          keys.forEach(k => (truep(preferred_h[k]) || allow_false_p) && (to[k] = preferred_h[k]))
    copy_vals(suggest_keys0, cur, true)
    copy_vals(suggest_keys0, cur_by_engine, true)
    copy_vals(suggest_keys1, cur)
    copy_vals(suggest_keys1, cur_by_engine)
    copy_vals(suggest_keys2, cur)
    !prefer_cached_p && copy_vals(suggest_keys2, cur_by_engine)
    game.engines[engine_id] = true; game.current_engine = engine_id
    // if current engine is Leela Zero, recall ownerships by KataGo
    const {endstate, endstate_stdev, score_without_komi} = {...cur, ...preferred_h}
    R.show_endstate && add_endstate_to_stones(R.stones, endstate, endstate_stdev, mc, true)
    endstate && set_endstate_uptodate(endstate)
    // is_endstate_drawable is true if...
    // (1) ownership is given here, or
    // (2) endstate_handler() was called already
    const is_endstate_drawable = is_endstate_uptodate()
    set_and_render(false, {...preferred_h, is_endstate_drawable, score_without_komi})
    on_suggest()
}

function delete_cache() {
    [game.move0, ...game.array_until(Infinity)].forEach(h => {
        h.deleted_cache || (h.deleted_cache = {});
        [h.by, h.deleted_cache.by] = [{}, h.by];
        [...suggest_keys1, ...suggest_keys2].forEach(key => {
            h.deleted_cache[key] = h[key]; delete h[key]
        })
    })
}

function undelete_cache() {
    [game.move0, ...game.array_until(Infinity)].forEach(h => {
        if (!h.deleted_cache) {return}
        [h.by, h.deleted_cache.by] = [h.deleted_cache.by, h.by];
        [...suggest_keys1, ...suggest_keys2].forEach(key => {
            [h[key], h.deleted_cache[key]] = [h.deleted_cache[key], h[key]]
        })
    })
}

/////////////////////////////////////////////////
// change renderer state and send it to renderer

function winrate_history_set_from_game() {
    const current = AI.engine_ids()
    const rest = Object.keys(game.engines).filter(eid => current.indexOf(eid) < 0)
    const f = a => a.map(winrate_from_game)
    return [f(current), f(rest)]
}

function set_renderer_state(...args) {
    merge(R, ...args)  // use updated R in below lines
    const {move_count, init_len} = game
    const busy = M.is_busy(), long_busy = M.is_long_busy()
    const winrate_history = winrate_from_game()
    const winrate_history_set = winrate_history_set_from_game()
    const su_p = finitep(move_count_for_suggestion())
    const previous_suggest = !su_p && get_previous_suggest()
    const future_moves = game.array_until(Infinity).slice(move_count).map(h => h.move)
    const winrate_trail = !su_p
    const max_visits = clip(Math.max(...orig_suggest().map(h => h.visits)), 1)
    const progress = M.auto_progress()
    const weight_info = weight_info_text()
    const is_katago = AI.katago_p()
    const komi = game.get_komi(), bsize = board_size()
    const cur = game.ref_current(), {note} = cur, comment = cur.comment || ''
    const comment_note = [comment, note].filter(identity).join(' / ')
    const amb_gain = get_amb_gain(game)
    amb_gain && merge(cur, {amb_gain})
    if (empty(R.suggest)) {R.score_without_komi = null}
    const endstate_sum = truep(R.score_without_komi) ? R.score_without_komi :
          AI.another_leelaz_for_endstate_p() ? average_endstate_sum() : null
    const endstate = aa_map(R.stones, h => h.endstate || 0)
    const endstate_clusters = get_endstate_clusters(endstate)
    const endstate_d_i = truep(endstate_sum) ? {endstate_diff_interval} : {}
    const move_history_keys = [
        'move', 'is_black', 'ko_state', 'ambiguity',
        'stone_entropy',
        M.plot_endstate_surprise_p() && 'endstate_surprise',
        M.plot_score_stdev_p() && 'score_stdev',
        'black_settled_territory', 'white_settled_territory', 'area_ambiguity_ratio',
        M.plot_shorttermScoreError_p() && 'shorttermScoreError',
        'amb_gain',
    ].filter(truep)
    const get_move_history = z => aa2hash(move_history_keys.map(key => [key, z[key]]))
    const move_history = [get_move_history(game.ref(0)), ...game.map(get_move_history)]
    const different_engine_for_white_p = AI.leelaz_for_white_p()
    merge(R, {move_count, init_len, busy, long_busy,
              winrate_history, winrate_history_set,
              endstate_sum, endstate_clusters, max_visits, progress,
              weight_info, is_katago, komi, bsize, comment, comment_note, move_history,
              different_engine_for_white_p,
              previous_suggest, future_moves, winrate_trail}, endstate_d_i)
    add_next_played_move_as_fake_suggest()
}
function set_and_render(is_board_changed, ...args) {
    set_renderer_state(...args)
    const mask = M.show_suggest_p() ? {hide_suggest: false} :
          {suggest: [], visits: null, show_endstate: false, hide_suggest: true}
    M.render({...R, ...mask}, is_board_changed)
}

function add_next_played_move_as_fake_suggest() {
    const next_mc = game.move_count + 1; if (next_mc > game.len()) {return}
    const next = (game.ref(next_mc) || {})
    const {move, is_black, suggest, visits, b_winrate, score_without_komi} = next
    const orig_n = R.suggest.findIndex(h => (h.move === move)), orig = R.suggest[orig_n]
    if (orig && orig.visits > 0) {return}; orig && R.suggest.splice(orig_n, 1)
    const order0 = (suggest || []).find(h => h.order === 0); if (!order0) {return}
    const pv = [move, ...order0.pv]
    const fake_suggest_elem = {
        move, visits, score_without_komi, pv,
        winrate: is_black ? b_winrate : 100 - b_winrate,
        order: -1, scoreStdev: null, prior: orig && orig.prior,
    }
    // destructive R.suggest.push(fake_suggest_elem) is wrong!
    R.suggest = [...R.suggest, fake_suggest_elem]
}

function orig_suggest() {return (R.suggest || []).filter(orig_suggest_p)}

/////////////////////////////////////////////////
// endstate

let endstate_array, endstate_move_count
function set_endstate_uptodate(endstate, move_count) {
    endstate_array = endstate
    endstate_move_count = true_or(move_count, game.move_count)
}
function set_endstate_obsolete() {[endstate_array, endstate_move_count] = [null, null]}
function is_endstate_uptodate() {return endstate_move_count === game.move_count}
function is_endstate_nearly_uptodate(lim) {
    return Math.abs(endstate_move_count - game.move_count) <= lim
}
function recall_endstate() {return endstate_array}
set_endstate_obsolete()

function append_implicit_tags_maybe(h) {
    const h_copy = {...h}, add = tag_letter => add_tag(h_copy, tag_letter)
    AI.support_endstate_p() && R.show_endstate &&
        h.move_count === game.move_count - endstate_diff_interval &&
        h.move_count >= game.init_len &&
        add(endstate_diff_tag_letter)
    M.branch_at(h.move_count) && add(branching_tag_letter)
    h.move_count === game.len() && add(last_loaded_element_tag_letter)
    return h_copy
}
function get_endstate_diff_interval() {return endstate_diff_interval}
function set_endstate_diff_interval(k) {endstate_diff_interval = k}
function get_showing_until() {return showing_until}
function move_count_for_suggestion() {return the_move_count_for_suggestion}
function set_showing_until(k, mc_for_suggestion) {
    change_endstate_diff_target(() => {
        the_move_count_for_suggestion = mc_for_suggestion
        showing_until = k; R.suggest = []
    })
}
function change_endstate_diff_target(proc) {
    const old = endstate_diff_move_count()
    proc()
    endstate_diff_move_count() !== old && update_endstate_diff(null, false, true)
}

function set_tentative_endstate_maybe() {
    if (!R.show_endstate) {return}
    const {endstate, endstate_stdev} = game.ref_current(), pausing = M.is_pausing()
    const update_p = endstate, dummy_p = endstate && empty(endstate[0])
    const reuse_p = is_endstate_nearly_uptodate(pausing ? 0 : 20)
    update_p ? set_endstate_uptodate(endstate) :
        reuse_p ? do_nothing() : set_endstate_obsolete()
    const es = recall_endstate()
    const immediately = update_p && (pausing || get_showing_until())
    tentatively_add_endstate_to_stones(R.stones, es, immediately)
    add_endstate_stdev_to_stones(R.stones, endstate_stdev)
    R.is_endstate_drawable = !!es && !dummy_p
}

function add_endstate_to_stones(stones, endstate, endstate_stdev, move_count, update_diff_p) {
    if (!R.show_endstate) {return}
    // if (!endstate) {return}
    add_endstate_stdev_to_stones(stones, endstate_stdev)
    purely_add_endstate_to_stones(stones, endstate)
    update_diff_p && update_endstate_diff(endstate)
    merge(game.ref(move_count), get_ambiguity_etc(stones, endstate))
}
function tentatively_add_endstate_to_stones(stones, endstate, immediately) {
    // if (!endstate) {return}
    purely_add_endstate_to_stones(stones, endstate, immediately)
    update_endstate_diff(endstate, true, immediately)
}
const endstate_lag_max_diff = 0.2
const lagged_endstate = make_lagged_aa(endstate_lag_max_diff)
function purely_add_endstate_to_stones(stones, endstate, immediately) {
    const aa = lagged_endstate.update_all(endstate)
    aa_each(stones, (s, i, j) => {
        s.endstate = aa_ref(immediately ? endstate : aa, i, j)
        s.immediate_endstate = aa_ref(endstate || aa, i, j)
    })
}

function add_endstate_stdev_to_stones(stones, endstate_stdev) {
    endstate_stdev && aa_each(stones, (s, i, j) => {
        s.endstate_stdev = aa_ref(endstate_stdev, i, j)
    })
}

function endstate_surprise(endstate) {
    const delta = 12, eps = 1e-10
    const prev = game.ref(game.move_count - delta).endstate
    if (!(endstate && prev)) {return 0}
    const pr = o => clip((o + 1) / 2, eps, 1 - eps)
    const f = (p, q) => p * Math.log(p / q)
    const kl = (p, q) => f(p, q) + f(1 - p, 1 - q)
    const o_kl = (c, i, j) => kl(pr(c), pr(aa_ref(prev, i, j)))
    return sum(aa_map(endstate, o_kl).flat())
}

const lagged_endstate_diff = make_lagged_aa(endstate_lag_max_diff)
function update_endstate_diff(endstate, tentatively, immediately) {
    const prev = endstate_diff_move_count(), sign = prev < game.move_count ? 1 : -1
    const prev_endstate = game.ref(prev).endstate
    const ok = prev_endstate && game.ref_current().endstate
    const tentatively_ok = prev_endstate && tentatively
    aa_each(R.stones, (s, i, j) => {
        const current = endstate ? aa_ref(endstate, i, j) : s.endstate
        const val = (ok || tentatively_ok) ?
              sign * (current - aa_ref(prev_endstate, i, j)) : 0
        const lagged = lagged_endstate_diff.update(i, j, val)
        s.endstate_diff = immediately ? val : lagged
    })
    R.prev_endstate_clusters = ok && get_endstate_clusters(prev_endstate, prev)
    R.prev_endstate_sum = game.ref(prev).score_without_komi
}
function endstate_diff_move_count() {
    return finite_or(get_showing_until(), game.move_count - endstate_diff_interval)
}
function average_endstate_sum(move_count) {
    return for_current_and_previous_endstate(move_count, 'endstate_sum', 1,
                                             (cur, prev) => (cur + prev) / 2)
}
function for_current_and_previous_endstate(move_count, key, delta, f) {
    const mc = truep(move_count) || game.move_count
    const [cur, prev] = [0, delta].map(k => game.ref(mc - k)[key])
    return truep(cur) && truep(prev) && f(cur, prev)
}
function add_tag(h, tag) {h.tag = str_sort_uniq((h.tag || '') + (tag || ''))}

function clear_endstate() {lagged_endstate.reset(); lagged_endstate_diff.reset()}

function get_endstate_clusters(endstate, move_count) {
    const stones = M.is_bogoterritory() &&
          (move_count ? game.stones_at(move_count) : R.stones)
    return endstate_clusters_for(endstate, stones)
}

function get_ambiguity_etc(stones, endstate) {
    const stone_entropy = get_stone_entropy(stones, endstate)
    const [black_settled_territory, white_settled_territory] =
          [true, false].map(black => get_settled_territory(stones, endstate, black))
    const area_ambiguity_ratio = get_area_ambiguity_ratio(endstate)
    const ret = {
        stone_entropy,
        black_settled_territory, white_settled_territory, area_ambiguity_ratio,
    }
    each_key_value(ret, (k, v) => {if (!truep(v)) delete ret[k]})
    return ret
}

function get_stone_entropy(stones, endstate) {
    return get_ambiguity_gen(stones, endstate, endstate_entropy)
}

function get_ambiguity_gen(stones, endstate, func) {
    if (!endstate) {return null}
    const amb = (h, i, j) => h.stone ? func(aa_ref(endstate, i, j)) : 0
    return sum(aa_map(stones, amb).flat())
}

function get_settled_territory(stones, endstate, black) {
    if (!endstate) {return null}
    const sign = black ? +1 : -1
    const hama = black ? R.black_hama : R.white_hama
    const g = es => clip(es * sign, 0) * (1 - endstate_entropy(es))
    const f = (h, i, j) => {
        const coef = !h.stone ? 1 : xor(h.black, black) ? 2 : 0
        return g(aa_ref(endstate, i, j)) * coef
    }
    return sum(aa_map(stones, f).flat()) + hama
}

function get_area_ambiguity_ratio(endstate) {
    return endstate && average(endstate.flat().map(endstate_entropy))
}

function set_ambiguity_etc_in_game(game) {
    game.forEach(h => {
        const {endstate, move_count} = h, stones = game.stones_at(move_count)
        merge(h, get_ambiguity_etc(stones, endstate))
    })
}

function make_lagged_aa(max_diff) {
    let aa = [[]]
    const update = (i, j, val) => {
        const prev = aa_ref(aa, i, j) || 0, given = val || 0
        const updated = clip(given, prev - max_diff, prev + max_diff)
        aa_set(aa, i, j, updated); return updated
    }
    const update_all = new_aa => {
        aa_each(new_aa || aa, (_, i, j) => update(i, j, aa_ref(new_aa || [[]], i, j)))
        return aa
    }
    const reset = () => (aa = [[]])
    return {update, update_all, reset}
}

/////////////////////////////////////////////////
// winrate history

function winrate_from_game(engine_id) {
    cook_lizzie_cache_maybe(game)
    // +1 for move_count (see game.js)
    const winrates = seq(game.len() + 1).map(mc => get_b_winrate(mc, engine_id))
    const score_loss = {b: 0, w: 0}; let prev_score = game.get_komi()
    return winrates.map((r, s, a) => {
        const [cur, prev] = [s, s - 1].map(game.ref)
        const [turn_letter, opponent_letter, turn_sign] =
              cur.is_black ? ['b', 'w', 1] : ['w', 'b', -1]
        const h = append_implicit_tags_maybe(cur), tag = h.tag
        if (!truep(r)) {return {tag}}
        const move_b_eval = a[s - 1] && (r - a[s - 1])
        const move_eval = move_b_eval && move_b_eval * turn_sign
        const predict = winrate_suggested(s, engine_id)
        const order_of = is_black => {
            if (s <= game.init_len || xor(is_black, cur.is_black)) {return null}
            const max_order = 20, {suggest} = prev, {move} = cur
            const hit = (suggest || []).find(z => z.move === move)
            const valid = hit && hit.order >= 0
            return clip(valid ? hit.order : Infinity, 0, max_order)
        }
        const orders = M.plot_order_p() ?
              {order_b: order_of(true), order_w: order_of(false)} : {}
        const aggressiveness_of = is_black => {
            if (s <= game.init_len || xor(is_black, cur.is_black)) {return null}
            const {suggest} = prev, {move} = cur
            const hit = (suggest || []).find(z => z.move === move)
            const {aggressive_policy, defensive_policy, prior} = hit || {}
            return remarkable_aggressiveness(aggressive_policy, defensive_policy, prior)
        }
        const aggressiveness = M.plot_aggressiveness_p() ?
              {aggressiveness_b: aggressiveness_of(true), aggressiveness_w: aggressiveness_of(false)} : {}
        const implicit_pass = (!!h.is_black === !!game.ref(s - 1).is_black)
        const pass = implicit_pass || M.is_pass(h.move) || h.illegal
        const score_without_komi = score_without_komi_at(s)
        const record_gain_as_side_effect = gain => {
            if (engine_id || s === 0 || !truep(score_without_komi_at(s - 1))) {return}
            merge(cur, {gain})
            s <= game.move_count && merge_to_stone_at(cur, {gain})
            record_panished(gain)
        }
        const record_panished = gain => {
            const prev_gain = (prev || {}).gain
            truep(prev_gain) &&
                // prev_punished = prev_loss - cur_loss
                merge_to_stone_at(prev, {punished: - (prev_gain - gain)})
        }
        const merge_to_stone_at = (at, val) =>
              merge(aa_ref(R.stones, ...move2idx(at.move)) || {}, val)
        const update_score_loss = gain => {
            // (A) gain < 0: Your move is bad.
            // (B) gain > 0: Your move is good or the opponent's last move was bad.
            // The case (B) never happens if the engine is perfectly accurate.
            // So we cannot trust positive gains literally.
            // Here, we accept positive gains as long as cumulative gains are
            // kept negative.
            const accepted = clip(gain, - Infinity, score_loss[turn_letter])
            const transferred = gain - accepted
            score_loss[turn_letter] -= accepted
            score_loss[opponent_letter] += transferred
            record_gain_as_side_effect(gain)  // clean me
        }
        const update_score_loss_maybe = () => {
            const gain = (score_without_komi - prev_score) * turn_sign
            const valid = !pass || (s === 0 && game.init_len === 0)
            valid && update_score_loss(gain)
            prev_score = score_without_komi
        }
        truep(score_without_komi) && update_score_loss_maybe()
        const cumulative_score_loss = {...score_loss}  // dup
        // drop "pass" to save data size for IPC
        return {
            r, move_b_eval, move_eval, tag, score_without_komi, cumulative_score_loss,
            turn_letter,
            ...(pass ? {pass} : {predict}), ...orders, ...aggressiveness,
        }
    })
}
function cook_lizzie_cache_maybe(new_game) {
    // engine_id depends komi etc. that are not updated yet
    // when create_games_from_sgf_internal is called.
    if (!new_game.needs_cooking_lizzie_cache) {return}
    const engine_id = AI.engine_ids()[0]
    new_game.forEach(cur => {
        if (!cur.suggest) {return}
        !cur.by && (cur.by = {}); !cur.by[engine_id] && (cur.by[engine_id] = {})
        const cur_by_engine = cur.by[engine_id]
        const keys = ['suggest', 'visits', 'b_winrate',
                      'komi', 'gorule', 'endstate', 'score_without_komi']
        keys.forEach(k => truep(cur[k]) && (cur_by_engine[k] = cur[k]))
    })
    new_game.needs_cooking_lizzie_cache = false
}

function score_without_komi_at(move_count) {
    return true_or(game.ref(move_count).score_without_komi,
                   average_endstate_sum(move_count))
}

function get_initial_b_winrate(engine_id) {return get_b_winrate(0, engine_id)}
function get_b_winrate(move_count, engine_id) {
    return true_or(get_estimation(move_count, engine_id).b_winrate, NaN)
}
function get_estimation(move_count, engine_id) {
    const m = game.ref(move_count)
    return truep(engine_id) ? ((m.by || {})[engine_id] || {}) : m
}

function winrate_suggested(move_count, engine_id) {
    const {move, is_black} = game.ref(move_count)
    const {suggest} = get_estimation(move_count - 1, engine_id)
    const sw = ((suggest || []).find(h => h.move === move && h.visits > 0) || {}).winrate
    return truep(sw) && (is_black ? sw : 100 - sw)
}

/////////////////////////////////////////////////
// misc. utils for updating renderer state

function get_previous_suggest() {
    const [cur, prev] = [0, 1].map(k => game.ref(game.move_count - k))
    // avoid "undefined" and use "null" for merge in set_renderer_state
    const ret = (prev.suggest || []).find(h => h.move === (cur.move || '')) || null
    ret && (ret.bturn = prev.engine_bturn)
    return ret
}
function weight_info_text() {
    const h = AI.engine_info(), ek = h.engine_komi, gk = game.get_komi()
    const game_komi = truep(gk) && gk != ek && ` (game komi=${gk})`
    const s = val => truep(val) ? to_s(val) : ''
    const engine_komi = `komi=${ek}${s(game_komi)} `
    const game_gorule = AI.is_gorule_supported() && game.gorule
    const gorule = game_gorule ? `(${game_gorule}) ` : ''
    const f = z => z ?
          `${z.preset_label_text}${s(z.aggressive_p && '!')} ${s(z.network_size)}${s(!z.is_ready && '(waiting...)')}` : ''
    const weight_info = h.leelaz_for_white_p ?
          `${f(h.black)} / ${f(h.white)}` : f(h.black)
    const tuning = M.tuning_message()
    return engine_komi + gorule + weight_info + (tuning ? ` | ${tuning}` : '')
}
function add_next_mark_to_stones(stones, game, move_count) {
    const h = game.ref(move_count + 1), s = stone_for_history_elem(h, stones)
    s && (s.next_move = true) && (s.next_is_black = h.is_black)
}
function add_branches_to_stones(stones, game, move_count) {
    // update R.branch_for_tag as a side effect (dirty...)
    R.branch_for_tag = []
    // We need seq(...) here to show "^" mark correctly
    // when handicap stone was deleted by "b" key + click. [2022-12-28]
    // (ex.) the black stone [dc] for (;SZ[9]AB[dc][dd]AW[cd])
    const past = (move_count <= game.init_len) ? seq(move_count + 1) : [0, 1]
    const add_past_branch = delta => {
        const mc = move_count - delta
        const b = branch_or_ladder_at(game, mc, delta === 0 && stones)
        b.forEach(gm => {
            const h = gm.ref(mc + 1), {is_black} = h, past_p = (delta !== 0)
            const fake_h = h.ladder_hit ? {move: h.ladder_hit} : h
            const s = stone_for_history_elem(fake_h, stones) || (fake_h && {})
            if (!s) {return}
            const tag = h.tag || unnamed_branch_tag_letter
            const branch_for_stone = {tag, is_black, past_p}
            s.branches || (s.branches = []); s.branches.push(branch_for_stone)
            const {id} = gm, future = gm.array_until(Infinity).slice(mc)
            const pv = pv_from_moves(future, !game.ref(mc).is_black)
            const pick_comment = (z, k) => z.comment ? [`${k + 1} ${z.comment}`] : []
            const comment = future.flatMap(pick_comment).join('/')
            const at_move_count = past_p && mc
            const branch = {tag, id, pv, comment, move_count, at_move_count}
            R.branch_for_tag.push(branch)
        })
    }
    past.forEach(add_past_branch)
}
function pv_from_moves(moves, initial_bturn) {
    let bturn = initial_bturn
    return moves.flatMap(({move, is_black}) => {
        const p = xor(bturn, is_black); bturn = !is_black
        return p ? [pass_command, move] : [move]
    })
}
function add_info_to_stones(stones, game) {
    game.forEach(h => {
        const s = stone_for_history_elem(h, stones); if (!s) {return}
        add_tag(s, h.tag)
        s.stone && (h.move_count <= game.move_count) && (s.move_count = h.move_count)
        !s.anytime_stones && (s.anytime_stones = [])
        s.anytime_stones.push(pick_properties(h, ['move_count', 'is_black']))
    })
    add_next_mark_to_stones(stones, game, game.move_count)
    add_branches_to_stones(stones, game, game.move_count)
}
function update_info_in_stones() {
    clear_info_in_stones(R.stones); add_info_to_stones(R.stones, game)
}
function clear_info_in_stones(stones) {
    const keys = ['move_count', 'tag', 'anytime_stones',
                  'next_move', 'next_is_black']
    aa_each(stones, s => keys.forEach(key => {delete s[key]}))
}
function stone_for_history_elem(h, stones) {
    return h && h.move &&
        aa_ref(stones, ...with_board_size(stones.length, move2idx, h.move))
}
function pick_properties(orig, keys) {
    const ret = {}; keys.forEach(k => ret[k] = orig[k]); return ret
}

/////////////////////////////////////////////////
// ladder

function branch_or_ladder_at(game, move_count, stones) {
    const b = M.branch_at(move_count) || []
    const l = (stones && M.ladder_branches(game, stones)) || []
    return [...b, ...l]
}

/////////////////////////////////////////////////
// exports

AI.set_handlers({suggest_handler, endstate_handler})

module.exports = {
    // basic
    set_board,
    // endstate
    append_implicit_tags_maybe,
    get_endstate_diff_interval, set_endstate_diff_interval,
    move_count_for_suggestion, set_showing_until,
    // renderer
    set_and_render,
    // util
    orig_suggest,
    update_info_in_stones, add_next_mark_to_stones,
    get_initial_b_winrate, add_info_to_stones, renew_game,
    set_ambiguity_etc_in_game,
    delete_cache, undelete_cache,
    hold_suggestion_for_a_while,
}
