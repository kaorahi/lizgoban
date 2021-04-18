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
let last_xy = [0, 0]

const sentinel = null

///////////////////////////////////////////
// parameters

const default_param = {
    // all parameters are "percents"
    assume_gray_as_dark: 40,
    assume_gray_as_light: 40,
    allow_outliers_in_black: 40,
    allow_outliers_in_white: 1,
    detection_width: 40,
}
let param = {...default_param}
function reset_param() {param = {...default_param}; update_forms(); read_param()}

const grid_state_name = ['black', 'white', 'empty']
const [BLACK, WHITE, EMPTY] = grid_state_name

///////////////////////////////////////////
// parameters UI

function update_forms() {
    each_key_value(param, (key, val) => {
        Q(`#${key}`).value = Q(`#${slider_id_for(key)}`).value = val
    })
}

function update_sample_colors() {
    const set_color = (id, percent) => {
        const c = 255 * percent / 100
        Q(id).style.background = `rgb(${c},${c},${c})`
    }
    const sample_colors = [
        ['#dark_sample', param.assume_gray_as_dark],
        ['#light_sample', 100 - param.assume_gray_as_light],
    ]
    sample_colors.forEach(a => set_color(...a))
}

function read_param(temporary) {
    each_key_value(param, (key, _) => {
        const val = to_f(Q(`#${key}`).value); if (isNaN(val)) {return}
        param[key] = val
    })
    draw(0, 0)
    stage() === 3 && estimate(temporary)
    !temporary && (update_forms(), set_url_from_param())
    update_sample_colors()
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
update_sample_colors()

Q_all('input').forEach(elem => {
    elem.oninput = () => read_param(true)
    elem.onchange = () => read_param(false)
})

function toggle_tuning() {is_tuning = !is_tuning; update_tuning()}
function update_tuning() {
    show_if(is_tuning, '#tuning')
    show_if(!is_tuning, '#toggle_tuning')
    is_tuning && window.scrollTo({top: Q('body').scrollHeight, behavior: 'smooth' })
}

update_tuning()

///////////////////////////////////////////
// init

window.onresize = () => {set_size()}
window.resizeTo(window.screen.width * 0.95, window.screen.height * 0.95)

const image_box = Q('#image_box')
const canvases = ['#image_canvas', '#digitized_canvas', '#overlay_canvas'].map(Q)
const [image_canvas, digitized_canvas, overlay_canvas] = canvases
const [image_ctx, digitized_ctx, overlay_ctx] = canvases.map(c => c.getContext('2d'))

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

const listener = {mousemove, mousedown}
each_key_value(listener, (key, val) => overlay_canvas.addEventListener(key, val))

load_image('demo.png')
hide('#loading'); show_if(true, '#main')

///////////////////////////////////////////
// electron

let electron; try {electron = require('electron')} catch {}

electron && initialize_electron()
hide(electron ? '.standalone' : '.electron')

function initialize_electron() {
    const {clipboard} = electron
    load_image(clipboard.readText() || clipboard.readImage().toDataURL())
}

function finish_electron() {
    if (!electron) {return}
    electron.ipcRenderer.send('read_sgf', get_sgf())
    window.close()
}

///////////////////////////////////////////
// stage
// 0 = initial
// 1 = 1-1 was clicked
// 2 = 2-2 was clicked
// 3 = finished

function xy_all() {return [xy_11, xy_22, xy_mn, sentinel]}

function stage() {return xy_all().findIndex(a => !a)}

function last_set_xy() {return xy_all()[stage() - 1]}

function reset() {
    xy_11 = xy_22 = xy_mn = null
    coord_signs = [0, 0]
    guessed_board = []
    set_sgf_form('')
    Q('#copy_to_clipboard').disabled = true
    draw(0, 0)
}

///////////////////////////////////////////
// mouse

function mousemove(e) {
    const [x, y] = event_xy(e); draw(x, y); draw_debug(x, y)
}

function mousedown(e) {
    const xy = event_xy(e)
    const valid2 = (a, b) => (a[0] !== b[0] || a[1] !== b[1])
    switch (stage()) {
    case 0: xy_11 = xy; break
    case 1: valid2(xy_11, xy) ? (xy_22 = xy) : wink(); break
    case 2: xy_mn = xy; estimate(); break
    case 3: edit_guess(...xy); break
    }
    draw(...xy)
}

function event_xy(e) {
    if (!e) {return last_xy}
    const x0 = e.layerX, y0 = e.layerY
    const scale = canvas_scale(), x = x0 * scale, y = y0 * scale
    return (last_xy = [x, y])
}

///////////////////////////////////////////
// keyboard control

document.onkeydown = e => {
    let delta = arrow_key_vec(e); if (!delta) {return}
    e.preventDefault(); fine_tune(delta, true)
}
document.onkeyup = e => {stage() === 3 && arrow_key_vec(e) && estimate()}

function arrow_key_vec(e) {
    const vec = {
        ArrowLeft: [-1, 0], ArrowRight: [+1, 0], ArrowUp: [0, -1], ArrowDown: [0, +1]
    }
    return !is_input_area(e) && vec[e.key]
}
function is_input_area(e) {return ['INPUT', 'TEXTAREA'].includes(e.target.tagName)}

function fine_tune(delta, force_estimate) {
    const xy = last_set_xy(); if (!xy) {return}
    const done = (stage() === 3), {mx, ny} = done ? grid_params() : {}
    vec_add(xy, delta)
    done && force_num_grids(mx, ny)
    done && force_estimate ? estimate(true) : mousemove()
    const g = overlay_ctx
    g.strokeStyle = 'blue'; g.lineWidth = 1; cross_line(...xy, g)
}

function force_num_grids(m, n) {
    const f = (grids, k) => {
        const [z1, z] = [xy_11[k], xy_mn[k]]
        xy_22[k] = z1 + (z - z1) / (grids - 1)
    }
    [m, n].map(f)
}

///////////////////////////////////////////
// draw each stage

function draw(x, y) {
    const s = stage()
    const f = [draw0, draw1, draw2, draw_guess][s]; f && f(x, y, overlay_ctx)
    const guide = ['#stage0', '#stage1', '#stage2', '#done']
    guide.forEach((sel, k) => {
        const {style} = Q(sel) || {style: {}}, current = (k === s)
        style.borderBottom = current ? 'solid 0.5vmin blue' : 'none'
        style.color = current ? 'black' : 'gray'
    })
    Q('#reset').disabled = (s === 0)
    Q('#ok').disabled = (s !== 3)
}

function draw0(x, y, g) {
    clear(g)
    g.strokeStyle = 'rgba(255,0,0,1)'; g.lineWidth = 1
    cross_line(x, y, g)
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
    const num_grids = ([z1, z2, z]) => (z - z1) / (z2 - z1) + 1
    const digitize = z => Math.max(2, Math.min(Math.round(z), 19))
    const [mx0, ny0] = [[x1, x2, x], [y1, y2, y]].map(num_grids)
    const [mx, ny] = (mx0 >= 1 && ny0 >= 1) ? [mx0, ny0].map(digitize) : [19, 19]
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
    draw_guess(x, y)
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

function set_sgf_form(sgf) {(Q('#sgf') || {}).textContent = sgf}

function update_sgf(silent, temporary) {
    if (electron) {return}
    const sgf = get_sgf()
    set_sgf_form(sgf)
    Q('#copy_to_clipboard').disabled = false
    !temporary && navigator.clipboard.writeText(sgf)
    !silent && wink()
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
    const [r, g, b, a] = rgba; if (!a) {return 1}
    const bri = brightness(rgba) * 100
    return bri <= param.assume_gray_as_dark ? 0 :
        bri >= 100 - param.assume_gray_as_light ? 2 : 1
}

function brightness([r, g, b, _]) {return (r + g + b) / (255 * 3)}

///////////////////////////////////////////
// SGF

function get_sgf() {
    // ex. (;SZ[19]AB[bc][bd][cc][db][dc]AW[be][bg][cd][ce][dd][eb][ec][ed][gb])
    if (!guessed_board) {return ''}
    const sgfpos_name = "abcdefghijklmnopqrs"
    const header = '(;SZ[19]', footer = ')'
    const sgfpos = (k, sign) => sgfpos_name[sign > 0 ? k : 19 - k - 1]
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
    const to_size = [width, height].map(z => to_i(z * mag))
    clear(image_ctx)
    image_ctx.drawImage(img, 0, 0, width, height, 0, 0, ...to_size)
    img.style.display = 'none'
    image_data =
        image_ctx.getImageData(0, 0, image_canvas.width, image_canvas.height).data
}

function rgba256_at(x, y) {
    const k = image_data_index(x, y), a = image_data.slice(k, k + 4)
    return a.length === 4 ? a : [0, 0, 0, 0]
}

function image_data_index(x, y) {
    return (Math.round(x) + Math.round(y) * image_canvas.width) * 4
}

let digitizing = false
function digitize_image() {
    digitizing = Q('#digitize').disabled = true; Q('#undigitize').disabled = false
    const digitized_rgba = [[0, 0, 0, 255], [255, 128, 0, 255], [255, 255, 255, 255]]
    const g = digitized_ctx
    clear(g)
    // dare to use opacity to show/hide canvas because
    // "hidden = true" or "display = 'none'" caused trouble in Chrome
    // for progress animation.
    digitized_canvas.style.opacity = 1
    const {width, height} = image_canvas
    const dst = g.createImageData(width, height)
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const k = image_data_index(x, y), src_rgba = rgba256_at(x, y)
            digitized_rgba[ternarize(src_rgba)].forEach((v, d) => {dst.data[k + d] = v})
        }
    }
    g.putImageData(dst, 0, 0)
}
function cancel_digitize() {
    digitizing = Q('#digitize').disabled = false; Q('#undigitize').disabled = true
    digitized_canvas.style.opacity = 0
}
cancel_digitize()

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
    p.forEach((value, key) => {param[key] = to_f(value)})
}

function set_url_from_param() {
    const p = new URLSearchParams('');
    each_key_value(param, (key, val) => p.append(key, val))
    const url = location.protocol + '//' + location.host + location.pathname + '?' + p.toString();
    history.replaceState(null, document.title, url);
}

///////////////////////////////////////////
// util

function to_i(x) {return x | 0}
function to_f(x) {return x - 0}
function each_key_value(h, f){Object.keys(h).forEach(k => f(k, h[k]))}
function each_value(h, f){each_key_value(h, (_, v) => f(v))}  // for non-array
function vec_add(a, delta) {a.forEach((_, k) => {a[k] += delta[k]})}

// seq(3) = [ 0, 1, 2 ]
function seq(n){return [...Array(n)].map((_, i) => i)}

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

function clear(ctx) {const c = ctx.canvas; ctx.clearRect(0, 0, c.width, c.height)}
function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
}
function cross_line(x, y, g) {
    const scale = canvas_scale()
    line(g, x, 0, x, ch * scale); line(g, 0, y, cw * scale, y)
}
function square(ctx, x, y, r) {
    ctx.beginPath(); ctx.rect(x - r, y - r, r * 2, r * 2); ctx.stroke()
}
function fill_square(ctx, x, y, r) {ctx.fillRect(x - r, y - r, r * 2, r * 2)}
function fill_circle(ctx, x, y, r) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill()
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
    const rgba = `rgba(${c.slice(0, 3).join(',')},${(c[3] / 255).toFixed(2)})`
    Q('#debug_color').style.background = Q('#debug_rgba').textContent = rgba
    Q('#debug_dark').textContent = `bright=${to_i(brightness(c) * 100)}%(${digitized[ternarize(c)]})`
    Q('#debug_guess').textContent = debug_guess(x, y)
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
