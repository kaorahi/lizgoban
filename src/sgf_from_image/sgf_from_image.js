// -*- coding: utf-8 -*-

'use strict'

///////////////////////////////////////////
// global state

let xy_11 = null, xy_22 = null, xy_mn = null
let coord_signs = [0, 0]
let guessed_board = []
let cw = 0, ch = 0
let img = null, image_data = []
let prev_scale = 1
let is_tuning = false
let digitizing = false
let last_xy = [0, 0]
let fine_tune_xy = null
let perspective_corners = []
let is_mouse_down = false
let initial_image_url = null

const sentinel = null

///////////////////////////////////////////
// parameters

const default_tuning_param = {
    // all parameters are "percents"
    assume_gray_as_dark: 40,
    assume_gray_as_light: 40,
    allow_outliers_in_black: 40,
    allow_outliers_in_white: 1,
    consider_reddish_stone: 30,
    detection_width: 40,
}
const default_param = {
    ...default_tuning_param,
    sgf_size: '-1',  // -1 = as_is
    to_play: 'B',
}
let param = {...default_param}
function reset_param() {
    param = {...param, ...default_tuning_param}
    update_forms(); read_param()
}

const grid_state_name = ['black', 'white', 'empty']
const [BLACK, WHITE, EMPTY] = grid_state_name

///////////////////////////////////////////
// parameters UI

function update_forms() {
    const update = (...a) => update_radio(...a) || update_slider(...a)
    const update_radio = (key, val) =>
          each_elem_for_name(key, elem => {elem.checked = (elem.value === val)})
    const update_slider = (key, val) => {
        Q(`#${key}`).value = Q(`#${slider_id_for(key)}`).value = val
    }
    each_key_value(param, update)
}

function read_param(elem, temporary) {
    const set_radio_val = key => {
        let val = null
        each_elem_for_name(key, e => e.checked && (val = e.value))
        val && (param[key] = val)
        return val
    }
    each_key_value(param, (key, _) => {
        if (set_radio_val(key)) {return}
        const val = to_f(Q(`#${key}`).value); if (isNaN(val)) {return}
        param[key] = val
    })
    draw(0, 0)
    stage() === 3 && estimate(temporary)
    !temporary && (update_forms(), set_url_from_param())
    digitizing && (!elem || is_digitizer_elem(elem)) && digitize_image_soon()
}

// fixme: dirty!
function is_digitizer_elem(elem) {
    return (elem.id || '').match(/^(assume_gray_as|consider_reddish_stone)/)
}

function slider_id_for(id) {return `${id}_slider`}

Q_all('input.percent').forEach(input => {
    const attr = {min: '0', max: '100', step: '0.1'}
    const input_id = input.getAttribute('id')
    const percent = create_after(input, 'span'); percent.textContent = '%'
    const slider = create_after(percent, 'input')
    Object.assign(input, {type: 'number'}, attr)
    Object.assign(slider, {type: 'range', id: slider_id_for(input_id)}, attr)
    slider.value = input.value
    const chain = (from, to) =>
          from.addEventListener('input', e => {to.value = from.value})
    chain(slider, input); chain(input, slider)
})

set_param_from_url()
update_forms()

Q_all('input').forEach(elem => {
    elem.oninput = () => read_param(elem, true)
    elem.onchange = () => read_param(elem, false)
})

function toggle_tuning() {is_tuning = !is_tuning; update_tuning()}
function update_tuning() {
    update_tuning_internally()
    is_tuning ? digitize_image_soon() : cancel_digitize()
}
function update_tuning_internally() {
    show_if(is_tuning, '#tuning')
    show_if(!is_tuning, '#toggle_tuning')
    is_tuning && scroll_to_bottom()
}

update_tuning_internally()

///////////////////////////////////////////
// init

const sgf_text_area = Q('#sgf')
function hack_for_chrome() {
    // "Paste" does not appear in the right click menu if the textarea is readonly...
    const read_only = 'mousedown mouseup keydown keyup'.split(/\s+/)
    const set_read_only = (key, value) =>
          sgf_text_area.addEventListener(key, e => {e.target.readOnly = value})
    set_read_only('contextmenu', false)
    read_only.forEach(key => set_read_only(key, true))
}
hack_for_chrome()

window.onresize = () => {set_size()}
window.resizeTo(window.screen.width * 0.95, window.screen.height * 0.95)

const image_box = Q('#image_box')
const canvases = ['#image_canvas', '#digitized_canvas', '#overlay_canvas'].map(Q)
const [image_canvas, digitized_canvas, overlay_canvas] = canvases
const [image_ctx, overlay_ctx] = [image_canvas, overlay_canvas].map(c => c.getContext('2d'))

function set_size() {
    const {clientWidth, clientHeight} = Q('html')
    cw = to_i(clientWidth * 0.9), ch = to_i(clientHeight * 0.9)
    set_style_size(image_box, cw, ch)
    canvases.forEach(c => {copy_position(image_box, c); set_canvas_size(c, cw, ch)})
    draw_image()
    reset()
}
new ResizeObserver(set_size).observe(image_box)

set_size()

const listener = {mousemove, mousedown, mouseup}
each_key_value(listener, (key, val) => overlay_canvas.addEventListener(key, val))

load_image(initial_image_url || 'demo_auto.png')
hide('#loading'); show_if(true, '#main')

///////////////////////////////////////////
// electron

let electron; try {electron = require('electron')} catch {}

electron && initialize_electron()
hide(electron ? '.standalone' : '.electron')

function initialize_electron() {
    const api = {highlight_tips, debug_show_rgb_diff, restore_settings}
    const {clipboard, ipcRenderer} = electron
    each_key_value(api, (k, v) => ipcRenderer.on(k, v))
    load_image(clipboard.readText() || clipboard.readImage().toDataURL())
}

function finish_electron() {
    if (!electron) {return}
    const {send} = electron.ipcRenderer
    send('momorize_settings_for_sgf_from_image', get_settings())
    send('read_sgf', get_sgf())
    window.close()
}

function get_settings() {return {param, points: [xy_11, xy_22, xy_mn]}}
function restore_settings(dummy_ipc_event, settings) {
    if (!settings) {alert('No previous settings')}
    [xy_11, xy_22, xy_mn] = settings.points
    param = settings.param
    estimate()
    update_forms()
    set_url_from_param()
}

function open_demo(image_url) {
    electron ? electron.ipcRenderer.send('open_image_url', image_url) :
        window.open(location.pathname + '?initial_image_url=' + image_url, '_blank')
}

function highlight_tips() {
    scroll_to_bottom()
    const keyframes = {
        transform: ['translateY(-100vh) scale(10)', 'none', 'none'],
        background: ['yellow', 'yellow', 'none'],
        offset: [0, 0.05, 1],
    }
    Q('#tips').animate(keyframes, 10 * 1000)
}

///////////////////////////////////////////
// stage

// (old way) click style:
// 0 = initial
// 1 = 1-1 was clicked (xy_11 is set)
// 2 = 2-2 was clicked (xy_22 is set)
// 3 = the limit grid was clicked (xy_mn is set)

// (new way) drag style:
// 0 = initial
// "drag1" = mouse button has been pressed at 1-1 (xy_11 is set)
// "drag2" = mouse button was released at the limit grid (xy_mn is set)
// 3 = 2-2 was clicked (xy_22 is set)

function xy_all() {return [xy_11, xy_22, xy_mn, sentinel]}

function stage() {
    const s = xy_all().findIndex(a => !a)
    return (s === 3) ? s :
        (s === 1 && xy_mn) ? "drag2" :
        (s === 1 && is_mouse_down) ? "drag1" :
        s
}

function last_set_xy() {
    const s = stage(), pc = perspective_corners
    return s === 0 ? pc[pc.length - 1] :
        s === 'drag1' ? xy_11 :
        s === 'drag2' ? xy_mn :
        xy_all()[s - 1]
}

function reset() {
    xy_11 = xy_22 = xy_mn = null
    coord_signs = [0, 0]
    guessed_board = []
    set_sgf_form('')
    Q('#copy_to_clipboard').disabled = Q('#download').hidden = true
    reset_perspective_corners()
    draw(0, 0)
}

///////////////////////////////////////////
// mouse

function mousemove(e) {
    const [x, y] = event_xy(e); draw(x, y); draw_debug(x, y)
}

function mousedown(e) {
    const s = stage()  // before setting is_mouse_down
    is_mouse_down = true
    const xy = event_xy(e)
    const valid2 = (a, b) => (a[0] !== b[0] || a[1] !== b[1])
    if (e.shiftKey) {try_perspective_transformation(xy); return}
    switch (s) {
    case 0: xy_11 = xy; break
    case 1: valid2(xy_11, xy) ? (xy_22 = xy) : wink(); break
    case 2: xy_mn = xy; estimate(); break
    case 3: edit_guess(...xy); break
    case "drag1": break  // can't happen
    case "drag2": click_after_drag(xy); return  // draw later
    }
    draw(...xy)
}

function click_after_drag(xy) {
    xy_22 = xy; update_indicators(); wink()  // need setTimeout for immediate wink
    setTimeout(() => {adjust_xy_all(); estimate()})
}

function mouseup(e) {
    const s = stage()  // before resetting is_mouse_down
    is_mouse_down = false
    const xy = event_xy(e)
    if (e.shiftKey) {try_perspective_transformation_mouseup(xy); return}
    if (s === "drag1") {
        if (too_near_in_canvas(image_canvas, 0.1, xy_11, xy)) {draw(...xy); return}
        xy_mn = xy
        adjust_xy_all()
        draw(...xy)
    }
}

function event_xy(e) {
    if (!e) {return last_xy}
    const x0 = e.layerX, y0 = e.layerY
    const scale = canvas_scale(), x = x0 * scale, y = y0 * scale
    return (last_xy = [x, y].map(Math.round))
}

///////////////////////////////////////////
// keyboard control

document.onkeydown = e => {
    // e.key === 'Escape' && (reset_perspective_corners(), draw())
    let delta = arrow_key_vec(e); if (!delta) {return}
    const xy = e.shiftKey ? xy_11 : e.ctrlKey ? xy_22 : null
    e.preventDefault(); fine_tune(delta, xy)
}
document.onkeyup = e => {arrow_key_vec(e) && finish_fine_tune()}

function arrow_key_vec(e) {
    const vec = {
        ArrowLeft: [-1, 0], ArrowRight: [+1, 0], ArrowUp: [0, -1], ArrowDown: [0, +1]
    }
    return !is_input_area(e) && vec[e.key]
}
function is_input_area(e) {return ['INPUT', 'TEXTAREA'].includes(e.target.tagName)}

function fine_tune(delta, given_xy) {
    const xy = fine_tune_xy = given_xy || last_set_xy(); if (!xy) {return}
    const done = (stage() === 3), {mx, ny} = done ? grid_params() : {}
    vec_add(xy, delta)
    done && (xy !== xy_22) && force_num_grids(mx, ny)
    done ? estimate(true) : draw(...last_xy)
}
function draw_fine_tune() {
    if (!fine_tune_xy) {return}
    const g = overlay_ctx
    g.strokeStyle = 'blue'; g.lineWidth = 1; cross_line(g, ...fine_tune_xy)
}
function finish_fine_tune() {
    fine_tune_xy = null
    setTimeout(() => {stage() === 3 ? estimate() : draw(...last_xy)}, 500)
}

function force_num_grids(m, n) {
    const f = (grids, k) => {
        const [z1, z2, z] = [xy_11[k], xy_22[k], xy_mn[k]]
        const [near, far] = Math.abs(z1 - z2) < Math.abs(z2 - z) ? [z1, z] : [z, z1]
        xy_22[k] = near + (far - near) / (grids - 1)
    }
    [m, n].map(f)
}

///////////////////////////////////////////
// draw each stage

function click_style_p() {return [1, 2].includes(stage())}

function draw(x, y) {
    const drag_table = {drag1: draw_drag1, drag2: draw_drag2}
    const click_table = [draw0, draw1, draw2, draw_guess]
    const s = stage(), f = drag_table[s] || click_table[s]
    f && f(x, y, overlay_ctx)
    draw_fine_tune()
    update_indicators()
}

function update_indicators() {
    const drag_guide = {drag1: '#drag1', drag2: '#drag2'}
    const click_guide = ['#stage0', '#stage1', '#stage2', '#done']
    const s = stage()
    const highlight_guide = (sel, k) => {
        const {style} = Q(sel) || {style: {}}, current = (k === s)
        style.borderBottom = current ? 'solid 0.5vmin blue' : 'none'
        style.color = current ? 'black' : 'gray'
    }
    click_guide.forEach(highlight_guide)
    Object.keys(drag_guide).forEach(k => highlight_guide(drag_guide[k], k))
    Q('#reset').disabled = (s === 0 && perspective_corners.length === 0)
    Q('#ok').disabled = (s !== 3)
    const cs = click_style_p()
    show_if(cs, '.click_style_only'); show_if(!cs, '.drag_style_only')
}

function draw0(x, y, g) {
    clear(g)
    g.strokeStyle = 'rgba(255,0,0,1)'; g.lineWidth = 1
    cross_line(g, x, y)
    draw_perspective_corners(x, y, g)
}

function draw_perspective_corners(x, y, g) {
    g.save(); g.lineCap = 'round'
    const thick = 5, pc = perspective_corners, xys = [...pc, [x, y]]
    const draw_last_edge = () => line(g, x, y, ...pc[0])
    const draw_area = () => {
        g.fillStyle = 'rgba(0,255,255,0.3)'; g.beginPath(); g.moveTo(...pc[3])
        pc.forEach(point => g.lineTo(...point)); g.fill()
    }
    const draw_rect = () => {
        g.fillStyle = 'rgba(0,255,255,0.3)'
        fill_rect_by_diag(g, ...pc[0], x, y)
    }
    const pc_len = pc.length, is_dragging = (pc_len === 1 && is_mouse_down)
    if (is_dragging) {draw_rect(); return}
    g.strokeStyle = 'rgba(0,255,255,0.5)'; g.lineWidth = thick
    xys.forEach((xy, k) => (k > 0) && line(g, ...xys[k - 1], ...xy))
    switch (pc_len) {
    case 3: g.strokeStyle = 'rgba(0,0,255,0.5)'; draw_last_edge(); break
    case 4: draw_last_edge(); draw_area(); break
    }
    g.restore()
}

function draw1(x, y, g) {
    const style = 'rgba(0,255,0,0.2)'
    const {x1, y1, dx, dy, radius} = grid_params([x, y])
    draw_grids(x1, y1, 19, 19, dx, dy, radius, style, g)
}

function draw2(x, y, g) {
    const style = 'rgba(0,0,255,0.2)'
    const {x1, y1, mx, ny, dx, dy, radius} = grid_params([x, y])
    draw_grids(x1, y1, mx, ny, dx, dy, radius, style, g)
}

function draw_drag1(x, y, g) {draw_drag_range(x, y, g)}

function draw_drag2(x, y, g) {
    draw_drag_range(...xy_mn, g)
    g.strokeStyle = 'blue'; g.lineWidth = 1; cross_line(g, x, y)
    const [x1, y1] = xy_11, [xm, yn] = xy_mn
    const out = (z, a, b) => (z - a) * (z - b) > 0
    const nearer = (z, a, b) => Math.abs(z - a) < Math.abs(z - b) ? a : b
    const x0 = nearer(x, x1, xm), y0 = nearer(y, y1, yn)
    const outside_p = out(x, x1, xm) || out(y, y1, yn)
    if (outside_p) {
        big_message(g, '19x19', (x1 + xm) / 2, (y1 + yn) / 2, 'blue', 'white')
    } else {
        const thick = 5
        g.strokeStyle = 'blue'; g.lineWidth = thick
        line(g, x, y, x0, y); line(g, x, y, x, y0)
    }
}

function draw_drag_range(x, y, g) {
    const style = 'rgba(0,0,255,0.2)'
    const {x1, y1} = grid_params([x, y])
    clear(g); g.fillStyle = style; fill_rect_by_diag(g, x1, y1, x, y)
}

///////////////////////////////////////////
// draw result

function draw_guess(cx, cy) {
    const {radius, each_grid} = grid_params()
    const square_mark_radius = radius * 0.6
    const circle_mark_radius = square_mark_radius * 4 / Math.PI
    const g = overlay_ctx
    const drawer = (marker, mark_radius, style) => (x, y) => {
        g.fillStyle = style; marker(g, x, y, mark_radius)
    }
    const draw_base = drawer(fill_square, radius, 'rgba(128,128,128,0.3)')
    const draw_black = drawer(fill_square, square_mark_radius, 'rgba(0,255,0,0.7)')
    const draw_white = drawer(fill_circle, circle_mark_radius, 'rgba(255,0,255,0.7)')
    const draw_for_color = {black: draw_black, white: draw_white}
    const draw_at_grid = (i, j, x, y) => {
        const f = draw_for_color[guessed_board_color(i, j)]
        draw_base(x, y); f && f(x, y)
    }
    clear(g); each_grid(draw_at_grid)
    draw_cursor(cx, cy)
}

function guessed_board_color(i, j) {return guessed_board_at(i, j).stone_color}
function guessed_board_at(i, j) {return (guessed_board[i] || [])[j] || {}}

function draw_cursor(x, y) {
    const {radius, xy_for, ij_for, valid_ij} = grid_params()
    const g = overlay_ctx
    g.strokeStyle = 'rgba(255, 0, 0, 1)', g.lineWidth = radius * 0.3
    const [i, j] = ij_for(x, y), [gx, gy] = xy_for(i, j)
    valid_ij(i, j) && square(g, gx, gy, radius + g.lineWidth / 2)
}

///////////////////////////////////////////
// drawing util

function kth(k, z1, dz) {return z1 + dz * k}
function k_for(z, z1, dz) {return Math.round((z - z1) / dz)}

function draw_grids(x1, y1, mx, ny, dx, dy, radius, style, g) {
    const [xmax, ymax] = [kth(mx - 1, x1, dx), kth(ny - 1, y1, dy)]
    clear(g)
    g.strokeStyle = style; g.lineCap = 'square'
    g.lineWidth = radius * 2
    seq(mx).forEach(k => {
        const xk = kth(k, x1, dx); line(g, xk, y1, xk, ymax)
    })
    seq(ny).forEach(k => {
        const yk = kth(k, y1, dy); line(g, x1, yk, xmax, yk)
    })
}

function grid_params(xy) {
    const [x, y] = xy_mn || xy, [x2, y2] = xy_22 || xy_mn || xy, [x1, y1] = xy_11 || xy_22
    const num_grids_A = ([z1, z2, z]) => (z - z1) / (z2 - z1) + 1
    const num_grids_B = ([z1, z2, z]) =>  // use min(|z-z1|, |z-z2|) for unit length
          Math.max(...[[z1, z2, z], [z, z2, z1]].map(num_grids_A))
    const num_grids = [1, 2].includes(stage()) ? num_grids_A : num_grids_B
    const digitize = z => Math.max(2, Math.min(Math.round(z), 19))
    const [mx0, ny0] = [[x1, x2, x], [y1, y2, y]].map(num_grids)
    const [mx, ny] = (mx0 >= 2 && ny0 >= 2) ? [mx0, ny0].map(digitize) : [19, 19]
    const [dx, dy] = [(x - x1) / (mx - 1), (y - y1) / (ny - 1)]
    const radius = Math.min(...[dx, dy].map(Math.abs)) * param.detection_width / 200
    const is = seq(mx), js = seq(ny)
    const xy_for = (i, j) => [kth(i, x1, dx), kth(j, y1, dy)]
    const ij_for = (x, y) => [k_for(x, x1, dx), k_for(y, y1, dy)]
    const valid_ij = (i, j) => (0 <= i && i < mx && 0 <= j && j < ny)
    const each_grid = f => is.forEach(i => js.forEach(j => f(i, j, ...xy_for(i, j))))
    return {x1, y1, mx, ny, dx, dy, radius, is, js, xy_for, ij_for, valid_ij, each_grid}
}

///////////////////////////////////////////
// estimate (whole board)

function estimate(temporary) {
    const f = temporary ? estimate_soon : do_estimate; f(temporary)
}

const estimate_soon = skip_too_frequent_requests(do_estimate)

function do_estimate(temporary) {
    const {dx, dy, radius, is, each_grid} = grid_params()
    guessed_board = is.map(() => [])
    coord_signs = [dx, dy].map(Math.sign)
    each_grid((i, j, x, y) => (guessed_board[i][j] = guess_color(x, y, radius)))
    const dummy = -777; update_guess(dummy, dummy, temporary, temporary)
}

function update_guess(x, y, silent, temporary) {
    draw(x, y)
    update_sgf(silent, temporary)
}

function edit_guess(x, y) {
    const {ij_for, valid_ij} = grid_params(), [i, j] = ij_for(x, y)
    if (!valid_ij(i, j)) {return}
    const old_guess = guessed_board_color(i, j), a = grid_state_name
    const next = (a.indexOf(old_guess) + 1) % a.length
    guessed_board_at(i, j).stone_color = a[next]
    update_guess(x, y, true)
}

function set_sgf_form(sgf) {sgf_text_area.value = sgf; sgf_text_area.readOnly = true}

function update_sgf(silent, temporary) {
    if (electron) {return}
    const sgf = get_sgf()
    set_sgf_form(sgf)
    Q('#copy_to_clipboard').disabled = Q('#download').hidden = false
    update_sgf_link(sgf)
    !temporary && navigator.clipboard.writeText(sgf)
    !silent && wink()
}

function update_sgf_link(sgf) {
    const a = Q('#download')
    const datestr = (new Date()).toISOString()
    const filename = datestr.replace(/:|^[-+]|[.].*/g, '').replace('T', '-') + '.sgf'
    a.download = filename  // '2022-01-23-123456.sgf'
    a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(get_sgf())
}

///////////////////////////////////////////
// estimate (each grid)

function guess_color(x0, y0, radius) {
    if (radius < 1) {return null}
    let counts = [0, 0, 0]
    const {width, height} = image_canvas
    const inside = (x, y) => (0 <= x) && (x < width) && (0 <= y) && (y < height)
    for (let x = x0 - radius; x < x0 + radius; x++) {
        for (let y = y0 - radius; y < y0 + radius; y++) {
            inside(x, y) && counts[ternarize(rgba256_at(x, y))]++
        }
    }
    const sum = Math.max(1, counts.reduce((a, c) => a + c))
    const [dark, medium, light] = counts.map(c => c / sum * 100)
    const almost = (percent, allowed_outliers) => 100 - percent <= allowed_outliers
    const stone_color =
          almost(dark, param.allow_outliers_in_black) ? BLACK :
          almost(light, param.allow_outliers_in_white) ? WHITE : EMPTY
    return {stone_color, dark, medium, light}
}

function ternarize(rgba) {
    const [r, g, b, a] = rgba, bri = brightness(rgba) * 100
    return !a ? 1 :
        redness(rgba) * 100 > param.consider_reddish_stone ? 1 :
        bri <= param.assume_gray_as_dark ? 0 :
        bri >= 100 - param.assume_gray_as_light ? 2 : 1
}

function brightness([r, g, b, ]) {return (r + g + b) / (255 * 3)}
function redness([r, g, b, ]) {return (r - b) / 255}

///////////////////////////////////////////
// SGF

function get_sgf() {
    // ex. (;SZ[19]AB[bc][bd][cc][db][dc]AW[be][bg][cd][ce][dd][eb][ec][ed][gb])
    if (!guessed_board) {return ''}
    const size = get_sgf_size(), {to_play} = param
    const sgfpos_name = "abcdefghijklmnopqrs"
    const header = `(;SZ[${size}]PL[${to_play}]`, footer = ')'
    const sgfpos = (k, sign) => sgfpos_name[sign > 0 ? k : size - k - 1]
    const [si, sj] = coord_signs
    const coords = (i, j) => '[' + sgfpos(i, si) + sgfpos(j, sj) + ']'
    const grids =
          guessed_board.flatMap((row, i) => row.map(({stone_color}, j) => [stone_color, i, j]))
    const body = (color, prop) => {
        const s = grids.map(([c, i, j]) => (c === color ? coords(i, j) : '')).join('')
        return (s === '') ? '' : (prop + s)
    }
    return header + body('black', 'AB') + body('white', 'AW') + footer
}

function get_sgf_size() {
    const sgf_size = to_i(param.sgf_size); if (sgf_size > 0) {return sgf_size}
    const rows = guessed_board.length, cols = guessed_board[0].length
    return Math.max(rows, cols)
}

///////////////////////////////////////////
// image

function load_image(url) {
    img = new Image()
    //img.crossOrigin = 'anonymous'
    img.src = url
    img.onload = draw_image
    reset()
}

function load_image_file(file) {
    const r = new FileReader()
    r.onload = e => load_image(e.target.result)
    r.readAsDataURL(file)
}

function draw_image() {
    if (!img) {return}
    cancel_digitize()
    const {width, height} = img
    const mag = Math.min(cw / width, ch / height) * canvas_scale()
    const [to_w, to_h] = [width, height].map(z => to_i(z * mag))
    const centering = (to, full) => Math.round((full - to) / 2)
    clear(image_ctx)
    image_ctx.drawImage(img, 0, 0, width, height,
                        centering(to_w, image_canvas.width),
                        centering(to_h, image_canvas.height),
                        to_w, to_h)
    img.style.display = 'none'
    update_image_data()
    Q('#revert_image').disabled = true
}

function update_image_data() {
    image_data =
        image_ctx.getImageData(0, 0, image_canvas.width, image_canvas.height).data
}

function rgba256_at(x, y) {
    const k = image_data_index(x, y), a = image_data.slice(k, k + 4)
    return a.length === 4 ? a : [0, 0, 0, 0]
}

function image_data_index(x, y) {
    x = Math.round(x); y = Math.round(y)
    const {width, height} = image_canvas
    const inside = 0 <= x && x < width && 0 <= y && y < height
    return inside ? (x + y * width) * 4 : -1
}

const digitize_image_soon = skip_too_frequent_requests(digitize_image)

function digitize_image() {
    digitizing = Q('#digitize').disabled = true; Q('#undigitize').disabled = false
    const dark = param.assume_gray_as_dark / 100
    const light = 1 - param.assume_gray_as_light / 100
    const reddish = param.consider_reddish_stone / 100
    // dare to use opacity to show/hide canvas because
    // "hidden = true" or "display = 'none'" caused trouble in Chrome
    // for progress animation.
    gl_digitize(image_canvas, digitized_canvas, dark, light, reddish) ?
        (digitized_canvas.style.opacity = 1) : (cancel_digitize(), hide('#digitizer'))
}
function cancel_digitize() {
    digitizing = Q('#digitize').disabled = false; Q('#undigitize').disabled = true
    digitized_canvas.style.opacity = 0
}
cancel_digitize()

// (ref)
// https://stackoverflow.com/questions/35309300/how-to-render-images-in-webgl-from-arraybuffer
// http://www.quabr.com/64682286/twgl-js-trouble-loading-texture-using-es6-modules
// https://jameshfisher.com/2017/10/06/webgl-loading-an-image/
function gl_digitize(src_canvas, dest_canvas, dark, light, reddish) {
    // assume same size canvases
    const gl = dest_canvas.getContext('webgl'); if (!gl) {return false}
    const shaders = ['digitize_vertex_shader', 'digitize_fragment_shader']
    const programInfo = twgl.createProgramInfo(gl, shaders)
    const arrays = {position: {numComponents: 2, data: [-1,-1, 1,-1, -1,1, 1,1]}}
    const bufferInfo = twgl.createBufferInfoFromArrays(gl, arrays)
    const texture = twgl.createTexture(gl, {src: src_canvas})
    const {width, height} = src_canvas
    const uniforms = {texture, width, height, dark, light, reddish}
    gl.useProgram(programInfo.program)
    twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo)
    twgl.setUniforms(programInfo, uniforms)
    twgl.drawBufferInfo(gl, bufferInfo, gl.TRIANGLE_STRIP)
    return true
}

///////////////////////////////////////////
// drag & drop

window.ondragover = e => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
}

window.ondrop = e => {
    e.preventDefault()
    each_value(e.dataTransfer.items, item => {
        const {kind, type} = item
        switch (kind) {
        case 'string':
            type.match('^text/uri-list') && item.getAsString(load_image)
            break;
        case 'file':
            type.match('^image/') && load_image_file(item.getAsFile())
            break;
        }
    })
}

///////////////////////////////////////////
// paste

window.addEventListener("paste", e => {
    each_value(e.clipboardData.items, item => {
        const f = item.type.match('^image/') && item.getAsFile()
        f && load_image(URL.createObjectURL(f))
    })
})

///////////////////////////////////////////
// URL

function set_param_from_url() {
    const p = new URLSearchParams(location.search)
    const to_f_maybe = (val, orig) => (typeof orig === 'string') ? val : to_f(val)
    p.forEach((value, key) => {
        if (key === 'initial_image_url') {initial_image_url = value; return}
        param[key] = to_f_maybe(value, param[key])
    })
}

function set_url_from_param() {
    const p = new URLSearchParams('');
    each_key_value(param, (key, val) => p.append(key, val))
    const url = location.protocol + '//' + location.host + location.pathname + '?' + p.toString();
    history.replaceState(null, document.title, url);
}

///////////////////////////////////////////
// auto adjust

function adjust_xy_all() {adjust_xy_all_repeatedly(10)}

function adjust_xy_all_repeatedly(count) {
    if (count < 1) {return}
    const tolerance = 0.4, valid_stages = [3, "drag2"], outside = [-1, -1]
    if (!valid_stages.includes(stage())) {return}
    const [x1, y1] = xy_11, [x2, y2] = xy_22 || outside, [xm, yn] = xy_mn
    const ds = [x2 - x1, x2 - xm, y2 - y1, y2 - yn]
    const out = (k, l) => ds[k] * ds[l] > 0, outside_p = out(0, 1) || out(2, 3)
    const min_abs = (...a) => Math.min(...a.map(Math.abs))
    const unit = outside_p ? min_abs(x1 - xm, y1 - yn) / (19 - 1) : min_abs(...ds)
    const r = Math.floor(unit * tolerance)
    const board_range = [xy_11, xy_mn]
    const get_adjusted = (xy0, r, toward) => {
        if (!toward) {return find_cross_around(xy0, r, board_range)}
        const [x0, y0] = xy0, [xt, yt] = toward
        const [dx, dy] = [xt - x0, yt - y0].map(z => Math.sign(z) * r)
        const search_range = [[x0, y0], [x0 + dx, y0 + dy]]
        return find_cross_in(search_range, board_range)
    }
    const adjust = (xy0, r, toward) => vec_cp(get_adjusted(xy0, r, toward), xy0)
    const before = JSON.stringify(xy_all())
    adjust(xy_11, r, xy_mn)
    !outside_p && adjust(xy_22, r)
    adjust(xy_mn, r, xy_11)
    const after = JSON.stringify(xy_all()); if (before === after) {return}
    adjust_xy_all_repeatedly(count - 1)
}

function find_cross_in(search_range, board_range) {
    const [[x0, y0], [x1, y1]] = search_range
    const [[bx0, by0], [bx1, by1]] = board_range
    const argmax = (f, z0, z1) => {
        let champ = - Infinity, at = null
        const [zmin, zmax] = min_max(z0, z1)
        for (let z = zmin; z <= zmax; z++) {
            const score = f(z); score > champ && ([champ, at] = [score, z])
        }
        return at
    }
    const rd_v = x => rgb_diff_on_vertical_line(x, ...min_max(by0, by1))
    const rd_h = y => rgb_diff_on_horizontal_line(y, ...min_max(bx0, bx1))
    const x = argmax(rd_v, x0, x1), y = argmax(rd_h, y0, y1)
    return [x, y]
}

function find_cross_around([x0, y0], radius, board_range) {
    const search_range = [[x0 - radius, y0 - radius], [x0 + radius, y0 + radius]]
    return find_cross_in(search_range, board_range)
}

function rgb_diff_on_vertical_line(x0, ymin, ymax) {
    return sum_for(y => rgb_diff(x0, y, 1, 0), ymin, ymax)
}
function rgb_diff_on_horizontal_line(y0, xmin, xmax) {
    return sum_for(x => rgb_diff(x, y0, 0, 1), xmin, xmax)
}

function rgb_diff(x, y, dx, dy) {
    const get_rgb = ([p, q]) => rgba256_at(x + p, y + q).slice(0, 3)
    const [c0, c] = [[0, 0], [dx, dy]].map(get_rgb)
    return c0.map((_, k) => Math.abs(c[k] - c0[k])).reduce((a, z) => a + z)
}

function rgb_diff_hv(x, y) {
    return [[1, 0], [0, 1]].map(dxy => rgb_diff(x, y, ...dxy))
}

function debug_rgb_diff_color(x, y) {
    const [d_h, d_v] = rgb_diff_hv(x, y)
    const r = Math.sqrt(d_h ** 2 + d_v **2), th = Math.atan2(d_h, d_v)
    const max_r = Math.sqrt(2) * 3 * 255, max_th = Math.PI / 2
    const hue = 120 * th / max_th, saturation = 100, luminance = 50
    const alpha = Math.min(2 * r / max_r, 1)
    return `hsla(${hue},${saturation}%,${luminance}%,${alpha})`
}

function debug_show_rgb_diff(dummy_ipc_event, enhance) {
    const {width, height} = image_canvas, g = image_ctx
    big_message(g, 'converting...', width / 2, height / 2, 'blue', 'white')
    // need setTimeout for showing message immediately
    setTimeout(() => debug_show_rgb_diff_now(enhance))
}

function debug_show_rgb_diff_now(enhance) {
    const {width, height} = image_canvas, g = image_ctx
    const dst = g.createImageData(width, height)
    const max_diff = 255 * 3
    const to_color = z => Math.round(Math.min(z / max_diff * enhance, 1) * 255)
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const [red, green] = rgb_diff_hv(x, y).map(to_color)
            const rgba = [red, green, 0, 255]
            const k = image_data_index(x, y)
            rgba.forEach((v, d) => {dst.data[k + d] = v})
        }
    }
    g.putImageData(dst, 0, 0)
    update_image_data()
    reset()
    Q('#revert_image').disabled = false
}

///////////////////////////////////////////
// perspective transformation

function try_perspective_transformation(xy) {
    if (stage() !== 0) {return}
    const pc = perspective_corners
    pc.push(xy); draw(...xy)
    if (pc.length < 4) {return}
    const {width, height} = image_canvas, u = Math.min(width, height) * 0.9
    const both_ends = full => {
        const centering = (to, full) => Math.round((full - to) / 2)
        const z1 = centering(u, full), z2 = full - z1
        return [z1, z2]
    }
    const [[left, right], [top, bottom]] = [width, height].map(both_ends)
    transform_image([right, top], [left, top], [left, bottom], [right, bottom], ...pc)
}

function try_perspective_transformation_mouseup(xy) {
    const pc = perspective_corners
    const is_dragging =
          (pc.length === 1 && !too_near_in_canvas(image_canvas, 0.01, pc[0], xy))
    if (!is_dragging) {return}
    const [x0, y0] = pc[0], [x, y] = xy
    const [left, right] = min_max(x0, x), [top, bottom] = min_max(y0, y)
    perspective_corners = [[right, top], [left, top], [left, bottom]]
    try_perspective_transformation([right, bottom])
}

function reset_perspective_corners() {perspective_corners = []}

function revert_to_original_image() {draw_image(); reset()}

function transform_image(...args) {
    const g = image_ctx, {width, height} = image_canvas
    g.fillStyle = 'rgba(255,255,255,0.7)'
    g.fillRect(0, 0, width, height)
    big_message(g, 'Transforming...', width * 0.5, height * 0.5, 'blue')
    const wait_millisec = 100
    setTimeout(() => transform_image_soon(...args), wait_millisec)
}

const transform_image_soon = skip_too_frequent_requests(do_transform_image)

function do_transform_image(...args) {
    const inv_mapper = perspective_transformer(...args)
    const {width, height} = image_canvas, g = image_ctx
    const dst = g.createImageData(width, height)
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const k = image_data_index(x, y)
            const src_rgba = rgba256_at(...inv_mapper([x, y]))
            src_rgba.forEach((v, d) => {dst.data[k + d] = v})
        }
    }
    g.putImageData(dst, 0, 0)
    update_image_data()
    reset()
    Q('#revert_image').disabled = false
}

///////////////////////////////////////////
// util

function to_i(x) {return x | 0}
function to_f(x) {return x - 0}
function each_key_value(h, f){Object.keys(h).forEach(k => f(k, h[k]))}
function each_value(h, f){each_key_value(h, (_, v) => f(v))}  // for non-array
function min_max(a, b) {return [Math.min(a, b), Math.max(a, b)]}
function vec_add(a, delta) {a.forEach((_, k) => {a[k] += delta[k]})}
function vec_cp(from, to) {from.forEach((_, k) => {to[k] = from[k]})}

// seq(3) = [ 0, 1, 2 ]
function seq(n){return [...Array(n)].map((_, i) => i)}

function sum_for(f, min, max) {
    let a = 0; for (let z = min; z <= max; z++) {a += f(z)}; return a
}

function skip_too_frequent_requests(f) {
    let latest_request = null
    const do_latest = () => {f(...latest_request); latest_request = null}
    return (...args) => {
        const idle = !latest_request; latest_request = args
        idle && setTimeout(do_latest)  // executed in the next event cycle
        // https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/setTimeout
    }
}

function Q(selector) {return document.querySelector(selector)}
function Q_all(selector) {return document.querySelectorAll(selector)}
function hide(selector) {show_if(false, selector)}
function show_if(bool, selector) {
    Q_all(selector).forEach(elem => elem.style.display = bool ? '' : 'none')
}
function create_after(elem, tag) {
    const new_elem = document.createElement(tag)
    elem.parentNode.insertBefore(new_elem, elem.nextSibling)
    return new_elem
}
function each_elem_for_name(name, proc) {
    const es = Q_all(`[name=${name}]`)
    es.forEach(proc)
    return es.length > 0
}

function set_style_px(elem, key, val){elem.style[key] = `${val}px`}
function set_style_size(elem, width, height) {
    each_key_value({width, height}, (k, v) => set_style_px(elem, k, v))
}
function copy_position(from, to) {
    const rect = from.getBoundingClientRect()
    const args = [['left', 'width', 'scrollX'],
                  ['top', 'height', 'scrollY']]
    const set_pos = ([xy, wh, scroll]) => {
        const pos = rect[xy] + window[scroll]
        set_style_px(to, xy, pos)
    }
    args.forEach(set_pos)
}
function canvas_scale(){
    const scale = window.devicePixelRatio, changed = (prev_scale !== scale)
    prev_scale = scale
    changed && set_size()
    return scale
}
function set_canvas_size(canvas, width, height) {
    set_style_size(canvas, width, height)
    const [w, h] = [width, height].map(z => to_i(z * canvas_scale()))
    canvas.width = w; canvas.height = h
}

function too_near_in_canvas(canvas, ratio, [x1, y1], [x2, y2]) {
    const {width, height} = canvas
    const too_near_len = Math.min(width, height) * ratio
    const d = Math.min(...[x1 - x2, y1 - y2].map(Math.abs))
    return d < too_near_len
}

function clear(ctx) {const c = ctx.canvas; ctx.clearRect(0, 0, c.width, c.height)}
function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
}
function cross_line(ctx, x, y) {
    const {width, height} = ctx.canvas
    line(ctx, x, 0, x, height); line(ctx, 0, y, width, y)
}
function fill_rect_by_diag(ctx, x1, y1, x2, y2) {
    const min_len = (a, b) => [Math.min(a, b), Math.abs(a - b)]
    const [left, width] = min_len(x1, x2), [top, height] = min_len(y1, y2)
    ctx.fillRect(left, top, width, height)
}
function big_message(ctx, text, x, y, fill_style, stroke_style) {
    ctx.save()
    ctx.font = '20vmin Arial'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const args = [text, x, y]
    fill_style && ((ctx.fillStyle = fill_style), ctx.fillText(...args))
    stroke_style && ((ctx.strokeStyle = stroke_style), ctx.strokeText(...args))
    ctx.restore()
}

function square(ctx, x, y, r) {
    ctx.beginPath(); ctx.rect(x - r, y - r, r * 2, r * 2); ctx.stroke()
}
function fill_square(ctx, x, y, r) {ctx.fillRect(x - r, y - r, r * 2, r * 2)}
function fill_circle(ctx, x, y, r) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill()
}

function scroll_to_bottom() {
    window.scrollTo({top: Q('body').scrollHeight, behavior: 'smooth' })
}

let last_wink_animation = null
function wink() {
    // const keyframes = [{scale: 1}, {scale: 0.8}, {scale: 1}]
    const keyframes = [{opacity: 1}, {opacity: 0.3}, {opacity: 1}]
    last_wink_animation && last_wink_animation.finish()
    last_wink_animation = image_box.animate(keyframes, 200)
}

function draw_debug(x, y) {
    const c = rgba256_at(x, y), digitized = ['dark', 'medium', 'light']
    const p = ([label, f]) => `${label}=${to_i(f(c) * 100)}%`
    const rgba = `rgba(${c.slice(0, 3).join(',')},${(c[3] / 255).toFixed(2)})`
    const red_bright = [['red', redness], ['bright', brightness]].map(p).join(' ')
    Q('#debug_xy').textContent = `(${x},${y})`
    Q('#debug_color').style.background = Q('#debug_rgba').textContent = rgba
    Q('#debug_dark').textContent = `${red_bright} (${digitized[ternarize(c)]})`
    Q('#debug_guess').textContent = debug_guess(x, y)
    Q('#debug_rgb_diff').textContent = JSON.stringify(rgb_diff_hv(x, y))
    Q('#debug_rgb_diff_color').style.background = debug_rgb_diff_color(x, y)
    // Q('#debug_misc').textContent = window.devicePixelRatio
}

function debug_guess(x, y) {
    if (stage() !== 3) {return ''}
    const {ij_for, valid_ij} = grid_params(), [i, j] = ij_for(x, y)
    if (!valid_ij(i, j)) {return ''}
    const {stone_color, dark, medium, light} = guessed_board_at(i, j)
    const format = z => (typeof z === 'number') ? z.toFixed(0) : '?'
    const ratio = [dark, medium, light].map(format).join(':')
    return `D:M:L=${ratio}(${stone_color || 'empty'})`
}
