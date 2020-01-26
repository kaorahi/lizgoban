// powered_goban.js: board renderer + analysis engine
// 
// set_board() indirectly updates displayed board,
// starts analysis of given game state, and updates displayed suggestions.

require('./common.js').to(global)
const {create_game} = require('./game.js')
const {endstate_clusters_for} = require('./area.js')

// state
let endstate_diff_interval = 12, endstate_diff_from = null
let game = create_game()  // dummy empty game until first set_board()
const winrate_trail = true

/////////////////////////////////////////////////
// basic

function set_board(given_game) {
    game = given_game; set_board_size(game.board_size)
    const hist = game.array_until(game.move_count)
    R.move_count = game.move_count = hist.length
    R.bturn = !(hist[hist.length - 1] || {}).is_black
    R.visits = null
    set_stones(game.current_stones())
    return hist
}

function set_stones(stones) {
    R.stones = stones; add_info_to_stones(R.stones, game)
    R.prev_endstate_clusters = null
}

/////////////////////////////////////////////////
// receive analysis from leelaz

// This is not equal to R.move_count and game.move_count
// for repeated (fast) undo/redo since showboard is deferred
// in this case for efficiency.
let leelaz_move_count = 0

function endstate_handler(h) {
    if (M.is_pausing()) {return}
    const sum = ary => flatten(ary).reduce((a, c) => a + c, 0)
    const endstate_setter = update_p => {
        const leelaz_move_count = R.endstate_move_count
        const add_endstate_to_history = z => {
            z.endstate = R.endstate; if (!update_p) {return}
            z.endstate_sum = sum(R.endstate)
        }
        // need add_endstate_to_history before add_endstate_to_stones
        // because update_endstate_diff depends on game.ref_current().endstate
        leelaz_move_count > 0 && add_endstate_to_history(game.ref(leelaz_move_count))
        add_endstate_to_stones(R.stones, R.endstate, leelaz_move_count, update_p)
    }
    set_renderer_state(h)
    AI.another_leelaz_for_endstate_p() && endstate_setter(!!h.endstate)
}

const too_small_prior = 1e-3
function suggest_handler(h) {
    const considerable = z => z.visits > 0 || z.prior >= too_small_prior
    const mc = game.move_count, cur = game.ref(mc) || {}, {engine_id} = h
    h.suggest = h.suggest.filter(considerable)
    h.ownership &&
        ((cur.endstate = h.endstate = endstate_from_ownership(h.ownership)),
         (cur.score_without_komi = h.score_without_komi))
    !cur.by && (cur.by = {}); !cur.by[engine_id] && (cur.by[engine_id] = {})
    const keys = ['suggest', 'visits', 'b_winrate']
    keys.forEach(k => cur.by[engine_id][k] = cur[k] = h[k])
    game.engines[engine_id] = true
    // if current engine is Leela Zero, recall ownerships by KataGo
    const {endstate, score_without_komi} = cur
    R.show_endstate && endstate && add_endstate_to_stones(R.stones, endstate, mc, true)
    set_and_render_maybe({...h, score_without_komi}); on_suggest()
}

function endstate_from_ownership(ownership) {
    const endstate = [[]]
    aa_each(R.stones, (_, i, j) => aa_set(endstate, i, j, ownership.shift()))
    return endstate
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
    const move_count = game.move_count
    const busy = M.is_busy()
    const winrate_history = busy ? [] : winrate_from_game()
    const winrate_history_set = busy ? [[[]], []] : winrate_history_set_from_game()
    const previous_suggest = get_previous_suggest()
    const max_visits = clip(Math.max(...(R.suggest || []).map(h => h.visits)), 1)
    const progress = M.auto_progress()
    const weight_info = weight_info_text()
    const is_katago = AI.katago_p()
    const komi = game.get_komi(), bsize = board_size()
    const comment = game.ref(game.move_count).comment || ''
    const endstate_sum = truep(R.score_without_komi) ? R.score_without_komi :
          AI.another_leelaz_for_endstate_p() ? average_endstate_sum() : null
    const endstate = aa_map(R.stones, h => h.endstate || 0)
    const endstate_clusters = get_endstate_clusters(endstate)
    const endstate_d_i = truep(endstate_sum) ? {endstate_diff_interval} : {}
    const invalid_endstate_p =
          (endstate_clusters.length === 1 && endstate_clusters[0].ownership_sum === 0)
    const move_history = [{}, ...game.map(z => ({
        move: z.move, is_black: z.is_black, ko_fight: z.ko_fight,
        unsafe_stones: z.unsafe_stones, ambiguity: z.ambiguity
    }))]
    merge(R, {move_count, busy, winrate_history, winrate_history_set,
              endstate_sum, endstate_clusters, max_visits, progress,
              weight_info, is_katago, komi, bsize, comment, move_history,
              previous_suggest, winrate_trail}, endstate_d_i)
}
function set_and_render(...args) {set_and_render_gen(true, ...args)}
function set_and_render_maybe(...args) {set_and_render_gen(false, ...args)}
function set_and_render_gen(is_board_changed, ...args) {
    set_renderer_state(...args)
    const mask = M.show_suggest_p() ? {} :
          {suggest: [], visits: null, show_endstate: false}
    M.render({...R, ...mask}, is_board_changed)
}

/////////////////////////////////////////////////
// endstate

function append_endstate_tag_maybe(h) {
    const h_copy = merge({}, h)
    AI.support_endstate_p() && R.show_endstate &&
        h.move_count === game.move_count - endstate_diff_interval &&
        add_tag(h_copy, endstate_diff_tag_letter)
    return h_copy
}
function get_endstate_diff_interval() {return endstate_diff_interval}
function add_endstate_diff_interval(k) {
    // only allow an even number as the interval in leelaz_for_endstate
    // since its estimation tends to oscillate with black / white turns
    const [unit, minimum] =
          (AI.another_leelaz_for_endstate_p() && !AI.katago_p()) ? [10, 2] : [1, 1]
    change_endstate_diff_target(() => {
        endstate_diff_interval = clip(endstate_diff_interval + k * unit, minimum)
        update_info_in_stones()  // update "recent stone" marks
    })
}
function set_endstate_diff_from(k) {
    change_endstate_diff_target(() => {endstate_diff_from = k})
}
function change_endstate_diff_target(proc) {
    const old = endstate_diff_move_count()
    proc()
    endstate_diff_move_count() !== old && update_endstate_diff()
}

function add_endstate_to_stones(stones, endstate, move_count, update_diff_p) {
    if (!endstate) {return}
    aa_each(stones, (s, i, j) => (s.endstate = aa_ref(endstate, i, j)))
    update_diff_p && update_endstate_diff()
    merge(game.ref(move_count), get_ambiguity_etc(stones, game, move_count))
}
function update_endstate_diff() {
    const prev = endstate_diff_move_count(), sign = prev < game.move_count ? 1 : -1
    const prev_endstate = game.ref(prev).endstate
    const ok = prev_endstate && game.ref_current().endstate
    aa_each(R.stones, (s, i, j) =>
            (s.endstate_diff = ok ?
             sign * (s.endstate - aa_ref(prev_endstate, i, j)) : 0))
    R.prev_endstate_clusters = ok && get_endstate_clusters(prev_endstate, prev)
}
function endstate_diff_move_count() {
    const edf = endstate_diff_from, mc = game.move_count
    return (truep(edf) && edf !== mc) ? edf : (mc - endstate_diff_interval)
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
function add_tag(h, tag) {h.tag = str_uniq((h.tag || '') + (tag || ''))}

function get_endstate_clusters(endstate, move_count) {
    const stones = M.is_bogoterritory() &&
          (move_count ? game.stones_at(move_count) : R.stones)
    return endstate_clusters_for(endstate, stones)
}

function get_ambiguity_etc(stones, game, move_count) {
    // ambiguity = sum of (1 - |ownership|) for all stones on the board.
    // unsafe_stones.black
    //   = number of captured black stones + sum[1 - f(ownership)]
    //   = number of black moves - sum[f(ownership)],
    // where sum[*] is taken for all black stones on the board
    // and f(x) = x (x > 0), 0 (x <= 0).
    let ambiguity = 0, unsafe_stones = {black: 0, white: 0}
    const add_to_unsafe_stones = (black_p, val) => {
        unsafe_stones[black_p ? 'black' : 'white'] += val
    }
    const count_played_stones = () =>
          game.array_until(move_count).forEach(({move, is_black}) => {
              const pass = move2idx(move)[0] < 0
              !pass && add_to_unsafe_stones(is_black, 1)
          })
    const check_endstate = h => {
        const is_target = h.stone && truep(h.endstate); if (!is_target) {return}
        const es = Math.abs(h.endstate), dead = xor(h.black, h.endstate > 0)
        ambiguity += 1 - es
        !dead && add_to_unsafe_stones(h.black, - es)
    }
    count_played_stones(); aa_each(stones, check_endstate)
    return {ambiguity, unsafe_stones}
}

/////////////////////////////////////////////////
// winrate history

function winrate_from_game(engine_id) {
    // +1 for move_count (see game.js)
    const winrates = seq(game.len() + 1).map(mc => get_b_winrate(mc, engine_id))
    return winrates.map((r, s, a) => {
        const cur = game.ref(s)
        const h = append_endstate_tag_maybe(cur), tag = h.tag
        if (!truep(r)) {return {tag}}
        const move_b_eval = a[s - 1] && (r - a[s - 1])
        const move_eval = move_b_eval && move_b_eval * (cur.is_black ? 1 : -1)
        const predict = winrate_suggested(s, engine_id)
        const implicit_pass = (!!h.is_black === !!game.ref(s - 1).is_black)
        const pass = implicit_pass || M.is_pass(h.move)
        const score_without_komi = truep(cur.score_without_komi) ?
              cur.score_without_komi : average_endstate_sum(s)
        // drop "pass" to save data size for IPC
        return merge({r, move_b_eval, move_eval, tag, score_without_komi},
                     pass ? {pass} : {predict})
    })
}

function get_initial_b_winrate(engine_id) {return get_b_winrate(0, engine_id)}
function get_b_winrate(move_count, engine_id) {
    const ret = get_estimation(move_count, engine_id).b_winrate
    return truep(ret) ? ret : NaN
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
    ret && (ret.bturn = !prev.is_black)
    return ret
}
function weight_info_text() {
    const h = AI.engine_info(), ek = h.engine_komi, gk = game.get_komi()
    const game_komi = truep(gk) && gk != ek && ` (game komi=${gk})`
    const s = val => truep(val) ? to_s(val) : ''
    const engine_komi = (game_komi || (ek !== leelaz_komi)) ?
          `komi=${ek}${s(game_komi)} ` : ''
    const f = z => z ?
          `${z.preset_label_text} ${s(z.network_size)}${s(!z.is_ready && '(waiting...)')}` : ''
    const weight_info = h.leelaz_for_white_p ?
          `${f(h.black)} / ${f(h.white)}` : f(h.black)
    const tuning = M.tuning_message()
    return engine_komi + weight_info + (tuning ? ` | ${tuning}` : '')
}
function add_next_mark_to_stones(stones, game, move_count) {
    const h = game.ref(move_count + 1), s = stone_for_history_elem(h, stones)
    s && (s.next_move = true) && (s.next_is_black = h.is_black)
}
function add_info_to_stones(stones, game) {
    game.forEach((h, c) => {
        const s = stone_for_history_elem(h, stones); if (!s) {return}
        add_tag(s, h.tag)
        s.stone && (h.move_count <= game.move_count) && (s.move_count = h.move_count)
        AI.support_endstate_p() && truep(s.move_count) &&
            (game.move_count - endstate_diff_interval < s.move_count) &&
            (s.recent = true)
        !s.anytime_stones && (s.anytime_stones = [])
        s.anytime_stones.push(pick_properties(h, ['move_count', 'is_black']))
    })
    add_next_mark_to_stones(stones, game, game.move_count)
}
function update_info_in_stones() {
    clear_info_in_stones(R.stones); add_info_to_stones(R.stones, game)
}
function clear_info_in_stones(stones) {
    const keys = ['move_count', 'tag', 'recent', 'anytime_stones',
                  'next_move', 'next_is_black']
    aa_each(stones, s => keys.forEach(key => {delete s[key]}))
}
function stone_for_history_elem(h, stones) {
    return h && h.move && aa_ref(stones, ...move2idx(h.move))
}
function pick_properties(orig, keys) {
    const ret = {}; keys.forEach(k => ret[k] = orig[k]); return ret
}

/////////////////////////////////////////////////
// exports

require('./give_and_take.js').offer(module, {
    // basic
    set_board,
    // endstate
    append_endstate_tag_maybe,
    get_endstate_diff_interval, add_endstate_diff_interval, set_endstate_diff_from,
    // renderer
    set_and_render,
    // util
    stone_for_history_elem, update_info_in_stones, weight_info_text,
    get_initial_b_winrate,
}, global, () => AI.set_handlers({suggest_handler, endstate_handler}))
