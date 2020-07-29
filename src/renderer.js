// -*- coding: utf-8 -*-

/////////////////////////////////////////////////
// setup

// util
function Q(x) {return document.querySelector(x)}
function Q_all(x) {return document.querySelectorAll(x)}
const electron = require('electron'), ipc = electron.ipcRenderer
const {globalize} = require('./globalize.js')
globalize(require('./util.js'), require('./coord.js'), require('./draw_common.js'))
const current_window = electron.remote.getCurrentWindow()
const {sgf_rule_from_katago_rule} = require('./katago_rules.js')

// canvas
const main_canvas = Q('#goban'), sub_canvas = Q('#sub_goban')
const additional_graph_canvas = Q('#additional_graph')
const winrate_bar_canvas = Q('#winrate_bar'), winrate_graph_canvas = Q('#winrate_graph')
const graph_overlay_canvas = Q('#graph_overlay')
const visits_trail_canvas = Q('#visits_trail_canvas')
const zone_chart_canvas = Q('#zone_chart_canvas')
let canvas_scale = 1

// renderer state
const R = {
    stones: [], black_hama: 0, white_hama: 0, move_count: 0, handicaps: 0, bturn: true,
    history_length: 0, suggest: [], visits: 1,
    trial_from: null,
    visits_per_sec: 0,
    winrate_history: [], winrate_history_set: [[[]], []], previous_suggest: null,
    attached: false, pausing: false, auto_analyzing: false, winrate_trail: false,
    in_match: false,
    hide_suggest: false,
    expand_winrate_bar: false, let_me_think: false, score_bar: false,
    max_visits: 1, board_type: 'double_boards', previous_board_type: '',
    progress: 0.0, weight_info: '', is_katago: false, engine_id: null,
    komi: 7.5, player_black: '', player_white: '',
    move_history: [],
    sequence_cursor: 1, sequence_length: 1, sequence_ids: [], sequence_props: {},
    history_tags: [], endstate_clusters: [], prev_endstate_clusters: null,
    is_endstate_drawable: false,
    lizzie_style: false,
    window_id: -1,
    image_paths: null, image: null, stone_image_p: true, board_image_p: true,
    stone_style: '2D',
}
globalize(R)
let temporary_board_type = null, the_first_board_canvas = null
let keyboard_moves = [], keyboard_tag_move_count = null
let hovered_move = null, hovered_move_count = null, hovered_board_canvas = null
let the_showing_movenum_p = false, the_showing_endstate_value_p = false
let thumbnails = []

// drawer
const D = require('./draw.js')

// handler
window.onload = window.onresize = update
window.onfocus = update_for_mac
function update()  {set_all_canvas_size(); update_goban(); update_for_mac()}
function update_for_mac() {mac_p() && main('update_menu')}  // for board_type_menu_item

/////////////////////////////////////////////////
// util

function setq(x, val) {Q(x).textContent = val}
function setdebug(x) {setq('#debug', JSON.stringify(x))}
globalize(setdebug)

// for debug from Developper Tool
function send_to_leelaz(cmd) {main('send_to_leelaz', cmd)}

/////////////////////////////////////////////////
// action

function new_window() {main('new_window', R.board_type === 'suggest' ? 'variation' : 'suggest')}
function toggle_auto_analyze() {
    main('toggle_auto_analyze', auto_analysis_visits_setting())
}
function toggle_auto_analyze_visits() {
    R.auto_analyzing ? main('stop_auto') : Q('#auto_analysis_visits').select()
}
function auto_analysis_visits_setting () {
    return to_i(Q('#auto_analysis_visits').value)
}

let on_generic_input_dialog_submit = do_nothing
function show_generic_input_dialog(warning, label, init_val, submit) {
    on_generic_input_dialog_submit = submit
    Q('#generic_input_dialog_warning').innerText = warning
    Q('#generic_input_dialog_label').innerText = label
    init_val && (Q('#generic_input_dialog_input').value = to_s(init_val))
    show_dialog('#generic_input_dialog')
}
function submit_generic_input_dialog() {
    on_generic_input_dialog_submit(to_f(Q('#generic_input_dialog_input').value))
    hide_dialog()
}

function set_game_info() {
    const keys = ['#player_black', '#player_white', '#board_size', '#handicap',
                  '#komi', '#sgf_rule', '#rule', '#comment_form', '#initial_p']
    const [pb, pw, sz_text, hc_test, komi_text, sgf_rule, rule, comment, ip_text] =
          keys.map(key => Q(key).value)
    const sz = to_i(sz_text), hc = to_i(hc_test)
    const komi = Math.round(to_f(komi_text) * 2) / 2  // int or half-int
    const initial_p = (ip_text === 'yes')
    main('set_game_info', pb, pw, sz, hc, komi, sgf_rule, rule, comment, initial_p)
    hide_dialog()
}

function show_dialog(name, selected) {
    Q(name).style.visibility = "visible"; Q(`${name} ${selected || "input"}`).select()
}
function hide_dialog() {
    document.querySelectorAll(".dialog").forEach(d => d.style.visibility = "hidden")
}

function play_moves(moves) {
    const tag = k => (k === 0) && start_moves_tag_letter
    const com = k => `by suggestion (${k + 1})`
    const play1 = (move, k) => main('play', move, false, tag(k), com(k))
    moves && moves.forEach(play1)
}

function stop_match() {main('stop_match', R.window_id)}

function alert_comment() {
    const comment = Q('#comment').textContent; comment ? alert(comment) : wink()
}

function main(channel, ...args) {ipc.send(channel, ...args)}

/////////////////////////////////////////////////
// from main

const render_in_capacity = skip_too_frequent_requests(render_now)

ipc.on('render', (...args) => {
    const [e, h, is_board_changed] = args
    // for readable variation display
    keep_selected_variation_maybe(h.suggest)
    // renderer state must be updated before update_ui is called
    merge(R, h)
    initialize_image_maybe()
    render_in_capacity(...args)
})

function render_now(e, h, is_board_changed) {
    set_board_size(R.bsize)
    setq('#move_count', D.movenum())
    setq('#black_hama', R.black_hama)
    setq('#white_hama', R.white_hama)
    setq('#history_length', ' (' + D.max_movenum() + ')')
    setq('#comment', R.comment_note)
    D.update_winrate_trail()
    update_goban()
}

ipc.on('update_ui', (e, win_prop, availability, ui_only) => {
    R.pausing = availability.resume
    R.auto_analyzing = availability.stop_auto
    merge(R, win_prop)
    set_all_canvas_size()
    if (R.busy) {return}
    ui_only || update_goban()
    update_body_color()
    update_button_etc(availability)
    update_board_type()
    update_all_thumbnails()
    update_title()
    try_thumbnail()
})

ipc.on('generic_input_dialog', (e, label, init_val, channel, warning) =>
       show_generic_input_dialog(warning, label, init_val, val => main(channel, val)))

ipc.on('ask_game_info', (e, params) => {
    const {info_text, sgf_rule, current_rule, supported_rules,
           asking_komi_p, initial_p} = params
    const unless_initial = text => initial_p ? '' : text
    // defaults
    Q('#player_black').value = unless_initial(R.player_black)
    Q('#player_white').value = unless_initial(R.player_white)
    Q('#board_size').value = board_size()
    Q('#handicap').value = R.handicaps
    Q('#komi').value = R.komi
    Q('#sgf_rule').value = sgf_rule
    Q('#comment_form').value = R.comment
    Q('#info_form').value = info_text
    Q('#initial_p').value = initial_p ? "yes" : "no"
    // rule selection
    const sel = Q('#rule'), rules = supported_rules || ['unsupported']
    while (sel.firstChild) {sel.removeChild(sel.firstChild)}
    sel.append(...rules.map(rule => {
        const opt = document.createElement("option")
        opt.value =  opt.innerText = rule; return opt
    }))
    sel.value = supported_rules ? current_rule : rules[0]
    sel.disabled = !supported_rules
    sel.onchange = () => {
        const new_sgf_rule = sgf_rule_from_katago_rule(sel.value)
        new_sgf_rule && (Q('#sgf_rule').value = new_sgf_rule)
    }
    // hide parts
    update_ui_element('.game_info_dialog_initial', initial_p)
    update_ui_element('.game_info_dialog_non_initial', !initial_p)
    // show it
    show_dialog('#game_info_dialog', asking_komi_p && '#komi')
})

ipc.on('take_thumbnail', (e, id, stones, trial_p) => take_thumbnail(id, stones, trial_p))
ipc.on('slide_in', (e, direction) => slide_in(direction))
ipc.on('wink', (e) => wink())
ipc.on('toast', (e, ...a) => toast(...a))

function skip_too_frequent_requests(f) {
    let latest_request = null
    const do_latest = () => {f(...latest_request); latest_request = null}
    return (...args) => {
        const idle = !latest_request; latest_request = args
        idle && setTimeout(do_latest)  // executed in the next event cycle
        // https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/setTimeout
    }
}

function initialize_image_maybe() {
    !image && R.image_paths && (R.image = aa2hash(R.image_paths.map(([key, path]) => {
        const img = new Image(); img.src = path; return [key, img]
    })))
}

let last_title = ''
function update_title() {
    const b = R.player_black, w = R.player_white
    const n = x => x || '?'
    const names = (b || w) ? `(B: ${n(b)} / W: ${n(w)})` : ''
    const tags = current_tag_letters()
    const tag_text = tags ? `[${tags}]` : ''
    const title = `LizGoban ${names} ${tag_text} ${R.weight_info || ''}`
    if (title !== last_title) {current_window.setTitle(title); last_title = title}
}

function current_tag_letters() {
    return R.history_tags.map(x => x.tag).join('')
        .replace(endstate_diff_tag_letter, '')
}

function update_body_color() {
    [Q('#body').style.color, Q('#body').style.backgroundColor] =
        R.attached ? ['white', '#111'] :
        in_match_p() ? ['white', '#232'] :
        R.let_me_think ? ['white', '#223'] : ['white', '#444']
}

function keep_selected_variation_maybe(suggest) {
    const sticky = any_selected_suggest(); if (!sticky) {return}
    const {move, pv} = sticky, s = suggest.find(z => z.move === move)
    s ? (s.pv = pv) : merge(suggest, sticky)  // can't happen?
}
function clear_selected_variation() {R.suggest = []}  // fixme: overkill

/////////////////////////////////////////////////
// draw parts

// set option "main_canvas_p" etc. for d(canvas, opts)
function with_opts(d, opts) {
    return c => {
        update_first_board_canvas(c); const firstp = is_first_board_canvas(c)
        if (R.busy && !firstp) {return}
        d(c, {
            main_canvas_p: c === main_canvas, selected_suggest: selected_suggest(c),
            first_board_p: firstp, draw_visits_p: firstp,
            pausing_p: R.pausing, trial_p: R.trial,
            show_until: showing_until(c),
            hovered_move: if_hover_on(c, hovered_move),
            cheap_shadow_p: R.long_busy,
            handle_mouse_on_goban,
            ...((typeof opts === 'function') ? opts() : opts || {}),
        })
    }
}

const ignore_mouse = {handle_mouse_on_goban: ignore_mouse_on_goban}
const draw_main = with_opts(D.draw_main_goban)
const draw_pv = with_opts(D.draw_goban_with_principal_variation, ignore_mouse)
const draw_raw_gen = options => with_opts(D.draw_raw_goban, options)
const draw_raw_unclickable = draw_raw_gen({draw_last_p: true, read_only: true})
const draw_raw_clickable = draw_raw_gen({draw_last_p: true})
const draw_raw_pure = draw_raw_gen({})
const draw_raw_main = draw_raw_gen({draw_last_p: true})
const draw_es_gen = options => with_opts(D.draw_endstate_goban, options)
const draw_current_endstate_value = draw_es_gen({draw_endstate_value_p: true})
const draw_past_endstate_value =
      draw_es_gen(() => ({draw_endstate_value_p: 'past',
                          show_until: showing_until(main_canvas), ...ignore_mouse}))

function draw_wr_graph(canvas) {
    const endstate_at = showing_endstate_value_p() && R.prev_endstate_clusters &&
          (R.move_count - R.endstate_diff_interval)
    const u = showing_until(), until = truep(u) ? u : endstate_at
    D.draw_winrate_graph(canvas, additional_graph_canvas,
                         until, handle_mouse_on_winrate_graph)
}

function draw_wr_bar(canvas) {
    const wr_only = (current_board_type() === 'winrate_only')
    const large_bar = R.expand_winrate_bar || wr_only
    D.draw_winrate_bar(canvas, large_bar, wr_only)
}

function first_board_canvas() {return the_first_board_canvas}
function is_first_board_canvas(canvas) {return canvas === the_first_board_canvas}
function reset_first_board_canvas() {the_first_board_canvas = null}
function update_first_board_canvas(canvas) {
    !the_first_board_canvas && (the_first_board_canvas = canvas)
}

/////////////////////////////////////////////////
// assign parts to canvases

// for smooth interaction on auto-repeated undo/redo
const sub_canvas_deferring_millisec = 10
const [do_on_sub_canvas_when_idle] =
      deferred_procs([f => f && f(sub_canvas), sub_canvas_deferring_millisec])

const double_boards_rule = {
    double_boards: {  // [on main_canvas, on sub_canvas]
        normal: [draw_main, draw_pv], raw: [draw_raw_pure, draw_pv]
    },
    double_boards_raw: {
        normal: [draw_main, draw_raw_clickable], raw: [draw_raw_pure, draw_pv]
    },
    double_boards_swap: {
        normal: [draw_raw_clickable, draw_main], raw: [draw_main, draw_pv]
    },
    double_boards_raw_pv: {
        normal: [draw_raw_main, draw_pv], raw: [draw_main, draw_pv]
    },
}

function update_goban() {
    reset_first_board_canvas()
    const btype = current_board_type()
    const f = (m, w, s) => (update_target_move(m, s),
                            m(main_canvas),
                            (w || draw_wr_graph)(winrate_graph_canvas),
                            do_on_sub_canvas_when_idle(s),
                            draw_wr_bar(winrate_bar_canvas))
    if (showing_endstate_value_p()) {
        const sub = R.prev_endstate_clusters ?
              draw_past_endstate_value : draw_raw_unclickable
        f(draw_current_endstate_value, null, sub)
    } else if (double_boards_p()) {
        const {normal, raw} = double_boards_rule[R.board_type]
        switch (btype) {
        case "winrate_only":
            f(draw_wr_graph, D.draw_visits_trail, draw_main); break;
        case "raw": f(raw[0], null, raw[1]); break;
        default: f(normal[0], null, normal[1]); break;
        }
    } else {
        switch (btype) {
        case "winrate_only": f(draw_wr_graph, draw_raw_unclickable); break;
        case "raw": f(draw_raw_clickable); break;
        case "variation": f(draw_pv); break;
        case "suggest": default: f(draw_main); break;
        }
    }
    const c = visits_trail_canvas, wro = btype === "winrate_only"
    wro ? D.draw_zone_color_chart(c) : (!showing_until() && D.draw_visits_trail(c))
    zone_chart_canvas.style.visibility = wro ? 'hidden' : 'visible'
}

function update_target_move(m, s) {
    const c = (m === draw_main) ? main_canvas : (s === draw_main) ? sub_canvas : null
    if (!c) {return}
    const u = showing_until(c), h = selected_suggest(c)
    D.set_target_move(!truep(u) && (h.visits > 0) && h.move)
}

function any_selected_suggest() {
    const is_nonempty = h => !empty(Object.keys(h))
    return [main_canvas, sub_canvas].map(selected_suggest).find(is_nonempty)
}
function selected_suggest(canvas) {
    const m = keyboard_moves[0] || if_hover_on(canvas, hovered_move)
    return R.suggest.find(h => h.move === m) || {}
}
function if_hover_on(canvas, val) {return (canvas === hovered_board_canvas) && val}

function current_board_type() {return temporary_board_type || R.board_type}

function set_temporary_board_type(btype, btype2) {
    const b = (R.board_type === btype) ? btype2 : btype
    if (temporary_board_type === b) {return}
    temporary_board_type = b; update_board_type()
}

function toggle_board_type(type) {main('toggle_board_type', R.window_id, type)}

function double_boards_p() {return R.board_type.match(/^double_boards/)}

/////////////////////////////////////////////////
// mouse action

// on goban

function handle_mouse_on_goban(canvas, coord2idx, read_only, tag_clickable_p) {
    const onmousedown = e =>
        (!read_only && !R.attached &&
         (play_here(e, coord2idx, tag_clickable_p), hover_off(canvas)))
    const onmousemove = e => hover_here(e, coord2idx, canvas)
    const onmouseenter = onmousemove
    const onmouseleave = e => hover_off(canvas)
    const handlers = {onmousedown, onmousemove, onmouseenter, onmouseleave}
    add_mouse_handlers_with_record(canvas, handlers)
}
function ignore_mouse_on_goban(canvas) {
    const ks = ['onmousedown', 'onmousemove', 'onmouseenter', 'onmouseleave']
    ks.forEach(k => canvas[k] = do_nothing)
}

function play_here(e, coord2idx, tag_clickable_p) {
    const move = mouse2move(e, coord2idx); if (!move) {return}
    const idx = move2idx(move)
    const another_board = e.ctrlKey, pass = e.button === 2 && R.move_count > 0
    const goto_p = showing_movenum_p()
    const match_sec = in_match_p() && (set_match_param(), auto_play_in_match_sec())
    if (goto_p) {goto_idx_maybe(idx, another_board); return}
    (tag_clickable_p && goto_idx_maybe(idx, another_board, true)) ||
        (pass && main('pass'),  // right click = pass and play
         main('play', move, !!another_board, null, null, match_sec))
}
function play_pass() {main('pass'); auto_play_in_match()}
function auto_play_in_match() {
    in_match_p() && main('auto_play_in_match', auto_play_in_match_sec())
}
function set_match_param() {
    const it = Q('#weaken'); main('set_match_param', it.options[it.selectedIndex].value)
}
function auto_play_in_match_sec() {return to_f(Q('#match_sec').value)}
function hover_here(e, coord2idx, canvas) {
    set_hovered(mouse2move(e, coord2idx) || 'last_move', null, canvas)
}
function hover_off(canvas) {set_hovered(null, null, null)}

function goto_idx_maybe(idx, another_board, tagged_stone_only) {
    const mc = latest_move_count_for_idx(idx, tagged_stone_only)
    return mc &&
        (duplicate_if(another_board), main('goto_move_count', mc), wink(), true)
}
function duplicate_if(x) {x && main('duplicate_sequence')}

main_canvas.addEventListener("wheel", e => {
    (e.deltaY !== 0) && (e.preventDefault(), main(e.deltaY < 0 ? 'undo' : 'redo'))
})

// on winrate graph

function handle_mouse_on_winrate_graph(canvas, coord2sr) {
    // helpers
    const unset_busy = () => main('unset_busy')
    const goto_here = e => !R.attached && winrate_graph_goto(e, coord2sr)
    const hover_here = e => hover_on_graph(e, coord2sr, canvas)
    // handlers
    const onmousedown = goto_here
    const onmousemove = e => (e.buttons === 1) ? goto_here(e) : hover_here(e)
    const onmouseup = unset_busy
    const onmouseleave = e => (hover_off(), unset_busy())
    const handlers = {onmousedown, onmousemove, onmouseup, onmouseleave}
    add_mouse_handlers_with_record(canvas, handlers, hover_here)
}

function winrate_graph_goto(e, coord2sr) {
    const goto_move_count = count => main('busy', 'goto_move_count', count)
    const [s, r] = coord2sr(...mouse2coord(e))
    goto_move_count(clip(s, 0, R.history_length))
}
function hover_on_graph(e, coord2sr, canvas) {
    set_hovered(null, coord2sr(...mouse2coord(e))[0], null)
}

// record mouse position

// When board is switched without mouse move,
// we need to re-calculate hovered_move_count.
function add_mouse_handlers_with_record(canvas, handlers, hover_updater) {
    const with_record_gen = bool => f =>
          e => (f(e), (canvas.lizgoban_last_mouse_move_event = bool && e))
    const with_record = with_record_gen(true), with_unrecord = with_record_gen(false)
    const with_it = {onmousemove: with_record, onmouseleave: with_unrecord}
    each_key_value(handlers, (k, f) => (canvas[k] = (with_it[k] || identity)(f)))
    canvas.lizgoban_hover_updater = hover_updater || canvas.onmousemove
}
function update_hover_maybe() {
    const c = hovered_board_canvas || winrate_graph_canvas
    const updater = c.lizgoban_hover_updater || do_nothing
    const e = c.lizgoban_last_mouse_move_event
    e && updater(e)
}

// hover

function set_hovered(move, count, canvas) {
    const [old_move, old_count] = [hovered_move, hovered_move_count]
    hovered_move = move
    truep(count) ? set_hovered_move_count_as(count) :
        set_hovered_move_count(hovered_move)
    hovered_board_canvas = canvas
    const changed = (hovered_move !== old_move) || (hovered_move_count !== old_count)
    changed && update_goban()
}
function set_hovered_move_count(move) {
    const count = move && (latest_move_count_for_idx(move2idx(move)) || R.move_count)
    set_hovered_move_count_as(count)
}
function set_hovered_move_count_as(count) {
    hovered_move_count = truep(count) && clip(count, 0, R.history_length)
    update_showing_until()
}

// util

function latest_move_count_for_idx(idx, tagged_stone_only) {
    const s = idx && aa_ref(R.stones, ...idx)
    const go = s && (!tagged_stone_only || (s.tag && s.stone))
    // use !! for safety (truep('') is true)
    return !!go && (D.latest_move(s.anytime_stones, R.move_count) || {}).move_count
}

function mouse2coord(e) {
    const bbox = e.target.getBoundingClientRect()
    return [(e.clientX - bbox.left) * canvas_scale,
            (e.clientY - bbox.top) * canvas_scale]
}
function mouse2idx(e, coord2idx) {
    const [i, j] = coord2idx(...mouse2coord(e))
    return (0 <= i && i < board_size() && 0 <= j && j < board_size()) && [i, j]
}
function mouse2move(e, coord2idx) {
    const idx = mouse2idx(e, coord2idx); return idx && idx2move(...idx)
}

/////////////////////////////////////////////////
// thmubnails

const max_sequence_length_for_thumbnail = 50  // for safety

// (1) record thumbnail

// To avoid wrong thumbnail recording,
// we require "no command" intervals before and *after* screenshot.

const thumbnail_deferring_millisec = 500

const [try_thumbnail] =
      deferred_procs([take_thumbnail, thumbnail_deferring_millisec])

function take_thumbnail(given_id, given_stones, given_trial_p) {
    const id = truep(given_id) ? given_id : current_sequence_id()
    const stones = given_stones || R.stones
    const trial_p = (given_trial_p === undefined) ? R.trial : given_trial_p
    take_thumbnail_of_stones(stones, url => store_thumbnail(id, url), trial_p)
}

let reusable_canvas = null
function take_thumbnail_of_stones(stones, proc, trail_p) {
    if (R.sequence_length > max_sequence_length_for_thumbnail) {return}
    // note: main_canvas can be rectangular by "x" key
    const [size, _] = get_canvas_size(main_canvas)
    const canvas = reusable_canvas || document.createElement("canvas")
    reusable_canvas = null
    set_canvas_square_size(canvas, size)
    with_board_size(stones.length, D.draw_thumbnail_goban, canvas, stones, trail_p)
    let fired = false
    canvas.toBlob(blob => {
        if (fired) {return}; fired = true  // can be called twice???
        proc(URL.createObjectURL(blob))
        reusable_canvas = canvas
    }, 'image/jpeg', 0.3)
}

function store_thumbnail(id, url) {
    !thumbnails[id] && (thumbnails[id] = {})
    merge(thumbnails[id], {url}); update_all_thumbnails()
}

// (2) show thumbnails

// Try block style first. If it overflows vertically, try inline style.

// Naive calculation of total height is wrong
// because "font-size" seems to have some lower bound.
// (ref) http://www.google.com/search?q=chrome%20minimum%20font%20size%20setting

function update_all_thumbnails(style) {
    discard_unused_thumbnails()
    const div = Q("#thumbnails"), preview = Q("#preview")
    const measurer = Q("#thumb_height_measurer")
    const hide_thumbnails = R.attached || R.sequence_length <= 1 ||
          R.board_type === 'variation' || R.board_type === 'winrate_only'
    const ids = hide_thumbnails ? [] : R.sequence_ids, scrollp = !!style
    ids.forEach(set_thumbnail_name)
    div.dataset.style = style || 'block'
    update_thumbnail_containers(ids, measurer)
    update_thumbnail_contents(ids, measurer, preview, scrollp)
    !empty(ids) && !style && measurer.clientHeight > Q("#goban").clientHeight &&
        update_all_thumbnails('inline')
}

function set_thumbnail_name(id) {
    const {player_black, player_white, handicaps, move_count, trial, len, tags} = R.sequence_props[id]
    const players = (player_black || player_white) ?
          `${player_black || "?"}/${player_white || "?"} ` : ''
    const name = (trial ? tags : players + tags) +
          ` ${move_count - handicaps}(${len - handicaps})`
    !thumbnails[id] && (thumbnails[id] = {})
    merge(thumbnails[id], {name})
}

function update_thumbnail_containers(ids, div) {
    while (div.children.length > ids.length) {div.removeChild(div.lastChild)}
    ids.slice(div.children.length)
        .forEach(() => {
            const [box, img] = ['div', 'img'].map(t => document.createElement(t))
            div.appendChild(box); box.appendChild(img)
        })
}

function update_thumbnail_contents(ids, div, preview, scrollp) {
    ids.forEach((id, n) => {
        const box = div.children[n], img = box.children[0], thumb = thumbnails[id]
        const set_action = (clickp, enter_leave_p) => {
            box.onclick =
                (clickp && (() => !R.attached && (main('nth_sequence', n),
                                                  preview.classList.remove('show'))))
            box.onmouseenter =
                (enter_leave_p && (() => {
                    preview.src = img.src; preview.classList.add('show')
                }))
            box.onmouseleave =
                (enter_leave_p && (() => preview.classList.remove('show')))
        }
        const set_current = () => box.classList.add('current')
        const unset_current = () => box.classList.remove('current')
        const scroll_maybe = () => {
            const rect = box.getBoundingClientRect()
            const inside = (rect.top >= 0 && rect.bottom <= window.innerHeight)
            scrollp && !inside && box.scrollIntoView()
        }
        const url = (thumb || {}).url
        box.classList.add('thumbbox')
        img.src = url || 'no_thumbnail.png'
        img.draggable = false
        id === current_sequence_id() ? (set_current(), set_action(), scroll_maybe()) :
            (unset_current(), set_action(true, true))
        box.dataset.name = (thumb && thumb.name) || ''
        box.dataset.available = yes_no(url)
        !url && set_action(true)
    })
}

function discard_unused_thumbnails() {
    const orig = thumbnails; thumbnails = []
    R.sequence_ids.slice(0, max_sequence_length_for_thumbnail)
        .forEach(id => (thumbnails[id] = orig[id]))
}

function current_sequence_id() {return R.sequence_ids[R.sequence_cursor]}

function yes_no(z) {return z ? 'yes' : 'no'}

/////////////////////////////////////////////////
// canvas

function set_all_canvas_size() {
    const wr_only = (current_board_type() === "winrate_only")
    const main_size = Q('#main_div').clientWidth
    const rest_size = Q('#rest_div').clientWidth
    const main_board_ratio = 0.95
    const main_board_max_size = main_size * main_board_ratio
    const main_board_size = main_board_max_size *
          (R.expand_winrate_bar && !wr_only ? 0.85 : 1)
    const main_board_height = wr_only ? main_board_max_size * 0.85 : main_board_size
    const additional_graph_height = 0
    // const additional_graph_height = wr_only ? main_board_height : 0
    const winrate_bar_height = main_size - main_board_height - additional_graph_height
    const sub_board_size = Math.min(main_board_max_size * 0.65, rest_size * 0.85)
    // use main_board_ratio in winrate_graph_width for portrait layout
    const winrate_graph_height = main_board_max_size * 0.25
    const winrate_graph_width = (wr_only && !double_boards_p()) ?
          winrate_graph_height : rest_size * main_board_ratio
    const zone_chart_canvas_size = rest_size * 0.05
    Q('#additional_graph_div').style.display = "none"
    // Q('#additional_graph_div').style.display = (wr_only ? "block" : "none")
    set_canvas_size(main_canvas, main_board_size, main_board_height)
    set_canvas_size(additional_graph_canvas, main_board_size, additional_graph_height)
    set_canvas_size(winrate_bar_canvas, main_board_size, winrate_bar_height)
    set_canvas_square_size(sub_canvas, sub_board_size)
    set_canvas_size(winrate_graph_canvas, winrate_graph_width, winrate_graph_height)
    after_effect(() => set_overlay(graph_overlay_canvas,
                                   wr_only ? main_canvas : winrate_graph_canvas))
    set_canvas_size(visits_trail_canvas, rest_size * 0.25, main_board_max_size * 0.13)
    update_all_thumbnails()
    set_subscript(zone_chart_canvas, winrate_graph_canvas, zone_chart_canvas_size) &&
        D.draw_zone_color_chart(zone_chart_canvas)  // call this here for efficiency
    set_cut_button_position_maybe()
}

function set_canvas_square_size(canvas, size) {
    return set_canvas_size(canvas, size, size)
}

function set_canvas_size(canvas, width, height) {
    canvas_scale = window.devicePixelRatio
    const [w0, h0] = [width, height].map(to_i)
    const [w, h] = [w0, h0].map(z => to_i(z * canvas_scale))
    if (w === canvas.width && h === canvas.height) {return false}
    canvas.style.width = `${w0}px`; canvas.style.height = `${h0}px`
    canvas.width = w; canvas.height = h
    return true
}

function set_overlay(canvas, orig) {
    copy_canvas_size(canvas, orig)
    set_relative_canvas_position(canvas, orig)
}

function copy_canvas_size(canvas, orig) {
    set_canvas_size(canvas, ...get_canvas_size(orig))
}

function get_canvas_size(canvas) {
    return [canvas.width / canvas_scale, canvas.height / canvas_scale]
}

function set_subscript(canvas, orig, width, height) {
    const h = height || width
    const shift_x = bounding_width => bounding_width
    const shift_y = bounding_height => bounding_height - h
    set_relative_canvas_position(canvas, orig, shift_x, shift_y)
    return set_canvas_size(canvas, width, h)
}

function set_relative_canvas_position(canvas, orig, shift_x, shift_y) {
    const rect = orig.getBoundingClientRect()
    // "canvas.style.position === 'absolute'" does not work
    const absolute_p = portrait_p()  // fixme: is there a better way?
    const set_without_margin = ([xy, wh, scroll, shift]) => {
        const margin = (rect[wh] - orig[wh] / canvas_scale) / 2
        const scroll_maybe = (absolute_p ? window[scroll] : 0)
        const pos = rect[xy] + scroll_maybe + (shift ? shift(rect[wh]) : margin)
        canvas.style[xy] = `${pos}px`
    }
    const args = [['left', 'width', 'scrollX', shift_x],
                  ['top', 'height', 'scrollY', shift_y]]
    args.forEach(set_without_margin)
}

function portrait_p() {
    const [my, sy] = [main_canvas, sub_canvas].map(c => c.getBoundingClientRect().y)
    return my < sy
}

// "X" button (cut_sequence) beside trial board:
// VERY ANNOYING! be careful of...
// - margin inclusion/exclusion
// - portrait/landscape and expand_winrate_bar
// - slide-up/down animation of main_canvas
function set_cut_button_position_maybe() {after_effect(set_cut_button_position)}
function set_cut_button_position() {
    const style = Q('#trial').style, portrait = portrait_p()
    style.left =
        main_canvas.getBoundingClientRect()[portrait ? 'width' : 'right'] - 1 + 'px'
    style.top =
        (portrait ? Q('#thumb_aligner').getBoundingClientRect().bottom : 0) + 1 + 'px'
}

/////////////////////////////////////////////////
// keyboard control

const with_skip = skip_too_frequent_requests((proc, ...a) => proc(...a))

document.onkeydown = e => {
    const key = (e.ctrlKey ? 'C-' : '') + e.key
    const f = (g, ...a) => (e.preventDefault(), g(...a)), m = (...a) => f(main, ...a)
    // GROUP 1: for input forms
    const escape = (key === "Escape" || key === "C-["), target = e.target
    escape && hide_dialog()
    switch (key === "Enter" && target.id) {
    case "auto_analysis_visits": toggle_auto_analyze(); return
    case "generic_input_dialog_input": submit_generic_input_dialog(); return
    case "player_black": case "player_white": case "komi": case "sgf_rule":
        set_game_info(); return
    }
    if ((target.tagName === "INPUT" && target.type !== "button") ||
        target.tagName === "SELECT" || target.tagName === "TEXTAREA") {
        escape && target.blur(); return
    }
    // GROUP 2: allow auto-repeat
    const busy = (...a) =>
          e.repeat ? m('busy', ...a) : m(...a)  // stop analysis in auto-repeat
    const skip_maybe = (...a) => e.repeat ? with_skip(busy, ...a) : busy(...a)
    switch (!R.attached && key) {
    case "ArrowLeft": case "ArrowUp":
        (!undoable() && e.repeat && !R.busy && !e.shiftKey) ? m('redo_to_end') :
            (!redoable() && e.repeat && !e.shiftKey) ? f(do_nothing) :
            undoable() ? busy('undo_ntimes', e.shiftKey ? 15 : 1) :
            !e.repeat && f(wink); break;
    case "ArrowRight": case "ArrowDown":
        (!redoable() && e.repeat && !R.busy && !e.shiftKey) ? m('undo_to_start') :
            (!undoable() && e.repeat && !e.shiftKey) ? f(do_nothing) :
            redoable() ? busy('redo_ntimes', e.shiftKey ? 15 : 1) :
            !e.repeat && f(wink); break;
    case "[": skip_maybe('previous_sequence'); break;
    case "]": skip_maybe('next_sequence'); break;
    }
    if (e.repeat) {e.preventDefault(); return}
    // GROUP 3: usable with sabaki
    const challenging = (R.board_type === "raw" && current_board_type() === "raw" &&
                         !R.attached)
    to_i(key) > 0 && (challenging ? m('play_weak', to_i(key) * 10) :
                      f(set_keyboard_moves_maybe, to_i(key) - 1))
    key.length === 1 && tag_letters.includes(key) && f(set_keyboard_tag_maybe, key)
    switch (key) {
    case "c" : set_showing_movenum_p(true); return
    case "v" : set_showing_endstate_value_p(true); return
    case "C-c": m('copy_sgf_to_clipboard'); return
    case "z": f(set_temporary_board_type, "raw", "suggest"); return
    case "x": f(set_temporary_board_type, "winrate_only", "suggest"); return
    case " ": m('toggle_pause'); return
    case "Z": f(toggle_board_type, 'raw'); return
    case "Tab": f(toggle_board_type); return
    case "0": challenging ? m('play_best', null, 'pass_maybe') :
            f(set_keyboard_moves_for_next_move); return
    case "#": f(alert_comment); return
    // (for safe_menu)
    case "B": m('toggle_stored', 'expand_winrate_bar'); return
    case "E": m('toggle_stored', 'show_endstate'); return
    case "C": m('toggle_stored', 'score_bar'); return
    case "M": m('toggle_let_me_think'); return
    }
    // GROUP 4: stand-alone only
    const until = showing_until()
    const play_it = (steps, another_board) =>
          D.target_move() ? m('play', D.target_move(), another_board) :
          truep(until) ? (duplicate_if(another_board), m('goto_move_count', until)) :
          truep(steps) ? m('play_best', steps) :
          !empty(R.suggest) ? m('play', R.suggest[0].move, another_board) : false
    switch (!R.attached && key) {
    case "C-v": m('paste_sgf_or_url_from_clipboard'); break;
    case "C-x": m('cut_sequence'); break;
    case "C-w": m('close_window_or_cut_sequence'); break;
    case "p": m('pass'); break;
    case "Enter": play_it(e.shiftKey ? 5 : 1); break;
    case "`": f(play_it, false, true); break;
    case ",": f(play_moves, keyboard_moves[0] ? keyboard_moves :
                (R.suggest[0] || {}).pv); break;
    case ";": m('let_me_think_next', R.board_type); break;
    case "Home": m('undo_to_start'); break;
    case "End": m('redo_to_end'); break;
    case "Backspace": case "Delete": m('explicit_undo'); break;
    case "a": f(toggle_auto_analyze_visits); break;
    case "q": R.trial ? m('cut_sequence') : wink(); break;
    }
}

document.onkeyup = e => {
    reset_keyboard_tag();
    (to_i(e.key) > 0 || e.key === "0") && reset_keyboard_moves()
    switch (e.key) {
    case "c" : set_showing_movenum_p(false); return
    case "v" : set_showing_endstate_value_p(false); return
    case "z": case "x": set_temporary_board_type(null); return
    }
    with_skip(do_nothing)  // cancel deferred proc (necessary!)
    // cancel keep_selected_variation_maybe() by any keyup
    // (ex.) keeping "2" key down, push and release shift key to update
    // displayed variation
    clear_selected_variation()
    main('unset_busy')
}

function set_keyboard_moves_maybe(n) {
    const h = R.suggest[n]
    h && !keyboard_moves[0] && (keyboard_moves = h.pv) && update_goban()
}
function set_keyboard_moves_for_next_move() {
    const hit = R.suggest.find(h => D.is_next_move(h.move))
    hit && !keyboard_moves[0] && (keyboard_moves = hit.pv) && update_goban()
}
function reset_keyboard_moves() {keyboard_moves = []; update_goban()}

function set_keyboard_tag_maybe(key) {
    const old = keyboard_tag_move_count
    const tags = R.history_tags.slice().reverse()
    const data = tags.find(h => h.tag.includes(key) && h.move_count < R.move_count) ||
          tags.find(h => h.tag.includes(key))
    data && (data.move_count !== old) &&
        ((keyboard_tag_move_count = data.move_count),
         update_showing_until(), update_goban())
}
function reset_keyboard_tag() {keyboard_tag_move_count = null; update_showing_until()}
const checker_for_showing_until = change_detector()
function showing_something_p() {return showing_movenum_p() || showing_endstate_value_p()}
function showing_movenum_p() {return the_showing_movenum_p}
function showing_endstate_value_p() {return the_showing_endstate_value_p}
function set_showing_something_p(val) {
    val && checker_for_showing_until.reset(); update_hover_maybe(); update_goban()
}
function set_showing_movenum_p(val) {
    the_showing_movenum_p = val; set_showing_something_p(val)
}
function set_showing_endstate_value_p(val) {
    the_showing_endstate_value_p = val; set_showing_something_p(val)
}
function showing_until(canvas) {
    const hovered_mc = truep(hovered_move_count) ? hovered_move_count :
          (R.move_count || Infinity)
    const ret = (by_tag, by_hover) =>
          (by_tag && keyboard_tag_move_count) ||
          (by_hover && showing_something_p() && hovered_mc)
    const accept_any = !canvas, hover_on_me = if_hover_on(canvas, true)
    const hover_on_any_board = !!hovered_board_canvas
    const i_am_first_board = is_first_board_canvas(canvas)
    const my_duty_p = hover_on_me || (!hover_on_any_board && i_am_first_board)
    const retval = accept_any ? ret(true, true) : ret(i_am_first_board, my_duty_p)
    return truep(retval) && D.clip_handicaps(retval)
}
function update_showing_until() {
    const cur = showing_until(), changed = checker_for_showing_until.is_changed(cur)
    if (!R.show_endstate || !changed) {return}
    main('set_showing_until', cur)
}

function undoable() {return R.move_count > R.handicaps}
function redoable() {return R.move_count < R.history_length}

/////////////////////////////////////////////////
// drag and drop

function read_sgf_file(file) {
    const r = new FileReader()
    r.onload = e => main('read_sgf', e.target.result)
    r.readAsText(file)
}

function drag_and_drop_handler(func) {
    return e => {const dt = e.dataTransfer; e.preventDefault(); dt.files && func(dt)}
}

function when_dropped(dt) {
    const text = dt.getData('text/plain')
    text ? main('open_url', text) : each_value(dt.files, read_sgf_file)
}

window.ondragover = drag_and_drop_handler(dt => {dt.dropEffect = "copy"})
window.ondrop = drag_and_drop_handler(when_dropped)

/////////////////////////////////////////////////
// controller

// board type selector

function update_board_type() {
    update_ui_element("#sub_goban_container", double_boards_p())
    set_all_canvas_size()
    update_goban()
}

// buttons

function update_button_etc(availability) {
    const f = (key, ids) =>
          (ids || key).split(/ /).forEach(x => update_ui_element('#' + x, availability[key]))
    f('undo', 'undo undo_ntimes undo_to_start explicit_undo')
    f('redo', 'redo redo_ntimes redo_to_end')
    update_ui_element('.hide_when_attached', availability.attach)
    f('detach')
    f('pause', 'pause play_best play_best_x5'); f('resume')
    f('bturn'); f('wturn'); f('auto_analyze')
    f('start_auto_analyze', 'start_auto_analyze auto_analysis_visits')
    f('stop_auto')
    f('normal_ui'); f('simple_ui'); f('trial')
    const in_match = in_match_p(), serious = in_match_p(true)
    update_ui_element('.show_in_match', in_match)
    update_ui_element('.hide_in_match', !in_match)
    update_ui_element('.show_in_serious_match', serious)
    update_ui_element('.hide_in_serious_match', !serious)
    update_ui_element('.katago_only', R.is_katago)
}

function in_match_p(serious) {return R.in_match && (!serious || R.board_type === 'raw')}
globalize({in_match_p})

/////////////////////////////////////////////////
// DOM

function update_ui_element(query_string, val) {
    Q_all(query_string).forEach(elem => update_ui_element_sub(elem, val))
}
function update_ui_element_sub(elem, val) {
    switch (elem.tagName) {
    case "INPUT": elem.disabled = !val; break
    case "DIV": elem.style.display = (val ? "block" : "none"); break
    case "SPAN": elem.style.display = (val ? "inline" : "none"); break
    case "OPTION":
        val ? elem.removeAttribute('disabled') : (elem.disabled = true); break
    case "SELECT": set_selection(elem, val); break
    }
}

function get_selection(elem) {return elem.options[elem.selectedIndex].value}

function set_selection(elem, val) {
    elem.selectedIndex =
        to_i(seq(elem.options.length).find(i => (elem.options[i].value === val)))
}

/////////////////////////////////////////////////
// effect

const effect_duration_millisec = 200

// to avoid flicker of scroll bar in repeated "[" key
let in_effect = false
const procs_after_effect = []
const [do_procs_after_effect] = deferred_procs([() => {
    procs_after_effect.forEach(proc => proc()); procs_after_effect.splice(0)
}, effect_duration_millisec + 100])
function after_effect(proc) {
    in_effect ? (procs_after_effect.push(proc), do_procs_after_effect()) : proc()
}

function slide_in(direction) {
    const shift = {next: '30%', previous: '-30%'}[direction]
    effect_gen({transform: `translate(0%, ${shift})`, opacity: 0},
               {transform: 'translate(0)', opacity: 1})
}
function wink() {effect_gen({opacity: 1}, {opacity: 0.7}, {opacity: 1})}
function effect_gen(...transforms) {
    in_effect = true
    Q('#goban').animate(transforms, effect_duration_millisec)
    after_effect(() => {in_effect = false})
}

function toast(message, millisec) {
    setq('#toast_message', message)
    Q('#toast').animate([{opacity: 1}, {opacity: 0.8}, {opacity: 0}], millisec || 3000)
}

/////////////////////////////////////////////////
// init

// (ref.)
// https://teratail.com/questions/8773
// https://qiita.com/damele0n/items/f4050649de023a948178
// https://qiita.com/tkdn/items/5be7ee5cc178a62f4f67
Q('body').offsetLeft  // magic spell to get updated clientWidth value
set_all_canvas_size()

main('init_from_renderer')
