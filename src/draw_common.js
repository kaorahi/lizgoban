////////////////////////////
// color

const BLACK = "#000", WHITE = "#fff"
const GRAY = "#ccc", DARK_GRAY = "#444"
const RED = "#f00", GREEN = "#0c0", BLUE = "#88f", YELLOW = "#ff0"
const ORANGE = "#fc8d49"
const DARK_YELLOW = "#c9a700", TRANSPARENT = "rgba(0,0,0,0)"
const MAYBE_BLACK = "rgba(0,0,0,0.5)", MAYBE_WHITE = "rgba(255,255,255,0.5)"
const VAGUE_BLACK = 'rgba(0,0,0,0.3)', VAGUE_WHITE = 'rgba(255,255,255,0.3)'
const PALE_BLUE = "rgba(128,128,255,0.5)"
const PALE_BLACK = "rgba(0,0,0,0.1)", PALE_WHITE = "rgba(255,255,255,0.3)"
const PALER_BLACK = "rgba(0,0,0,0.07)", PALER_WHITE = "rgba(255,255,255,0.21)"
const PALE_RED = "rgba(255,0,0,0.1)", PALE_GREEN = "rgba(0,255,0,0.1)"
const WINRATE_TRAIL_COLOR = 'rgba(160,160,160,0.8)'
const WINRATE_BAR_ORDER_COLOR = '#d00', WINRATE_BAR_FIRST_ORDER_COLOR = '#0a0'
const EXPECTED_COLOR = 'rgba(0,0,255,0.3)', UNEXPECTED_COLOR = 'rgba(255,0,0,0.8)'
// p: pausing, t: trial, r: ref
const GOBAN_BG_COLOR = {
    "": "#f9ca91", p: "#a38360", t: "#a38360", pt: "#a09588", r: "#a09588",
}

////////////////////////////
// graphics

function clear_canvas(canvas, bg_color, g) {
    canvas.style.background = bg_color || TRANSPARENT;
    (g || canvas.getContext("2d")).clearRect(0, 0, canvas.width, canvas.height)
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
function square_around_gen([x, y], radius, g) {
    rect_gen([x - radius, y - radius], [x + radius, y + radius], g)
}
function close_line(...args) {line_gen(...args); last(args).closePath()}
function diamond_around_gen([x, y], radius, g) {
    const r = radius; close_line([x - r, y], [x, y - r], [x + r, y], [x, y + r], g)
}
function signed_triangle_around_gen(sign, [x, y], radius, g) {
    const half_width = radius * Math.sqrt(3) / 2
    const y1 = y - radius * sign, y2 = y + radius / 2 * sign
    close_line([x, y1], [x - half_width, y2], [x + half_width, y2], g)
}
function triangle_around_gen(xy, radius, g) {
    signed_triangle_around_gen(1, xy, radius, g)
}
function rev_triangle_around_gen(xy, radius, g) {
    signed_triangle_around_gen(-1, xy, radius, g)
}

const [line, fill_line, edged_fill_line] = drawers_trio(line_gen)
const [rect, fill_rect, edged_fill_rect] = drawers_trio(rect_gen)
const [circle, fill_circle, edged_fill_circle] = drawers_trio(circle_gen)
const [fan, fill_fan, edged_fill_fan] = drawers_trio(fan_gen)
const [square_around, fill_square_around, edged_fill_square_around] =
      drawers_trio(square_around_gen)
const [diamond_around, fill_diamond_around, edged_fill_diamond_around] =
      drawers_trio(diamond_around_gen)
const [triangle_around, fill_triangle_around, edged_fill_triangle_around] =
      drawers_trio(triangle_around_gen)
const [rev_triangle_around, fill_rev_triangle_around, edged_fill_rev_triangle_around] =
      drawers_trio(rev_triangle_around_gen)

function x_shape_around([x, y], radius, g) {
    line([x - radius, y - radius], [x + radius, y + radius], g)
    line([x - radius, y + radius], [x + radius, y - radius], g)
}

function draw_square_image(img, [x, y], radius, g) {
    const shorter = Math.min(img.width, img.height), mag = radius / shorter
    const xrad = mag * img.width, yrad = mag * img.height
    g.drawImage(img, x - xrad, y - yrad, xrad * 2, yrad * 2)
}

// ref.
// https://github.com/kaorahi/lizgoban/issues/30
// https://stackoverflow.com/questions/53958949/createjs-canvas-text-position-changed-after-chrome-version-upgrade-from-70-to-71
// https://bugs.chromium.org/p/chromium/issues/detail?id=607053
const fix_baseline_p = process.versions.electron.match(/^[0-4]\./)
function fill_text(g, fontsize, text, x, y, max_width) {
    fill_text_with_modifier(g, null, fontsize, text, x, y, max_width)
}
function fill_text_with_modifier(g, font_modifier, fontsize, text, x, y, max_width) {
    const sink = fix_baseline_p ? 0 : 0.07
    set_font((font_modifier || '') + fontsize, g)
    g.fillText(text, x, y + fontsize * sink, max_width)
}
function set_font(fontsize, g) {g.font = '' + fontsize + 'px Arial'}

function side_gradation(x0, x1, color0, color1, g) {
    return gradation_gen(g.createLinearGradient(x0, 0, x1, 0), color0, color1, g)
}

function radial_gradation(x, y, radius0, radius1, color0, color1, g) {
    return skew_radial_gradation(x, y, radius0, x, y, radius1, color0, color1, g)
}

function skew_radial_gradation(x0, y0, radius0, x1, y1, radius1, color0, color1, g) {
    return gradation_gen(g.createRadialGradient(x0, y0, radius0, x1, y1, radius1),
                         color0, color1, g)
}

function gradation_gen(grad, color0, color1, g) {
    grad.addColorStop(0, color0); grad.addColorStop(1, color1)
    return grad
}

function hsla(h, s, l, alpha) {
    return 'hsla(' + h + ',' + s + '%,' + l + '%,' + (alpha === undefined ? 1 : alpha) + ')'
}

////////////////////////////
// math

function flip_maybe(x, bturn) {
    return (bturn === undefined ? R.bturn : bturn) ? x : 100 - x
}

function tics_until(max) {
    const v = Math.pow(10, Math.floor(log10(max)))
    const unit_v = (max > v * 5) ? v * 2 : (max > v * 2) ? v : v / 2
    return seq(to_i(max / unit_v + 2)).map(k => unit_v * k)  // +1 for margin
}

function log10(z) {return Math.log(z) / Math.log(10)}

function f2s(z, digits) {return truep(z) ? z.toFixed(truep(digits) ? digits : 1) : ''}

////////////////////////////
// exports

module.exports = {
    // color
    BLACK, WHITE,
    GRAY, DARK_GRAY,
    RED, GREEN, BLUE, YELLOW,
    ORANGE,
    DARK_YELLOW, TRANSPARENT,
    MAYBE_BLACK, MAYBE_WHITE,
    VAGUE_BLACK, VAGUE_WHITE,
    PALE_BLUE,
    PALE_BLACK, PALE_WHITE,
    PALER_BLACK, PALER_WHITE,
    PALE_RED, PALE_GREEN,
    WINRATE_TRAIL_COLOR,
    WINRATE_BAR_ORDER_COLOR, WINRATE_BAR_FIRST_ORDER_COLOR,
    EXPECTED_COLOR, UNEXPECTED_COLOR,
    GOBAN_BG_COLOR,
    // graphics
    clear_canvas,
    line, fill_line, edged_fill_line,
    rect, fill_rect, edged_fill_rect,
    circle, fill_circle, edged_fill_circle,
    fan, fill_fan, edged_fill_fan,
    square_around, fill_square_around, edged_fill_square_around,
    diamond_around, fill_diamond_around, edged_fill_diamond_around,
    triangle_around, fill_triangle_around, edged_fill_triangle_around,
    rev_triangle_around, fill_rev_triangle_around, edged_fill_rev_triangle_around,
    x_shape_around, draw_square_image,
    fill_text, fill_text_with_modifier, set_font,
    side_gradation, radial_gradation, skew_radial_gradation, hsla,
    // math
    flip_maybe, tics_until, log10, f2s,
}
