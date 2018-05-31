// -*- coding: utf-8 -*-

/////////////////////////////////////////////////
// setup

// util
function Q(x) {return document.querySelector(x)}
const ipc = require('electron').ipcRenderer
const {to_i, to_f, xor, clone, flatten, each_key_value, seq, do_ntimes}
      = require('./util.js')
const {board_size, idx2coord_translator_pair, move2idx, idx2move, sgfpos2move, move2sgfpos}
      = require('./coord.js')

// canvas
const main_canvas = Q('#goban'), sub_canvas = Q('#sub_goban')
const winrate_bar_canvas = Q('#winrate_bar')
main_canvas.lizgoban_operable = true

// color constant
const BLACK = "#000", WHITE = "#fff", RED = "#f00"

// board & game state
let stones = [], bturn = true, suggest = [], playouts = 1
let b_winrate = 50, min_winrate = 50, max_winrate = 50

// handler
window.onload = () => {
    set_all_canvas_size(); draw_goban(main_canvas, stones); draw_goban(sub_canvas, stones)
}
window.onresize = set_all_canvas_size

/////////////////////////////////////////////////
// util

function setq(x, val) {Q(x).textContent = val}
function setdebug(x) {setq('#debug', JSON.stringify(x))}

/////////////////////////////////////////////////
// play

function play() {let d = Q('#move'); play_move(d.value); d.value = ''}
function play_best() {suggest.length > 0 && play_move(suggest[0].move)}
function play_move(move) {main('play', move)}
function main(channel, x) {ipc.send(channel, x)}

/////////////////////////////////////////////////
// from main

ipc.on('state', (e, h) => {
    stones = h.stones
    bturn = h.bturn
    setq('#turn', h.bturn ? '⬤' : '◯')
    setq('#stone_count', '' + h.stone_count)
    update_goban()
    update_button(h.availability)
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

/////////////////////////////////////////////////
// draw goban etc.

function update_goban() {
    draw_main_goban(main_canvas)
    draw_goban_with_variation(sub_canvas, (suggest[0] && suggest[0].variation) || [])
    draw_winrate_bar(winrate_bar_canvas)
}

function draw_main_goban(canvas) {
    let h = suggest.find(h => h.move === canvas.lizgoban_mouse_move)
    h ? draw_goban_with_variation(canvas, h.variation) : draw_goban_with_suggest(canvas)
}

function draw_goban_with_suggest(canvas) {
    let displayed_stones = clone(stones)
    suggest.forEach(h => set_stone_at(h.move, displayed_stones, {suggest: true, data: h}))
    draw_goban(canvas, displayed_stones)
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
    let [i, j] = move2idx(move); (i !== undefined) && (stone_array[i][j] = stone)
}

function draw_goban(canvas, stones) {
    let margin = canvas.width * 0.05
    let g = canvas.getContext("2d")
    let [idx2coord, coord2idx] = idx2coord_translator_pair(canvas, margin, margin)
    let unit = idx2coord(0, 1)[0] - idx2coord(0, 0)[0]
    g.clearRect(0, 0, canvas.width, canvas.height)
    draw_grid(unit, idx2coord, g)
    draw_on_board(stones, unit, idx2coord, g)
    if (canvas.lizgoban_operable) {
        canvas.onmousedown = e => play_here(e, coord2idx)
        canvas.onmousemove = e => hover_here(e, coord2idx, canvas)
    }
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

function draw_on_board(stones, unit, idx2coord, g) {
    const stone_radius = unit * 0.5
    stones.forEach((row, i) => row.forEach((h, j) => {
        let xy = idx2coord(i, j)
        h.stone ? draw_stone(h, xy, stone_radius, g) :
            h.suggest ? draw_suggest(h, xy, stone_radius, g) : null
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
    edged_fill_circle(xy, radius, g)
    h.movenum && draw_movenum(h, xy, radius, g)
    h.last && draw_lastmove(h, xy, radius, g)
}

function draw_movenum(h, xy, radius, g) {
    g.fillStyle = h.variation_last ? RED : (!h.black ? BLACK : WHITE)
    let [x, y] = xy, max_width = radius * 1.5, fontsize = to_i(radius * 1.8)
    g.font = '' + fontsize + 'px sans-serif'; g.textAlign = 'center'
    g.fillText('' + to_i(h.movenum), x, y + fontsize * 0.35, max_width)
}

function draw_lastmove(h, xy, radius, g) {
    g.strokeStyle = h.black ? WHITE : BLACK; circle(xy, radius * 0.5, g)
}

// suggest_as_stone = {suggest: true, data: suggestion_data}
// See "suggestion reader" section in main.js for suggestion_data.

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
    if (('' + x). length <= digits) {return '' + x}
    let a = Math.floor(x / 10**digits), b = x - a * 10**digits
    let c = '' + a, d = '.' + ('' + b)[0]
    return c + (c.length < digits - 1 ? d : '') + unit
}

/////////////////////////////////////////////////
// winrate bar

function draw_winrate_bar(canvas) {
    let tics = 9
    let w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    g.strokeStyle = BLACK; g.fillStyle = WHITE; g.lineWidth = 1; fill_rect([0, 0], [w, h], g)
    let b = w * b_winrate / 100
    g.fillStyle = BLACK; fill_rect([0, 0], [b, h], g)
    seq(tics, 1).forEach(i => {
        let r = w * i / (tics + 1)
        g.strokeStyle = (r < b) ? WHITE : BLACK; line([r, 0], [r, h], g)
    })
    g.lineWidth = 3; g.strokeStyle = (b_winrate > 50) ? WHITE : BLACK
    line([w / 2, 0], [w / 2, h], g)
    g.strokeStyle = BLACK; rect([0, 0], [w, h], g)
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
    let main_size = window.innerHeight * 0.95
    let sub_size = Math.min(window.innerWidth - main_size, window.innerHeight) * 0.95
    set_canvas_square_size(main_canvas, main_size)
    set_canvas_square_size(sub_canvas, sub_size)
    set_canvas_size(winrate_bar_canvas, sub_size, sub_size / 20)
}

function set_canvas_square_size(canvas, size) {set_canvas_size(canvas, size, size)}

function set_canvas_size(canvas, width, height) {
    canvas.setAttribute('width', width); canvas.setAttribute('height', height)
}

/////////////////////////////////////////////////
// button

function update_button(availability) {
    const f = (ids, key) => ids.split(/ /).forEach(x => (Q('#' + x).disabled = !availability[key]))
    f('undo undo_ntimes undo_to_start explicit_undo', 'undo')
    f('redo redo_ntimes redo_to_end', 'redo')
    f('previous_sequence', 'previous_sequence')
    f('next_sequence', 'next_sequence')
}
