// -*- coding: utf-8 -*-

/////////////////////////////////////////////////
// setup

// util
function Q(x) {return document.querySelector(x)}
function Q_all(x) {return document.querySelectorAll(x)}
const electron = require('electron'), ipc = electron.ipcRenderer
const {globalize} = require('./globalize.js')
globalize(require('./util.js'), require('./coord.js'), require('./draw_common.js'))
const {sgf_rule_from_katago_rule} = require('./katago_rules.js')
const {save_blob} = require('./image_exporter.js')

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
    stones: [], black_hama: 0, white_hama: 0, move_count: 0, init_len: 0, bturn: true,
    showing_bturn: true, forced_color_to_play: null,
    history_length: 0, suggest: [], visits: 1,
    visits_per_sec: 0,
    winrate_history: [], winrate_history_set: [[[]], []], previous_suggest: null,
    future_moves: [],
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
    branch_for_tag: [],
    is_endstate_drawable: false,
    lizzie_style: false,
    window_id: -1,
    image_paths: null, image: null, stone_image_p: true, board_image_p: true,
    stone_style: '2D',
    exercise_metadata: {},
    pv_trail_max_suggestions: 0,
}
globalize(R)
let temporary_board_type = null, the_first_board_canvas = null
let keyboard_moves = [], keyboard_tag_move_count = null
let hovered_move = null, hovered_move_count = null, hovered_board_canvas = null
let the_showing_movenum_p = false, the_showing_endstate_value_p = false
let showing_branch = null
let thumbnails = []

// drawer
const D = require('./draw.js')

// handler
window.onload = window.onresize = update
window.onfocus = update_for_mac
function update()  {set_all_canvas_size(); update_goban(); update_for_mac()}
function update_for_mac() {mac_p() && main('update_menu')}  // for board_type_menu_item

// to receive the event...
Q('#pass').onclick = play_pass

/////////////////////////////////////////////////
// util

function setq(x, val) {Q(x).textContent = val}
function setdebug(x) {setq('#debug', JSON.stringify(x)); return x}
globalize(setdebug)

// for debug from Developper Tool
function send_to_leelaz(cmd) {main('send_to_leelaz', cmd)}

/////////////////////////////////////////////////
// action

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
    main('enable_menu', false)
}
function shown_dialogs() {
    return document.querySelectorAll('.dialog:not([style*="visibility: hidden"])')
}
function hide_dialog() {
    const opened = shown_dialogs(); if (empty(opened)) {return false}
    opened.forEach(d => d.style.visibility = "hidden")
    main('enable_menu', true)
    return true
}

function play_moves(moves) {
    const tag = k => (k === 0) && start_moves_tag_letter
    const com = k => `by suggestion (${k + 1})`
    const play1 = (move, k) => main('play', move, 'never_redo', tag(k), com(k))
    moves && moves.forEach(play1)
}

function stop_match() {main('stop_match', R.window_id)}

function alert_comment() {
    const popup = str => {
        electron.clipboard.writeText(str); alert(str); toast('copied to clipboard', 1000)
    }
    const comment = Q('#comment').textContent; comment ? popup(comment) : wink()
}

function main(channel, ...args) {ipc.send(channel, ...args)}

/////////////////////////////////////////////////
// from main

const render_in_capacity = skip_too_frequent_requests(render_now)

ipc.on('render', (e, h, is_board_changed) => {
    // !showing_branch is necessary because of "previous branch" feature
    // introduced in 9b00d8403c. See set_branch_moves_maybe().
    is_board_changed && !showing_branch && reset_keyboard_moves(true)
    // for readable variation display
    keep_selected_variation_maybe(h.suggest)
    // renderer state must be updated before update_ui is called
    merge(R, h)
    initialize_image_maybe()
    cancel_obsolete_branch()
    render_in_capacity()
})

function render_now() {
    set_board_size(R.bsize)
    setq('#move_count', D.movenum())
    setq('#black_hama', R.black_hama)
    setq('#white_hama', R.white_hama)
    setq('#history_length', ' (' + D.max_movenum() + ')')
    update_displayed_comment()
    D.update_winrate_trail()
    update_goban()
}

function update_exercise() {
    if (!R.exercise_metadata) {return}
    const {seen_at, stars} = R.exercise_metadata
    const prev_seen_at = (seen_at || [])[1]
    const prev_seen_text = prev_seen_at ?
          `(seen: ${(new Date(prev_seen_at)).toLocaleDateString()})` : ''
    setq('#exercise_stars', true_or(stars, 0))
    setq('#exercise_prev_seen', prev_seen_text)
}

function update_displayed_comment() {
    const com = Q('#comment'), old_text = com.textContent, text = displayed_comment()
    text !== old_text && (com.textContent = text) && (com.scrollTop = 0)
}
function displayed_comment() {return (showing_branch || {}).comment || R.comment_note}

ipc.on('update_ui', (e, win_prop, availability) => {
    R.pausing = availability.resume
    R.auto_analyzing = availability.stop_auto
    merge(R, win_prop)
    set_all_canvas_size()
    if (R.busy) {return}
    update_body_color()
    update_exercise()
    update_button_etc(availability)
    update_board_type()
    update_all_thumbnails()
    try_thumbnail()
})

ipc.on('generic_input_dialog', (e, label, init_val, channel, warning) =>
       show_generic_input_dialog(warning, label, init_val, val => main(channel, val)))

ipc.on('ask_game_info', (e, params) => {
    const {info_text, sgf_rule, current_rule, supported_rules, handicaps,
           asking_komi_p, initial_p} = params
    const unless_initial = text => initial_p ? '' : text
    // defaults
    Q('#player_black').value = unless_initial(R.player_black)
    Q('#player_white').value = unless_initial(R.player_white)
    Q('#board_size').value = board_size()
    Q('#handicap').value = handicaps
    Q('#komi').value = R.komi
    Q('#sgf_rule').value = sgf_rule
    Q('#comment_form').value = R.comment
    Q('#info_form').value = info_text
    Q('#initial_p').value = yes_no(initial_p)
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

ipc.on('save_q_and_a_images', (e, q_filename, a_filename, msg_path) => {
    const q_draw = canvas => D.draw_raw_goban(canvas, {draw_last_p: true})
    const a_draw = canvas => D.draw_goban_with_principal_variation(canvas, {})
    const saver = (filename, cb) => blob => save_blob(blob, filename, cb)
    const callback = err =>
          err ? alert(`[Error]\n${err.message}`) : toast(`Saved to ${msg_path}`, 7000)
    generate_board_image_blob(q_draw, saver(q_filename, do_nothing))
    generate_board_image_blob(a_draw, saver(a_filename, callback))
})

const direct_ipc = {
    reset_match_param, take_thumbnail, slide_in, wink, toast, update_analysis_region,
}
each_key_value(direct_ipc, (key, func) => ipc.on(key, (e, ...a) => func(...a)))

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
    !R.image && R.image_paths && (R.image = aa2hash(R.image_paths.map(([key, path]) => {
        const img = new Image(); img.src = path; return [key, img]
    })))
}

function update_body_color() {
    [Q('#body').style.color, Q('#body').style.backgroundColor] =
        R.attached ? ['white', '#111'] :
        in_match_p() ? ['white', '#232'] :
        R.let_me_think ? ['white', '#223'] : ['white', '#444']
}

function keep_selected_variation_maybe(suggest) {
    // Never modify suggest[k] itself.
    // Replace suggest[k] instead to avoid unintentional side effects.
    if (empty(suggest)) {return}; suggest[0].was_top = true
    const sticky = any_selected_suggest(); if (!sticky) {return}
    const merge_sticky = (orig, kept) => {
        const {pv, was_top} = kept, pvVisits = kept.pvVisits.slice(), new_pv = orig.pv
        const obsolete_visits = kept.obsolete_visits || (pvVisits && pvVisits[0]) || 0
        const uptodate_len = common_header_length(new_pv, pv, true)
        pvVisits && orig.pvVisits &&
            replace_header(pvVisits, orig.pvVisits.slice(0, uptodate_len))
        return {...orig, pv, pvVisits, was_top, obsolete_visits, uptodate_len, new_pv}
    }
    const k = suggest.findIndex(z => z.move === sticky.move)
    k >= 0 ? (suggest[k] = merge_sticky(suggest[k], sticky)) :
        suggest.push(sticky)  // can't happen?
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
            keyboard_moves_len: keyboard_moves.length,
            analysis_region: get_analysis_region_for_display(),
            cheap_shadow_p: R.long_busy,
            handle_mouse_on_goban,
            ...(functionp(opts) ? opts() : opts || {}),
        })
    }
}

const ignore_mouse = {handle_mouse_on_goban: ignore_mouse_on_goban}
const draw_main = with_opts(D.draw_main_goban)
const draw_sub = with_opts((...args) => {
    const sss_p = R.subboard_stones_suggest && !hover_on_subboard_p()
    const draw = sss_p ? D.draw_goban_with_subboard_stones_suggest : D.draw_main_goban
    draw(...args)
})
const draw_pv = with_opts((...args) => {
    R.subboard_stones_suggest ? D.draw_goban_with_subboard_stones_suggest(...args) :
        truep(showing_until()) ? D.draw_raw_goban(...args) :
        showing_branch_p() ? D.draw_goban_with_future_moves(...args) :
        already_showing_pv_p() ? draw_another(...args) :
        D.draw_goban_with_principal_variation(...args)
}, ignore_mouse)
const draw_another = (...args) => {
    R.different_engine_for_white_p ?
        D.draw_goban_with_expected_variation(...args) :
        D.draw_goban_with_future_moves(...args)
}
const draw_raw_gen = options => with_opts(D.draw_raw_goban, options)
const draw_raw_unclickable = draw_raw_gen({draw_last_p: true, read_only: true})
const draw_raw_clickable = draw_raw_gen({draw_last_p: true})
const draw_raw_pure = draw_raw_gen({})
const draw_raw_swap =
      draw_raw_gen(() => ({draw_last_p: true,
                           ...(hover_on_subboard_p() ? {show_until: null} : {})}))
const draw_es_gen = options => with_opts(D.draw_endstate_goban, options)
const draw_current_endstate_value = draw_es_gen({draw_endstate_value_p: true})
const draw_past_endstate_value =
      draw_es_gen(() => ({draw_endstate_value_p: 'past',
                          show_until: showing_until(main_canvas), ...ignore_mouse}))

function draw_wr_graph(canvas) {
    const endstate_at = showing_endstate_value_p() && R.prev_endstate_clusters &&
          (R.move_count - R.endstate_diff_interval)
    const until = finite_or(showing_until(), endstate_at)
    D.draw_winrate_graph(canvas, additional_graph_canvas,
                         until, handle_mouse_on_winrate_graph)
}

function draw_wr_bar(canvas) {
    const wr_only = (current_board_type() === 'winrate_only')
    const large_bar = R.expand_winrate_bar || wr_only
    const move_count = finite_or(move_count_for_suggestion(), R.move_count)
    D.draw_winrate_bar(canvas, move_count, large_bar, wr_only)
}

function first_board_canvas() {return the_first_board_canvas}
function is_first_board_canvas(canvas) {return canvas === the_first_board_canvas}
function reset_first_board_canvas() {the_first_board_canvas = null}
function update_first_board_canvas(canvas) {
    !the_first_board_canvas && (the_first_board_canvas = canvas)
}

function already_showing_pv_p() {
    const target = D.target_move(), {move, was_top} = any_selected_suggest() || {}
    return target && (move === target) && was_top && !showing_branch_p()
}

/////////////////////////////////////////////////
// assign parts to canvases

// for smooth interaction on auto-repeated undo/redo
const sub_canvas_deferring_millisec = 10
function do_on_sub_canvas_maybe(proc) {proc && proc(sub_canvas)}
const [do_on_sub_canvas_when_idle, cancel_do_on_sub_canvas] =
      deferred_procs([do_on_sub_canvas_maybe, sub_canvas_deferring_millisec],
                     [do_nothing, 0])
let is_sub_canvas_resized = false
function do_on_sub_canvas(proc) {
    const do_now = () => (cancel_do_on_sub_canvas(), do_on_sub_canvas_maybe(proc))
    is_sub_canvas_resized ? do_now() : do_on_sub_canvas_when_idle(proc)
    is_sub_canvas_resized = false
}

const double_boards_rule = {
    double_boards: {  // [on main_canvas, on sub_canvas]
        normal: [draw_main, draw_pv], raw: [draw_raw_pure, draw_pv]
    },
    double_boards_raw: {
        normal: [draw_main, draw_raw_unclickable], raw: [draw_raw_pure, draw_pv]
    },
    double_boards_swap: {
        normal: [draw_raw_swap, draw_sub], raw: [draw_main, draw_pv]
    },
    double_boards_raw_pv: {
        normal: [draw_raw_clickable, draw_pv], raw: [draw_main, draw_pv]
    },
}

function update_goban() {
    reset_first_board_canvas()
    const btype = current_board_type()
    const f = (m, w, s) => (update_target_move(m, s),
                            m(main_canvas),
                            (w || draw_wr_graph)(winrate_graph_canvas),
                            do_on_sub_canvas(s),
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
    const stop_trail_p = finitep(showing_until())
    c.style.visibility = wro ? 'hidden' : 'visible'
    !wro && !stop_trail_p && D.draw_visits_trail(c)
}

function update_target_move(m, s) {
    const c = (m === draw_main) ? main_canvas : (s === draw_sub) ? sub_canvas : null
    if (!c) {return}
    const u = move_count_for_suggestion(c), h = selected_suggest(c)
    const setp = !truep(u) && (h.visits > 0) && !is_setting_analysis_region()
    D.set_target_move(setp && h.move)
}

function any_selected_suggest() {
    const is_nonempty = h => !empty(Object.keys(h))
    return [main_canvas, sub_canvas].map(selected_suggest).find(is_nonempty)
}
function selected_suggest(canvas) {
    const m = keyboard_moves[0] || if_hover_on(canvas, hovered_move)
    const [fake, overwrite] = showing_branch_p() ?
          [{move: keyboard_moves[0], visits: 1}, {pv: keyboard_moves}] : [{}, {}]
    return {...(R.suggest.find(h => h.move === m) || fake), ...overwrite}
}
function if_hover_on(canvas, val) {return (canvas === hovered_board_canvas) && val}
function hover_on_subboard_p() {return if_hover_on(sub_canvas, true)}

function current_board_type() {return temporary_board_type || R.board_type}

function set_temporary_board_type(btype, btype2) {
    const b = (R.board_type === btype) ? btype2 : btype
    if (temporary_board_type === b) {return}
    temporary_board_type = b; update_board_type(); update_goban()
}

function toggle_board_type(type) {main('toggle_board_type', R.window_id, type)}

function double_boards_p() {return R.board_type.match(/^double_boards/)}

/////////////////////////////////////////////////
// mouse action

// on goban

function handle_mouse_on_goban(canvas, coord2idx, read_only) {
    const onmousedown = e => !read_only && !R.attached &&
          play_here(e, coord2idx, canvas) &&
          (set_showing_movenum_p(false), hover_off(canvas))
    const onmouseup = e => {
        if (!is_setting_analysis_region()) {return}
        const idx = is_event_to_set_analysis_region(e) && mouse2idx(e, coord2idx)
        set_analysis_region(idx); hover_off(canvas)
        idx && cancel_next_alt_up()
    }
    const ondblclick = onmousedown
    const onmousemove = e => {unset_stone_is_clicked(); hover_here(e, coord2idx, canvas)}
    const onmouseenter = onmousemove
    const onmouseleave = e => hover_off(canvas)
    const handlers = {
        onmousedown, onmouseup, ondblclick, onmousemove, onmouseenter, onmouseleave,
    }
    add_mouse_handlers_with_record(canvas, handlers)
}
function ignore_mouse_on_goban(canvas) {
    const ks = ['onmousedown', 'ondblclick', 'onmousemove',
                'onmouseenter', 'onmouseleave']
    ks.forEach(k => canvas[k] = do_nothing)
}

function play_here(e, coord2idx, canvas) {
    const dblclick = (e.type === 'dblclick')
    if (is_stone_clicked && !dblclick) {return true}
    const move = mouse2move(e, coord2idx); if (!move) {return true}
    const idx = move2idx(move)
    const another_board = e.ctrlKey, pass = e.button === 2 && R.move_count > 0
    const goto_p = showing_movenum_p() || dblclick
    const stone_p = aa_ref(R.stones, ...idx).stone
    const match_sec = in_match_p() && (set_match_param(), auto_play_in_match_sec())
    const force_create = in_match_p() ? 'never_redo' : !!another_board
    if (is_event_to_edit_middle(e)) {
        pass && main('edit_middle', 'pass'); main('edit_middle', move); return true
    }
    if (is_event_to_set_analysis_region(e)) {start_analysis_region(idx); return false}
    if (goto_p) {goto_idx_maybe(idx, another_board); return true}
    if (stone_p) {
        set_showing_movenum_p(true); hover_here(e, coord2idx, canvas)
        set_stone_is_clicked(); return false
    }
    pass && main('pass')  // right click = pass and play
    main('play', move, force_create, null, null, match_sec)
    return true
}
function play_pass(e) {
    is_event_to_edit_middle(e) ? main('edit_middle', 'pass') :
        (main('pass'), auto_play_in_match())
}
function auto_play_in_match() {
    in_match_p() && main('auto_play_in_match', auto_play_in_match_sec())
}
function set_match_param(reset_p) {
    const it = Q('#weaken'); reset_p && (it.selectedIndex = 0)
    main('set_match_param', it.options[it.selectedIndex].value)
}
function reset_match_param() {set_match_param(true)}
function auto_play_in_match_sec() {return to_f(Q('#match_sec').value)}
function hover_here(e, coord2idx, canvas) {
    set_hovered(mouse2move(e, coord2idx) || 'last_move', null, canvas)
}
function hover_off(canvas) {set_hovered(null, null, null)}

function goto_idx_maybe(idx, another_board) {
    const mc = latest_move_count_for_idx(idx)
    return mc &&
        (duplicate_if(another_board), main('goto_move_count', mc - 1), wink(), true)
}
function duplicate_if(x) {x && main('duplicate_sequence')}

const [unset_busy_later] = deferred_procs([() => main('unset_busy'), 100])

const wheel_enabled = [main_canvas, sub_canvas, winrate_graph_canvas]
wheel_enabled.forEach(c => c.addEventListener("wheel", e => {
    (e.deltaY !== 0) && (e.preventDefault(), main('busy', e.deltaY < 0 ? 'undo' : 'redo'), unset_busy_later())
}))

let is_stone_clicked = false
function set_stone_is_clicked() {is_stone_clicked = true}
function unset_stone_is_clicked() {
    is_stone_clicked && ((is_stone_clicked = false), set_showing_movenum_p(false))
}

function is_event_to_edit_middle(e) {return R.forced_color_to_play || (e.shiftKey && e.ctrlKey)}

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
    clear_tentatively_showing_until()
    const [old_move, old_count] = [hovered_move, hovered_move_count]
    hovered_move = move
    truep(count) ? set_hovered_move_count_as(count) :
        set_hovered_move_count(hovered_move)
    hovered_board_canvas = canvas
    const changed = (hovered_move !== old_move) || (hovered_move_count !== old_count)
    changed && update_goban()
}
function set_hovered_move_count(move) {
    const count = move && latest_move_count_for_idx(move2idx(move))
    set_hovered_move_count_as(count)
}
function set_hovered_move_count_as(count) {
    hovered_move_count = count
    update_showing_until()
}

// util

function latest_move_count_for_idx(idx) {
    const s = idx && aa_ref(R.stones, ...idx)
    return s && (D.latest_move(s.anytime_stones, R.move_count) || {}).move_count
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

// analysis_region = [[imin, imax], [jmin, jmax]]

let analysis_region = null, analysis_region_start_idx = null
function is_event_to_set_analysis_region(e) {return e.altKey}
function is_setting_analysis_region() {return !!analysis_region_start_idx}
function start_analysis_region(idx) {
    toast('Drag to set analysis region')
    set_analysis_region(null); analysis_region_start_idx = idx
}
function set_analysis_region(idx) {
    const region = region_from_idx(analysis_region_start_idx, idx)
    const cancel_p = !region || region.every(([p, q]) => p === q)
    analysis_region_start_idx && cancel_p && toast('Canceled')
    analysis_region_start_idx = null
    update_analysis_region(cancel_p ? null : region)
}
function update_analysis_region(region) {
    main('update_analysis_region', analysis_region = region)
    region && toast('Alt+click to cancel region')
}
function get_analysis_region_for_display() {
    const tmp_idx = move2idx_maybe(hovered_move || '')
    const tmp_region = region_from_idx(analysis_region_start_idx, tmp_idx)
    return tmp_region || analysis_region
}
function region_from_idx(...idx_pair) {
    return idx_pair.every(truep) && aa_transpose(idx_pair).map(num_sort)
}

function shrink_analysis_region_to(direction) {
    const args = {
        left: [1, false], right: [1, true], up: [0, false], down: [0, true],
    }
    shrink_analysis_region(...args[direction])
}
function shrink_analysis_region(axis, positive) {
    const ratio = 0.3, b = board_size() - 1
    const region = analysis_region || [[0, b], [0, b]]
    const [kmin, kmax] = region[axis], k_for = c => Math.round(kmin * (1 - c) + kmax * c)
    const cs = positive ? [ratio, 1] : [0, 1 - ratio], shrunken = cs.map(k_for)
    region.splice(axis, 1, shrunken); update_analysis_region(region)
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
    if (R.sequence_length > max_sequence_length_for_thumbnail) {return}
    const id = true_or(given_id, current_sequence_id())
    const stones = given_stones || R.stones
    const trial_p = (given_trial_p === undefined) ? R.trial : given_trial_p
    take_thumbnail_of_stones(stones, url => store_thumbnail(id, url), trial_p)
}

function take_thumbnail_of_stones(stones, proc, trail_p) {
    const drawing_func = canvas =>
          with_board_size(stones.length, D.draw_thumbnail_goban, canvas, stones, trail_p)
    const callback = blob => proc(URL.createObjectURL(blob))
    generate_board_image_blob(drawing_func, callback, 'image/jpeg', 0.3)
}

let reusable_canvas = null
function generate_board_image_blob(drawing_func, callback, mime_type, quality) {
    // note: main_canvas can be rectangular by "x" key
    const [size, _] = get_canvas_size(main_canvas)
    const canvas = reusable_canvas || document.createElement("canvas")
    const my_callback = blob => {callback(blob); reusable_canvas = canvas}
    reusable_canvas = null
    set_canvas_square_size(canvas, size)
    drawing_func(canvas)
    generate_canvas_image_blob(canvas, my_callback, mime_type, quality)
}

function generate_canvas_image_blob(canvas, callback, mime_type, quality) {
    // mime_type and quality are optional. See
    // https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
    let fired = false
    canvas.toBlob(blob => {
        if (fired) {return}; fired = true  // can be called twice???
        callback(blob)
    }, mime_type, quality)
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
    const {player_black, player_white, init_len, move_count, trial, len, tags} = R.sequence_props[id]
    const players = (player_black || player_white) ?
          `${player_black || "?"}/${player_white || "?"} ` : ''
    const name = (trial ? tags : players + tags) +
          ` ${move_count - init_len}(${len - init_len})`
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
    const sub_board_max_height = h =>
          h * (portrait_p() ? 1 : wr_only ? 0.5 : h < 1000 ? 0.55 : 1)
    const sub_board_size =
          Math.min(main_board_max_size * 0.65, rest_size * 0.85,
                   sub_board_max_height(window.innerHeight))
    // use main_board_ratio in winrate_graph_width for portrait layout
    const winrate_graph_height = main_board_max_size * 0.25
    const winrate_graph_width = (wr_only && !double_boards_p()) ?
          winrate_graph_height : rest_size * main_board_ratio
    Q('#additional_graph_div').style.display = "none"
    // Q('#additional_graph_div').style.display = (wr_only ? "block" : "none")
    set_canvas_size(main_canvas, main_board_size, main_board_height)
    set_canvas_size(additional_graph_canvas, main_board_size, additional_graph_height)
    set_canvas_size(winrate_bar_canvas, main_board_size, winrate_bar_height)
    is_sub_canvas_resized = set_canvas_square_size(sub_canvas, sub_board_size)
    set_canvas_size(winrate_graph_canvas, winrate_graph_width, winrate_graph_height)
    after_effect(() => set_overlay(graph_overlay_canvas,
                                   wr_only ? main_canvas : winrate_graph_canvas))
    set_canvas_size(visits_trail_canvas, rest_size * 0.25, main_board_max_size * 0.13)
    update_all_thumbnails()
    set_cut_button_position_maybe()

    const wro_main_zone_size = (main_size - main_board_size) * 0.5
    const wro_sub_zone_size = double_boards_p() ? (rest_size - sub_board_size) * 0.5 : 0
    const wro_zone_size = wro_main_zone_size + wro_sub_zone_size
    const [zone_chart_canvas_size, zone_chart_base_canvas] = wr_only ?
          [Math.min(wro_zone_size, sub_board_size * 0.5), main_canvas] :
          [rest_size * 0.05, winrate_graph_canvas]
    set_subscript(zone_chart_canvas, zone_chart_base_canvas, zone_chart_canvas_size, 0.5)
    D.draw_zone_color_chart(zone_chart_canvas)  // call this here for efficiency

    const com = Q('#comment')
    const controller_row_margin_top = 0.02  // see index.html (dirty)
    const com_h = !portrait_p() && (window.innerHeight * (1 - controller_row_margin_top) - Q('#above_comment_for_height_calculation').getBoundingClientRect().bottom)
    com.style.height = com_h ? `${com_h}px` : 'auto'
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
    // https://stackoverflow.com/questions/19669786/check-if-element-is-visible-in-dom
    const hidden = (orig.offsetParent == null)
    canvas.style.display = hidden ? 'none' : ''; if (hidden) {return}
    copy_canvas_size(canvas, orig)
    set_relative_canvas_position(canvas, orig)
}

function copy_canvas_size(canvas, orig) {
    set_canvas_size(canvas, ...get_canvas_size(orig))
}

function get_canvas_size(canvas) {
    return [canvas.width / canvas_scale, canvas.height / canvas_scale]
}

function set_subscript(canvas, orig, size, vertical_relative_pos) {
    const vrp = vertical_relative_pos
    const shift_x = bounding_width => bounding_width
    const shift_y = bounding_height => truep(vertical_relative_pos) ?
          bounding_height * vrp - size * (1 - vrp) : bounding_height - size
    set_relative_canvas_position(canvas, orig, shift_x, shift_y)
    return set_canvas_size(canvas, size, size)
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

let prev_portait_p = false
function portrait_p() {
    const [my, sy] = ['#main_div', '#rest_div'].map(z => Q(z).getBoundingClientRect().y)
    const now_portrait_p = (my < sy)
    now_portrait_p && !prev_portait_p && toast('Portrait layout is obsolete.')
    prev_portait_p = now_portrait_p
    return now_portrait_p
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
const arrow_keys = ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]

document.onkeydown = e => {
    const until = showing_until()  // before unset_stone_is_clicked()
    arrow_keys.includes(e.key) || unset_stone_is_clicked()
    const prefix = mod => e[`${mod}Key`] ? `${mod[0].toUpperCase()}-` : ''
    const key = ['ctrl', 'alt', 'meta'].map(prefix).join('') + e.key
    const f = (g, ...a) => (e.preventDefault(), g(...a)), m = (...a) => f(main, ...a)
    // GROUP 1: for input forms
    const escape = (key === "Escape" || key === "C-["), target = e.target
    escape && (hide_dialog() && f(do_nothing), set_analysis_region(null))
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
        truep(showing_until()) ? increment_showing_until(-1) :
            (!undoable() && e.repeat && !R.busy && !e.shiftKey) ? m('redo_to_end') :
            (!redoable() && e.repeat && !e.shiftKey) ? f(do_nothing) :
            undoable() ? busy('undo_ntimes', e.shiftKey ? 15 : 1) :
            !e.repeat && f(wink); break;
    case "ArrowRight": case "ArrowDown":
        truep(showing_until()) ? increment_showing_until(+1) :
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
    key === ladder_tag_letter && m('ladder_is_seen')
    switch (key) {
    case "b": m('force_color_to_play', true); return
    case "w": m('force_color_to_play', false); return
    case "c": set_showing_movenum_p(true); return
    case "v": set_showing_endstate_value_p(true); return
    case "C-c": m('copy_sgf_to_clipboard', true); return
    case "z": f(set_temporary_board_type, "raw", "suggest"); return
    case "x": set_showing_movenum_p(false);  // avoid broken display
        // by "c" key + "x" key when mouse cursor is on the winrate graph
        f(set_temporary_board_type, "winrate_only", "suggest"); return
    case " ": m('toggle_pause'); return
    case "Z": f(toggle_board_type, 'raw'); return
    case "Tab": f(toggle_board_type); return
    case "0": challenging ? m('play_best', null, 'pass_maybe') :
            f(set_keyboard_moves_for_next_move); return
    case "#": f(alert_comment); return
    case "A-h": shrink_analysis_region_to('left'); return
    case "A-j": shrink_analysis_region_to('down'); return
    case "A-k": shrink_analysis_region_to('up'); return
    case "A-l": shrink_analysis_region_to('right'); return
    case "A-[": update_analysis_region(null); return
    // (for safe_menu)
    case "B": m('toggle_stored', 'expand_winrate_bar'); return
    case "E": m('toggle_stored', 'show_endstate'); return
    case "C": m('toggle_stored', 'score_bar'); return
    case "M": m('toggle_let_me_think'); return
    }
    // GROUP 4: stand-alone only
    const goto_move_count = (c, another_board) => {
        duplicate_if(another_board); m('goto_move_count', finite_or(c, R.move_count))
    }
    const play_target = another_board => {
        const move = D.target_move()
        const force_create = another_board ||
              (showing_branch_p() ? false : 'never_redo')
        reset_keyboard_moves(); m('play', move, force_create)
    }
    const switch_to_branch = () => {
        const {id} = showing_branch
        reset_keyboard_moves(true); m('switch_to_game_id', id, R.move_count + 1)
    }
    const play_it = (steps, another_board) =>
          showing_branch_p() ? switch_to_branch() :
          D.target_move() ? play_target(another_board) :
          truep(until) ? goto_move_count(until, another_board) :
          truep(steps) ? m('play_best', steps) :
          !empty(R.suggest) ? m('play', R.suggest[0].move,
                                another_board || 'never_redo') : false
    switch (!R.attached && key) {
    case "C-v": m('paste_sgf_or_url_from_clipboard'); break;
    case "C-x": m('cut_sequence'); break;
    case "C-w": m('close_window_or_cut_sequence'); break;
    case "p": case "C-P": play_pass(e); break;
    case "Enter": play_it(e.shiftKey ? 5 : 1); break;
    case "`": f(play_it, false, true); break;
    case ",": f(play_moves, (any_selected_suggest() || R.suggest[0] || {}).pv); break;
    case ";": m('let_me_think_next', R.board_type); break;
    case "Home": m('undo_to_start'); break;
    case "End": m('redo_to_end'); break;
    case "Backspace": case "Delete": m('explicit_undo'); break;
    case "a": f(toggle_auto_analyze_visits); break;
    case "q": R.trial ? m('cut_sequence') : wink(); break;
    }
}

document.onkeyup = e => {
    // cancel keep_selected_variation_maybe() by almost any keyup
    // (ex.) keeping "2" key down, push and release control key to update
    // displayed variation
    // (caution!) Just after release of control key, keydown of "2" key is fired
    // without e.repeat. It causes a race condition with
    // ipc.on('render', ...) that is called by the following main('unset_busy').
    const {key} = e, clearp = tag_letters.includes(key) || key === "Shift"
    const reset_kb_moves_p = (to_i(key) > 0 || key === "0" || clearp)
    reset_keyboard_tag();
    reset_kb_moves_p && reset_keyboard_moves(true)
    cancel_alt_up_maybe(e)
    switch (key) {
    case "b": case "w": main('cancel_forced_color'); break
    case "c": set_showing_movenum_p(false); break
    case "v": set_showing_endstate_value_p(false); break
    case "z": case "x": set_temporary_board_type(null); break
    default: !reset_kb_moves_p && clear_selected_variation()
        // Don't call clear_selected_variation for z, x, ... to avoid flicker.
    }
    clearp && clear_tentatively_showing_until()
    with_skip(do_nothing)  // cancel deferred proc (necessary!)
    immediately_update_showing_until()
    main('unset_busy')
    // (fixme) immediately_update_showing_until() also calls main() internally.
    // Then update_all() is redundantly called twice by two "main()".
}

function set_keyboard_moves_maybe(n) {set_keyboard_moves(R.suggest[n])}
function set_keyboard_moves_for_next_move() {
    set_keyboard_moves(R.suggest.find(h => D.is_next_move(h.move)))
}
function set_keyboard_moves(h, silent) {
    h && !keyboard_moves[0] && (keyboard_moves = h.pv) && !silent && update_goban()
}
function reset_keyboard_moves(silent) {
    const done = reset_branch_moves_maybe()
    keyboard_moves = []; showing_branch = null; silent || done || update_goban()
}

function set_keyboard_tag_maybe(key) {
    if (set_branch_moves_maybe(key)) {return}
    const old = keyboard_tag_move_count, explicit = exclude_implicit_tags(key)
    const tags = R.history_tags.slice(); explicit && tags.reverse()
    const included = h => h.tag.includes(key)
    const preferred = h =>
          Math.sign(h.move_count - R.move_count) * (explicit ? -1 : 1) > 0
    const data = [...tags.filter(preferred), ...tags].find(included)
    data && (data.move_count !== old) &&
        ((keyboard_tag_move_count = data.move_count),
         update_showing_until())
}
function reset_keyboard_tag() {keyboard_tag_move_count = null}
const checker_for_showing_until = change_detector()
function showing_something_p() {return showing_movenum_p() || showing_endstate_value_p()}
function showing_movenum_p() {return the_showing_movenum_p}
function showing_endstate_value_p() {return the_showing_endstate_value_p}
function set_showing_something_p(val) {
    val && checker_for_showing_until.reset(); update_hover_maybe();
    clear_tentatively_showing_until()
    update_showing_until(); update_goban()
}
function set_showing_movenum_p(val) {
    the_showing_movenum_p = val; set_showing_something_p(val)
}
function set_showing_endstate_value_p(val) {
    the_showing_endstate_value_p = val; set_showing_something_p(val)
}
var tentatively_showing_until = null
function clear_tentatively_showing_until() {tentatively_showing_until = null}
function showing_until(canvas) {return showing_until_etc(canvas)[0]}
function move_count_for_suggestion(canvas) {return showing_until_etc(canvas)[1]}
function showing_until_etc(canvas) {
    const su = true_or(tentatively_showing_until, orig_showing_until(canvas))
    return [su, !showing_endstate_value_p() && su]
}
function orig_showing_until(canvas) {
    const hovered_mc = true_or(hovered_move_count, Infinity)
    const ret = (by_tag, by_hover) =>
          (by_tag && keyboard_tag_move_count) ||
          (by_hover && showing_something_p() && hovered_mc)
    const accept_any = !canvas, hover_on_me = if_hover_on(canvas, true)
    const hover_on_any_board = !!hovered_board_canvas
    const i_am_first_board = is_first_board_canvas(canvas)
    const my_duty_p = hover_on_me || (!hover_on_any_board && i_am_first_board)
    const retval = accept_any ? ret(true, true) : ret(i_am_first_board, my_duty_p)
    return truep(retval) && D.clip_init_len(retval)
}
const update_showing_until = skip_too_frequent_requests(immediately_update_showing_until)
function increment_showing_until(inc) {
    const mc = R.move_count, cur = finite_or(showing_until(), mc)
    const target = true_or(cur, mc) + inc
    tentatively_showing_until = Math.min(clip_init_len(target), R.history_length)
    update_showing_until()
}
function immediately_update_showing_until() {
    const su_and_mcfs = showing_until_etc()
    const [cur, _] = su_and_mcfs, changed = checker_for_showing_until.is_changed(cur)
    if (!changed) {return}
    // Caution: JSON.stringify(Infinity) === 'null'
    main('set_showing_until', ...su_and_mcfs)
}

function set_branch_moves_maybe(key) {
    const branch = R.branch_for_tag.find(z => z.tag.includes(key))
    const set_branch = () => {
        showing_branch = branch; set_keyboard_moves(branch, true)
        update_displayed_comment()
        const {at_move_count} = branch
        truep(at_move_count) ?
            main('goto_move_count', at_move_count) : update_goban()
    }
    return branch && (set_branch(), true)
}
function reset_branch_moves_maybe() {
    const {move_count, at_move_count} = (showing_branch || {})
    const goto_p = truep(at_move_count)
    return goto_p && (main('goto_move_count', move_count), true)
}
function cancel_obsolete_branch() {showing_branch_p() || (showing_branch = null)}
function showing_branch_p() {
    const {move_count, at_move_count} = (showing_branch || {})
    return true_or(at_move_count, move_count) === R.move_count
}
globalize({showing_branch_p})

function undoable() {return R.move_count > R.init_len}
function redoable() {return R.move_count < R.history_length}

let cancel_next_alt_up_p = false
function cancel_next_alt_up() {cancel_next_alt_up_p = true}
function cancel_alt_up_maybe(e) {
    const cancel_p = (e.key === 'Alt') && cancel_next_alt_up_p
    cancel_p && (e.preventDefault(), (cancel_next_alt_up_p = false))
}

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
    f('trial')
    const in_match = in_match_p(), serious = in_match_p(true)
    update_ui_element('.show_in_match', in_match)
    update_ui_element('.hide_in_match', !in_match)
    update_ui_element('.show_in_serious_match', serious)
    update_ui_element('.hide_in_serious_match', !serious)
    update_ui_element('.show_in_exercise', !!R.exercise_metadata)
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

let last_toast_animation = null
function toast(message, millisec) {
    last_toast_animation && last_toast_animation.finish()
    setq('#toast_message', message)
    const keyframes = [{opacity: 1}, {opacity: 0.8}, {opacity: 0}]
    last_toast_animation = Q('#toast').animate(keyframes, millisec || 3000)
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
