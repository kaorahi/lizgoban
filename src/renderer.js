// -*- coding: utf-8 -*-

/////////////////////////////////////////////////
// setup

// util
function Q(x) {return document.querySelector(x)}
const electron = require('electron')
const ipc = electron.ipcRenderer
const {to_i, to_f, xor, clone, merge, flatten, each_key_value, array2hash, seq, do_ntimes}
      = require('./util.js')
const {board_size, idx2coord_translator_pair, move2idx, idx2move, sgfpos2move, move2sgfpos}
      = require('./coord.js')
function current_window() {return electron.remote.getCurrentWindow()}

// canvas
const main_canvas = Q('#goban')
const winrate_bar_canvas = Q('#winrate_bar')
let board_type = current_window().lizgoban_board_type

// color constant
const BLACK = "#000", WHITE = "#fff", RED = "#f00"
const MAYBE_BLACK = "rgba(0,0,0,0.5)", MAYBE_WHITE = "rgba(255,255,255,0.5)"

// state
let stones = [], stone_count = 0, bturn = true, suggest = [], playouts = 1
let b_winrate = 50, min_winrate = 50, max_winrate = 50
let attached = false, showing_raw_board_temporally = false

// handler
window.onload = () => {set_all_canvas_size(); draw_goban(main_canvas, stones)}
window.onresize = set_all_canvas_size

/////////////////////////////////////////////////
// util

function setq(x, val) {Q(x).textContent = val}
function setdebug(x) {setq('#debug', JSON.stringify(x))}

/////////////////////////////////////////////////
// action

function play() {let d = Q('#move'); play_move(d.value); d.value = ''}
function play_best() {suggest.length > 0 && play_move(suggest[0].move)}
function play_move(move) {main('play', move)}

function new_window() {main('new_window', board_type === 'suggest' ? 'variation' : 'suggest')}

function main(channel, x) {ipc.send(channel, x)}

/////////////////////////////////////////////////
// from main

ipc.on('state', (e, h) => {
    stones = h.stones; stone_count = h.stone_count; bturn = h.bturn, attached = h.attached
    setq('#turn', h.bturn ? '⬤' : '◯')
    setq('#stone_count', '' + h.stone_count + '/' + h.history_length)
    setq('#sequence_cursor', '' + (h.sequence_cursor + 1) + '/' + h.sequence_length)
    suggest = []  // avoid flicker of stone colors in subboard
    update_goban()
    update_button(h.availability)
    update_board_type_switch()
})

ipc.on('suggest', (e, h) => {
    suggest = h.suggest
    playouts = h.playouts
    if (!isNaN(h.winrate)) {
        min_winrate = h.min_winrate
        max_winrate = h.max_winrate
        b_winrate = bturn ? h.winrate : 100 - h.winrate
    }
    update_goban()
})

ipc.on('play_maybe', (e, {move, is_black}) => {
    const [i, j] = move2idx(move)
    // update items on the board only.
    // don't toggle bturn because it causes flicker of winrate bar.
    i && (stones[i][j] = {stone: true, black: is_black, maybe: true}, suggest = [])
})

/////////////////////////////////////////////////
// draw goban etc.

function update_goban() {
    (showing_raw_board_temporally ||
     board_type === "raw") ? draw_goban(main_canvas, stones) :
        board_type === "suggest" ? draw_main_goban(main_canvas) :
        draw_goban_with_variation(main_canvas, (suggest[0] && suggest[0].variation) || [])
    draw_winrate_bar(winrate_bar_canvas)
}

function draw_main_goban(canvas) {
    let h = suggest.find(h => h.move === canvas.lizgoban_mouse_move)
    h ? draw_goban_with_variation(canvas, h.variation) : draw_goban_with_suggest(canvas)
}

function draw_goban_with_suggest(canvas) {
    let displayed_stones = clone(stones)
    suggest.forEach(h => set_stone_at(h.move, displayed_stones, {suggest: true, data: h}))
    draw_goban(canvas, displayed_stones, true)
}

function draw_goban_with_variation(canvas, variation) {
    let displayed_stones = clone(stones)
    variation.forEach((move, k) => {
        let b = xor(bturn, k % 2 === 1), w = !b
        set_stone_at(move, displayed_stones, {
            stone: true, black: b, white: w,
            variation: true, movenum: k + 1, variation_last: k === variation.length - 1
        })
    })
    draw_goban(canvas, displayed_stones)
}

function set_stone_at(move, stone_array, stone) {
    // do nothing if move is pass
    let [i, j] = move2idx(move); (i !== undefined) && merge(stone_array[i][j], stone)
}

function draw_goban(canvas, stones, draw_next_p) {
    let margin = canvas.width * 0.05
    let g = canvas.getContext("2d")
    let [idx2coord, coord2idx] = idx2coord_translator_pair(canvas, margin, margin)
    let unit = idx2coord(0, 1)[0] - idx2coord(0, 0)[0]
    g.clearRect(0, 0, canvas.width, canvas.height)
    draw_grid(unit, idx2coord, g)
    draw_on_board(stones, draw_next_p, unit, idx2coord, g)
    canvas.onmousedown = e => (!attached && play_here(e, coord2idx))
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

function draw_on_board(stones, draw_next_p, unit, idx2coord, g) {
    const stone_radius = unit * 0.5
    stones.forEach((row, i) => row.forEach((h, j) => {
        let xy = idx2coord(i, j)
        h.stone ? draw_stone(h, xy, stone_radius, g) :
            h.suggest ? draw_suggest(h, xy, stone_radius, g) : null
        draw_next_p && h.next_move && draw_next_move(h, xy, stone_radius, g)
    }))
}

/////////////////////////////////////////////////
// mouse action

function play_here(e, coord2idx) {
    let move = mouse2move(e, coord2idx); move && play_move(move)
}

function hover_here(e, coord2idx, canvas) {
    let old = canvas.lizgoban_mouse_move
    canvas.lizgoban_mouse_move = mouse2move(e, coord2idx)
    if (canvas.lizgoban_mouse_move != old) {update_goban()}
}

function mouse2idx(e, coord2idx) {
    let bbox = e.target.getBoundingClientRect()
    let [i, j] = coord2idx(e.clientX - bbox.left, e.clientY - bbox.top)
    return (0 <= i && i < board_size && 0 <= j && j < board_size) && [i, j]
}

function mouse2move(e, coord2idx) {
    let idx = mouse2idx(e, coord2idx); return idx && idx2move(...idx)
}

/////////////////////////////////////////////////
// draw parts

function draw_stone(h, xy, radius, g) {
    g.strokeStyle = BLACK; g.fillStyle = h.black ? BLACK : WHITE; g.lineWidth = 1
    h.maybe && (g.fillStyle = h.black ? MAYBE_BLACK : MAYBE_WHITE)
    edged_fill_circle(xy, radius, g)
    h.movenum && draw_movenum(h, xy, radius, g)
    h.last && draw_last_move(h, xy, radius, g)
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
    let c = (h.data.winrate - min_winrate) / (max_winrate - min_winrate + epsilon)
    let hue = to_i(green_hue * c), alpha = h.data.playouts / (playouts + 1)
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

function previous_value_keeper(initial_value) {
    // (ex) f = previous_value_keeper(3)
    // f("a", 4) ==> 3, f("a", 5) ==> 3, f("a", 6) ==> 3
    // f("b", 7) ==> 6, f("b", 8) ==> 6, f("c", 9) ==> 8
    let prev_key, prev_val = initial_value, cur_val
    return (key, val) => {
        if (key != prev_key) {prev_key = key, prev_val = cur_val}
        cur_val = val
        return prev_val
    }
}

const previous_b_winrate = previous_value_keeper(b_winrate)

function draw_winrate_bar(canvas) {
    let tics = 9
    let w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    let xfor = percent => w * percent / 100
    let vline = percent => {const x = xfor(percent); line([x, 0], [x, h], g)}
    g.strokeStyle = BLACK; g.fillStyle = WHITE; g.lineWidth = 1; fill_rect([0, 0], [w, h], g)
    g.fillStyle = BLACK; fill_rect([0, 0], [xfor(b_winrate), h], g)
    seq(tics, 1).forEach(i => {
        let r = 100 * i / (tics + 1)
        g.strokeStyle = (r < b_winrate) ? WHITE : BLACK; vline(r)
    })
    g.lineWidth = 3; g.strokeStyle = (b_winrate > 50) ? WHITE : BLACK; vline(50)
    g.strokeStyle = RED; vline(previous_b_winrate(stone_count, b_winrate))
    g.strokeStyle = BLACK; g.lineWidth = 1; rect([0, 0], [w, h], g)
}

/////////////////////////////////////////////////
// graphics

function line([x0, y0], [x1, y1], g) {
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke()
}

function rect(xy0, xy1, g) {rect_gen(xy0, xy1, g); g.stroke()}
function fill_rect(xy0, xy1, g) {rect_gen(xy0, xy1, g); g.fill()}
function rect_gen([x0, y0], [x1, y1], g) {g.beginPath(); g.rect(x0, y0, x1, y1)}

function circle(xy, r, g) {circle_gen(xy, r, g); g.stroke()}
function fill_circle(xy, r, g) {circle_gen(xy, r, g); g.fill()}
function edged_fill_circle(xy, r, g) {fill_circle(xy, r, g); circle(xy, r, g)}
function circle_gen([x, y], r, g) {g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI)}

/////////////////////////////////////////////////
// canvas

function set_all_canvas_size() {
    let main_size = Math.min(document.body.clientWidth, document.body.clientHeight) * 0.98
    set_canvas_square_size(main_canvas, main_size)
    set_canvas_size(winrate_bar_canvas, main_size, main_size / 50)
}

function set_canvas_square_size(canvas, size) {set_canvas_size(canvas, size, size)}

function set_canvas_size(canvas, width, height) {
    canvas.setAttribute('width', width); canvas.setAttribute('height', height)
}

/////////////////////////////////////////////////
// keyboard operation

document.onkeydown = e => {
    if (!accept_call()) {return}
    switch (e.key) {
    case "c": e.ctrlKey && main('copy_sgf_to_clipboard'); break;
    case "z": showing_raw_board_temporally = true; break;
    }
    switch (!attached && e.key) {
    case "ArrowLeft": case "ArrowUp":
        main('undo_ntimes', e.shiftKey ? 15 : 1); e.preventDefault(); break;
    case "ArrowRight": case "ArrowDown":
        main('redo_ntimes', e.shiftKey ? 15 : 1); e.preventDefault(); break;
    case "[": main('previous_sequence'); break;
    case "]": main('next_sequence'); break;
    case "p": main('pass'); break;
    case ",": play_best(); break;
    case "o": e.ctrlKey && main('open_sgf'); break;
    case "v": e.ctrlKey && main('paste_sgf_from_clipboard'); break;
    case "Backspace": case "Delete": main('explicit_undo'); break;
    case "Home": main('undo_to_start'); break;
    case "End": main('redo_to_end'); break;
    }
}

document.onkeyup = e => {
    switch (e.key) {
    case "z": showing_raw_board_temporally = false; break;
    }
}


// avoid too fast call
let last_call_time = 0
function accept_call() {
    const minimum_interval_millisec = 0
    // const minimum_interval_millisec = 10
    return (Date.now() - last_call_time >= minimum_interval_millisec) &&
        (last_call_time = Date.now())
}

/////////////////////////////////////////////////
// controller

// board type selector

function switch_board_type() {
    current_window().lizgoban_board_type = board_type =
        get_selection(Q("#switch_board_type"))
    main('update')
}
function update_board_type_switch() {update_ui_element("#switch_board_type", board_type)}

// buttons

function update_button(availability) {
    const f = (ids, key) =>
          ids.split(/ /).forEach(x => update_ui_element('#' + x, availability[key]))
    f('undo undo_ntimes undo_to_start explicit_undo', 'undo')
    f('redo redo_ntimes redo_to_end', 'redo')
    f('previous_sequence', 'previous_sequence')
    f('next_sequence', 'next_sequence')
    f('attach hide_when_attached', 'attach')
    f('detach', 'detach')
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

main('update')

// (ref.)
// https://teratail.com/questions/8773
// https://qiita.com/damele0n/items/f4050649de023a948178
// https://qiita.com/tkdn/items/5be7ee5cc178a62f4f67
Q('body').offsetLeft  // magic spell to get updated clientWidth value
set_all_canvas_size()
