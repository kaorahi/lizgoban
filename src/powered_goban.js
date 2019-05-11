require('./util.js').use(); require('./coord.js').use()
const PATH = require('path')

// state
let initial_b_winrate = NaN, winrate_trail = true
let R, on_change, M, V
function initialize(...args) {  // fixme: ugly
    [R, on_change, M] = args; V = M.peek_main
}

// leelaz
const {create_leelaz} = require('./engine.js')
let leelaz = create_leelaz(), leelaz_for_black = leelaz
let leelaz_for_white = null, leelaz_for_endstate = null

function start_endstate(es_args) {
    leelaz_for_endstate = create_leelaz()
    leelaz_for_endstate.start(es_args); leelaz_for_endstate.set_pondering(false)
}
function each_leelaz(f) {
    [leelaz_for_black, leelaz_for_white, leelaz_for_endstate].forEach(z => z && f(z))
}

/////////////////////////////////////////////////
// set_board

function set_board(game, move_count) {
    const hist = game ? game.array_until(move_count) : []
    each_leelaz(z => z.set_board(hist)); R.move_count = hist.length
    R.bturn = !(hist[hist.length - 1] || {}).is_black
    R.visits = null
    switch_leelaz()
    on_change()
}

/////////////////////////////////////////////////
// main flow (4) receive analysis from leelaz

function board_handler(h) {
    const game = V().game
    const sum = ary => flatten(ary).reduce((a, c) => a + c, 0)
    const board_setter = () => {
        add_next_mark_to_stones(R.stones, game, R.move_count)
        add_info_to_stones(R.stones, game)
    }
    const endstate_setter = update_p => {
        const prev = R.move_count - V().endstate_diff_interval
        const prev_endstate = update_p && game.ref(prev).endstate
        const add_endstate_to_history = z => {
            z.endstate = R.endstate; update_p && (z.endstate_sum = sum(R.endstate))
        }
        add_endstate_to_stones(R.stones, R.endstate, prev_endstate)
        R.move_count > 0 && add_endstate_to_history(game.ref(R.move_count))
    }
    set_renderer_state(h)
    h.endstate || board_setter(); leelaz_for_endstate && endstate_setter(!!h.endstate)
    M.update_state()
}

const too_small_prior = 1e-3
function suggest_handler(h) {
    const game = V().game
    const considerable = z => z.visits > 0 || z.prior >= too_small_prior
    h.suggest = h.suggest.filter(considerable)
    const cur = game.ref(R.move_count)
    R.move_count > 0 && (cur.suggest = h.suggest)
    R.move_count > 0 ? (cur.b_winrate = h.b_winrate) : (initial_b_winrate = h.b_winrate)
    set_and_render(h); M.try_auto()
}

/////////////////////////////////////////////////
// main flow (5) change renderer state and send it to renderer

function set_renderer_state(...args) {
    const winrate_history = winrate_from_game(V().game)
    const previous_suggest = get_previous_suggest()
    const progress_bturn = V().auto_bturn
    const weight_info = weight_info_text()
    const network_size = leelaz.network_size()
    const endstate_sum = leelaz_for_endstate && average_endstate_sum()
    const endstate_diff_interval = V().endstate_diff_interval
    const endstate_d_i = leelaz_for_endstate ? {endstate_diff_interval} : {}
    const stored_keys = ['lizzie_style', 'expand_winrate_bar', 'let_me_think',
                         'show_endstate']
    stored_keys.forEach(key => R[key] = M.store.get(key, false))
    merge(R, {winrate_history, endstate_sum,
              progress_bturn,
              weight_info, network_size, tag_letters, start_moves_tag_letter,
              endstate_diff_tag_letter,
              previous_suggest, winrate_trail}, endstate_d_i, ...args)
    // clean me: R.max_visits is needed for auto_progress()
    R.max_visits = clip(Math.max(...(R.suggest || []).map(h => h.visits)), 1)
    R.progress = M.auto_progress()
}
function set_and_render(...args) {
    set_renderer_state(...args)
    const masked_R = merge({}, R, M.show_suggest_p() ? {} : {suggest: [], visits: null})
    V().renderer('render', masked_R)
}

/////////////////////////////////////////////////
// another leelaz for white

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
        (leelaz = next_leelaz) && (update_ponder(), M.update_state())
}

function swap_leelaz_for_black_and_white() {
    if (!leelaz_for_white) {return}
    const old_black = leelaz_for_black
    leelaz_for_black = leelaz_for_white; leelaz_for_white = old_black
    leelaz_for_black.activate(!leelaz_for_endstate); leelaz_for_white.activate(false)
    switch_leelaz()
}

/////////////////////////////////////////////////
// winrate history

function winrate_before(move_count) {return winrate_after(move_count - 1)}

function winrate_after(move_count) {
    const or_NaN = x => truep(x) ? x : NaN
    return move_count < 0 ? NaN :
        move_count === 0 ? initial_b_winrate :
        or_NaN(game.ref(move_count).b_winrate)
}

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
    const game = V().game
    const {move, is_black} = game.ref(move_count)
    const {suggest} = game.ref(move_count - 1)
    const sw = ((suggest || []).find(h => h.move === move && h.visits > 0) || {}).winrate
    return truep(sw) && (is_black ? sw : 100 - sw)
}

/////////////////////////////////////////////////
// tag letter
let next_tag_count = 0
const normal_tag_letters = 'bcdefghijklmnorstuvwy'
const last_loaded_element_tag_letter = '.'
const start_moves_tag_letter = "'"
const endstate_diff_tag_letter = "/"
const tag_letters = normal_tag_letters + last_loaded_element_tag_letter +
      start_moves_tag_letter + endstate_diff_tag_letter
function new_tag() {
    const game = V().game
    const used = game.map(h => h.tag || '').join('')
    const first_unused_index = normal_tag_letters.repeat(2).slice(next_tag_count)
          .split('').findIndex(c => used.indexOf(c) < 0)
    const tag_count = (next_tag_count + Math.max(first_unused_index, 0))
          % normal_tag_letters.length
    next_tag_count = tag_count + 1
    return normal_tag_letters[tag_count]
}

/////////////////////////////////////////////////
// utils for updating renderer state

function average_endstate_sum(move_count) {
    const game = V().game
    const mc = truep(move_count) || R.move_count
    const [cur, prev] = [0, 1].map(k => game.ref(mc - k).endstate_sum)
    return truep(cur) && truep(prev) && (cur + prev) / 2
}

function get_previous_suggest() {
    const [cur, prev] = [0, 1].map(k => V().game.ref(R.move_count - k))
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

function append_endstate_tag_maybe(h) {
    const h_copy = merge({}, h)
    const endstate_diff_interval = V().endstate_diff_interval
    leelaz_for_endstate && R.show_endstate &&
        h.move_count === R.move_count - endstate_diff_interval &&
        add_tag(h_copy, endstate_diff_tag_letter)
    return h_copy
}

function add_tag(h, tag) {h.tag = str_uniq((h.tag || '') + (tag || ''))}

function add_next_mark_to_stones(stones, game, move_count) {
    const h = game.ref(move_count + 1), s = stone_for_history_elem(h, stones)
    s && (s.next_move = true) && (s.next_is_black = h.is_black)
}

function add_info_to_stones(stones, game) {
    game.forEach((h, c) => {
        const s = stone_for_history_elem(h, stones); if (!s) {return}
        add_tag(s, h.tag)
        s.stone && (h.move_count <= R.move_count) && (s.move_count = h.move_count)
        leelaz_for_endstate && truep(s.move_count) &&
            (R.move_count - V().endstate_diff_interval < s.move_count) && (s.recent = true)
        !s.anytime_stones && (s.anytime_stones = [])
        s.anytime_stones.push(pick_properties(h, ['move_count', 'is_black']))
    })
}

function add_endstate_to_stones(stones, endstate, prev_endstate) {
    if (!endstate) {return}
    stones.forEach((row, i) => row.forEach((s, j) => {
        s.endstate = endstate[i][j]
        prev_endstate && (s.endstate_diff = s.endstate - prev_endstate[i][j])
    }))
}

function stone_for_history_elem(h, stones) {
    return h && h.move && aa_ref(stones, ...move2idx(h.move))
}

function pick_properties(orig, keys) {
    const ret = {}; keys.forEach(k => ret[k] = orig[k]); return ret
}

/////////////////////////////////////////////////
// exports

function leelaz_weight_file(leelaz_for_black_or_white) {
    const k = M.leelaz_weight_option_pos_in_args()
    const arg = (leelaz_for_black_or_white || leelaz).start_args()
    return (k >= 0) && arg && arg.leelaz_args[k + 1]
}

function L() {return {leelaz, leelaz_for_black, leelaz_for_white, leelaz_for_endstate}}

module.exports = {
    initialize, set_board, switch_leelaz,
    stone_for_history_elem, new_tag, set_renderer_state, set_and_render,
    append_endstate_tag_maybe,
    L,
    board_handler, suggest_handler, create_leelaz,
    load_leelaz_for_white, unload_leelaz_for_white, with_temporary_leelaz,
    leelaz_weight_file, start_endstate,
    each_leelaz,
}
