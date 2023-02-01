'use strict'

function draw_endstate_distribution(canvas) {
    const ss = sorted_stones(); if (!ss) {hide_endstate_distribution(canvas); return}
    const {width, height} = canvas, g = canvas.getContext("2d")
    const {komi} = R
    const points = ss.length + Math.abs(komi)
    const [p2x, x2p] = translator_pair([0, points], [0, width])
    const [o2y, y2o] = translator_pair([0, 1], [height, 0])
    draw_komi(komi, p2x, g)
    draw_endstate(ss, komi, p2x, o2y, g)
    draw_endstate_mirror(ss, komi, p2x, o2y, g)
    draw_grids(g)
    draw_score(ss, points, g)
    show_endstate_distribution(canvas)
}

// fixme: ugly show/hide to hide border (see also hide_in_serious_match)
function show_endstate_distribution(canvas) {canvas.dataset.show = 'yes'}
function hide_endstate_distribution(canvas) {
    canvas.dataset.show = 'no'; clear_canvas(canvas)
}

////////////////////////////////////////////
// sort

function sorted_stones() {
    const copy_immediate_endstate = s => ({...s, endstate: s.immediate_endstate})
    const flat_stones = R.stones.flat().map(copy_immediate_endstate)
    if (!flat_stones.some(s => s.endstate)) {return null}
    const pick = pred => sort_by(flat_stones.filter(pred), s => s.endstate)
    const [alive_bs, dead_bs] = classify(pick(s => s.stone && s.black))
    const [alive_ws, dead_ws] = classify(pick(s => s.stone && !s.black))
    const ts = pick(s => !s.stone)
    return [
        dead_ws.reverse(), alive_bs, ts.reverse(), alive_ws, dead_bs.reverse()
    ].flat()
}

function alive(s) {return s.endstate * (s.black ? +1 : -1) > 0}
function dead(s) {return !alive(s)}
function classify(ss) {return [ss.filter(alive), ss.filter(dead)]}

////////////////////////////////////////////
// draw

function draw_komi(komi, p2x, g) {
    const {width, height} = g.canvas, epsilon = 1
    const [top_left, bottom_right, color] = komi < 0 ?
          [[0, 0], [p2x(- komi) + epsilon, height], '#000'] :
          [[p2x(1) - epsilon, 0], [width, height], '#fff']
    g.fillStyle = color; fill_rect(top_left, bottom_right, g)
}

function draw_endstate(ss, komi, p2x, o2y, g) {
    const offset = komi < 0 ? - komi : 0
    const draw = (s, k) =>
          rect2(k + offset, Math.abs(s.endstate), colors_for(s), p2x, o2y, g)
    ss.forEach(draw)
}

function draw_endstate_mirror(ss, komi, p2x, o2y, g) {
    draw_endstate_phantom(ss.slice().reverse(), - komi, p2x, o2y, g)
}

function draw_endstate_phantom(ss, komi, p2x, o2y, g) {
    const offset = komi < 0 ? - komi : 0
    const get_xyc = ({endstate}, k) => {
        const x = p2x(k + offset + 0.5), y = o2y(Math.abs(endstate))
        const c = endstate < 0 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'
        return [x, y, c]
    }
    const xyc_list = ss.map(get_xyc)
    const draw = ([x, y, c], k, a) => {
        const [x0, y0, _] = a[k - 1] || []; if (!truep(x)) {return}
        g.strokeStyle = c; g.lineWidth = 2
        line([x0, y0], [x, y], g)
    }
    xyc_list.forEach(draw)
}

function draw_grids(g) {
    const x_grids = 2, y_grids = 3, color = ORANGE, line_width = 1
    const {width, height} = g.canvas
    const grid_lines = (n, size, plotter) =>
          seq(n - 1, 1).forEach(k => plotter(k * size / n, g))
    g.strokeStyle = color; g.lineWidth = line_width
    grid_lines(x_grids, width, vertical_line)
    grid_lines(y_grids, height, horizontal_line)
}

function draw_score(ss, points, g) {
    const {komi, endstate_sum} = R
    const {width, height} = g.canvas
    // <average height>
    const score_diff = endstate_sum - komi
    const score_sum = sum(ss.map(s => Math.abs(s.endstate))) + Math.abs(komi)
    const average_height = (score_sum / points) * height
    const average_y = height - average_height
    // g.lineWidth = 1
    // g.strokeStyle = score_diff > 0 ? '#000' : '#fff'
    // line([0, average_y], [width, average_y], g)
    // <score lead>
    const same_area_rectangle_for_square = (a, max_height) =>
          (a > max_height) ? [a**2 / max_height, max_height] : [a, a]
    const unit_area = width * height / points
    const l = Math.sqrt(Math.abs(score_diff) * unit_area)
    const [w, h] = same_area_rectangle_for_square(l, average_height)
    const center_x = width / 2, half_w = w / 2
    // > 'fc 8d 49'.split(/ /).map(s => parseInt(s, 16))
    // [ 252, 141, 73 ]
    g.lineWidth = 2
    g.strokeStyle = score_diff > 0 ? '#000' : '#fff'
    g.fillStyle = 'rgba(252,141,73,0.5)'
    edged_fill_rect([center_x - half_w, average_y],
                    [center_x + half_w, average_y + h], g)
}

function colors_for(s) {
    const black_color = '#111', alt_black_color = '#333'
    const white_color = '#eee', alt_white_color = '#ccc'
    const stone_void_color = ORANGE, territory_void_color = '#888'
    const if_alive = (a, d) => s.stone && alive(s) ? a : d
    const void_color = s.stone ? stone_void_color : territory_void_color
    const owner_color = s.endstate >= 0 ?
          if_alive(black_color, alt_black_color) :
          if_alive(white_color, alt_white_color)
    return [void_color, owner_color]
}

function rect2(k, ownership, [color0, color1], p2x, o2y, g) {
    const x0 = p2x(k), x1 = p2x(k + 1), y = o2y(ownership), y0 = o2y(0)
    rect1([x0, 0], [x1, y], color0, g)
    rect1([x0, y], [x1, y0], color1, g)
}

function rect1([x0, y0], [x1, y1], color, g) {
    const eps = 0.5
    g.fillStyle = color
    fill_rect([x0 - eps, y0], [x1 + eps, y1], g)
}

function horizontal_line(y, g) {line([0, y], [g.canvas.width, y], g)}
function vertical_line(x, g) {line([x, 0], [x, g.canvas.height], g)}

/////////////////////////////////////////////////
// exports

module.exports = {
    draw_endstate_distribution,
    hide_endstate_distribution,
}
