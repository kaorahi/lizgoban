// -*- coding: utf-8 -*-

'use strict'

///////////////////////////////////////////
// global state

let xy_11 = null
let xy_22 = null
let xy_mn = null
let coord_signs = [0, 0]
let color_stones = {black: [], white: []}
let cw = 0, ch = 0
let img = null
let prev_scale = 1

///////////////////////////////////////////
// init

window.onresize = () => {set_size(); draw_image()}
window.resizeTo(window.screen.width, window.screen.height)

const image_canvas = Q('#image_canvas'), overlay_canvas = Q('#overlay')
const [image_ctx, overlay_ctx] =
      [image_canvas, overlay_canvas].map(c => c.getContext('2d'))

function set_size() {
    const {clientWidth, clientHeight} = Q('#measure')
    cw = to_i(clientWidth * 0.9), ch = to_i(clientHeight * 0.9)
    set_canvas_size(image_canvas, cw, ch)
    set_overlay(overlay_canvas, image_canvas)
}

set_size()

const listener = {mousemove, mousedown}
Object.keys(listener).forEach(key =>
    overlay_canvas.addEventListener(key, listener[key]))

function load_demo() {load_image('demo.png')}
load_demo()

///////////////////////////////////////////
// electron

let electron; try {electron = require('electron')} catch {}

electron && load_image(electron.clipboard.readImage().toDataURL())
hide(electron ? '.standalone' : '.electron')

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
    Object.values(color_stones).forEach(a => a.splice(0))
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
    console.log([xy_11, xy])
    switch (stage()) {
    case 0: xy_11 = xy; break
    case 1: valid2(xy_11, xy) ? (xy_22 = xy) : wink(); break
    case 2: xy_mn = xy; estimate(); break
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
    const f = [draw0, draw1, draw2][s]; f && f(x, y, overlay_ctx)
    const guide = ['#done', '#stage0', '#stage1', '#stage2']
    guide.forEach((sel, k) => {
        const {style} = Q(sel) || {style: {}}, current = (k === s + 1)
        style.borderBottom = current ? 'solid 0.5vmin blue' : 'none'
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
    const [x1, y1] = xy_11, [dx, dy] = [x - x1, y - y1]
    draw_grids(x1, y1, 19, 19, dx, dy, style, g)
}

function draw2(x, y, g) {
    const style = 'rgba(0,0,255,0.2)'
    const {x1, y1, mx, ny, dx, dy} = grid_params([x, y])
    draw_grids(x1, y1, mx, ny, dx, dy, style, g)
}

function kth(k, z1, dz) {return z1 + dz * k}

function draw_grids(x1, y1, mx, ny, dx, dy, style, g) {
    const [xmax, ymax] = [kth(mx - 1, x1, dx), kth(ny - 1, y1, dy)]
    const radius = Math.min(...[dx, dy].map(Math.abs)) * 0.25
    clear(g)
    g.strokeStyle = style; g.lineCap = 'square'
    g.lineWidth = radius * 2
    for (let k = 0; k < mx; k++) {
        const xk = kth(k, x1, dx); line(g, xk, y1, xk, ymax)
    }
    for (let k = 0; k < ny; k++) {
        const yk = kth(k, y1, dy); line(g, x1, yk, xmax, yk)
    }
}

function grid_params(xy) {
    const [x, y] = xy_mn || xy, [x2, y2] = xy_22 || xy_mn, [x1, y1] = xy_11 || xy_22
    const num_grids = ([z1, z2, z]) =>
          Math.min(19, Math.round((z - z1) / (z2 - z1)) + 1)
    const [mx0, ny0] = [[x1, x2, x], [y1, y2, y]].map(num_grids)
    const [mx, ny] = (mx0 >= 1 && ny0 >= 1) ? [mx0, ny0] : [19, 19]
    const [dx, dy] = [(x - x1) / (mx - 1), (y - y1) / (ny - 1)]
    const radius = Math.min(...[dx, dy].map(Math.abs)) * 0.25
    return {x1, y1, mx, ny, dx, dy, radius}
}

///////////////////////////////////////////
// estimate (whole board)

function estimate() {
    const g = overlay_ctx
    const {x1, y1, mx, ny, dx, dy, radius} = grid_params()
    coord_signs = [dx, dy].map(Math.sign)
    const xy_for = ([i, j]) => [kth(i, x1, dx), kth(j, y1, dy)]
    const draw_mark = (ij, marker, mark_radius) =>
          marker(g, ...xy_for(ij), mark_radius)
    // store guess (+ indicate checked areas)
    const push_stone = (color, ij) => {
        const a = color_stones[color]; a && a.push(ij)
    }
    clear(g)
    g.fillStyle = 'rgba(128,128,128,0.3)'
    for (let i = 0; i < mx; i++) {
        for (let j = 0; j < ny; j++) {
            const ij = [i, j]
            push_stone(guess_color(...xy_for(ij), radius), ij)
            draw_mark(ij, fill_square, radius)
        }
    }
    // show guess
    const square_mark_radius = radius * 0.6
    const circle_mark_radius = square_mark_radius * 4 / Math.PI
    const draw_guess = (color, marker, mark_radius) =>
          color_stones[color].forEach(ij => draw_mark(ij, marker, mark_radius))
    g.fillStyle = 'rgba(0,255,0,0.7)'
    draw_guess('black', fill_square, square_mark_radius)
    g.fillStyle = 'rgba(255,0,255,0.7)'
    draw_guess('white', fill_circle, circle_mark_radius)
    // generate SGF
    !electron && update_sgf()
}

function update_sgf() {
    const sgf = (Q('#sgf') || {}).textContent = get_sgf()
    navigator.clipboard.writeText(sgf)
    wink()
}

///////////////////////////////////////////
// estimate (each grid)

function guess_color(x0, y0, radius) {
    if (radius < 1) {return null}
    const guess = [[0.9, 'black'], [1e-3, 'misc'], [0, 'white']]
    let pixels = 0, dark_pixels = 0
    for (let x = x0 - radius; x < x0 + radius; x++) {
        for (let y = y0 - radius; y < y0 + radius; y++) {
            pixels++; is_dark(rgba256_at(x, y)) && dark_pixels++
        }
    }
    const dark_ratio = dark_pixels / pixels
    return (guess.find(([threshold, _]) => dark_ratio >= threshold) || [])[1]
}

function is_dark([r, g, b, _]) {
    const dark_rgb_sum = 300
    return r + g + b <= dark_rgb_sum
}

///////////////////////////////////////////
// SGF

function get_sgf() {
    // ex. (;SZ[19]AB[bc][bd][cc][db][dc]AW[be][bg][cd][ce][dd][eb][ec][ed][gb])
    const sgfpos_name = "abcdefghijklmnopqrs"
    const header = '(;SZ[19]', footer = ')'
    const body = (color, prop) => {
        const a = color_stones[color]; if (a.length === 0) {return ''}
        const sgfpos = (k, sign) => sgfpos_name[sign > 0 ? k : 19 - k - 1]
        const [si, sj] = coord_signs
        const coords = ([i, j]) => '[' + sgfpos(i, si) + sgfpos(j, sj) + ']'
        return (a.length === 0) ? '' : (prop + a.map(coords).join(''))
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
    const {width, height} = img
    const mag = Math.min(cw / width, ch / height) * canvas_scale()
    const to_size = [width, height].map(z => to_i(z * mag))
    clear(image_ctx)
    image_ctx.drawImage(img, 0, 0, width, height, 0, 0, ...to_size)
    img.style.display = 'none'
}

function rgba256_at(x, y) {return image_ctx.getImageData(x, y, 1, 1).data}

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
// util

function Q(x) {return document.querySelector(x)}
function Q_all(x) {return document.querySelectorAll(x)}
function hide(x) {Q_all(x).forEach(elem => elem.style.display = 'none')}

function to_i(x) {return x | 0}
function each_key_value(h, f){Object.keys(h).forEach(k => f(k, h[k]))}
function each_value(h, f){each_key_value(h, (_, v) => f(v))}  // for non-array

function clear(ctx) {const c = ctx.canvas; ctx.clearRect(0, 0, c.width, c.height)}
function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
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
    Q('#debug_dark').textContent = is_dark(c) ? 'dark' : 'light'
    Q('#debug_misc').textContent = window.devicePixelRatio
}
