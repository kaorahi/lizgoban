// -*- coding: utf-8 -*-

'use strict'

///////////////////////////////////////////
// global state

let xy_11 = null, xy_22 = null, xy_mn = null
let coord_signs = [0, 0]
let guessed_board = []
let cw = 0, ch = 0
let img = null
let prev_scale = 1
let is_tuning = false

///////////////////////////////////////////
// parameters

const default_param = {
    // all parameters are "percents"
    dark: 50,
    dark_ratio_black: 80,
    dark_ratio_white: 1,
    detection_width: 30,
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
    const set_color = (id, r, g, b) => {
        const coef = 1 / (r + g + b) * 255 * 3 * param.dark / 100
        const rgb = [r, g, b].map(z => Math.min(to_i(z * coef), 255))
        Q(id).style.background = `rgb(${rgb.join(',')})`
    }
    const sample_colors = [
        ['#dark_sample1', 1, 1, 1],
    ]
    sample_colors.forEach(a => set_color(...a))
}

function read_param(temporary) {
    each_key_value(param, (key, _) => {
        const val = to_f(Q(`#${key}`).value); if (isNaN(val)) {return}
        param[key] = val
    })
    draw(0, 0)
    stage() === -1 && estimate(temporary)
    !temporary && (update_forms(), set_url_from_param())
    update_sample_colors()
}

function slider_id_for(id) {return `${id}_slider`}

Q_all('input.percent').forEach(input => {
    const attr = {min: '0', max: '100', step: 'any'}
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
    is_tuning && window.scroll(0, Q('body').scrollHeight)
}

update_tuning()

///////////////////////////////////////////
// init

window.onresize = () => {set_size()}
window.resizeTo(window.screen.width * 0.95, window.screen.height * 0.95)

const [image_canvas, binarized_canvas, overlay_canvas] =
      ['#image_canvas', '#binarized_canvas', '#overlay_canvas'].map(Q)
const [image_ctx, binarized_ctx, overlay_ctx] =
      [image_canvas, binarized_canvas, overlay_canvas].map(c => c.getContext('2d'))

function set_size() {
    const {clientWidth, clientHeight} = Q('#measure')
    cw = to_i(clientWidth * 0.9), ch = to_i(clientHeight * 0.9)
    set_canvas_size(image_canvas, cw, ch)
    draw_image()
    reset()
}
function set_overlay_size() {
    set_overlay(binarized_canvas, image_canvas)
    set_overlay(overlay_canvas, image_canvas)
    draw(0, 0)
}
new ResizeObserver(set_overlay_size).observe(image_canvas)

set_size()

const listener = {mousemove, mousedown}
each_key_value(listener, (key, val) => overlay_canvas.addEventListener(key, val))

load_image('demo.png')

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
// -1 = finished

function stage() {return [xy_11, xy_22, xy_mn].findIndex(a => !a)}

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
    case -1: edit_guess(...xy); break
    }
    draw(...xy)
}

function event_xy(e) {
    const x0 = e.layerX, y0 = e.layerY
    const scale = canvas_scale(), x = x0 * scale, y = y0 * scale
    return [x, y]
}

///////////////////////////////////////////
// draw each stage

function draw(x, y) {
    const s = stage()
    const f = [draw_guess, draw0, draw1, draw2][s + 1]; f && f(x, y, overlay_ctx)
    const guide = ['#done', '#stage0', '#stage1', '#stage2']
    guide.forEach((sel, k) => {
        const {style} = Q(sel) || {style: {}}, current = (k === s + 1)
        style.borderBottom = current ? 'solid 0.5vmin blue' : 'none'
        style.color = current ? 'black' : 'gray'
    })
    Q('#reset').disabled = (s === 0)
    Q('#ok').disabled = (s !== -1)
}

function draw0(x, y, g) {
    const scale = canvas_scale()
    clear(g)
    g.strokeStyle = 'rgba(255,0,0,1)'; g.lineWidth = 1
    line(g, x, 0, x, ch * scale)
    line(g, 0, y, cw * scale, y)
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
        const f = draw_for_color[guessed_board[i][j]]; draw_base(x, y); f && f(x, y)
    }
    clear(g); each_grid(draw_at_grid)
    draw_cursor(cx, cy)
}

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
    const num_grids = ([z1, z2, z]) =>
          Math.min(19, Math.round((z - z1) / (z2 - z1)) + 1)
    const [mx0, ny0] = [[x1, x2, x], [y1, y2, y]].map(num_grids)
    const [mx, ny] = (mx0 >= 1 && ny0 >= 1) ? [mx0, ny0] : [19, 19]
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
    const old_guess = guessed_board[i][j], a = grid_state_name
    const next = (a.indexOf(old_guess) + 1) % a.length
    guessed_board[i][j] = a[next]
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
    let pixels = 0, dark_pixels = 0
    for (let x = x0 - radius; x < x0 + radius; x++) {
        for (let y = y0 - radius; y < y0 + radius; y++) {
            pixels++; is_dark(rgba256_at(x, y)) && dark_pixels++
        }
    }
    const dark_percent = dark_pixels / pixels * 100
    return dark_percent >= param.dark_ratio_black ? BLACK :
        dark_percent <= param.dark_ratio_white ? WHITE : EMPTY
}

function is_dark(rgba) {return brightness(rgba) <= param.dark / 100}

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
          guessed_board.flatMap((row, i) => row.map((color, j) => [color, i, j]))
    const body = (color, prop) => {
        const s = grids.map(([c, i, j]) => (c === color ? coords(i, j) : '')).join('')
        return (s === '') ? '' : (prop + s)
    }
    return header + body('black', 'AB') + body('white', 'AW') + footer
}

///////////////////////////////////////////
// canvas util
// (copied from https://github.com/kaorahi/lizgoban)

function canvas_scale(){
    const scale = window.devicePixelRatio, changed = (prev_scale !== scale)
    prev_scale = scale
    changed && set_size()
    return scale
}

function set_canvas_size(canvas, width, height) {
    const [w0, h0] = [width, height].map(to_i)
    const [w, h] = [w0, h0].map(z => to_i(z * canvas_scale()))
    if (w === canvas.width && h === canvas.height) {return false}
    canvas.style.width = `${w0}px`; canvas.style.height = `${h0}px`
    canvas.width = w; canvas.height = h
    return true
}

function set_overlay(canvas, orig) {
    // // https://stackoverflow.com/questions/19669786/check-if-element-is-visible-in-dom
    // const hidden = (orig.offsetParent == null)
    // canvas.style.display = hidden ? 'none' : ''; if (hidden) {return}
    copy_canvas_size(canvas, orig)
    set_relative_canvas_position(canvas, orig)
}

function copy_canvas_size(canvas, orig) {
    set_canvas_size(canvas, ...get_canvas_size(orig))
}

function get_canvas_size(canvas) {
    const scale = canvas_scale()
    return [canvas.width / scale, canvas.height / scale]
}

function set_relative_canvas_position(canvas, orig, shift_x, shift_y) {
    const rect = orig.getBoundingClientRect()
    // "canvas.style.position === 'absolute'" does not work
    const absolute_p = true
    const set_without_margin = ([xy, wh, scroll, shift]) => {
        const margin = (rect[wh] - orig[wh] / canvas_scale()) / 2
        const scroll_maybe = (absolute_p ? window[scroll] : 0)
        const pos = rect[xy] + scroll_maybe + (shift ? shift(rect[wh]) : margin)
        canvas.style[xy] = `${pos}px`
    }
    const args = [['left', 'width', 'scrollX', shift_x],
                  ['top', 'height', 'scrollY', shift_y]]
    args.forEach(set_without_margin)
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
    cancel_binarize()
    const {width, height} = img
    const mag = Math.min(cw / width, ch / height) * canvas_scale()
    const to_size = [width, height].map(z => to_i(z * mag))
    clear(image_ctx)
    image_ctx.drawImage(img, 0, 0, width, height, 0, 0, ...to_size)
    img.style.display = 'none'
}

function rgba256_at(x, y) {
    return image_ctx.getImageData(x, y, 1, 1).data
}

let binarizing = false
function binarize_image() {
    // setTimeout for showing progress
    if (binarizing) {return}
    binarizing = Q('#binarize').disabled = true; Q('#unbinarize').disabled = false
    const g = binarized_ctx
    clear(g)
    reveal_elem(binarized_canvas)
    let x = 0
    const f = () => {
        for (let y = 0; y < ch; y++) {
            if (!binarizing) {return}
            g.fillStyle = is_dark(rgba256_at(x, y)) ? 'black' : 'white'
            fill_square(g, x, y, 1)
        }
        ++x < cw && setTimeout(f, 0)
    }
    f()
}
function cancel_binarize() {
    binarizing = Q('#binarize').disabled = false; Q('#unbinarize').disabled = true
    hide('#binarized_canvas')
}
cancel_binarize()

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

function Q(selector) {return document.querySelector(selector)}
function Q_all(selector) {return document.querySelectorAll(selector)}
function hide(selector) {show_if(false, selector)}
function show_if(bool, selector) {
    Q_all(selector).forEach(elem => show_elem_if(bool, elem))
}
function show_elem_if(bool, elem) {elem.style.display = bool ? '' : 'none'}
function reveal_elem(elem) {show_elem_if(true, elem)}
function create_after(elem, tag) {
    const new_elem = document.createElement(tag)
    elem.parentNode.insertBefore(new_elem, elem.nextSibling)
    return new_elem
}

function to_i(x) {return x | 0}
function to_f(x) {return x - 0}
function each_key_value(h, f){Object.keys(h).forEach(k => f(k, h[k]))}
function each_value(h, f){each_key_value(h, (_, v) => f(v))}  // for non-array

// seq(3) = [ 0, 1, 2 ]
function seq(n){return [...Array(n)].map((_, i) => i)}

function clear(ctx) {const c = ctx.canvas; ctx.clearRect(0, 0, c.width, c.height)}
function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
}
function square(ctx, x, y, r) {
    ctx.beginPath(); ctx.rect(x - r, y - r, r * 2, r * 2); ctx.stroke()
}
function fill_square(ctx, x, y, r) {
    ctx.beginPath(); ctx.rect(x - r, y - r, r * 2, r * 2); ctx.fill()
}
function fill_circle(ctx, x, y, r) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill()
}

let last_wink_animation = null
function wink() {
    // const keyframes = [{scale: 1}, {scale: 0.8}, {scale: 1}]
    const keyframes = [{opacity: 1}, {opacity: 0.3}, {opacity: 1}]
    last_wink_animation && last_wink_animation.finish()
    last_wink_animation = Q('#image_box').animate(keyframes, 200)
}

function draw_debug(x, y) {
    const c = rgba256_at(x, y)
    const rgba = `rgba(${c.slice(0, 3).join(',')},${(c[3] / 255).toFixed(2)})`
    Q('#debug_color').style.background = Q('#debug_rgba').textContent = rgba
    Q('#debug_dark').textContent = `bright=${to_i(brightness(c) * 100)}%(${is_dark(c) ? 'dark' : 'light'})`
    // Q('#debug_misc').textContent = window.devicePixelRatio
}
