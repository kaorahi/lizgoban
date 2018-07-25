// -*- coding: utf-8 -*-

/////////////////////////////////////////////////
// setup

// util
function Q(x) {return document.querySelector(x)}
const electron = require('electron'), ipc = electron.ipcRenderer
const {to_i, to_f, xor, truep, clone, merge, last, flatten, each_key_value, array2hash, seq, do_ntimes}
      = require('./util.js')
const {idx2move, move2idx, idx2coord_translator_pair, uv2coord_translator_pair,
       board_size, sgfpos2move, move2sgfpos} = require('./coord.js')
function current_window() {return electron.remote.getCurrentWindow()}

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
const PALE_BLUE = "rgba(128,128,255,0.3)"
const PALE_RED = "rgba(255,0,0,0.1)", PALE_GREEN = "rgba(0,255,0,0.1)"
const NORMAL_GOBAN_BG = "#f9ca91", PAUSE_GOBAN_BG = '#a38360', AUTO_GOBAN_BG = GRAY
const WINRATE_BG = "#111111"

// renderer state
const R = {
    stones: [], move_count: 0, bturn: true, history_length: 0, suggest: [], playouts: 1,
    b_winrate: 50, min_winrate: 50, max_winrate: 50,
    last_move_b_eval: NaN, last_move_eval: NaN, winrate_history: [],
    attached: false, pausing: false, auto_analyzing: false
}
let board_type = current_window().lizgoban_board_type, temporary_board_type = false
let hovered_suggest = null

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

function new_window() {main('new_window', board_type === 'suggest' ? 'variation' : 'suggest')}
function toggle_auto_analyze() {
    main('toggle_auto_analyze', to_i(Q('#auto_analysis_playouts').value))
}

function main(channel, x) {ipc.send(channel, x)}

/////////////////////////////////////////////////
// from main

ipc.on('render', (e, h) => {
    merge(R, h)
    setq('#move_count', '' + R.move_count + '/' + R.history_length)
    setq('#sequence_cursor', '' + (R.sequence_cursor + 1) + '/' + R.sequence_length)
    update_goban()
    update_title(R.suggest.length > 0)
})

ipc.on('update_ui', (e, availability, ui_only) => {
    R.pausing = availability.resume
    R.auto_analyzing = availability.stop_auto_analyze
    ui_only || update_goban()
    update_body_color(availability.detach)
    update_button_etc(availability)
    update_board_type()
})

function update_title(with_eval) {
    const summary = with_eval ?
          (`B: ${R.player_black} ${f2s(R.b_winrate)}% /`
           + ` W: ${R.player_white} ${f2s(100 - R.b_winrate)}%`
           + (isNaN(R.last_move_eval) ? '' :
              ` Last move ${R.last_move_eval > 0 ? '+' : ''}${f2s(R.last_move_eval)}`)) :
          `B: ${R.player_black || "?"} / W: ${R.player_white || "?"}`
    current_window().setTitle(`LizGoban (${summary})`)
}

function update_body_color(attached) {
    Q('#body').style.color = attached ? 'black' : 'white'
    Q('#body').style.backgroundColor = attached ? '#eee' : '#444'
}

/////////////////////////////////////////////////
// draw goban etc.

function update_goban() {
    const btype = current_board_type()
    const draw_raw = c => draw_goban(c, null, true), do_nothing = truep
    const f = (m, w, s) => (m(main_canvas),
                            (w || draw_winrate_graph)(winrate_graph_canvas),
                            (s || do_nothing)(sub_canvas),
                            draw_winrate_bar(winrate_bar_canvas))
    if (board_type === "double_boards") {
        switch (btype) {
        case "winrate_only":
            f(draw_winrate_graph, draw_raw, draw_main_goban); break;
        case "raw":
            f(draw_goban, null, draw_goban_with_principal_variation); break;
        default:
            f(draw_main_goban, null, draw_goban_with_principal_variation); break;
        }
    } else {
        switch (btype) {
        case "winrate_only": f(draw_winrate_graph, draw_raw); break;
        case "raw": f(draw_goban); break;
        case "variation": f(draw_goban_with_principal_variation); break;
        case "suggest": default: f(draw_main_goban); break;
        }
    }
}

function draw_main_goban(canvas) {
    let h = hovered_suggest = R.suggest.find(h => h.move === canvas.lizgoban_mouse_move)
    h ? draw_goban_with_variation(canvas, h.variation) : draw_goban_with_suggest(canvas)
}

function draw_goban_with_suggest(canvas) {
    let displayed_stones = clone(R.stones)
    R.suggest.forEach(h => set_stone_at(h.move, displayed_stones, {suggest: true, data: h}))
    draw_goban(canvas, displayed_stones, true, true)
}

function draw_goban_with_variation(canvas, variation) {
    let displayed_stones = clone(R.stones)
    variation.forEach((move, k) => {
        let b = xor(R.bturn, k % 2 === 1), w = !b
        set_stone_at(move, displayed_stones, {
            stone: true, black: b, white: w,
            variation: true, movenum: k + 1, variation_last: k === variation.length - 1
        })
    })
    draw_goban(canvas, displayed_stones, true)
}

function draw_goban_with_principal_variation(canvas) {
    draw_goban_with_variation(canvas, (R.suggest[0] && R.suggest[0].variation) || [])
}

function set_stone_at(move, stone_array, stone) {
    // do nothing if move is pass
    let [i, j] = move2idx(move); (i >= 0) && merge(stone_array[i][j], stone)
}

function draw_goban(canvas, stones, draw_last_p, draw_next_p) {
    let margin = canvas.height * 0.05
    let g = canvas.getContext("2d")
    let [idx2coord, coord2idx] = idx2coord_translator_pair(canvas, margin, margin, true)
    let unit = idx2coord(0, 1)[0] - idx2coord(0, 0)[0]
    clear_canvas(canvas,
                 (R.pausing ? PAUSE_GOBAN_BG :
                  R.auto_analyzing ? AUTO_GOBAN_BG : NORMAL_GOBAN_BG),
                 g)
    g.strokeStyle = BLACK; g.lineWidth = 1
    rect([0, 0], [canvas.width, canvas.height], g)
    draw_grid(unit, idx2coord, g)
    draw_on_board(stones || R.stones, draw_last_p, draw_next_p, unit, idx2coord, g)
    canvas.onmousedown = e => (!R.attached && play_here(e, coord2idx))
    canvas.onmousemove = e => hover_here(e, coord2idx, canvas)
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

function draw_on_board(stones, draw_last_p, draw_next_p, unit, idx2coord, g) {
    const stone_radius = unit * 0.5
    stones.forEach((row, i) => row.forEach((h, j) => {
        let xy = idx2coord(i, j)
        h.stone ? draw_stone(h, xy, stone_radius, draw_last_p, g) :
            h.suggest ? draw_suggest(h, xy, stone_radius, g) : null
        draw_next_p && h.next_move && draw_next_move(h, xy, stone_radius, g)
    }))
}

function current_board_type() {
    return (temporary_board_type === board_type && board_type === "raw") ?
        "suggest" : (temporary_board_type || board_type)
}

function set_temporary_board_type(btype, btype2) {
    const b = (board_type === btype) ? btype2 : btype
    if (temporary_board_type === b) {return}
    temporary_board_type = b; update_board_type()
}

/////////////////////////////////////////////////
// mouse action

function play_here(e, coord2idx) {
    let move = mouse2move(e, coord2idx); move && main('play', move)
}

function hover_here(e, coord2idx, canvas) {
    let old = canvas.lizgoban_mouse_move
    canvas.lizgoban_mouse_move = mouse2move(e, coord2idx)
    if (canvas.lizgoban_mouse_move != old) {update_goban()}
}

function mouse2coord(e) {
    let bbox = e.target.getBoundingClientRect()
    return [e.clientX - bbox.left, e.clientY - bbox.top]
}

function mouse2idx(e, coord2idx) {
    let [i, j] = coord2idx(...mouse2coord(e))
    return (0 <= i && i < board_size && 0 <= j && j < board_size) && [i, j]
}

function mouse2move(e, coord2idx) {
    let idx = mouse2idx(e, coord2idx); return idx && idx2move(...idx)
}

/////////////////////////////////////////////////
// draw parts

function draw_stone(h, xy, radius, draw_last_p, g) {
    g.strokeStyle = BLACK; g.fillStyle = h.black ? BLACK : WHITE; g.lineWidth = 1
    h.maybe && (g.fillStyle = h.black ? MAYBE_BLACK : MAYBE_WHITE)
    edged_fill_circle(xy, radius, g)
    h.movenum && draw_movenum(h, xy, radius, g)
    draw_last_p && h.last && draw_last_move(h, xy, radius, g)
}

function draw_movenum(h, xy, radius, g) {
    g.fillStyle = h.variation_last ? RED : (!h.black ? BLACK : WHITE)
    let [x, y] = xy, max_width = radius * 1.5, fontsize = to_i(radius * 1.8)
    g.font = '' + fontsize + 'px sans-serif'; g.textAlign = 'center'
    g.fillText('' + to_i(h.movenum), x, y + fontsize * 0.35, max_width)
}

function draw_last_move(h, xy, radius, g) {
    g.strokeStyle = h.black ? WHITE : BLACK; g.lineWidth = 1; circle(xy, radius * 0.5, g)
}

function draw_next_move(h, xy, radius, g) {
    g.strokeStyle = h.next_is_black ? BLACK : WHITE; g.lineWidth = 3; circle(xy, radius, g)
}

// suggest_as_stone = {suggest: true, data: suggestion_data}
// See "suggestion reader" section in engine.js for suggestion_data.

function draw_suggest(h, xy, radius, g) {
    let epsilon = 1e-8, green_hue = 120
    let c = (h.data.winrate - R.min_winrate + epsilon) / (R.max_winrate - R.min_winrate + epsilon)
    let hue = to_i(green_hue * c)
    let max_alpha = 0.5, alpha_emphasis = 0.5
    let alpha = max_alpha * (h.data.playouts / (R.playouts + 1))**(1 - alpha_emphasis)
    g.lineWidth = 1
    g.fillStyle = hsl(hue, 100, 50, alpha); g.strokeStyle = hsl(0, 0, 0, alpha**0.3)
    edged_fill_circle(xy, radius, g)
    let [x, y] = xy, max_width = radius * 1.8
    let fontsize = to_i(radius * 0.8), next_y = y + fontsize
    g.fillStyle = g.strokeStyle
    g.font = '' + fontsize + 'px sans-serif'; g.textAlign = 'center'
    g.fillText('' + to_i(h.data.winrate) + '%', x, y, max_width)
    g.fillText(kilo_str(h.data.playouts), x, next_y , max_width)
}

function hsl(h, s, l, alpha) {
    return 'hsla(' + h + ',' + s + '%,' + l + '%,' + (alpha === undefined ? 1 : alpha) + ')'
}

// kilo_str(123) = '123'
// kilo_str(1234) = '1.2k'
// kilo_str(12345) = '12k'
function kilo_str(x) {
    let digits = 3, unit = 'k'
    let b = 10**digits, y = x / 10**digits, z = Math.floor(y)
    return x < b ? ('' + x) :
        (x < b * 10 ? ('' + y).slice(0, digits) : '' + z) + unit
}

/////////////////////////////////////////////////
// winrate bar

function draw_winrate_bar(canvas) {
    const w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    const tics = 9
    const xfor = percent => w * percent / 100
    const vline = percent => {const x = xfor(percent); line([x, 0], [x, h], g)}
    draw_winrate_bar_areas(w, h, xfor, vline, g)
    draw_winrate_bar_tics(tics, vline, g)
    draw_winrate_bar_last_move_eval(h, xfor, vline, g)
    draw_winrate_bar_suggestions(h, xfor, vline, g)
}

function draw_winrate_bar_areas(w, h, xfor, vline, g) {
    const wrx = xfor(R.b_winrate)
    g.lineWidth = 1
    g.fillStyle = WINRATE_BG; g.strokeStyle = WHITE; edged_fill_rect([0, 0], [wrx, h], g)
    g.fillStyle = WHITE; g.strokeStyle = WINRATE_BG; edged_fill_rect([wrx, 0], [w, h], g)
}

function draw_winrate_bar_tics(tics, vline, g) {
    seq(tics, 1).forEach(i => {
        const r = 100 * i / (tics + 1)
        g.lineWidth = 1; g.strokeStyle = (r < R.b_winrate) ? WHITE : WINRATE_BG; vline(r)
    })
    g.lineWidth = 3; g.strokeStyle = (R.b_winrate > 50) ? WHITE : WINRATE_BG; vline(50)
}

function draw_winrate_bar_last_move_eval(h, xfor, vline, g) {
    if (isNaN(R.last_move_eval)) {return}
    const [x1, x2] = [R.b_winrate, R.b_winrate - R.last_move_b_eval].map(xfor).sort()
    const [stroke, fill] = (R.last_move_eval >= 0 ?
                            [GREEN, PALE_GREEN] : [RED, PALE_RED])
    const lw = g.lineWidth = 3; g.strokeStyle = stroke; g.fillStyle = fill
    edged_fill_rect([x1, lw / 2], [x2, h - lw / 2], g)
}

function draw_winrate_bar_suggestions(h, xfor, vline, g) {
    g.lineWidth = 1
    const flip_maybe = x => R.bturn ? x : 100 - x
    const wr = flip_maybe(R.b_winrate)
    const is_next_move = move => {
        [i, j] = move2idx(move); return (i >= 0) && R.stones[i][j].next_move
    }
    R.suggest.forEach(s => {
        const {move, visits, winrate} = s
        // fan
        g.lineWidth = 1; g.strokeStyle = BLUE
        g.fillStyle = (s === hovered_suggest) ? ORANGE :
            is_next_move(move) ? YELLOW : PALE_BLUE
        const x = xfor(flip_maybe(winrate)), y = h / 2
        const radius = Math.sqrt(visits / R.playouts) * h
        const degs = R.bturn ? [150, 210] : [-30, 30]
        edged_fill_fan([x, y], radius, degs, g)
        // vertical line
        g.lineWidth = 3
        g.strokeStyle = (s === hovered_suggest) ? ORANGE :
            is_next_move(move) ? DARK_YELLOW : TRANSPARENT
        vline(flip_maybe(winrate))
    })
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
    clear_canvas(canvas, WINRATE_BG, g)
    draw_winrate_graph_frame(w, h, tics, g)
    draw_winrate_graph_move_count(smax, fontsize, sr2coord, g)
    draw_winrate_graph_vline(sr2coord, g)
    draw_winrate_graph_curve(sr2coord, g)
    canvas.onmousedown = e => !R.attached && winrate_graph_goto(e, coord2sr)
    canvas.onmousemove = e => !R.attached && (e.buttons === 1) && winrate_graph_goto(e, coord2sr)
}

function draw_winrate_graph_frame(w, h, tics, g) {
    // horizontal lines (tics)
    g.strokeStyle = DARK_GRAY; g.fillStyle = DARK_GRAY; g.lineWidth = 1
    seq(tics, 1).forEach(i => {let y = h * i / (tics + 1); line([0, y], [w, y], g)})
    // // frame
    // g.strokeStyle = GRAY; g.fillStyle = GRAY; g.lineWidth = 1
    // rect([0, 0], [w, h], g)
    // 50% line
    g.strokeStyle = GRAY; g.fillStyle = GRAY; g.lineWidth = 1
    line([0, h / 2], [w, h / 2], g)
}

function draw_winrate_graph_vline(sr2coord, g) {
    const vline = s => line(sr2coord(s, 0), sr2coord(s, 100), g)
    g.strokeStyle = DARK_GRAY; g.fillStyle = DARK_GRAY; g.lineWidth = 1
    vline(R.move_count)
}

function draw_winrate_graph_move_count(smax, fontsize, sr2coord, g) {
    g.strokeStyle = DARK_GRAY; g.fillStyle = DARK_GRAY; g.lineWidth = 1
    g.font = '' + fontsize + 'px sans-serif'
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
        g.strokeStyle = isNaN(h.move_eval) ? GRAY : (h.move_eval < 0) ? RED :
            (s > 0 && !truep(h.predict)) ? YELLOW : GREEN
        g.lineWidth = (s <= R.move_count ? 3 : 1)
        cur = sr2coord(s, h.r); prev && line(prev, cur, g); prev = cur
    })
}

function winrate_graph_goto(e, coord2sr) {
    const [s, r] = coord2sr(...mouse2coord(e))
    s >= 0 && main('goto_move_count', Math.max(0, Math.min(s, R.history_length)))
}

/////////////////////////////////////////////////
// graphics

function clear_canvas(canvas, bg_color, g) {
    canvas.style.background = bg_color
    g.clearRect(0, 0, canvas.width, canvas.height)
}

function line([x0, y0], [x1, y1], g) {
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke()
}

function drawers_trio(gen) {
    const edged = (...a) => {gen(...a); last(a).stroke()}
    const filled = (...a) => {gen(...a); last(a).fill()}
    const both = (...a) => {filled(...a); edged(...a)}
    return [edged, filled, both]
}

function rect_gen([x0, y0], [x1, y1], g) {g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0)}
function circle_gen([x, y], r, g) {g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI)}
function fan_gen([x, y], r, [deg1, deg2], g) {
    g.beginPath(); g.moveTo(x, y)
    g.arc(x, y, r, deg1 * Math.PI / 180, deg2 * Math.PI / 180); g.closePath()
}

const [rect, fill_rect, edged_fill_rect] = drawers_trio(rect_gen)
const [circle, fill_circle, edged_fill_circle] = drawers_trio(circle_gen)
const [fan, fill_fan, edged_fill_fan] = drawers_trio(fan_gen)

/////////////////////////////////////////////////
// canvas

function set_all_canvas_size() {
    const main_size = Q('#main_div').clientWidth
    const rest_size = Q('#rest_div').clientWidth
    const main_board_ratio = 0.96, main_board_size = main_size * main_board_ratio
    // use main_board_ratio in winrate_graph_width for portrait layout
    const winrate_graph_width = rest_size * main_board_ratio
    set_canvas_square_size(main_canvas, main_board_size)
    set_canvas_size(winrate_bar_canvas,
                    main_board_size, main_size * (1 - main_board_ratio))
    set_canvas_square_size(sub_canvas, rest_size * 0.85)
    set_canvas_size(winrate_graph_canvas,
                    winrate_graph_width, winrate_graph_width * 0.35)
}

function set_canvas_square_size(canvas, size) {set_canvas_size(canvas, size, size)}

function set_canvas_size(canvas, width, height) {
    canvas.setAttribute('width', width); canvas.setAttribute('height', height)
}

/////////////////////////////////////////////////
// keyboard operation

document.onkeydown = e => {
    if (e.target.id === "auto_analysis_playouts" && e.key === "Enter") {
        toggle_auto_analyze(); return
    }
    if (e.target.tagName === "INPUT" && e.target.type !== "button") {return}
    const f = (g, ...a) => (e.preventDefault(), g(...a)), m = (...a) => f(main, ...a)
    switch (e.key) {
    case "c": e.ctrlKey && m('copy_sgf_to_clipboard'); break;
    case "d": e.ctrlKey && m('detach_from_sabaki'); break;
    case "z": f(set_temporary_board_type, "raw", "suggest"); break;
    case "x": f(set_temporary_board_type, "winrate_only", "suggest"); break;
    case " ": m('toggle_ponder'); break;
    }
    switch (!R.attached && e.key) {
    case "ArrowLeft": case "ArrowUp": m('undo_ntimes', e.shiftKey ? 15 : 1); break;
    case "ArrowRight": case "ArrowDown": m('redo_ntimes', e.shiftKey ? 15 : 1); break;
    case "[": m('previous_sequence'); break;
    case "]": m('next_sequence'); break;
    case "p": m('pass'); break;
    case "Enter": m('play_best', e.shiftKey ? 5 : 1); break;
    case "v": e.ctrlKey && m('paste_sgf_from_clipboard'); break;
    case "Backspace": case "Delete": m('explicit_undo'); break;
    case "Home": m('undo_to_start'); break;
    case "End": m('redo_to_end'); break;
    case "a": e.ctrlKey ? m('attach_to_sabaki') : f(toggle_auto_analyze); break;
    }
}

document.onkeyup = e => {
    switch (e.key) {
    case "z": case "x": set_temporary_board_type(false); break;
    }
}

/////////////////////////////////////////////////
// controller

// board type selector

function update_board_type() {
    board_type = current_window().lizgoban_board_type
    update_ui_element("#sub_goban_container", board_type === "double_boards")
    update_goban()
}

// buttons

function update_button_etc(availability) {
    const f = (key, ids) =>
          (ids || key).split(/ /).forEach(x => update_ui_element('#' + x, availability[key]))
    f('undo', 'undo undo_ntimes undo_to_start explicit_undo')
    f('redo', 'redo redo_ntimes redo_to_end')
    f('previous_sequence'); f('next_sequence')
    f('attach', 'hide_when_attached1 hide_when_attached2'); f('detach')
    f('pause'); f('resume'); f('bturn'); f('wturn'); f('auto_analyze')
    f('start_auto_analyze', 'start_auto_analyze auto_analysis_playouts')
    f('stop_auto_analyze')
    f('normal_ui')
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
// init

main('init_from_renderer')

// (ref.)
// https://teratail.com/questions/8773
// https://qiita.com/damele0n/items/f4050649de023a948178
// https://qiita.com/tkdn/items/5be7ee5cc178a62f4f67
Q('body').offsetLeft  // magic spell to get updated clientWidth value
set_all_canvas_size()
