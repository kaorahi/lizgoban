// powered_goban.js: board renderer + analysis engine
// 
// set_board() indirectly updates displayed board,
// starts analysis of given game state, and updates displayed suggestions.

require('./util.js').use(); require('./coord.js').use()
const {create_game} = require('./game.js')
const {endstate_clusters_for} = require('./area.js')
const PATH = require('path')

// leelaz
const {create_leelaz} = require('./engine.js')
let leelaz = create_leelaz(), leelaz_for_black = leelaz
let leelaz_for_white = null, leelaz_for_endstate = null

// state
let endstate_diff_interval = 12, endstate_diff_from = null, initial_b_winrate = NaN
let game = create_game()  // dummy empty game until first set_board()
const winrate_trail = true
let R, on_change, on_suggest, M

/////////////////////////////////////////////////
// basic

function initialize(...args) {[R, {on_change, on_suggest}, M] = args}  // fixme: ugly

function set_board(given_game, move_count) {
    // use game.move_count if move_count is omitted
    game = given_game
    const hist = game.array_until(truep(move_count) ? move_count : game.move_count)
    each_leelaz(z => z.set_board(hist), katago_p())
    R.move_count = game.move_count = hist.length
    R.bturn = !(hist[hist.length - 1] || {}).is_black
    R.visits = null
    set_stones(game.current_stones())
    switch_leelaz()
    on_change()
    M.is_busy() || M.update_state()
}

function set_stones(stones) {
    R.stones = stones; add_info_to_stones(R.stones, game)
    R.prev_endstate_clusters = null
    // avoid flicker for fast undo/redo
    leelaz_for_endstate_p() && add_endstate_to_stones(R.stones, R.endstate)
}

/////////////////////////////////////////////////
// leelaz

function start_leelaz(leelaz_start_args, endstate_option) {
    leelaz.start(with_handlers(leelaz_start_args()))
    endstate_option && start_endstate(leelaz_start_args, endstate_option)
}
function update_leelaz() {leelaz.update()}
function restart(h, new_weight_p) {
    const cooked = h && with_handlers(h)
    const error_handler =
          (leelaz === leelaz_for_white) ? invalid_weight_for_white : do_nothing
    leelaz.restart(new_weight_p ? {...cooked, error_handler} : cooked)
}
function kill_all_leelaz() {each_leelaz(z => z.kill())}
function set_pondering(pausing, busy) {
    const pondering = !pausing && !busy
    const b = (leelaz === leelaz_for_black)
    pausing && clear_endstate()
    leelaz_for_black.set_pondering(pondering && b)
    leelaz_for_white && leelaz_for_white.set_pondering(pondering && !b)
}
function all_start_args() {
    const f = lz => lz && lz.start_args()
    return {black: f(leelaz_for_black), white: f(leelaz_for_white), both: f(leelaz)}
}
function leelaz_weight_file(leelaz_for_black_or_white) {
    return (leelaz_for_black_or_white || leelaz).get_weight_file()
}

function each_leelaz(f, for_black_and_white_only) {
    [leelaz_for_black, leelaz_for_white,
     !for_black_and_white_only && leelaz_for_endstate].forEach(z => z && f(z))
}
function with_handlers(h) {return merge({suggest_handler}, h)}

function katago_p() {return leelaz.is_katago()}

/////////////////////////////////////////////////
// receive analysis from leelaz

// This is not equal to R.move_count and game.move_count
// for repeated (fast) undo/redo since showboard is deferred
// in this case for efficiency.
let leelaz_move_count = 0

function endstate_handler(h) {
    const sum = ary => flatten(ary).reduce((a, c) => a + c, 0)
    const endstate_setter = update_p => {
        const leelaz_move_count = R.endstate_move_count
        const add_endstate_to_history = z => {
            z.endstate = R.endstate; if (!update_p) {return}
            z.endstate_sum = sum(R.endstate)
            z.hotness = sum_of_endstate_change(leelaz_move_count)
        }
        // need add_endstate_to_history before add_endstate_to_stones
        // because update_endstate_diff depends on game.ref_current().endstate
        leelaz_move_count > 0 && add_endstate_to_history(game.ref(leelaz_move_count))
        add_endstate_to_stones(R.stones, R.endstate, update_p)
    }
    set_renderer_state(h)
    leelaz_for_endstate && endstate_setter(!!h.endstate)
    M.update_state()
}

const too_small_prior = 1e-3
function suggest_handler(h) {
    const considerable = z => z.visits > 0 || z.prior >= too_small_prior
    const mc = game.move_count, cur = game.ref(mc) || {}
    h.suggest = h.suggest.filter(considerable)
    R.show_endstate && h.ownership &&
        ((cur.endstate = h.endstate = endstate_from_ownership(h.ownership)),
         (cur.hotness = sum_of_endstate_change(game.move_count)),
         (cur.score_without_komi = h.score_without_komi),
         add_endstate_to_stones(R.stones, h.endstate, true))
    cur.suggest = h.suggest; cur.visits = h.visits;
    mc > 0 ? (cur.b_winrate = h.b_winrate) : (initial_b_winrate = h.b_winrate)
    set_and_render_maybe(h); on_suggest()
}

function endstate_from_ownership(ownership) {
    const endstate = [[]]
    aa_each(R.stones, (_, i, j) => aa_set(endstate, i, j, ownership.shift()))
    return endstate
}

/////////////////////////////////////////////////
// change renderer state and send it to renderer

function set_renderer_state(...args) {
    merge(R, ...args)  // use updated R in below lines
    const move_count = game.move_count
    const busy = M.is_busy()
    const winrate_history = busy ? [] : winrate_from_game(game)
    const previous_suggest = get_previous_suggest()
    const max_visits = clip(Math.max(...(R.suggest || []).map(h => h.visits)), 1)
    const progress = M.auto_progress()
    const progress_bturn = M.is_auto_bturn()
    const weight_info = weight_info_text()
    const is_katago = katago_p()
    const endstate_sum = truep(R.score_without_komi) ? R.score_without_komi :
          leelaz_for_endstate ? average_endstate_sum() : null
    const endstate = aa_map(R.stones, h => h.endstate || 0)
    const endstate_clusters = endstate_clusters_for(endstate)
    const endstate_d_i = truep(endstate_sum) ? {endstate_diff_interval} : {}
    merge(R, {move_count, busy, winrate_history, endstate_sum, endstate_clusters,
              max_visits, progress,
              progress_bturn, weight_info, is_katago,
              previous_suggest, winrate_trail}, endstate_d_i)
}
function set_and_render(...args) {set_and_render_gen(true, ...args)}
function set_and_render_maybe(...args) {set_and_render_gen(false, ...args)}
function set_and_render_gen(is_board_changed, ...args) {
    set_renderer_state(...args)
    const masked_R = merge({}, R, M.show_suggest_p() ? {} : {suggest: [], visits: null})
    M.render(masked_R, is_board_changed)
}

function clear_endstate() {R.endstate = null}

/////////////////////////////////////////////////
// another leelaz for white

function leelaz_for_white_p() {return !!leelaz_for_white}
function swap_leelaz_for_black_and_white() {
    if (!leelaz_for_white) {return}
    const old_black = leelaz_for_black
    leelaz_for_black = leelaz_for_white; leelaz_for_white = old_black
    switch_leelaz()
}
function switch_to_random_leelaz(percent) {
    switch_leelaz(xor(R.bturn, Math.random() < percent / 100))
}
function load_leelaz_for_black(load_weight) {
    with_temporary_leelaz(leelaz_for_black, load_weight)
}
function load_leelaz_for_white(load_weight) {
    const proc = () => {
        load_weight() || (leelaz_for_white.kill(), (leelaz_for_white = null))
    }
    with_temporary_leelaz(leelaz_for_white = create_leelaz(), proc)
}
function set_engine_for_white(command_args) {
    unload_leelaz_for_white()
    const [leelaz_command, ...leelaz_args] = command_args
    const start_args = {...leelaz_for_black.start_args(), leelaz_command, leelaz_args}
    const proc = () => leelaz_for_white.start(start_args)
    with_temporary_leelaz(leelaz_for_white = create_leelaz(), proc)
}
function unload_leelaz_for_white() {
    switch_to_another_leelaz(leelaz_for_black)
    leelaz_for_white && leelaz_for_white.kill(); leelaz_for_white = null
    M.update_state()
}

// internal

function with_temporary_leelaz(leelaz_for_black_or_white, proc) {
    leelaz = leelaz_for_black_or_white; proc()
    leelaz = leelaz_for_black; switch_leelaz()
}
function switch_leelaz(bturn) {
    switch_to_another_leelaz((bturn === undefined ? R.bturn : bturn) ?
                             leelaz_for_black : leelaz_for_white)
}
function switch_to_another_leelaz(next_leelaz) {
    next_leelaz && next_leelaz !== leelaz &&
        (leelaz = next_leelaz) && (M.update_ponder(), M.update_state())
}
function invalid_weight_for_white() {
    M.error_from_powered_goban('Invalid weights file (for white)')
    unload_leelaz_for_white()
}

/////////////////////////////////////////////////
// endstate

function leelaz_for_endstate_p() {return katago_p() || !!leelaz_for_endstate}
function append_endstate_tag_maybe(h) {
    const h_copy = merge({}, h)
    leelaz_for_endstate_p() && R.show_endstate &&
        h.move_count === game.move_count - endstate_diff_interval &&
        add_tag(h_copy, endstate_diff_tag_letter)
    return h_copy
}
function get_endstate_diff_interval() {return endstate_diff_interval}
function add_endstate_diff_interval(k) {
    // only allow an even number as the interval in leelaz_for_endstate
    // since its estimation tends to oscillate with black / white turns
    const [unit, minimum] = (leelaz_for_endstate && !katago_p()) ? [10, 2] : [1, 1]
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
    endstate_diff_move_count() !== old && (update_endstate_diff(), M.update_state(true))
}

function start_endstate(leelaz_start_args, endstate_option) {
    const [lz_command, x] = endstate_option, x_type = typeof x
    const weight = (x_type === 'string') && x
    const more = (x_type === 'object') ? {leelaz_args: x} : {}
    const start_args = {...leelaz_start_args(weight), endstate_handler,
                        leelaz_command: lz_command, ...more}
    leelaz_for_endstate = create_leelaz()
    leelaz_for_endstate.start(start_args)
    leelaz_for_endstate.set_pondering(false)
}
function add_endstate_to_stones(stones, endstate, update_diff_p) {
    if (!endstate) {return}
    aa_each(stones, (s, i, j) => (s.endstate = endstate[i][j]))
    update_diff_p && update_endstate_diff()
}
function update_endstate_diff() {
    const prev = endstate_diff_move_count(), sign = prev < game.move_count ? 1 : -1
    const prev_endstate = game.ref(prev).endstate
    const ok = prev_endstate && game.ref_current().endstate
    aa_each(R.stones, (s, i, j) =>
            (s.endstate_diff = ok ? sign * (s.endstate - prev_endstate[i][j]) : 0))
    R.prev_endstate_clusters = ok && endstate_clusters_for(prev_endstate)
}
function endstate_diff_move_count() {
    return endstate_diff_from || (game.move_count - endstate_diff_interval)
}
function average_endstate_sum(move_count) {
    return for_current_and_previous_endstate(move_count, 'endstate_sum', 1,
                                             (cur, prev) => (cur + prev) / 2)
}
function sum_of_endstate_change(move_count) {
    // delta = 2 for leelaz_for_endstate since it tends to oscillate
    let sum = 0, delta = katago_p() ? 1 : 2
    const f = (cur, prev) =>
          (aa_each(cur, (c, i, j) => (sum += Math.abs(c - prev[i][j]))), true)
    return for_current_and_previous_endstate(move_count, 'endstate', delta, f) && sum
}
function for_current_and_previous_endstate(move_count, key, delta, f) {
    const mc = truep(move_count) || game.move_count
    const [cur, prev] = [0, delta].map(k => game.ref(mc - k)[key])
    return truep(cur) && truep(prev) && f(cur, prev)
}
function add_tag(h, tag) {h.tag = str_uniq((h.tag || '') + (tag || ''))}

/////////////////////////////////////////////////
// komi

const leelaz_komi = 7.5
let engine_komi = leelaz_komi
function support_komi_p() {return katago_p()}
function get_engine_komi() {return support_komi_p() ? engine_komi : leelaz_komi}
function set_engine_komi(komi) {engine_komi = komi; restart({komi})}

/////////////////////////////////////////////////
// winrate history

function winrate_from_game(game) {
    const winrates = game.map(m => m.b_winrate)
    return [initial_b_winrate, ...winrates].map((r, s, a) => {
        const cur = game.ref(s)
        const h = append_endstate_tag_maybe(cur), tag = h.tag
        if (!truep(r)) {return {tag}}
        const move_b_eval = a[s - 1] && (r - a[s - 1])
        const move_eval = move_b_eval && move_b_eval * (cur.is_black ? 1 : -1)
        const predict = winrate_suggested(s)
        const implicit_pass = (!!h.is_black === !!game.ref(s - 1).is_black)
        const pass = implicit_pass || M.is_pass(h.move)
        const score_without_komi = truep(cur.score_without_komi) ?
              cur.score_without_komi : average_endstate_sum(s)
        const hotness = h.hotness
        const best = (h.suggest || [])[0]
        const uncertainty = best && (1 - best.visits / h.visits)
        // drop "pass" to save data size for IPC
        return merge({r, move_b_eval, move_eval, tag, score_without_komi, hotness,
                      uncertainty}, pass ? {pass} : {predict})
    })
}

function winrate_suggested(move_count) {
    const {move, is_black} = game.ref(move_count)
    const {suggest} = game.ref(move_count - 1)
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
    const ek = get_engine_komi()
    const engine_komi = (ek === leelaz_komi) ? '' : `komi=${ek} `
    const f = lz =>
          `${PATH.basename(leelaz_weight_file(lz) || '')} ${lz.network_size() || ''}`
    const weight_info = leelaz_for_white ?
          `${f(leelaz_for_black)} / ${f(leelaz_for_white)}` : f(leelaz)
    return engine_komi + weight_info
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
        leelaz_for_endstate && truep(s.move_count) &&
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

const exported_from_leelaz = ['send_to_leelaz', 'peek_value']
module.exports = {
    // basic
    initialize, set_board,
    // leelaz
    start_leelaz, update_leelaz, set_pondering, restart, kill_all_leelaz,
    all_start_args, leelaz_weight_file, katago_p,
    // another leelaz for white
    leelaz_for_white_p, swap_leelaz_for_black_and_white, switch_to_random_leelaz,
    load_leelaz_for_black, load_leelaz_for_white, unload_leelaz_for_white,
    set_engine_for_white,
    // endstate
    leelaz_for_endstate_p, append_endstate_tag_maybe,
    get_endstate_diff_interval, add_endstate_diff_interval, set_endstate_diff_from,
    // komi
    support_komi_p, get_engine_komi, set_engine_komi,
    // renderer
    set_and_render,
    // util
    stone_for_history_elem, update_info_in_stones,
    get_initial_b_winrate: () => initial_b_winrate,
    // leelaz methods
    ...aa2hash(exported_from_leelaz.map(key =>
                                        [key, (...args) => leelaz[key](...args)]))
}
