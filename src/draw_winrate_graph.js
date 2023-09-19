/////////////////////////////////////////////////
// winrate graph

const zone_indicator_height_percent = 6
const upper_graph_rate = 0.5

function draw_winrate_graph(canvas, show_until, handle_mouse_on_winrate_graph) {
    const g = canvas.getContext("2d")
    g.save()
    g.lineJoin = 'round'
    draw_winrate_graph_sub(g, canvas, show_until, handle_mouse_on_winrate_graph)
    g.restore()
}

function draw_winrate_graph_sub(g, canvas, show_until, handle_mouse_on_winrate_graph) {
    const w = canvas.width
    const xmargin = w * 0.04, fontsize = to_i(w * 0.04)
    // s = move_count, r = winrate
    // q = winrate for lower graph, c = canvas rate (0 = top, 1 = bottom)
    const smin = R.init_len, smax = Math.max(R.history_length, smin + 1)
    const get_trans = (r_top, r_bot, c_top, c_bot) => {
        const [z2c, c2z] = translator_pair([r_top, r_bot], [c_top, c_bot])
        const [sz2coord_raw, coord2sz] =
              uv2coord_translator_pair(canvas, [smin, smax], [c2z(0), c2z(1)], xmargin, 0)
        const sz2coord_noclip = (s, r) =>
              s < R.init_len ? [NaN, NaN] : sz2coord_raw(s, r)
        const sz2coord = (s, r) => sz2coord_noclip(s, clip(r, 0, 100))
        return [sz2coord, sz2coord_noclip, coord2sz]
    }
    const hz = zone_indicator_height_percent / 2
    const [sr2coord, sr2coord_noclip, coord2sr] =
          get_trans(100, - hz, 0, upper_graph_rate)
    const [sq2coord, sq2coord_noclip, coord2sq] =
          get_trans(100 + hz, 0, upper_graph_rate, 1)
    const overlay = graph_overlay_canvas.getContext("2d")
    const show_until_p = truep(show_until)
    clear_canvas(graph_overlay_canvas)
    show_until_p ?
        draw_winrate_graph_show_until(show_until, w, fontsize,
                                      sr2coord, sq2coord, overlay) :
        draw_winrate_graph_future(w, fontsize, sr2coord, sq2coord, overlay)
    if (R.busy || show_until_p) {return}
    const draw_score = score_drawer(w, sq2coord, g)
    const score_loss_p = !alternative_engine_for_white_p()
    update_winrate_text_geom(w, sr2coord, coord2sr)
    draw_winrate_graph_frame(w, sr2coord, g)
    draw_winrate_graph_frame(w, sq2coord, g)
    draw_winrate_graph_settled_territory(sq2coord, g)
    draw_winrate_graph_ambiguity(sr2coord, sq2coord, g)
    draw_winrate_graph_ko_fight(sr2coord, g)
    score_loss_p && draw_winrate_graph_score_loss(w, sq2coord, true, g)
    draw_winrate_graph_order(sr2coord, g)
    draw_winrate_graph_aggressiveness(sr2coord, g)
    draw_winrate_graph_tag(fontsize, sr2coord, g)
    draw_winrate_graph_curve(sr2coord, g)
    draw_score('score') || draw_no_score(w, sq2coord, fontsize, g)
    draw_winrate_graph_current(g)
    // mouse events
    handle_mouse_on_winrate_graph(canvas, coord2sr)
}

function draw_winrate_graph_frame(w, sr2coord, g) {
    const tics = 9, xtics = 10, xtics_delta = 50
    const s2x = s => sr2coord(s, 0)[0], r2y = r => sr2coord(R.init_len, r)[1]
    const [y0, y50, y100] = [0, 50, 100].map(r2y)
    g.fillStyle = BLACK; fill_rect([0, r2y(100)], [w, r2y(0)], g)
    // horizontal / vertical lines (tics)
    g.strokeStyle = DARK_GRAY; g.fillStyle = DARK_GRAY; g.lineWidth = 1
    seq(tics, 1).forEach(i => {
        const y = r2y(100 * i / (tics + 1)); line([0, y], [w, y], g)
    })
    seq(xtics, 0).forEach(k => {
        const x = s2x(k * xtics_delta + R.init_len); line([x, y0], [x, y100], g)
    })
    // // frame
    // g.strokeStyle = GRAY; g.fillStyle = GRAY; g.lineWidth = 1
    // rect([0, 0], [w, h], g)
    // 50% line
    g.strokeStyle = GRAY; g.fillStyle = GRAY; g.lineWidth = 1
    line([0, y50], [w, y50], g)
}

function draw_winrate_graph_show_until(show_until, w, fontsize,
                                       sr2coord, sq2coord, g) {
    // area
    const [s0, s1] = num_sort([show_until, R.move_count])
    const paint_area = sz2coord => {
        const xy0 = sz2coord(s0, 100), xy1 = sz2coord(s1, 0)
        g.strokeStyle = g.fillStyle = 'rgba(128,128,0,0.3)'; g.lineWidth = 1
        edged_fill_rect(xy0, xy1, g)
    }
    paint_area(sr2coord)
    sq2coord !== sr2coord && paint_area(sq2coord)
    // move number
    const delta = R.move_count - show_until
    const [x, y] = sr2coord(show_until, 0), margin = fontsize * 2
    const left_limit = (delta < 0 ? w - margin : margin)
    g.save()
    g.textAlign = delta === 0 ? 'center' : x < left_limit ? 'left' : 'right'
    g.textBaseline = 'bottom'
    g.fillStyle = 'rgba(255,255,0,0.7)'
    fill_text(g, fontsize, ' ' + mc2movenum(show_until) + ' ', x, y)
    g.restore()
}

function draw_winrate_graph_future(w, fontsize, sr2coord, sq2coord, g) {
    const [x, y] = sr2coord(clip_init_len(R.move_count), 50)
    const [ , y_base] = sr2coord(R.init_len, 0)
    const paint = (dx, l_alpha, r_alpha, y0, y1) => {
        const c = a => `rgba(255,255,255,${a})`
        const grad = side_gradation(x, x + dx,
                                    c(l_alpha), c(r_alpha), g)
        g.fillStyle = grad; fill_rect([x, y0], [w, y1], g)
    }
    const alpha = 0.2
    const do_paint = (y0, y1) => paint(w * 0.05, alpha, 0, y0, y1)
    do_paint(0, y_base)
    sq2coord !== sr2coord &&
        do_paint(sq2coord(R.init_len, 100)[1], sq2coord(R.init_len, 0)[1])
    // move number
    g.save()
    g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillStyle = WHITE
    fill_text(g, fontsize, mc2movenum(R.move_count), x, y_base)
    g.restore()
}

function draw_winrate_graph_curve(sr2coord, g) {
    const [whs, rest] = R.winrate_history_set
    const style_for = k =>
          alternative_engine_for_white_p() && (k === 0 ? "#0c0" : '#c0c')
    const draw1 = (a, style) => draw_winrate_graph_curve_for(a, style, sr2coord, g)
    rest.forEach(a => draw1(a, 'rest'))
    whs.forEach((a, which_engine) => draw1(a, style_for(which_engine)))
}

function draw_winrate_graph_curve_for(winrate_history, style, sr2coord, g) {
    const draw_predict = (r, s, p) => {
        g.strokeStyle = YELLOW; g.lineWidth = 1; line(sr2coord(s, r), sr2coord(s, p), g)
    }
    const draw1 = (prev_xy, h, s) => {
        if (!truep(h.r)) {return prev_xy}
        const thin = (style === 'rest'), xy = sr2coord(s, h.r)
        truep(h.predict) && !thin && draw_predict(h.r, s, h.predict)
        g.strokeStyle = thin ? PALE_BLUE : style ? style :
            isNaN(h.move_eval) ? GRAY : h.pass ? PALE_BLUE :
            (h.move_eval < 0) ? "#e00" : (s > 1 && !truep(h.predict)) ? "#ff0" : "#0c2"
        g.lineWidth = (thin ? 1 : 3)
        prev_xy && line(prev_xy, xy, g)
        return xy
    }
    winrate_history.reduce(draw1, null)
}

function draw_winrate_graph_current(g) {
    const {x, y, unit, here, normal, r, valid} = winrate_text_geom()
    if (!truep(r) || (R.pausing && !valid)) {return}
    g.save()
    g.strokeStyle = g.fillStyle = WHITE; fill_circle([x, y], 5, g)
    g.lineWidth = 1; line([x, y], here, g)
    g.textAlign = normal ? 'left' : 'right'; g.textBaseline = 'middle'
    fill_text(g, unit * 2, `${Math.round(r)}%`, ...here)
    g.restore()
}
let last_winrate_text_geom = {}
function winrate_text_geom() {return last_winrate_text_geom}
function update_winrate_text_geom(w, sr2coord, coord2sr) {
    const s = R.move_count, r = r_for_s(s), valid = truep(r)
    if (!valid) {last_winrate_text_geom.valid = false; return}
    const [x, y] = sr2coord(s, r), ymax = y_for_r(0, sr2coord)
    const unit = Math.min(dy_for_percent(20, sr2coord), w * 0.05)
    const normal = x < w * 0.5
    const dx = (normal ? 3 : -3) * unit
    const y_for_sign = sign => {
        const dy = sign * 2 * unit; return clip(y + dy, unit, ymax - unit)
    }
    // to avoid overlap with winrate curve
    const s1 = Math.round(coord2sr(x + dx, 0)[0]), r1 = r_for_s(s1)
    const y1 = y_for_r(r1, sr2coord)  // y of winrate curve
    const diff = y => Math.abs(y - y1)
    // to avoid flicker...
    const prev_dy_sign = last_winrate_text_geom.dy_sign || 1
    const prev_y = y_for_sign(prev_dy_sign)
    // ...keep previous sign as far as it is admissible
    const is_prev_ok = diff(prev_y) > unit * 1
    const dy_sign = is_prev_ok ? prev_dy_sign :
          diff(y_for_sign(+1)) > diff(y_for_sign(-1)) ? +1 : -1
    const here = [x + dx, y_for_sign(dy_sign)]
    last_winrate_text_geom = {x, y, unit, here, normal, ymax, dy_sign, r, valid}
}
function r_for_s(given_s) {return truep(given_s) && (R.winrate_history[given_s] || {}).r}
function y_for_r(r, sr2coord) {return sr2coord(R.init_len, r)[1]}
function dy_for_percent(percent, sr2coord) {
    return y_for_r(0, sr2coord) - y_for_r(percent, sr2coord)
}

function draw_winrate_graph_tag(fontsize, sr2coord, g) {
    g.save()
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.strokeStyle = g.fillStyle = BLUE; g.lineWidth = 1
    const half = fontsize / 2
    R.winrate_history.forEach((h, s) => {
        if (!h.tag) {return}
        const [x, ymax] = sr2coord(s, 0)
        const [yt, yl] = (h.r < 50) ? [half, fontsize] : [ymax - half, ymax - fontsize]
        exclude_implicit_tags(h.tag || '') && line([x, yl], [x, ymax / 2], g)
        fill_text(g, fontsize, h.tag, x, yt)
    })
    g.restore()
}

// additional plots

function score_drawer(w, sr2coord, g) {
    const scores = winrate_history_values_of('score_without_komi')
          .map(z => truep(z) && (z - R.komi))
    const max_score = Math.max(...scores.filter(truep).map(Math.abs))
    if (max_score === - Infinity) {return command => ({score: () => false})[command]()}
    const color = "rgba(235,148,0,1)"
    const margin = 3, scale_list = [5, 2, 1, 0.5, 0.2, 0.1]
    const scale = scale_list.find(z => max_score * z < 50 - margin) || last(scale_list)
    const to_r = score => 50 + score * scale
    const plotter = (x, y, s, g) => {g.fillStyle = color; fill_circle([x, y], 2.5, g)}
    const draw_score = () => {
        const at_r = [10, 30, 50, 70, 90], to_score = r => (r - 50) / scale
        draw_winrate_graph_scale(at_r, to_score, color, null, sr2coord, g)
        draw_winrate_graph_history(scores, to_r, plotter, sr2coord, g)
        !R.hide_suggest && draw_score_text(w, to_r, sr2coord, g)  // avoid flicker
        return true
    }
    return command => ({score: draw_score})[command]()
}

function draw_score_text(w, to_r, sr2coord, g) {
    const s = R.move_count, {r, score_without_komi} = R.winrate_history[s] || {}
    if (!truep(score_without_komi)) {return}
    const score = score_without_komi - R.komi
    const wr = winrate_text_geom()
    const [x0, ] = wr.here, {normal, ymax} = wr, unit = wr.unit * 0.75
    const [x, y] = sr2coord(s, to_r(score))
    const my_ymax = (ymax < sr2coord(s, 100)[1]) ? sr2coord(s, 0)[1] : ymax
    const here = [x0, clip(y + 2 * unit, unit, my_ymax - unit)]
    g.save()
    g.strokeStyle = g.fillStyle = WHITE; g.lineWidth = 1
    fill_circle([x, y], 4, g); line([x, y], here, g)
    g.textAlign = normal ? 'left' : 'right'; g.textBaseline = 'middle'
    const bw = score > 0 ? 'B' : 'W'
    fill_text(g, unit * 2, `${bw}+${f2s(Math.abs(score))}`, ...here)
    g.restore()
}

function draw_no_score(w, sr2coord, fontsize, g) {
    const x = w / 2, [ , y] = sr2coord(R.init_len, 50)
    g.save()
    g.textAlign = 'center'; g.textBaseline = 'bottom'
    g.fillStyle = GRAY; fill_text(g, fontsize, "no score estimation", x, y)
    g.restore()
}

function draw_winrate_graph_ko_fight(sr2coord, g) {
    const radius = 5, alpha = 0.7, lineWidth = 2
    const marker_for = {ko_captured: fill_circle,
                        resolved_by_connection: circle,
                        resolved_by_capture: x_shape_around}
    const plot = (z, s, marker) => {
        const [x, y] = sr2coord(s, 100), cy = y + radius * (z.is_black ? 1 : 2.5)
        g.lineWidth = lineWidth
        g.strokeStyle = zone_color_for_move(z.move)
        g.fillStyle = zone_color_for_move(z.move, alpha)
        marker([x, cy], radius, g)
    }
    const f = (z, s) => (key, val) => val && plot(z, s, marker_for[key])
    R.move_history.forEach((z, s) => each_key_value(z.ko_state || {}, f(z, s)))
}

function draw_winrate_graph_settled_territory(sr2coord, g) {
    const radius = 4, alpha = 0.2
    const bar_width = 2, bar_alpha = 0.2
    const long_bar = 20, long_bar_alpha = 0.2
    const scores = winrate_history_values_of('score_without_komi')
          .map(z => truep(z) && (z - R.komi))
    const plot_dot = (val, s, style) => {
        const [x, y] = sr2coord(s, val)
        g.fillStyle = style; fill_circle([x, y], radius, g)
    }
    const plot_bar = (from, len, style, s) => {
        const xy0 = sr2coord(s, from)
        const xy1 = sr2coord(s, from + len)
        g.strokeStyle = style, g.lineWidth = bar_width
        line(xy0, xy1, g)
    }
    const plot = (z, s) => {
        let {black_settled_territory, white_settled_territory} = z
        R.komi > 0 ? (white_settled_territory += R.komi) :
            (black_settled_territory -= R.komi)
        const score = scores[s]
        const ok = truep(black_settled_territory) && truep(white_settled_territory)
        if (!ok) {return}
        const black_color = a => `rgba(0,192,0,${a})`
        const white_color = a => `rgba(255,0,255,${a})`
        const delta = black_settled_territory - white_settled_territory
        const bar = score - delta, abs_bar = Math.abs(bar)
        const a = (abs_bar >= long_bar) ? long_bar_alpha : bar_alpha
        const [bar_from, bar_color] = bar > 0 ?
              [black_settled_territory, black_color(a)] :
              [white_settled_territory, white_color(a)]
        plot_bar(bar_from, Math.abs(bar), bar_color, s)
        plot_dot(black_settled_territory, s, black_color(alpha))
        plot_dot(white_settled_territory, s, white_color(alpha))
    }
    R.move_history.forEach(plot)
}

function draw_winrate_graph_ambiguity(sr2coord, sq2coord, g) {
    const radius = 2, line_width = 3
    g.lineWidth = line_width
    const dots = (...args) => {
        const xys = args.slice(), g = xys.pop()
        xys.forEach(xy => fill_square_around(xy, radius, g))
    }
    const highlight_background_above = threshold => (...args) => {
        const xys = args.slice(), g = xys.pop(), orig_style = g.strokeStyle
        const y_for = val => sr2coord(clip_init_len(0), val)[1]
        const [ymax, ymin, y0] = [0, 100, threshold].map(y_for)
        const high = y => (y <= y0)
        let left = null, right = null
        xys.forEach(([x, y], k) => {
            const prev_high = truep(right), cur_high = high(y)
            const is_last = k === xys.length - 1
            cur_high && (right = x, left = true_or(left, right))
            prev_high && (!cur_high || is_last) &&
                (fill_rect([left, ymin], [right, ymax], g), left = right = null)
        })
    }
    const items_in_upper_chart = [
        // key, stroke, fill, scale, plotter
        ['ambiguity', TRANSPARENT, 'rgba(255,0,0,0.2)', 1, highlight_background_above(20)],
    ]
    const items_in_lower_chart = [
        // key, stroke, fill, scale, plotter
        ['area_ambiguity_ratio', 'rgba(128,128,128,0.4)', TRANSPARENT, 100, line],
        ['stone_entropy', '#008', TRANSPARENT, 0.5, line],
        // ['ambiguity', TRANSPARENT, '#800', 1, dots],
        ['ambiguity', '#800', TRANSPARENT, 1, line],
        // ['ambiguity', RED, 'rgba(255,0,0,0.3)', 1, edged_fill_line],
        ['endstate_surprise', '#660', TRANSPARENT, 1, line],
        ['score_stdev', '#066', TRANSPARENT, 1, line],
        ['shorttermScoreError', TRANSPARENT, '#444', 10, dots],
]
    draw_winrate_graph_ambiguity_sub(items_in_upper_chart, sr2coord, g)
    draw_winrate_graph_ambiguity_sub(items_in_lower_chart, sq2coord, g)
}

function draw_winrate_graph_ambiguity_sub(items, sr2coord, g) {
    const plot = (key, stroke, fill, scale, plotter) => {
        const to_xy = (z, s) => {
            const val = z[key]; return truep(val) && sr2coord(s, val * scale)
        }
        let xys = R.move_history.map(to_xy).filter(identity)
        const fill_p = [fill_line, edged_fill_line].includes(plotter)
        if (fill_p) {
            const left_bottom = sr2coord(clip_init_len(0), 0)
            const right_bottom = sr2coord(R.move_history.length - 1, 0)
            xys = [left_bottom, ...xys, right_bottom]
        }
        g.strokeStyle = stroke; g.fillStyle = fill;
        plotter(...xys, g)
    }
    items.forEach(a => plot(...a))
}

function draw_winrate_graph_score_loss(w, sr2coord, large_graph, g) {
    const ready = R.winrate_history && R.history_length > 0 &&
          R.winrate_history.map(h => h.score_without_komi).filter(truep).length > 1
    if (!ready) {return}
    const style_with = alpha =>
          ({b: `rgba(0,192,0,${alpha})`, w: `rgba(255,0,255,${alpha})`})
    const style = style_with(large_graph ? 1 : 0.7)
    const blunder_style = style_with(1)
    const line_width = 1, blunder_width = large_graph ? 4 : 2
    const offset = 0, turn = R.bturn ? 'b' : 'w'
    const current = (R.winrate_history[R.move_count].cumulative_score_loss || {})[turn]
    const worst = Math.max(...R.winrate_history.map(h => h.cumulative_score_loss)
                           .map(csl => csl ? Math.max(csl['b'], csl['w']) : - Infinity))
    const ks = [0.5, 1, 2, 5, 10, 20, 50, 100], range = 100 - offset
    const scale = 1 / (ks.find(k => worst <= k * range) || last(ks))
    const to_r = loss => 100 - offset - loss * scale
    const to_step = ([x, y], k, a) => {
        const [x0, y0] = a[k - 1] || [x, y]; return [[x, y0], [x, y]]
    }
    // step chart of cumulative score loss
    g.lineWidth = line_width
    each_key_value(style, (key, style_for_key) => {
        g.strokeStyle = style_for_key
        const to_xy = ({cumulative_score_loss}, s) => cumulative_score_loss ?
              sr2coord(s, to_r(cumulative_score_loss[key])) : [NaN, NaN]
        line(...R.winrate_history.map(to_xy).flatMap(to_step), g)
    })
    // emphasize blunders
    g.lineWidth = blunder_width
    R.winrate_history.forEach(({cumulative_score_loss, turn_letter}, s, a) => {
        each_key_value(blunder_style, (key, style_for_key) => {
            g.strokeStyle = style_for_key
            const prev_wrh = (a[s - 1] || {}).cumulative_score_loss
            const current = (cumulative_score_loss || {})[key]
            const prev = (prev_wrh || {})[key]
            const blunder_p = truep(current) && truep(prev) && (key === turn_letter) &&
                  (current - prev > - blunder_threshold)
            if (!blunder_p) {return}
            const [x0, y0] = sr2coord(s - 1, to_r(prev))
            const [x, y] = sr2coord(s, to_r(current))
            line([x, y0], [x, y], g)
        })
    })
    // scale
    const at_r = [80, 60, 40, 20], to_loss = r => (100 - offset - r) / scale
    draw_winrate_graph_scale(at_r, to_loss, style.b, w * 0.995, sr2coord, g)
}

function draw_winrate_graph_order(sr2coord, g) {
    const table = [['order_b', '0,192,0', true], ['order_w', '255,0,255', false]]
    table.forEach(([key, rgb, upside_down]) =>
                  draw_winrate_graph_barchart(key, 1, rgb, upside_down, sr2coord, g))
}

function draw_winrate_graph_aggressiveness(sr2coord, g) {
    const table = [['aggressiveness_b', '0,192,0', true],
                   ['aggressiveness_w', '255,0,255', false]]
    const alpha = 0.3, radius = 4, scale = 20, bound = 30
    const f_mag = {true: [fill_square_around, 1],
                   false: [fill_diamond_around, Math.sqrt(2)]}
    const to_r = val => truep(val) && clip(Math.log(val) / Math.log(2) * scale, - bound, bound) + 50
    const to_r_filtered = val => {
        const small = 5, r = to_r(val), boring = (clip(r, 50 - small, 50 + small) === r)
        return !boring && r
    }
    const moving_average = (a, d) => a.map((z, k) => z && average(a.slice(clip(k - d, 0), k + d + 1).filter(valid_numberp)))
    const plot1 = ([key, rgb, black_p]) => {
        const values = winrate_history_values_of(key), [f, mag] = f_mag[black_p]
        const plotter = (x, y, s, g) => f([x, y], radius * mag, g)
        g.fillStyle = `rgba(${rgb},${alpha})`
        draw_winrate_graph_history(values, to_r_filtered, plotter, sr2coord, g)
        const d = 6, smoothed_r = moving_average(values.map(to_r), d)
        const xys = smoothed_r.map((r, s) => truep(r) && sr2coord(s, r)).filter(truep)
        g.save()
        g.lineWidth = radius * 2; g.lineJoin = 'bevel'
        g.strokeStyle = `rgba(${rgb},${alpha})`
        line(...xys, g)
        g.restore()
    }
    table.forEach(plot1)
}

function draw_winrate_graph_scale(at_r, r2val, color, x_maybe, sr2coord, g) {
    const unit_r = 10, s0 = clip_init_len(0)
    const [x0, y0] = sr2coord(s0, 0), [ , y1] = sr2coord(s0, unit_r)
    const maxwidth = x0 * 0.8, fontsize = Math.min((y0 - y1) * 1.7, maxwidth)
    const to_xy = r => [x_maybe || maxwidth, sr2coord(s0, r)[1]]
    const to_text = r => to_s(Math.round(r2val(r)))
    const draw_at = r => {
        g.textBaseline = r === 0 ? 'bottom' : r === 100 ? 'top' : 'middle'
        const text = to_text(r), maxw = text.length === 1 ? maxwidth / 2 : maxwidth
        fill_text(g, fontsize, text, ...to_xy(r), maxw)
    }
    g.save()
    g.textAlign = 'right'; g.fillStyle = color
    at_r.forEach(draw_at)
    g.restore()
}

function draw_winrate_graph_history(ary, to_r, plotter, sr2coord, g) {
    const f = (val, s) => {
        const r = truep(val) && to_r(val)
        truep(r) && plotter(...sr2coord(s, r), s, g)
    }
    ary.forEach(f)
}

function draw_winrate_graph_barchart(key, mag, rgb, upside_down, sr2coord, g) {
    const values = winrate_history_values_of(key)
    const conv = upside_down ? (val => 100 - val) : identity
    const to_r = val => conv(clip(val * mag, 0, 100))
    const threshold = num_sort(values.filter(truep)).slice(-10)[0]
    const [ , base_y] = sr2coord(clip_init_len(0), upside_down ? 100 : 0)
    const plotter = (x, y, s, g) => {
        const [line_width, alpha] = values[s] >= threshold ? [1, 0.5] : [1, 0.5]
        g.strokeStyle = `rgba(${rgb},${alpha})`; g.lineWidth = line_width
        line([x, y], [x, base_y], g)
    }
    draw_winrate_graph_history(values, to_r, plotter, sr2coord, g)
}

/////////////////////////////////////////////////
// zone color

function zone_color_for_move(move, alpha) {return zone_color(...move2idx(move || ''), alpha)}

/////////////////////////////////////////////////
// exports

module.exports = {
    draw_winrate_graph,
}
