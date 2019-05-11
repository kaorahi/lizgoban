// powered_goban.js: board renderer + analysis engine
// 
// set_board() indirectly updates displayed board,
// starts analysis of given game state, and updates displayed suggestions.

require('./util.js').use(); require('./coord.js').use()
const {create_game} = require('./game.js')
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
    // use entire history if move_count is omitted
    game = given_game
    const hist = game.array_until(move_count)
    each_leelaz(z => z.set_board(hist))
    R.move_count = game.move_count = hist.length
    R.bturn = !(hist[hist.length - 1] || {}).is_black
    R.visits = null
    switch_leelaz()
    on_change()
}

/////////////////////////////////////////////////
// leelaz

function start_leelaz(leelaz_start_args, endstate_option) {
    leelaz.start(with_handlers(leelaz_start_args()))
    endstate_option && start_endstate(leelaz_start_args, endstate_option)
}
function update_leelaz() {leelaz.update()}
function restart(h) {leelaz.restart(h && with_handlers(h))}
function kill_all_leelaz() {each_leelaz(z => z.kill())}
function set_pondering(pondering) {
    const b = (leelaz === leelaz_for_black)
    leelaz_for_black.set_pondering(pondering && b)
    leelaz_for_white && leelaz_for_white.set_pondering(pondering && !b)
}
function all_start_args() {
    const f = lz => lz && lz.start_args()
    return {black: f(leelaz_for_black), white: f(leelaz_for_white), both: f(leelaz)}
}
function leelaz_weight_file(leelaz_for_black_or_white) {
    const k = M.leelaz_weight_option_pos_in_args()
    const arg = (leelaz_for_black_or_white || leelaz).start_args()
    return (k >= 0) && arg && arg.leelaz_args[k + 1]
}

function each_leelaz(f) {
    [leelaz_for_black, leelaz_for_white, leelaz_for_endstate].forEach(z => z && f(z))
}
function with_handlers(h) {return merge({board_handler, suggest_handler}, h)}

/////////////////////////////////////////////////
// receive analysis from leelaz

function board_handler(h) {
    const sum = ary => flatten(ary).reduce((a, c) => a + c, 0)
    const board_setter = () => {
        add_next_mark_to_stones(R.stones, game, game.move_count)
        add_info_to_stones(R.stones, game)
    }
    const endstate_setter = update_p => {
        const add_endstate_to_history = z => {
            z.endstate = R.endstate; update_p && (z.endstate_sum = sum(R.endstate))
        }
        add_endstate_to_stones(R.stones, R.endstate, update_p)
        game.move_count > 0 && add_endstate_to_history(game.ref(game.move_count))
    }
    set_renderer_state(h)
    h.endstate || board_setter(); leelaz_for_endstate && endstate_setter(!!h.endstate)
    M.update_state()
}

const too_small_prior = 1e-3
function suggest_handler(h) {
    const considerable = z => z.visits > 0 || z.prior >= too_small_prior
    h.suggest = h.suggest.filter(considerable)
    const cur = game.ref(game.move_count)
    game.move_count > 0 && (cur.suggest = h.suggest)
    game.move_count > 0 ? (cur.b_winrate = h.b_winrate) : (initial_b_winrate = h.b_winrate)
    set_and_render(h); on_suggest()
}

/////////////////////////////////////////////////
// change renderer state and send it to renderer

function set_renderer_state(...args) {
    const move_count = game.move_count
    const winrate_history = winrate_from_game(game)
    const previous_suggest = get_previous_suggest()
    const progress_bturn = M.is_auto_bturn()
    const weight_info = weight_info_text()
    const network_size = leelaz.network_size()
    const endstate_sum = leelaz_for_endstate && average_endstate_sum()
    const endstate_d_i = leelaz_for_endstate ? {endstate_diff_interval} : {}
    merge(R, {move_count, winrate_history, endstate_sum,
              progress_bturn, weight_info, network_size,
              previous_suggest, winrate_trail}, endstate_d_i, ...args)
    // clean me: R.max_visits is needed for auto_progress()
    R.max_visits = clip(Math.max(...(R.suggest || []).map(h => h.visits)), 1)
    R.progress = M.auto_progress()
}
function set_and_render(...args) {
    set_renderer_state(...args)
    const masked_R = merge({}, R, M.show_suggest_p() ? {} : {suggest: [], visits: null})
    M.render(masked_R)
}

/////////////////////////////////////////////////
// another leelaz for white

function leelaz_for_white_p() {return !!leelaz_for_white}
function swap_leelaz_for_black_and_white() {
    if (!leelaz_for_white) {return}
    const old_black = leelaz_for_black
    leelaz_for_black = leelaz_for_white; leelaz_for_white = old_black
    leelaz_for_black.activate(!leelaz_for_endstate); leelaz_for_white.activate(false)
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
        leelaz_for_white.activate(false)
        load_weight() || (leelaz_for_white.kill(), (leelaz_for_white = null))
    }
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

/////////////////////////////////////////////////
// endstate

function leelaz_for_endstate_p() {return !!leelaz_for_endstate}
function append_endstate_tag_maybe(h) {
    const h_copy = merge({}, h)
    leelaz_for_endstate && R.show_endstate &&
        h.move_count === game.move_count - endstate_diff_interval &&
        add_tag(h_copy, endstate_diff_tag_letter)
    return h_copy
}
function get_endstate_diff_interval() {return endstate_diff_interval}
function add_endstate_diff_interval(k) {
    change_endstate_diff_target(() => {
        endstate_diff_interval = clip(endstate_diff_interval + k, 2)
    })
}
function set_endstate_diff_from(k) {
    change_endstate_diff_target(() => {endstate_diff_from = k})
}
function change_endstate_diff_target(proc) {
    const old = endstate_diff_move_count()
    proc()
    endstate_diff_move_count() !== old && (update_endstate_diff(), set_and_render())
}

function start_endstate(leelaz_start_args, endstate_option) {
    leelaz.activate(false)
    const [lz_command, weight] = endstate_option
    const es_args = {...leelaz_start_args(weight), leelaz_command: lz_command}
    leelaz_for_endstate = create_leelaz()
    leelaz_for_endstate.start(with_handlers(es_args))
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
    prev_endstate &&
        aa_each(R.stones, (s, i, j) =>
                (s.endstate_diff = sign * (s.endstate - prev_endstate[i][j])))
}
function endstate_diff_move_count() {
    return endstate_diff_from || (game.move_count - endstate_diff_interval)
}
function average_endstate_sum(move_count) {
    const mc = truep(move_count) || game.move_count
    const [cur, prev] = [0, 1].map(k => game.ref(mc - k).endstate_sum)
    return truep(cur) && truep(prev) && (cur + prev) / 2
}
function add_tag(h, tag) {h.tag = str_uniq((h.tag || '') + (tag || ''))}

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
        const pass = (!!h.is_black === !!game.ref(s - 1).is_black)
        const score_without_komi = average_endstate_sum(s)
        // drop "pass" to save data size for IPC
        return merge({r, move_b_eval, move_eval, tag, score_without_komi},
                     pass ? {pass} : {predict})
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
    const f = lz =>
          `${PATH.basename(leelaz_weight_file(lz)) || ''} ${lz.network_size() || ''}`
    return leelaz_for_white ?
        `${f(leelaz_for_black)} / ${f(leelaz_for_white)}` : f(leelaz)
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
    all_start_args, leelaz_weight_file,
    // another leelaz for white
    leelaz_for_white_p, swap_leelaz_for_black_and_white, switch_to_random_leelaz,
    load_leelaz_for_black, load_leelaz_for_white, unload_leelaz_for_white,
    // endstate
    leelaz_for_endstate_p, append_endstate_tag_maybe,
    get_endstate_diff_interval, add_endstate_diff_interval, set_endstate_diff_from,
    // renderer
    set_and_render,
    // util
    stone_for_history_elem, get_initial_b_winrate: () => initial_b_winrate,
    // leelaz methods
    ...aa2hash(exported_from_leelaz.map(key =>
                                        [key, (...args) => leelaz[key](...args)]))
}
