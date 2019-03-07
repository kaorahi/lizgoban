// -*- coding: utf-8 -*-

/////////////////////////////////////////////////
// setup

// util
function Q(x) {return document.querySelector(x)}
const electron = require('electron'), ipc = electron.ipcRenderer
const {to_i, to_f, xor, truep, clip, merge, empty, last, flatten, each_key_value, array2hash, seq, do_ntimes, deferred_procs}
      = require('./util.js')
const {idx2move, move2idx, idx2coord_translator_pair, uv2coord_translator_pair,
       board_size, sgfpos2move, move2sgfpos} = require('./coord.js')
const current_window = electron.remote.getCurrentWindow()

// canvas
const main_canvas = Q('#goban'), sub_canvas = Q('#sub_goban')
const winrate_bar_canvas = Q('#winrate_bar'), winrate_graph_canvas = Q('#winrate_graph')

// color constant
const BLACK = "#000", WHITE = "#fff"
const GRAY = "#ccc", DARK_GRAY = "#444"
const RED = "#f00", GREEN = "#0c0", BLUE = "#88f", YELLOW = "#ff0"
const ORANGE = "#fc8d49"
const DARK_YELLOW = "#c9a700", TRANSPARENT = "rgba(0,0,0,0)"
const MAYBE_BLACK = "rgba(0,0,0,0.5)", MAYBE_WHITE = "rgba(255,255,255,0.5)"
const VAGUE_BLACK = 'rgba(0,0,0,0.3)', VAGUE_WHITE = 'rgba(255,255,255,0.3)'
const PALE_BLUE = "rgba(128,128,255,0.5)"
const PALE_BLACK = "rgba(0,0,0,0.1)", PALE_WHITE = "rgba(255,255,255,0.3)"
const PALE_RED = "rgba(255,0,0,0.1)", PALE_GREEN = "rgba(0,255,0,0.1)"
const WINRATE_TRAIL_COLOR = 'rgba(160,160,160,0.8)'
const EXPECTED_COLOR = 'rgba(0,0,255,0.3)', UNEXPECTED_COLOR = 'rgba(255,0,0,0.8)'
// p: pausing, t: trial
const GOBAN_BG_COLOR = {"": "#f9ca91", p: "#a38360", t: "#f7e3cd", pt: "#a09588"}

// renderer state
const R = {
    stones: [], move_count: 0, bturn: true, history_length: 0, suggest: [], visits: 1,
    winrate_history: [], previous_suggest: null,
    attached: false, pausing: false, auto_analyzing: false, winrate_trail: false,
    expand_winrate_bar: false,
    auto_analysis_visits: Infinity, max_visits: 1,
    sequence_cursor: 1, sequence_length: 1, sequence_ids: [],
    history_tags: [],
    tag_letters: '',
}
let temporary_board_type = null, target_move = null
let keyboard_moves = [], keyboard_tag_data = {}
let thumbnails = []

// handler
window.onload = window.onresize = update
function update()  {set_all_canvas_size(); update_goban()}

/////////////////////////////////////////////////
// util

function setq(x, val) {Q(x).textContent = val}
function setdebug(x) {setq('#debug', JSON.stringify(x))}
const f2s = (new Intl.NumberFormat(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})).format

// for debug from Developper Tool
function send_to_leelaz(cmd) {main('send_to_leelaz', cmd)}

/////////////////////////////////////////////////
// action

function new_window() {main('new_window', R.board_type === 'suggest' ? 'variation' : 'suggest')}
function toggle_auto_analyze() {
    main('toggle_auto_analyze', auto_analysis_visits_setting())
}
function toggle_auto_analyze_visits() {
    R.auto_analyzing ? toggle_auto_analyze() : Q('#auto_analysis_visits').select()
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
                                             (k === 0) && R.start_moves_tag_letter))
}

function main(channel, ...args) {ipc.send(channel, ...args)}

/////////////////////////////////////////////////
// from main

ipc.on('render', (e, h) => {
    merge(R, h)
    setq('#move_count', R.move_count)
    setq('#history_length', ' (' + R.history_length + ')')
    R.max_visits = (R.suggest.find(s => (s.order === 0)) || {}).visits
    update_goban()
})

ipc.on('update_ui', (e, availability, ui_only, board_type) => {
    R.pausing = availability.resume
    R.auto_analyzing = availability.stop_auto
    merge(R, {board_type})
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

function b_winrate(nth_prev) {return winrate_history_ref('r', nth_prev)}
function last_move_b_eval() {return winrate_history_ref('move_b_eval')}
function last_move_eval() {return winrate_history_ref('move_eval')}
function winrate_history_ref(key, nth_prev) {
    return (R.winrate_history[R.move_count - (nth_prev || 0)] || {})[key]
}
function current_tag_letters() {return R.history_tags.map(x => x.tag).join('')}

function update_body_color() {
    [Q('#body').style.color, Q('#body').style.backgroundColor] =
        R.attached ? ['white', '#111'] :
        R.auto_analyzing ? ['black', '#aaa'] : ['white', '#444']
}

/////////////////////////////////////////////////
// draw goban etc.

// for smooth interaction on auto-repeated undo/redo
const sub_canvas_deferring_millisec = 10
const [do_on_sub_canvas_when_idle] =
      deferred_procs([f => f(sub_canvas), sub_canvas_deferring_millisec])

function update_goban() {
    const btype = current_board_type(), do_nothing = truep
    const draw_raw_unclickable = c => draw_goban(c, null, {draw_last_p: true, read_only: true})
    const draw_raw_clickable = c => draw_goban(c, null, {
        draw_visits_p: true, draw_last_p: R.board_type === "raw"
    })
    const f = (m, w, s) => (m(main_canvas),
                            (w || draw_winrate_graph)(winrate_graph_canvas),
                            do_on_sub_canvas_when_idle(s || do_nothing),
                            draw_winrate_bar(winrate_bar_canvas))
    if (R.board_type === "double_boards") {
        switch (btype) {
        case "winrate_only":
            f(draw_winrate_graph, draw_raw_unclickable, draw_main_goban); break;
        case "raw":
            f(draw_raw_clickable, null, draw_goban_with_principal_variation); break;
        default:
            f(draw_main_goban, null, draw_goban_with_principal_variation); break;
        }
    } else {
        switch (btype) {
        case "winrate_only": f(draw_winrate_graph, draw_raw_unclickable); break;
        case "raw": f(draw_raw_clickable); break;
        case "variation": f(draw_goban_with_principal_variation); break;
        case "suggest": default: f(draw_main_goban); break;
        }
    }
}

function draw_main_goban(canvas) {
    const opts = {draw_visits_p: true, read_only: R.attached}
    const h = selected_suggest(canvas); target_move = h.move
    // case I: "variation"
    if (target_move) {draw_goban_with_variation(canvas, h, opts); return}
    // case II: "suggest" or "until"
    const [i, j] = h.move ? move2idx(h.move) : [-1, -1]
    const s = (i >= 0 && R.stones[i] && R.stones[i][j]) || {}
    const show_until = keyboard_tag_data.move_count ||
          (s.stone && s.tag && (s.move_count !== R.move_count) && s.move_count)
    show_until ? draw_goban_until(canvas, show_until, opts)
        : draw_goban_with_suggest(canvas, opts)
}

function draw_goban_until(canvas, show_until, opts) {
    const displayed_stones = copy_stones_for_display()
    const latest_move = ss => {
        const n = ss.findIndex(z => (z.move_count > show_until))
        return n >= 0 ? ss[n - 1] : last(ss)
    }
    each_stone(displayed_stones, (h, idx) => {
        const ss = h.anytime_stones, target = ss && latest_move(ss)
        if (target) {
            h.black = target.is_black; h.last = (target.move_count === show_until)
            h.displayed_colors =
                h.last ? [BLACK, WHITE] :
                h.stone ? [MAYBE_BLACK, MAYBE_WHITE] : [PALE_BLACK, PALE_WHITE]
        }
        h.stone = !!target; h.displayed_tag = h.tag
    })
    draw_goban(canvas, displayed_stones, {draw_last_p: true, ...opts})
}

function draw_goban_with_suggest(canvas, opts) {
    const displayed_stones = copy_stones_for_display()
    R.suggest.forEach(h => set_stone_at(h.move, displayed_stones, {suggest: true, data: h}))
    each_stone(displayed_stones, (h, idx) => (h.displayed_tag = h.tag && h.stone))
    const s0 = R.suggest.find(s => s.order === 0)
    const expected_move = expected_pv()[0]
    expected_move && !empty(R.suggest) && s0.move !== expected_move &&
        set_expected_stone(expected_move, s0.move, displayed_stones)
    draw_goban(canvas, displayed_stones,
               {draw_last_p: true, draw_next_p: true, draw_expected_p: true, ...opts})
}

function draw_goban_with_variation(canvas, suggest, opts) {
    const reliable_moves = 7
    const variation = suggest.pv || []
    const expected = expected_pv()
    let mark_unexpected_p = (expected[0] === variation[0]) || opts.force_draw_expected_p
    const displayed_stones = copy_stones_for_display()
    variation.forEach((move, k) => {
        const b = xor(R.bturn, k % 2 === 1), w = !b, expected_move = expected[k]
        set_stone_at(move, displayed_stones, {
            stone: true, black: b, white: w,
            variation: true, movenums: [k + 1],
            variation_last: k === variation.length - 1, is_vague: k >= reliable_moves
        })
        if (mark_unexpected_p && expected_move && expected_move !== move) {
            set_expected_stone(expected[k], move, displayed_stones)
            mark_unexpected_p = false
        }
    })
    const [winrate_text, visits_text, prior_text] = suggest_texts(suggest) || []
    const text = winrate_text && (canvas === main_canvas) ?
          `${winrate_text} (${visits_text})` : undefined
    const subtext = text && ` prior = ${prior_text} `
    const at = flip_maybe(suggest.winrate)
    const mapping_to_winrate_bar = text && {text, subtext, at}
    draw_goban(canvas, displayed_stones,
               {draw_last_p: true, draw_expected_p: true,
                mapping_to_winrate_bar, ...opts})
}

function draw_goban_with_principal_variation(canvas) {
    draw_goban_with_variation(canvas, R.suggest[0] || {},
                              {read_only: true, force_draw_expected_p: true})
}

function selected_suggest(canvas) {
    const m = keyboard_moves[0] || canvas.lizgoban_hovered_move
    return R.suggest.find(h => h.move === m) || {}
}

function copy_stones_for_display() {
    return R.stones.map(row => row.map(s => merge({}, s)))
}

function each_stone(stones, proc) {
    stones.forEach((row, i) => row.forEach((h, j) => proc(h, [i, j])))
}

function set_stone_at(move, stone_array, stone) {
    const get_movenums = s => s.movenums || []
    const ary_or_undef = a => empty(a) ? undefined : a
    const merge_stone = (stone0, stone1) =>
        merge(stone0, stone1,
              {movenums: ary_or_undef(flatten([stone0, stone1].map(get_movenums)))})
    // do nothing if move is pass
    const [i, j] = move2idx(move); (i >= 0) && merge_stone(stone_array[i][j], stone)
}

function expected_pv() {return ((R.previous_suggest || {}).pv || []).slice(1)}

function set_expected_stone(expected_move, unexpected_move, displayed_stones) {
    set_stone_at(expected_move, displayed_stones, {expected_move: true})
    set_stone_at(unexpected_move, displayed_stones, {unexpected_move: true})
}

function draw_goban(canvas, stones, opts) {
    const {draw_last_p, draw_next_p, draw_visits_p, draw_winrate_trail_p,
           draw_expected_p,
           read_only, mapping_to_winrate_bar} = opts || {}
    const margin = canvas.height * 0.05
    const g = canvas.getContext("2d"); g.lizgoban_canvas = canvas
    const [idx2coord, coord2idx] = idx2coord_translator_pair(canvas, margin, margin, true)
    const unit = idx2coord(0, 1)[0] - idx2coord(0, 0)[0]
    const hovered_move = canvas.lizgoban_hovered_move
    // clear
    g.strokeStyle = BLACK; g.fillStyle = goban_bg(); g.lineWidth = 1
    edged_fill_rect([0, 0], [canvas.width, canvas.height], g)
    // draw
    draw_grid(unit, idx2coord, g)
    draw_visits_p && draw_visits(margin, canvas, g)
    mapping_to_winrate_bar &&
        draw_mapping_text(mapping_to_winrate_bar, margin, canvas, g)
    !read_only && hovered_move && draw_cursor(hovered_move, unit, idx2coord, g)
    draw_on_board(stones || R.stones,
                  draw_last_p, draw_next_p, draw_expected_p, unit, idx2coord, g)
    // mouse events
    canvas.onmousedown = e => (!read_only && !R.attached &&
                               (play_here(e, coord2idx), hover_off(canvas)))
    canvas.onmousemove = e => hover_here(e, coord2idx, canvas)
    canvas.onmouseleave = e => hover_off(canvas)
}

function draw_grid(unit, idx2coord, g) {
    g.strokeStyle = BLACK; g.fillStyle = BLACK; g.lineWidth = 1
    seq(board_size).forEach(i => {
        line(idx2coord(i, 0), idx2coord(i, board_size - 1), g)
        line(idx2coord(0, i), idx2coord(board_size - 1, i), g)
    })
    const star_radius = unit * 0.1, stars = [3, 9, 15]
    stars.forEach(i => stars.forEach(j => fill_circle(idx2coord(i, j), star_radius, g)))
}

function draw_visits(margin, canvas, g) {
    if (!truep(R.visits)) {return}
    draw_visits_text(margin, canvas, g)
    draw_progress(margin, canvas, g)
}

function draw_visits_text(margin, canvas, g) {
    g.save()
    g.fillStyle = BLACK; set_font(margin / 3, g)
    g.textAlign = 'left'; g.textBaseline = 'middle'
    g.fillText(`  visits = ${R.visits}`, 0, margin / 4)
    g.restore()
}

function draw_progress(margin, canvas, g) {
    if (R.progress < 0) {return}
    g.fillStyle = R.bturn ? BLACK : WHITE
    fill_rect([0, canvas.height - margin / 10],
              [canvas.width * R.progress, canvas.height], g)
}

function draw_mapping_text(mapping_to_winrate_bar, margin, canvas, g) {
    const {text, subtext, at} = mapping_to_winrate_bar
    const y = canvas.height - margin / 6
    g.fillStyle = RED; set_font(margin / 3, g)
    // main text
    g.textAlign = at < 10 ? 'left' : at < 90 ? 'center' : 'right'
    g.fillText(text, canvas.width * at / 100, y)
    // subtext
    const [sub_at, sub_align] = at > 50 ? [0, 'left'] : [100, 'right']
    g.fillStyle = 'rgba(255,0,0,0.5)'; g.textAlign = sub_align
    g.fillText(subtext, canvas.width * sub_at / 100, y)
}

function draw_cursor(hovered_move, unit, idx2coord, g) {
    const xy = idx2coord(...move2idx(hovered_move))
    g.fillStyle = R.bturn ? PALE_BLACK : PALE_WHITE
    fill_circle(xy, unit / 4, g)
}

function draw_on_board(stones, draw_last_p, draw_next_p, draw_expected_p,
                       unit, idx2coord, g) {
    const stone_radius = unit * 0.5
    const draw_exp = (move, exp_p, h, xy) => draw_expected_p && move &&
          draw_expected_mark(h, xy, exp_p, stone_radius, g)
    const each_coord =
          proc => each_stone(stones, (h, idx) => proc(h, idx2coord(...idx)))
    each_coord((h, xy) => {
        h.stone ? draw_stone(h, xy, stone_radius, draw_last_p, g) :
            h.suggest ? draw_suggest(h, xy, stone_radius, g) : null
        draw_next_p && h.next_move && draw_next_move(h, xy, stone_radius, g)
        draw_expected_p && (draw_exp(h.expected_move, true, h, xy),
                            draw_exp(h.unexpected_move, false, h, xy))
        h.displayed_tag && draw_tag(h.tag, xy, stone_radius, g)
    })
    each_coord((h, xy) => h.suggest && draw_winrate_mapping_line(h, xy, unit, g))
}

function goban_bg() {
    return GOBAN_BG_COLOR[(R.pausing ? 'p' : '') + (R.trial ? 't' : '')]
}

function current_board_type() {
    return (temporary_board_type === R.board_type && R.board_type === "raw") ?
        "suggest" : (temporary_board_type || R.board_type)
}

function set_temporary_board_type(btype, btype2) {
    const b = (R.board_type === btype) ? btype2 : btype
    if (temporary_board_type === b) {return}
    temporary_board_type = b; update_board_type()
}

let board_type_before_toggle = "double_boards"
function toggle_raw_board() {
    [R.board_type, board_type_before_toggle] = (R.board_type === "raw") ?
        [board_type_before_toggle, "raw"] : ["raw", R.board_type]
    update_board_type()
    current_window.lizgoban_board_type = R.board_type; main('update_menu')
}

/////////////////////////////////////////////////
// mouse action

function play_here(e, coord2idx) {
    const move = mouse2move(e, coord2idx); if (!move) {return}
    const another_board = e.ctrlKey
    goto_idx_maybe(move2idx(move), another_board) ||
        main('play', move, !!another_board)
}

function hover_here(e, coord2idx, canvas) {
    const old = canvas.lizgoban_hovered_move
    canvas.lizgoban_hovered_move = mouse2move(e, coord2idx)
    if (canvas.lizgoban_hovered_move != old) {update_goban()}
}

function hover_off(canvas) {
    canvas.lizgoban_hovered_move = undefined; update_goban()
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

function goto_idx_maybe(idx, another_board) {
    const [i, j] = idx, s = (i >= 0) ? R.stones[i][j] : {}
    return s.stone && s.tag &&
        (duplicate_if(another_board), main('goto_move_count', s.move_count - 1), true)
}

function duplicate_if(x) {x && main('duplicate_sequence')}

main_canvas.addEventListener("wheel", e => {
    (e.deltaY !== 0) && (e.preventDefault(), main(e.deltaY < 0 ? 'undo' : 'redo'))
})

/////////////////////////////////////////////////
// draw parts

function draw_stone(h, xy, radius, draw_last_p, g) {
    const [b_color, w_color] = h.displayed_colors ||
          (h.maybe ? [MAYBE_BLACK, MAYBE_WHITE] :
           h.maybe_empty ? [PALE_BLACK, PALE_WHITE] :
           h.is_vague ? [VAGUE_BLACK, VAGUE_WHITE] :
           [BLACK, WHITE])
    g.lineWidth = 1; g.strokeStyle = b_color
    g.fillStyle = h.black ? b_color : w_color
    edged_fill_circle(xy, radius, g)
    h.movenums && draw_movenums(h, xy, radius, g)
    draw_last_p && h.last && draw_last_move(h, xy, radius, g)
}

function draw_movenums(h, xy, radius, g) {
    const movenums = h.movenums.slice().sort((a, b) => a - b)
    const bw = h.is_vague ? [MAYBE_BLACK, MAYBE_WHITE] : [BLACK, WHITE]
    const color = (movenums[0] === 1) ? GREEN : h.variation_last ? RED :
          bw[h.black ? 1 : 0]
    draw_text_on_stone(movenums.join(','), color, xy, radius, g)
}

function draw_tag(tag, xy, radius, g) {
    draw_text_on_stone(tag, BLUE, xy, radius, g)
}

function draw_text_on_stone(text, color, xy, radius, g) {
    const l = text.length, [x, y] = xy, max_width = radius * 1.5
    const fontsize = to_i(radius * (l < 3 ? 1.8 : l < 6 ? 1.2 : 0.9))
    g.save()
    set_font(fontsize, g); g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillStyle = color; g.fillText(text, x, y, max_width)
    g.restore()
}

function draw_last_move(h, xy, radius, g) {
    g.strokeStyle = h.black ? WHITE : BLACK; g.lineWidth = 2
    circle(xy, radius * 0.8, g)
}

function draw_next_move(h, xy, radius, g) {
    g.strokeStyle = h.next_is_black ? BLACK : WHITE; g.lineWidth = 3; circle(xy, radius, g)
}

function draw_expected_mark(h, [x, y], expected_p, radius, g) {
    const x1 = x - radius, y1 = y + radius, d = radius / 2
    g.fillStyle = xor(R.bturn, expected_p) ? BLACK : WHITE  // whose plan?
    fill_line([x1, y1 - d], [x1, y1], [x1 + d, y1], g)
    g.strokeStyle = expected_p ? EXPECTED_COLOR : UNEXPECTED_COLOR; g.lineWidth = 2
    square_around([x, y], radius, g)
}

// suggest_as_stone = {suggest: true, data: suggestion_data}
// See "suggestion reader" section in engine.js for suggestion_data.

function draw_suggest(h, xy, radius, g) {
    const suggest = h.data, {stroke, fill, lizzie_text_color} = suggest_color(suggest)
    g.lineWidth = 1; g.strokeStyle = stroke; g.fillStyle = fill
    edged_fill_circle(xy, radius, g)
    if (R.lizzie_style) {
        const [x, y] = xy, max_width = radius * 1.8, champ_color = RED
        const fontsize = to_i(radius * 0.8), next_y = y + fontsize
        const [winrate_text, visits_text] = suggest_texts(suggest)
        g.save(); set_font(fontsize, g); g.textAlign = 'center'
        g.fillStyle = suggest.winrate_order === 0 ? champ_color : lizzie_text_color
        g.fillText(winrate_text, x, y, max_width)
        g.fillStyle = suggest.order === 0 ? champ_color : lizzie_text_color
        g.fillText(visits_text, x, next_y , max_width)
        g.restore()
    }
    draw_suggestion_order(h, xy, radius, g.strokeStyle, g)
}

function suggest_color(suggest, alpha) {
    const max_alpha = 0.5, hue = suggest_color_hue(suggest)
    const visits_ratio = suggest.visits / (R.visits + 1)
    const alpha_emphasis = emph => max_alpha * visits_ratio ** (1 - emph)
    const hsl_e = (h, s, l, emph) => hsla(h, s, l, alpha || alpha_emphasis(emph))
    const stroke = hsl_e(hue, 100, 20, 0.85), fill = hsl_e(hue, 100, 50, 0.4)
    const lizzie_text_color = hsl_e(0, 0, 0, 0.75)
    return {stroke, fill, lizzie_text_color}
}

function suggest_color_hue(suggest) {
    const cyan_hue = 180, green_hue = 120, yellow_hue = 60, red_hue = 0
    const unit_delta_points = 5, unit_delta_hue = green_hue - yellow_hue
    const wr = suggest.winrate, wr0 = flip_maybe(b_winrate(1) || b_winrate())
    const delta_hue = (wr - wr0) * unit_delta_hue / unit_delta_points
    return to_i(clip(yellow_hue + delta_hue, red_hue, cyan_hue))
}

function suggest_texts(suggest) {
    return ['' + to_i(suggest.winrate) + '%', kilo_str(suggest.visits),
            ('' + suggest.prior).slice(0, 5)]
}

function draw_winrate_mapping_line(h, xy, unit, g) {
    const canvas = g.lizgoban_canvas, b_winrate = flip_maybe(h.data.winrate)
    const x1 = canvas.width * b_winrate / 100, y1 = canvas.height, d = unit * 0.3
    const order = h.next_move ? 0 : Math.min(h.data.order, h.data.winrate_order)
    g.lineWidth = 1.5 / (order * 2 + 1)
    g.strokeStyle = RED
    line(xy, [x1, y1 - d], [x1, y1], g)
}

function draw_suggestion_order(h, [x, y], radius, color, g) {
    if (h.data.order >= 9) {return}
    const lizzie = R.lizzie_style
    const both_champ = (h.data.order + h.data.winrate_order === 0)
    const either_champ = (h.data.order * h.data.winrate_order === 0)
    const [fontsize, d, w] =
          (lizzie ? [0.8, 0.3, 0.8] :
           both_champ ? [1.5, -0.5, 1.5] : [1, -0.1, 1]).map(c => c * radius)
    g.save()
    g.fillStyle = BLUE
    lizzie && fill_rect([x + d, y - d - w], [x + d + w, y - d], g)
    g.fillStyle = lizzie ? WHITE : either_champ ? RED : color
    set_font(fontsize, g); g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(h.data.order + 1, x + d + w / 2, y - d - w / 2, w)
    g.restore()
}

function flip_maybe(x, bturn) {
    return (bturn === undefined ? R.bturn : bturn) ? x : 100 - x
}

function hsla(h, s, l, alpha) {
    return 'hsla(' + h + ',' + s + '%,' + l + '%,' + (alpha === undefined ? 1 : alpha) + ')'
}

// [0,1,2,3,4,5,6,7,8,9,10,11,12].map(k => kilo_str(10**k))  ==>
// ['1','10','100','1.0K','10K','100K','1.0M','10M','100M','1.0G','10G','100G','1000G']
function kilo_str(x) {
    return kilo_str_sub(x, [[1e9, 'G'], [1e6, 'M'], [1e3, 'k']])
}
function kilo_str_sub(x, rules) {
    if (empty(rules)) {return '' + x}
    const [[base, unit], ...rest] = rules
    if (x < base) {return kilo_str_sub(x, rest)}
    // +0.1 for "1.0K" instead of "1K"
    const y = (x + 0.1) / base, z = Math.floor(y)
    return (y < 10 ? ('' + y).slice(0, 3) : '' + z) + unit
}

/////////////////////////////////////////////////
// winrate bar

let winrate_bar_prev = 50

function draw_winrate_bar(canvas) {
    const w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    const tics = 9
    const xfor = percent => w * percent / 100
    const vline = percent => {const x = xfor(percent); line([x, 0], [x, h], g)}
    const b_wr0 = b_winrate(), b_wr = truep(b_wr0) ? b_wr0 : winrate_bar_prev
    winrate_bar_prev = b_wr
    if (R.pausing && !truep(b_wr0)) {
        draw_winrate_bar_unavailable(w, h, g)
        draw_winrate_bar_tics(0, tics, vline, g)
        return
    }
    draw_winrate_bar_areas(b_wr, w, h, xfor, vline, g)
    large_winrate_bar_p() && draw_winrate_bar_horizontal_lines(w, h, g)
    draw_winrate_bar_tics(b_wr, tics, vline, g)
    draw_winrate_bar_last_move_eval(b_wr, h, xfor, vline, g)
    R.winrate_trail && draw_winrate_trail(canvas)
    draw_winrate_bar_suggestions(w, h, xfor, vline, g)
    draw_winrate_bar_text(w, h, g)
    canvas.onmouseenter = e => {update_goban()}
    canvas.onmouseleave = e => {update_goban()}
}

function draw_winrate_bar_text(w, h, g) {
    const b_wr = b_winrate(), eval = last_move_eval()
    const visits = R.max_visits && kilo_str(R.max_visits)
    const fontsize = Math.min(h * 0.5, w * 0.04)
    if (!truep(b_wr)) {return}
    g.save()
    set_font(fontsize, g); g.textBaseline = 'middle'
    const f = (wr, x, align, myturn) => {
        const cond = (pred, s) => (pred ? ` ${s} ` : '')
        const vis = cond(visits, visits)
        const ev = cond(truep(eval), `(${eval > 0 ? '+' : ''}${f2s(eval)})`)
        const win = cond(true, `${f2s(wr)}%`)
        const [wr_color, vis_color] = (current_board_type() === 'winrate_only') ?
              ['rgba(0,192,0,0.3)', 'rgba(160,160,160,0.3)'] :
              [GREEN, WINRATE_TRAIL_COLOR]
        g.textAlign = align; g.fillStyle = wr_color; g.fillText(win, x, fontsize * 0.5)
        myturn && (g.fillStyle = vis_color)
        g.fillText(myturn ? vis : ev, x, fontsize * 1.5)
    }
    f(b_wr, 0, 'left', R.bturn)
    f(100 - b_wr, w, 'right', !R.bturn)
    g.restore()
}

function draw_winrate_bar_unavailable(w, h, g) {
    g.fillStyle = "#888"; fill_rect([0, 0], [w, h], g)
}

function draw_winrate_bar_areas(b_wr, w, h, xfor, vline, g) {
    const wrx = xfor(b_wr)
    g.lineWidth = 1
    // black area
    g.fillStyle = R.bturn ? BLACK : "#000"
    g.strokeStyle = WHITE; edged_fill_rect([0, 0], [wrx, h], g)
    // white area
    g.fillStyle = R.bturn ? "#fff" : WHITE
    g.strokeStyle = BLACK; edged_fill_rect([wrx, 0], [w, h], g)
}

function draw_winrate_bar_horizontal_lines(w, h, g) {
    const mv = R.max_visits
    const v = Math.pow(10, Math.floor(Math.log(mv) / Math.log(10)))
    const unit_v = (mv > v * 5) ? v * 2 : (mv > v * 2) ? v : v / 2
    const iota = n => [...Array(n).keys()]  // [0, 1, 2, ..., n - 1]
    const vs = iota(to_i(mv / unit_v + 2)).map(k => unit_v * k)  // +1 for margin
    g.strokeStyle = WINRATE_TRAIL_COLOR; g.lineWidth = 1
    winrate_bar_ys(vs, w, h).map(y => line([0, y], [w, y], g))
}

function draw_winrate_bar_tics(b_wr, tics, vline, g) {
    seq(tics, 1).forEach(i => {
        const r = 100 * i / (tics + 1)
        g.lineWidth = 1; g.strokeStyle = (r < b_wr) ? WHITE : BLACK; vline(r)
    })
    g.lineWidth = 3; g.strokeStyle = (b_wr > 50) ? WHITE : BLACK; vline(50)
}

function draw_winrate_bar_last_move_eval(b_wr, h, xfor, vline, g) {
    const eval = last_move_eval(), b_eval = last_move_b_eval()
    if (!truep(eval)) {return}
    const [x1, x2] = [b_wr, b_wr - b_eval].map(xfor).sort()
    const [stroke, fill] = (eval >= 0 ? [GREEN, PALE_GREEN] : [RED, PALE_RED])
    const lw = g.lineWidth = 3; g.strokeStyle = stroke; g.fillStyle = fill
    edged_fill_rect([x1, lw / 2], [x2, h - lw / 2], g)
}

function draw_winrate_bar_suggestions(w, h, xfor, vline, g) {
    g.lineWidth = 1
    const wr = flip_maybe(b_winrate())
    const is_next_move = move => {
        [i, j] = move2idx(move); return (i >= 0) && R.stones[i][j].next_move
    }
    const max_radius = Math.min(h, w * 0.05)
    const next_color = '#48f', prev_color = 'rgba(64,128,255,0.8)'
    R.suggest.forEach(s => {
        const edge_color = target_move ? 'rgba(128,128,128,0.5)' : '#888'
        const {move, winrate} = s
        const target_p = (move === target_move), next_p = is_next_move(move)
        const {fill} = suggest_color(s, target_p ? 1.0 : target_move ? 0.1 : 0.8)
        const fan_color = (!target_move && next_p) ? next_color : fill
        const vline_color = (target_p || next_p) ? fan_color : null
        const major = s.visits >= R.max_visits * 0.3 || s.prior >= 0.3 ||
              s.order < 3 || s.winrate_order < 3 || target_p || next_p
        const eliminated = target_move && !target_p
        draw_winrate_bar_fan(s, w, h, edge_color, fan_color, g)
        major && !eliminated && large_winrate_bar_p() &&
            draw_winrate_bar_order(s, w, h, g)
        if (vline_color) {
            g.lineWidth = 3; g.strokeStyle = vline_color; vline(flip_maybe(winrate))
        }
    })
    R.previous_suggest &&
        draw_winrate_bar_fan(R.previous_suggest, w, h, prev_color, TRANSPARENT, g)
}

function draw_winrate_bar_fan(s, w, h, stroke, fill, g) {
    const bturn = s.bturn === undefined ? R.bturn : s.bturn
    const [x, y, r, max_radius] = winrate_bar_xy(s, w, h, true, bturn)
    const center_angle = 60
    const direction = (bturn ? 180 : 0) + winrate_trail_rising(s) * 45 * (bturn ? -1 : 1)
    const degs = [direction - center_angle / 2, direction + center_angle / 2]
    if (large_winrate_bar_p()) {
        g.fillStyle = 'rgba(235,148,0,0.9)'
        fill_circle([x, y], max_radius * 0.15 * Math.sqrt(winrate_trail_searched(s)), g)
    }
    g.lineWidth = 1; [g.strokeStyle, g.fillStyle] = [stroke, fill]
    edged_fill_fan([x, y], r, degs, g)
}

function draw_winrate_bar_order(s, w, h, g) {
    const fontsize = w * 0.03, [x, y] = winrate_bar_xy(s, w, h)
    g.save()
    g.fillStyle = RED; set_font(fontsize, g)
    g.textAlign = R.bturn ? 'left' : 'right'; g.textBaseline = 'middle'
    g.fillText(` ${s.order + 1} `, x, y)
    g.restore()
}

function winrate_bar_xy(suggest, w, h, and_r, bturn) {
    const x = w * flip_maybe(suggest.winrate, bturn) / 100
    const max_radius = winrate_bar_max_radius(w, h)
    const y = winrate_bar_y(suggest.visits, w, h, max_radius)
    return and_r ? [x, y, max_radius * Math.sqrt(suggest.prior), max_radius] : [x, y]
}

function winrate_bar_y(visits, w, h, max_radius) {
    const mr = max_radius || winrate_bar_max_radius(w, h)
    const hmin = mr * 0.1, hmax = h - hmin
    const relative_visits = visits / R.max_visits
    // relative_visits > 1 can happen for R.previous_suggest
    return clip(hmin * relative_visits + hmax * (1 - relative_visits), 0, h)
}

function winrate_bar_ys(vs, w, h) {
    const max_radius = winrate_bar_max_radius(w, h)
    return vs.map(v => winrate_bar_y(v, w, h, max_radius))
}

function winrate_bar_max_radius(w, h) {return Math.min(h * 1, w * 0.1)}

function large_winrate_bar_p() {
    return R.expand_winrate_bar || current_board_type() === 'winrate_only'
}

/////////////////////////////////////////////////
// winrate graph

function draw_winrate_graph(canvas) {
    const w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    const tics = current_board_type() === 'winrate_only' ? 9 : 9
    const xmargin = w * 0.02, fontsize = to_i(w * 0.04)
    const smax = Math.max(R.history_length, 1)
    // s = move_count, r = winrate
    const [sr2coord, coord2sr] =
          uv2coord_translator_pair(canvas, [0, smax], [100, 0], xmargin, 0)
    clear_canvas(canvas, BLACK, g)
    draw_winrate_graph_frame(w, h, tics, g)
    draw_winrate_graph_move_count(smax, fontsize, sr2coord, g)
    draw_winrate_graph_future(w, h, sr2coord, g)
    draw_winrate_graph_tag(fontsize, sr2coord, g)
    draw_winrate_graph_curve(sr2coord, g)
    canvas.onmousedown = e => !R.attached && winrate_graph_goto(e, coord2sr)
    canvas.onmousemove = e => !R.attached && (e.buttons === 1) && winrate_graph_goto(e, coord2sr)
    canvas.onmouseup = e => main('unset_busy')
}

function draw_winrate_graph_frame(w, h, tics, g) {
    // horizontal lines (tics)
    g.strokeStyle = DARK_GRAY; g.fillStyle = DARK_GRAY; g.lineWidth = 1
    seq(tics, 1).forEach(i => {const y = h * i / (tics + 1); line([0, y], [w, y], g)})
    // // frame
    // g.strokeStyle = GRAY; g.fillStyle = GRAY; g.lineWidth = 1
    // rect([0, 0], [w, h], g)
    // 50% line
    g.strokeStyle = GRAY; g.fillStyle = GRAY; g.lineWidth = 1
    line([0, h / 2], [w, h / 2], g)
}

function draw_winrate_graph_future(w, h, sr2coord, g) {
    const [x, y] = sr2coord(R.move_count, 50)
    const paint = (partial, l_alpha, r_alpha, y0, y1) => {
        const c = a => `rgba(255,255,255,${a})`
        const grad = side_gradation(x, (1 - partial) * x + partial * w,
                                    c(l_alpha), c(r_alpha), g)
        g.fillStyle = grad; fill_rect([x, y0], [w, y1], g)
    }
    const alpha = 0.2
    paint(0.5, alpha, 0, 0, y); paint(1, alpha, alpha, y, h)
}

function draw_winrate_graph_move_count(smax, fontsize, sr2coord, g) {
    g.strokeStyle = DARK_GRAY; g.fillStyle = DARK_GRAY; g.lineWidth = 1
    set_font(fontsize, g)
    g.textAlign = R.move_count < smax / 2 ? 'left' : 'right'
    g.fillText(' ' + R.move_count + ' ', ...sr2coord(R.move_count, 0))
}

function draw_winrate_graph_curve(sr2coord, g) {
    let prev = null, cur = null
    const draw_predict = (r, s, p) => {
        g.strokeStyle = YELLOW; g.lineWidth = 1; line(sr2coord(s, r), sr2coord(s, p), g)
    }
    R.winrate_history.forEach((h, s) => {
        if (!truep(h.r)) {return}
        truep(h.predict) && draw_predict(h.r, s, h.predict)
        g.strokeStyle = isNaN(h.move_eval) ? GRAY : h.pass ? PALE_BLUE :
            (h.move_eval < 0) ? RED : (s > 0 && !truep(h.predict)) ? YELLOW : GREEN
        g.lineWidth = (s <= R.move_count ? 3 : 1)
        cur = sr2coord(s, h.r); prev && line(prev, cur, g); prev = cur
    })
}

function draw_winrate_graph_tag(fontsize, sr2coord, g) {
    R.winrate_history.forEach((h, s) => {
        if (!h.tag) {return}
        const [x, ymax] = sr2coord(s, 0)
        const [yt, yl] = (h.r < 50 ? [0.05, 0.1] : [0.95, 0.9]).map(c => ymax * c)
        g.save()
        set_font(fontsize, g); g.textAlign = 'center'; g.textBaseline = 'middle'
        g.strokeStyle = BLUE; g.lineWidth = 1; line([x, yl], [x, ymax / 2], g)
        g.fillStyle = BLUE; g.fillText(h.tag, x, yt)
        g.restore()
    })
}

function winrate_graph_goto(e, coord2sr) {
    const [s, r] = coord2sr(...mouse2coord(e))
    s >= 0 && main('busy', 'goto_move_count',
                   clip(s, 0, R.history_length))
}

/////////////////////////////////////////////////
// winrate trail

const winrate_trail_max_length = 50
const winrate_trail_max_suggestions = 10
const winrate_trail_limit_relative_visits = 0.3
let winrate_trail = {}, winrate_trail_move_count = 0, winrate_trail_visits = 0

function update_winrate_trail() {
    const total_visits_increase = R.visits - winrate_trail_visits;
    // check visits for detecting restart of leelaz
    (winrate_trail_move_count !== R.move_count ||
     winrate_trail_visits > R.visits) && (winrate_trail = {});
    [winrate_trail_move_count, winrate_trail_visits] = [R.move_count, R.visits]
    R.suggest.slice(0, winrate_trail_max_suggestions).forEach(s => {
        const move = s.move, wt = winrate_trail
        const trail = wt[move] || (wt[move] = []), len = trail.length
        s.relative_visits = s.visits / R.max_visits
        len > 0 && (s.searched = (s.visits - trail[0].visits) / total_visits_increase)
        s.searched === 0 && trail.shift()
        trail.unshift(s)
        len > winrate_trail_max_length &&
            trail.splice(1 + Math.floor(Math.random() * (len - 2)), 1)
            // never delete first and last element
    })
}

function draw_winrate_trail(canvas) {
    const w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    const xy_for = s => winrate_bar_xy(s, w, h)
    const limit_visits = R.max_visits * winrate_trail_limit_relative_visits
    update_winrate_trail()
    g.lineWidth = 2
    g.strokeStyle = target_move ? 'rgba(0,192,255,0.8)' : WINRATE_TRAIL_COLOR
    each_key_value(winrate_trail, (move, a, count) => {
        const ok = target_move ? (move === target_move) : (a[0].visits >= limit_visits)
        ok && line(...a.map(xy_for), g)
    })
}

function winrate_trail_rising(suggest) {
    const unit = 0.005, max_delta = 5, a = winrate_trail[suggest.move] || []
    const delta = clip(a.length - 1, 0, max_delta)
    return (delta < 1) ? 0 :
        clip((a[0].relative_visits - a[delta].relative_visits) / (delta * unit), -1, 1)
}

function winrate_trail_searched(suggest) {
    // suggest.searched > 1 can happen for some reason
    return clip(suggest.searched || 0, 0, 1)
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
    let fired = false
    main_canvas.toBlob(blob => {
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
// graphics

function clear_canvas(canvas, bg_color, g) {
    canvas.style.background = bg_color
    g.clearRect(0, 0, canvas.width, canvas.height)
}

function drawers_trio(gen) {
    const edged = (...a) => {gen(...a); last(a).stroke()}
    const filled = (...a) => {gen(...a); last(a).fill()}
    const both = (...a) => {filled(...a); edged(...a)}
    return [edged, filled, both]
}

function line_gen(...args) {
    // usage: line([x0, y0], [x1, y1], ..., [xn, yn], g)
    const g = args.pop(), [[x0, y0], ...xys] = args
    g.beginPath(); g.moveTo(x0, y0); xys.forEach(xy => g.lineTo(...xy))
}
function rect_gen([x0, y0], [x1, y1], g) {g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0)}
function circle_gen([x, y], r, g) {g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI)}
function fan_gen([x, y], r, [deg1, deg2], g) {
    g.beginPath(); g.moveTo(x, y)
    g.arc(x, y, r, deg1 * Math.PI / 180, deg2 * Math.PI / 180); g.closePath()
}

const [line, fill_line, edged_fill_line] = drawers_trio(line_gen)
const [rect, fill_rect, edged_fill_rect] = drawers_trio(rect_gen)
const [circle, fill_circle, edged_fill_circle] = drawers_trio(circle_gen)
const [fan, fill_fan, edged_fill_fan] = drawers_trio(fan_gen)

function square_around([x, y], radius, g) {
    rect([x - radius, y - radius], [x + radius, y + radius], g)
}

function set_font(fontsize, g) {g.font = '' + fontsize + 'px sans-serif'}

function side_gradation(x0, x1, color0, color1, g) {
    const grad = g.createLinearGradient(x0, 0, x1, 0)
    grad.addColorStop(0, color0); grad.addColorStop(1, color1)
    return grad
}

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
    const winrate_graph_width = rest_size * main_board_ratio
    const winrate_graph_height = main_board_max_size * 0.25
    set_canvas_size(main_canvas, main_board_size, main_board_height)
    set_canvas_size(winrate_bar_canvas,
                    main_board_size, main_size - main_board_height)
    set_canvas_square_size(sub_canvas, sub_board_size)
    set_canvas_size(winrate_graph_canvas, winrate_graph_width, winrate_graph_height)
    update_all_thumbnails()
}

function set_canvas_square_size(canvas, size) {set_canvas_size(canvas, size, size)}

function set_canvas_size(canvas, width, height) {
    if (to_i(width) === canvas.width && to_i(height) === canvas.height) {return}
    canvas.setAttribute('width', width); canvas.setAttribute('height', height)
}

/////////////////////////////////////////////////
// keyboard operation

let keydown = false

document.onkeydown = e => {
    const repeated_keydown = keydown; keydown = true
    const key = (e.ctrlKey ? 'C-' : '') + e.key
    const escape = (key === "Escape" || key === "C-[")
    if (escape) {hide_dialog()}
    switch (key === "Enter" && e.target.id) {
    case "auto_analysis_visits": toggle_auto_analyze(); return
    case "auto_play_sec": start_auto_play(); return
    }
    if (e.target.tagName === "INPUT" && e.target.type !== "button") {
        escape && e.target.blur(); return
    }
    const f = (g, ...a) => (e.preventDefault(), g(...a)), m = (...a) => f(main, ...a)
    const play_it = (steps, another_board) =>
          target_move ? m('play', target_move, another_board) :
          keyboard_tag_data.move_count ? (duplicate_if(another_board),
                                          m('goto_move_count',
                                            keyboard_tag_data.move_count - 1)) :
          truep(steps) ? m('play_best', steps) :
          !empty(R.suggest) ? m('play', R.suggest[0].move, another_board) : false
    if (to_i(key) > 0) {
        (R.board_type === "raw" && current_board_type() === "raw" && !R.attached
         && !repeated_keydown) ?
            m('play_best', 1, -1, to_i(key) * 10) :
            f(set_keyboard_moves_maybe, to_i(key) - 1)
    }
    if (key.length === 1 && R.tag_letters.indexOf(key) >= 0) {
        f(set_keyboard_tag_maybe, key)
    }
    switch (key) {
    case "C-c": m('copy_sgf_to_clipboard'); return
    case "z": f(set_temporary_board_type, "raw", "suggest"); return
    case "x": f(set_temporary_board_type, "winrate_only", "suggest"); return
    case " ": m('toggle_pause'); return
    case "Z": f(toggle_raw_board); return
    }
    const busy = (...a) => m('busy', ...a)
    switch (!R.attached && key) {
    case "C-v": m('paste_sgf_from_clipboard'); break;
    case "C-x": m('cut_sequence'); break;
    case "C-w": m('close_window_or_cut_sequence'); break;
    case "ArrowLeft": case "ArrowUp":
        busy('undo_ntimes', e.shiftKey ? 15 : 1); break;
    case "ArrowRight": case "ArrowDown":
        busy('redo_ntimes', e.shiftKey ? 15 : 1); break;
    case "[": m('previous_sequence'); break;
    case "]": m('next_sequence'); break;
    case "p": m('pass'); break;
    case "Enter": play_it(e.shiftKey ? 5 : 1); break;
    case "`": f(play_it, false, true); break;
    case "Tab": f(play_moves, keyboard_moves[0] ? keyboard_moves : R.suggest[0].pv);
        break;
    case "0": m('play_best', 1, -1, 'pass_maybe'); break;
    case "Backspace": case "Delete": busy('explicit_undo'); break;
    case "Home": m('undo_to_start'); break;
    case "End": m('redo_to_end'); break;
    case "a": f(toggle_auto_analyze_visits); break;
    case "q": R.trial && m('cut_sequence'); break;
    }
}

document.onkeyup = e => {
    keydown = false
    reset_keyboard_moves(); reset_keyboard_tag()
    switch (e.key) {
    case "z": case "x": set_temporary_board_type(null); return
    }
    main('unset_busy')
}

function set_keyboard_moves_maybe(n) {
    const h = R.suggest[n]
    h && !keyboard_moves[0] && (keyboard_moves = h.pv) && update_goban()
}
function reset_keyboard_moves() {keyboard_moves = []; update_goban()}

function set_keyboard_tag_maybe(key) {
    if (keyboard_tag_data.tag) {return}
    const tags = R.history_tags.slice().reverse()
    const data = tags.find(h => h.tag === key && h.move_count <= R.move_count) ||
          tags.find(h => h.tag === key)
    keyboard_tag_data = data || {}
    data && update_goban()
}
function reset_keyboard_tag() {keyboard_tag_data = {}; update_goban()}

/////////////////////////////////////////////////
// controller

// board type selector

function update_board_type() {
    const new_board_type = current_board_type()
    update_ui_element("#sub_goban_container", R.board_type === "double_boards")
    set_all_canvas_size()
    previous_board_type = new_board_type
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
    Q('#goban').animate([
        {transform: `translate(0%, ${shift})`, opacity: 0},
        {transform: 'translate(0)', opacity: 1},
    ], 200)
}

/////////////////////////////////////////////////
// init

main('init_from_renderer')

// (ref.)
// https://teratail.com/questions/8773
// https://qiita.com/damele0n/items/f4050649de023a948178
// https://qiita.com/tkdn/items/5be7ee5cc178a62f4f67
Q('body').offsetLeft  // magic spell to get updated clientWidth value
set_all_canvas_size()
