'use strict'

function draw_endstate_distribution(canvas) {
    const {ssg} = sorted_stone_groups()
    if (!ssg) {hide_endstate_distribution(canvas); return}
    const {width, height} = canvas, g = canvas.getContext("2d")
    const {komi} = R
    const ss = ssg.flat(), points = ss.length + Math.abs(komi)
    const [p2x, x2p] = translator_pair([0, points], [0, width])
    const [o2y, y2o] = translator_pair([0, 1], [height, 0])
    clear_canvas(canvas, '#888')
    draw_endstate(ssg, komi, p2x, o2y, g)
    draw_endstate_mirror(ssg, komi, p2x, o2y, g)
    draw_grids(o2y, g)
    draw_score(ss, points, o2y, g)
    show_endstate_distribution(canvas)
}

// fixme: ugly show/hide to hide border (see also hide_in_serious_match)
function show_endstate_distribution(canvas) {canvas.dataset.show = 'yes'}
function hide_endstate_distribution(canvas) {
    canvas.dataset.show = 'no'; clear_canvas(canvas)
}

////////////////////////////////////////////
// sort

function sorted_stone_groups() {
    if (!truep((aa_ref(R.stones, 0, 0) || {}).immediate_endstate)) {return {}}
    const copy_immediate_endstate = s => ({...s, endstate: s.immediate_endstate})
    const flat_stones = R.stones.flat().map(copy_immediate_endstate)
    const pick = pred => sort_by(flat_stones.filter(pred), s => s.endstate)
    const [alive_bs, dead_bs] = classify(pick(s => s.stone && s.black))
    const [alive_ws, dead_ws] = classify(pick(s => s.stone && !s.black))
    const ts = pick(s => !s.stone)
    const left = [dead_ws.reverse(), alive_bs].flat()
    const middle = ts.reverse()
    const right = [alive_ws, dead_bs.reverse()].flat()
    const ssg = [left, middle, right]
    return {ssg}
}

function alive(s) {return s.endstate * (s.black ? +1 : -1) > 0}
function dead(s) {return !alive(s)}
function classify(ss) {return [ss.filter(alive), ss.filter(dead)]}

////////////////////////////////////////////
// black/white regions

function draw_endstate(ssg, komi, p2x, o2y, g) {
    const [left, middle, right] = ssg, ss = ssg.flat()
    const stone_ambiguity = sum(ss.map(s => s.stone ? 1 - Math.abs(s.endstate) : 0))
    const hot = clip(Math.floor(stone_ambiguity / 20), 0, 2)
    const {b_komi, w_komi, bk_offset, wk_offset, l_offset, m_offset, r_offset}
          = param_for(left, middle, right, komi)
    const draw_part = (ss, offset) => {
        const draw = (s, k) =>
              rect2(k + offset, Math.abs(s.endstate), colors_for(s, hot), p2x, o2y, g)
        ss.forEach(draw)
    }
    draw_komi(b_komi, bk_offset, '#000', p2x, o2y, g)
    draw_komi(w_komi, wk_offset, '#fff', p2x, o2y, g)
    draw_part(left, l_offset)
    draw_part(middle, m_offset)
    draw_part(right, r_offset)
}

function param_for(left, middle, right, komi) {
    const b_komi = clip(- komi, 0), w_komi = clip(komi, 0)
    const lengths = [left.length, b_komi, middle.length, w_komi]
    let length_sum = 0
    const [l_offset, bk_offset, m_offset, wk_offset, r_offset] =
          [0, ...lengths.map(w => length_sum += w)]
    return {b_komi, w_komi, bk_offset, wk_offset, l_offset, m_offset, r_offset}
}

function colors_for(s, hot) {
    const black_color = '#222', alt_black_color = '#444'
    const white_color = '#eee', alt_white_color = '#ccc'
    const hot_color = [ORANGE, '#f00', '#f0f']
    const stone_void_color = hot_color[hot], territory_void_color = '#888'
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

function draw_komi(komi, offset, color, p2x, o2y, g) {
    const epsilon = 1
    const {top, bottom} = get_geometry(o2y, g)
    const top_left = [p2x(offset) - epsilon, top]
    const bottom_right =[p2x(offset + komi) + epsilon, bottom]
    g.fillStyle = color; fill_rect(top_left, bottom_right, g)
}

////////////////////////////////////////////
// mirror outlines

function draw_endstate_mirror(ssg, komi, p2x, o2y, g) {
    const reverse_ss = ss => ss.slice().reverse()
    const mirrored_ssg = ssg.map(reverse_ss).reverse()
    draw_endstate_outline(mirrored_ssg, - komi, p2x, o2y, g)
}

function draw_endstate_outline(ssg, komi, p2x, o2y, g) {
    g.lineWidth = 2
    const black_color = 'rgba(255,255,255,0.5)', white_color = 'rgba(0,0,0,0.5)'
    const [left, middle, right] = ssg
    const {b_komi, w_komi, bk_offset, wk_offset, l_offset, m_offset, r_offset}
          = param_for(left, middle, right, komi)
    const k2x = k => p2x(k + 0.5)
    const xyc_list_for = (ss, offset) => {
        const xyc = ({endstate}, k) => {
            const x = k2x(k + offset), y = o2y(Math.abs(endstate))
            const c = endstate < 0 ? black_color : white_color
            return [x, y, c]
        }
        return ss.map(xyc)
    }
    const komi_xyc_list = (komi, offset, color) =>
          komi > 0 ? [[k2x(offset), 0, color], [k2x(komi + offset - 1), 0, color]] : []
    const xyc_list = [
        xyc_list_for(left, l_offset),
        komi_xyc_list(b_komi, bk_offset, black_color),
        xyc_list_for(middle, m_offset),
        komi_xyc_list(w_komi, wk_offset, white_color),
        xyc_list_for(right, r_offset),
    ].flat()
    const draw = ([x, y, c], k, a) => {
        const [x0, y0, _] = a[k - 1] || []; if (!truep(x)) {return}
        g.strokeStyle = c
        line([x0, y0], [x, y], g)
    }
    xyc_list.forEach(draw)
}

////////////////////////////////////////////
// grid lines

function draw_grids(o2y, g) {
    const x_grids = 2, y_grids = 3, color = ORANGE, line_width = 1
    const {left, right, top, bottom, width, height} = get_geometry(o2y, g)
    const horizontal_line = (y, g) => {line([left, y], [right, y], g)}
    const vertical_line = (x, g) => {line([x, top], [x, bottom], g)}
    const grid_lines = (n, size, plotter) =>
          seq(n - 1, 1).forEach(k => plotter(k * size / n, g))
    g.strokeStyle = color; g.lineWidth = line_width
    grid_lines(x_grids, width, vertical_line)
    grid_lines(y_grids, height, horizontal_line)
}

////////////////////////////////////////////
// score lead rectangle

function draw_score(ss, points, o2y, g) {
    const {komi, endstate_sum} = R
    const {width, height} = get_geometry(o2y, g)
    // <average height>
    const score_diff = endstate_sum - komi
    const score_sum = sum(ss.map(s => Math.abs(s.endstate))) + Math.abs(komi)
    const average_height = score_sum / points * height
    const average_y = o2y(score_sum / points)
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

/////////////////////////////////////////////////
// util

function get_geometry(o2y, g) {
    const left = 0, right = g.canvas.width, top = o2y(1), bottom = o2y(0)
    const width = right - left, height = bottom - top
    return {left, right, top, bottom, width, height}
}

/////////////////////////////////////////////////
// exports

module.exports = {
    draw_endstate_distribution,
    hide_endstate_distribution,
}
