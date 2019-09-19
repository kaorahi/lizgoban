// -*- coding: utf-8 -*-

/////////////////////////////////////////////////
// setup

// util
function Q(x) {return document.querySelector(x)}
const electron = require('electron'), ipc = electron.ipcRenderer
require('./util.js').use(); require('./coord.js').use()
const current_window = electron.remote.getCurrentWindow()

// canvas
const main_canvas = Q('#goban'), sub_canvas = Q('#sub_goban')
const winrate_bar_canvas = Q('#winrate_bar'), winrate_graph_canvas = Q('#winrate_graph')
const graph_overlay_canvas = Q('#graph_overlay')

// renderer state
const R = {
    stones: [], move_count: 0, bturn: true, history_length: 0, suggest: [], visits: 1,
    visits_per_sec: 0,
    winrate_history: [], previous_suggest: null,
    attached: false, pausing: false, auto_analyzing: false, winrate_trail: false,
    expand_winrate_bar: false, let_me_think: false, score_bar: false,
    max_visits: 1, board_type: 'double_boards', previous_board_type: '',
    progress: 0.0, progress_bturn: true, weight_info: '', is_katago: false,
    sequence_cursor: 1, sequence_length: 1, sequence_ids: [],
    history_tags: [], endstate_clusters: [], prev_endstate_clusters: null,
    lizzie_style: false,
    window_id: -1,
}
let temporary_board_type = null, the_first_board_canvas = null
let keyboard_moves = [], keyboard_tag_move_count = null
let hovered_move = null, hovered_move_count = null, hovered_board_canvas = null
let the_showing_movenum_p = false, the_showing_endstate_value_p = false
let thumbnails = []

// drawer
const D = require('./draw.js'); D.set_state(R)

// handler
window.onload = window.onresize = update
window.onfocus = update_for_mac
function update()  {set_all_canvas_size(); update_goban(); update_for_mac()}
function update_for_mac() {mac_p() && main('update_menu')}  // for board_type_menu_item

/////////////////////////////////////////////////
// util

function setq(x, val) {Q(x).textContent = val}
function setdebug(x) {setq('#debug', JSON.stringify(x))}

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

function start_auto_play() {
    main('auto_play', to_f(Q('#auto_play_sec').value)); hide_dialog()
}

function show_dialog(name) {
    Q(name).style.visibility = "visible"; Q(`${name} input`).select()
}
function hide_dialog() {
    document.querySelectorAll(".dialog").forEach(d => d.style.visibility = "hidden")
}

function play_moves(moves) {
    moves && moves.forEach((move, k) => main('play', move, false,
                                             (k === 0) && start_moves_tag_letter))
}

function main(channel, ...args) {ipc.send(channel, ...args)}

/////////////////////////////////////////////////
// from main

ipc.on('render', (e, h, is_board_changed) => {
    if (showing_until() && !is_board_changed) {return}  // for smooth reaction
    merge(R, h)
    setq('#move_count', R.move_count)
    setq('#history_length', ' (' + R.history_length + ')')
    D.update_winrate_trail()
    update_goban()
})

ipc.on('update_ui', (e, win_prop, availability, ui_only) => {
    R.pausing = availability.resume
    R.auto_analyzing = availability.stop_auto
    merge(R, win_prop)
    set_all_canvas_size()
    ui_only || update_goban()
    update_body_color()
    update_button_etc(availability)
    update_board_type()
    update_all_thumbnails()
    update_title()
    try_thumbnail()
})

ipc.on('ask_auto_play_sec', (e) => show_dialog('#auto_play_sec_dialog'))

ipc.on('slide_in', (e, direction) => slide_in(direction))
ipc.on('wink', (e) => wink())

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
        R.let_me_think ? ['white', '#223'] : ['white', '#444']
}

/////////////////////////////////////////////////
// draw parts

// set option "main_canvas_p" etc. for d(canvas, opts)
function with_opts(d, opts) {
    return c => (update_first_board_canvas(c), d(c, {
        main_canvas_p: c === main_canvas, selected_suggest: selected_suggest(c),
        first_board_p: is_first_board_canvas(c),
        show_until: showing_until(c),
        hovered_move: if_hover_on(c, hovered_move),
        handle_mouse_on_goban,
        ...(opts || {})
    }))
}

const ignore_mouse = {handle_mouse_on_goban: ignore_mouse_on_goban}
const draw_main = with_opts(D.draw_main_goban)
const draw_pv = with_opts(D.draw_goban_with_principal_variation, ignore_mouse)
const draw_raw_gen = options => with_opts(D.draw_raw_goban, options)
const draw_raw_unclickable = draw_raw_gen({draw_last_p: true, read_only: true})
const draw_raw_clickable = draw_raw_gen({draw_last_p: true})
const draw_raw_pure = draw_raw_gen({})
const draw_raw_main = draw_raw_gen({draw_last_p: true, draw_visits_p: true})
const draw_es_gen = options => with_opts(D.draw_endstate_goban, options)
const draw_current_endstate_value = draw_es_gen({draw_endstate_value_p: true})
const draw_past_endstate_value = draw_es_gen({draw_endstate_value_p: 'past'})

function draw_wr_graph(canvas) {
    const endstate_at = showing_endstate_value_p() && R.prev_endstate_clusters &&
          (R.move_count - R.endstate_diff_interval)
    const until = showing_until() || endstate_at
    D.draw_winrate_graph(canvas, until, handle_mouse_on_winrate_graph)
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
    const f = (m, w, s) => (m(main_canvas),
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
    const c = Q("#visits_trail_canvas")
    btype === "winrate_only" ? D.clear_canvas(c) :
        !showing_until() && D.draw_visits_trail(c)
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
    if (goto_p) {goto_idx_maybe(idx, another_board); return}
    (tag_clickable_p && goto_idx_maybe(idx, another_board, true)) ||
        (pass && main('pass'), main('play', move, !!another_board))
}
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
    s >= 0 && goto_move_count(clip(s, 0, R.history_length))
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
    hovered_move_count = truep(count) && clip(count, 1, R.history_length)
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
    return [e.clientX - bbox.left, e.clientY - bbox.top]
}
function mouse2idx(e, coord2idx) {
    const [i, j] = coord2idx(...mouse2coord(e))
    return (0 <= i && i < board_size && 0 <= j && j < board_size) && [i, j]
}
function mouse2move(e, coord2idx) {
    const idx = mouse2idx(e, coord2idx); return idx && idx2move(...idx)
}

/////////////////////////////////////////////////
// thmubnails

// (1) record thumbnail

// To avoid wrong thumbnail recording,
// we require "no command" intervals before and *after* screenshot.

const thumbnail_deferring_millisec = 500

const [try_thumbnail, store_thumbnail_later] =
      deferred_procs([take_thumbnail, thumbnail_deferring_millisec],
                     [store_thumbnail, thumbnail_deferring_millisec])

function take_thumbnail() {
    const canvas = first_board_canvas(); if (!canvas) {return}
    let fired = false
    canvas.toBlob(blob => {
        if (fired) {return}; fired = true  // can be called twice???
        const tags = current_tag_letters()
        const players = (R.player_black || R.player_white) ?
              `${R.player_black || "?"}/${R.player_white || "?"} ` : ''
        const name = (R.trial ? tags : players + tags) +
              ` ${R.move_count}(${R.history_length})`
        store_thumbnail_later(current_sequence_id(), URL.createObjectURL(blob), name)
    }, 'image/jpeg', 0.3)
}

function store_thumbnail(id, url, name) {
    thumbnails[id] = {url, name}; update_all_thumbnails()
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
    const ids = hide_thumbnails ? [] : R.sequence_ids
    div.dataset.style = style || 'block'
    update_thumbnail_containers(ids, measurer)
    update_thumbnail_contents(ids, measurer, preview)
    !empty(ids) && !style && measurer.clientHeight > Q("#goban").clientHeight &&
        update_all_thumbnails('inline')
}

function update_thumbnail_containers(ids, div) {
    while (div.children.length > ids.length) {div.removeChild(div.lastChild)}
    ids.slice(div.children.length)
        .forEach(() => {
            const [box, img] = ['div', 'img'].map(t => document.createElement(t))
            div.appendChild(box); box.appendChild(img)
        })
}

function update_thumbnail_contents(ids, div, preview) {
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
        box.classList.add('thumbbox')
        img.src = thumb ? thumb.url : 'no_thumbnail.png'
        id === current_sequence_id() ? (set_current(), set_action()) :
            (unset_current(), set_action(true, true))
        box.dataset.name = (thumb && thumb.name) || ''
        box.dataset.available = yes_no(thumb)
        !thumb && set_action(true)
    })
}

function discard_unused_thumbnails() {
    const orig = thumbnails; thumbnails = []
    R.sequence_ids.forEach(id => (thumbnails[id] = orig[id]))
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
    const main_board_height = wr_only ? main_board_max_size * 0.7 : main_board_size
    const sub_board_size = Math.min(main_board_max_size * 0.65, rest_size * 0.85)
    // use main_board_ratio in winrate_graph_width for portrait layout
    const winrate_graph_height = main_board_max_size * 0.25
    const winrate_graph_width = (wr_only && !double_boards_p()) ?
          winrate_graph_height : rest_size * main_board_ratio
    set_canvas_size(main_canvas, main_board_size, main_board_height)
    set_canvas_size(winrate_bar_canvas,
                    main_board_size, main_size - main_board_height)
    set_canvas_square_size(sub_canvas, sub_board_size)
    set_canvas_size(winrate_graph_canvas, winrate_graph_width, winrate_graph_height)
    set_overlay(graph_overlay_canvas, wr_only ? main_canvas: winrate_graph_canvas)
    update_all_thumbnails()
}

function set_canvas_square_size(canvas, size) {set_canvas_size(canvas, size, size)}

function set_canvas_size(canvas, width, height) {
    if (to_i(width) === canvas.width && to_i(height) === canvas.height) {return}
    canvas.setAttribute('width', width); canvas.setAttribute('height', height)
}

function set_overlay(canvas, orig) {
    set_canvas_size(canvas, orig.width, orig.height)
    const rect = orig.getBoundingClientRect()
    // "canvas.style.position === 'absolute'" does not work
    const absolute_p = portrait_p()  // fixme: is there a better way?
    const set_without_margin = ([xy, wh, scroll]) =>
          (canvas.style[xy] = (rect[xy] + (rect[wh] - canvas[wh]) / 2)
           + (absolute_p ? window[scroll] : 0) + 'px')
    const args = [['left', 'width', 'scrollX'], ['top', 'height', 'scrollY']]
    args.forEach(set_without_margin)
}

function portrait_p() {
    const [my, sy] = [main_canvas, sub_canvas].map(c => c.getBoundingClientRect().y)
    return my < sy
}

/////////////////////////////////////////////////
// keyboard operation

document.onkeydown = e => {
    const key = (e.ctrlKey ? 'C-' : '') + e.key
    const f = (g, ...a) => (e.preventDefault(), g(...a)), m = (...a) => f(main, ...a)
    // GROUP 1: for input forms
    const escape = (key === "Escape" || key === "C-[")
    escape && hide_dialog()
    switch (key === "Enter" && e.target.id) {
    case "auto_analysis_visits": toggle_auto_analyze(); return
    case "auto_play_sec": start_auto_play(); return
    }
    if (e.target.tagName === "INPUT" && e.target.type !== "button") {
        escape && e.target.blur(); return
    }
    // GROUP 2: allow auto-repeat
    const busy = (...a) => m('busy', ...a)  // stop analysis in auto-repeat
    switch (!R.attached && key) {
    case "ArrowLeft": case "ArrowUp":
        busy('undo_ntimes', e.shiftKey ? 15 : 1); break;
    case "ArrowRight": case "ArrowDown":
        busy('redo_ntimes', e.shiftKey ? 15 : 1); break;
    case ";": busy('let_me_think_next', R.board_type); break;
    }
    if (e.repeat) {return}
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
    }
    // GROUP 4: stand-alone only
    const until = showing_until()
    const play_it = (steps, another_board) =>
          D.target_move() ? m('play', D.target_move(), another_board) :
          truep(until) ? (duplicate_if(another_board), m('goto_move_count', until)) :
          truep(steps) ? m('play_best', steps) :
          !empty(R.suggest) ? m('play', R.suggest[0].move, another_board) : false
    switch (!R.attached && key) {
    case "C-v": m('paste_sgf_from_clipboard'); break;
    case "C-x": m('cut_sequence'); break;
    case "C-w": m('close_window_or_cut_sequence'); break;
    case "[": m('previous_sequence'); break;
    case "]": m('next_sequence'); break;
    case "p": m('pass'); break;
    case "Enter": play_it(e.shiftKey ? 5 : 1); break;
    case "`": f(play_it, false, true); break;
    case ",": f(play_moves, keyboard_moves[0] ? keyboard_moves :
                (R.suggest[0] || {}).pv); break;
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
        ((keyboard_tag_move_count = data.move_count), update_goban())
}
function reset_keyboard_tag() {keyboard_tag_move_count = null; update_goban()}
function showing_movenum_p() {return the_showing_movenum_p}
function set_showing_movenum_p(val) {
    the_showing_movenum_p = val; val && update_hover_maybe(); update_goban()
}
function showing_endstate_value_p() {return the_showing_endstate_value_p}
function set_showing_endstate_value_p(val) {
    the_showing_endstate_value_p = val; update_goban()
}
function showing_until(canvas) {
    const ret = (by_tag, by_hover) =>
          (by_tag && keyboard_tag_move_count) ||
          (by_hover && showing_movenum_p() &&
           (hovered_move_count || R.move_count || Infinity))
    const accept_any = !canvas, hover_on_me = if_hover_on(canvas, true)
    const hover_on_any_board = !!hovered_board_canvas
    const i_am_first_board = is_first_board_canvas(canvas)
    const my_duty_p = hover_on_me || (!hover_on_any_board && i_am_first_board)
    return accept_any ? ret(true, true) : ret(i_am_first_board, my_duty_p)
}
function update_showing_until() {
    R.show_endstate && main('set_endstate_diff_from', showing_until())
}

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
    f('attach', 'hide_when_attached1 hide_when_attached2'); f('detach')
    f('pause', 'pause play_best play_best_x5'); f('resume')
    f('bturn'); f('wturn'); f('auto_analyze')
    f('start_auto_analyze', 'start_auto_analyze auto_analysis_visits')
    f('stop_auto')
    f('normal_ui'); f('simple_ui'); f('trial')
}

/////////////////////////////////////////////////
// DOM

function update_ui_element(query_string, val) {
    const elem = Q(query_string), tag = elem.tagName
    switch (tag) {
    case "INPUT": elem.disabled = !val; break
    case "DIV": elem.style.display = (val ? "block" : "none"); break
    case "SPAN": elem.style.display = (val ? "inline" : "none"); break
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

function slide_in(direction) {
    const shift = {next: '30%', previous: '-30%'}[direction]
    effect_gen({transform: `translate(0%, ${shift})`, opacity: 0},
               {transform: 'translate(0)', opacity: 1})
}
function wink() {effect_gen({opacity: 1}, {opacity: 0.7}, {opacity: 1})}
function effect_gen(...transforms) {Q('#goban').animate(transforms, 200)}

/////////////////////////////////////////////////
// init

main('init_from_renderer')

// (ref.)
// https://teratail.com/questions/8773
// https://qiita.com/damele0n/items/f4050649de023a948178
// https://qiita.com/tkdn/items/5be7ee5cc178a62f4f67
Q('body').offsetLeft  // magic spell to get updated clientWidth value
set_all_canvas_size()
