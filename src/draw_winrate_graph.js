/////////////////////////////////////////////////
// winrate graph

const zone_indicator_height_percent = 3

function draw_winrate_graph(canvas, show_until, large_graph, handle_mouse_on_winrate_graph) {
    const w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    const xmargin = w * 0.04, fontsize = to_i(w * 0.04)
    const smin = R.handicaps, smax = Math.max(R.history_length, smin + 1)
    const rmin = - zone_indicator_height_percent
    // s = move_count, r = winrate
    const [sr2coord_raw, coord2sr] =
          uv2coord_translator_pair(canvas, [smin, smax], [100, rmin], xmargin, 0)
    const sr2coord = (s, r) => s < R.handicaps ? [NaN, NaN] : sr2coord_raw(s, r)
    const overlay = graph_overlay_canvas.getContext("2d")
    clear_canvas(graph_overlay_canvas)
    truep(show_until) ?
        draw_winrate_graph_show_until(show_until, w, h, fontsize, sr2coord, overlay) :
        draw_winrate_graph_future(w, fontsize, sr2coord, overlay)
    if (R.busy || show_until) {return}
    const draw_score = score_drawer(w, sr2coord, g)
    const score_loss_p = !alternative_engine_for_white_p()
    update_winrate_text_geom(w, sr2coord, coord2sr)
    clear_canvas(canvas, BLACK, g)
    draw_winrate_graph_frame(w, h, sr2coord, g)
    draw_score('komi')
    draw_winrate_graph_ko_fight(sr2coord, g)
    draw_winrate_graph_ambiguity(sr2coord, g)
    score_loss_p && draw_winrate_graph_score_loss(sr2coord, large_graph, g)
    draw_winrate_graph_zone(sr2coord, g)
    draw_winrate_graph_tag(fontsize, sr2coord, g)
    draw_winrate_graph_curve(sr2coord, g)
    draw_score('score')
    draw_winrate_graph_current(g)
    // mouse events
    handle_mouse_on_winrate_graph(canvas, coord2sr)
}

function draw_winrate_graph_frame(w, h, sr2coord, g) {
    const tics = 9, xtics = 10, xtics_delta = 50
    const s2x = s => sr2coord(s, 0)[0], r2y = r => sr2coord(R.handicaps, r)[1]
    // horizontal / vertical lines (tics)
    g.strokeStyle = DARK_GRAY; g.fillStyle = DARK_GRAY; g.lineWidth = 1
    seq(tics, 1).forEach(i => {
        const y = r2y(100 * i / (tics + 1)); line([0, y], [w, y], g)
    })
    seq(xtics, 0).forEach(k => {
        const x = s2x(k * xtics_delta); line([x, 0], [x, h], g)
    })
    // // frame
    // g.strokeStyle = GRAY; g.fillStyle = GRAY; g.lineWidth = 1
    // rect([0, 0], [w, h], g)
    // 50% line
    g.strokeStyle = GRAY; g.fillStyle = GRAY; g.lineWidth = 1
    const y50 = r2y(50); line([0, y50], [w, y50], g)
    // bottom space for zone indicator
    g.fillStyle = DARK_GRAY; fill_rect([0, h], [w, r2y(0)], g)
}

function draw_winrate_graph_show_until(show_until, w, h, fontsize, sr2coord, g) {
    // area
    const [s0, s1] = num_sort([show_until, R.move_count])
    const xy0 = sr2coord(s0, 100), xy1 = sr2coord(s1, 0)
    g.strokeStyle = g.fillStyle = 'rgba(128,128,0,0.3)'; g.lineWidth = 1
    edged_fill_rect(xy0, xy1, g)
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

function draw_winrate_graph_future(w, fontsize, sr2coord, g) {
    const [x, y] = sr2coord(clip_handicaps(R.move_count), 50)
    const [_, y_base] = sr2coord(R.handicaps, 0)
    const paint = (dx, l_alpha, r_alpha, y0, y1) => {
        const c = a => `rgba(255,255,255,${a})`
        const grad = side_gradation(x, x + dx,
                                    c(l_alpha), c(r_alpha), g)
        g.fillStyle = grad; fill_rect([x, y0], [w, y1], g)
    }
    const alpha = 0.2
    paint(w * 0.05, alpha, 0, 0, y_base)
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
    let prev = null, cur = null
    const draw_predict = (r, s, p) => {
        g.strokeStyle = YELLOW; g.lineWidth = 1; line(sr2coord(s, r), sr2coord(s, p), g)
    }
    winrate_history.forEach((h, s) => {
        if (!truep(h.r)) {return}
        const thin = (style === 'rest')
        truep(h.predict) && !thin && draw_predict(h.r, s, h.predict)
        g.strokeStyle = thin ? PALE_BLUE : style ? style :
            isNaN(h.move_eval) ? GRAY : h.pass ? PALE_BLUE :
            (h.move_eval < 0) ? "#e00" : (s > 1 && !truep(h.predict)) ? "#ff0" : "#0c2"
        g.lineWidth = (thin ? 1 : 3)
        cur = sr2coord(s, h.r); prev && line(prev, cur, g); prev = cur
    })
}

function draw_winrate_graph_current(g) {
    const {x, y, unit, here, normal, r, valid} = winrate_text_geom()
    if (!truep(r) || (R.pausing && !valid)) {return}
    g.save()
    g.strokeStyle = g.fillStyle = WHITE; fill_circle([x, y], 5, g)
    g.lineWidth = 1; line([x, y], here, g)
    g.textAlign = normal ? 'left' : 'right'; g.textBaseline = 'middle'
    fill_text(g, unit, `${Math.round(r)}%`, ...here)
    g.restore()
}
let last_winrate_text_geom = {}
function winrate_text_geom() {return last_winrate_text_geom}
function update_winrate_text_geom(w, sr2coord, coord2sr) {
    const s = R.move_count, r = r_for_s(s), valid = truep(r)
    if (!valid) {last_winrate_text_geom.valid = false; return}
    const [x, y] = sr2coord(s, r), ymax = y_for_r(0, sr2coord)
    const unit = dy_for_percent(20, sr2coord)
    const normal = x < Math.max(w * 0.5, w - unit * 3.5)
    const dx = (normal ? 1 : -1.5) * unit
    const y_for_sign = sign => {
        const dy = sign * unit; return clip(y + dy, unit, ymax - unit)
    }
    // to avoid overlap with winrate curve
    const s1 = Math.round(coord2sr(x + dx, 0)[0]), r1 = r_for_s(s1)
    const y1 = y_for_r(r1, sr2coord)  // y of winrate curve
    // to avoid flicker...
    const prev_dy_sign = last_winrate_text_geom.dy_sign || 1
    const prev_y = y_for_sign(prev_dy_sign)
    // ...keep previous sign as far as it is admissible
    const is_prev_ok = Math.abs(prev_y - y1) > unit * 0.5
    const dy_sign = is_prev_ok ? prev_dy_sign : (truep(r1) && r1 > r ? 1 : -1)
    const here = [x + dx, y_for_sign(dy_sign)]
    last_winrate_text_geom = {x, y, unit, here, normal, ymax, dy_sign, r, valid}
}
function r_for_s(given_s) {return truep(given_s) && (R.winrate_history[given_s] || {}).r}
function y_for_r(r, sr2coord) {return sr2coord(R.handicaps, r)[1]}
function dy_for_percent(percent, sr2coord) {
    return y_for_r(0, sr2coord) - y_for_r(percent, sr2coord)
}

function draw_winrate_graph_tag(fontsize, sr2coord, g) {
    g.save()
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.strokeStyle = g.fillStyle = BLUE; g.lineWidth = 1
    R.winrate_history.forEach((h, s) => {
        if (!h.tag) {return}
        const [x, ymax] = sr2coord(s, 0)
        const [yt, yl] = (h.r < 50 ? [0.05, 0.1] : [0.95, 0.9]).map(c => ymax * c)
        h.tag !== endstate_diff_tag_letter && line([x, yl], [x, ymax / 2], g)
        fill_text(g, fontsize, h.tag, x, yt)
    })
    g.restore()
}

// additional plots

function score_drawer(w, sr2coord, g) {
    const scores = winrate_history_values_of('score_without_komi')
    const max_score = Math.max(...scores.filter(truep).map(Math.abs))
    if (max_score === - Infinity) {return do_nothing}
    const color = alpha => `rgba(235,148,0,${alpha})`
    const scale = max_score < 20 ? 2 : max_score < 45 ? 1 : max_score < 95 ? 0.5 : 0.2
    const to_r = score => 50 + score * scale
    const draw_komi = () => {
        const [dummy, ky] = sr2coord(R.move_count, to_r(R.komi))
        g.lineWidth = 1; g.strokeStyle = color(1)
        line([0, ky], [w, ky], g)
    }
    const plotter = (x, y, s, g) => {
        const current_p = (s === R.move_count)
        // const diff_target_p = R.endstate_diff_interval > 5 &&
        //       (s === R.move_count - R.endstate_diff_interval)
        const [radius, alpha] = current_p ? [4, 1] : [2.5, 0.6]
        g.fillStyle = color(alpha)
        fill_circle([x, y], radius, g)
    }
    const draw_score = () => {
        const at_r = [50, 60, 70], to_score = r => (r - 50) / scale
        draw_winrate_graph_scale(at_r, to_score, color(0.6), w * 0.995, sr2coord, g)
        draw_winrate_graph_history(scores, to_r, plotter, sr2coord, g)
        !R.hide_suggest && draw_score_text(w, to_r, sr2coord, g)  // avoid flicker
    }
    return command => ({score: draw_score, komi: draw_komi})[command]()
}

function draw_score_text(w, to_r, sr2coord, g) {
    const s = R.move_count, {r, score_without_komi} = R.winrate_history[s] || {}
    if (!truep(score_without_komi)) {return}
    const wr = winrate_text_geom()
    const [x0, y0] = wr.here, {normal, ymax} = wr, unit = wr.unit * 0.75
    const [x, y] = sr2coord(s, to_r(score_without_komi))
    const dy = (y > wr.y ? 1 : -1) * 1.5 * unit
    const half = unit * 0.5, needed = wr.unit * 0.5 + half
    const [y1, y2] = dy > 0 ? [y0 + needed, ymax - half] : [half, y0 - needed]
    const here = [x0, clip(y + dy, y1, y2)]
    g.save()
    g.strokeStyle = g.fillStyle = WHITE; g.lineWidth = 1; line([x, y], here, g)
    g.textAlign = normal ? 'left' : 'right'; g.textBaseline = 'middle'
    const score = score_without_komi - R.komi, bw = score > 0 ? 'B' : 'W'
    fill_text(g, unit, `${bw}+${f2s(Math.abs(score))}`, ...here)
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

function draw_winrate_graph_ambiguity(sr2coord, g) {
    const radius = 2
    g.fillStyle = "rgba(255,0,0,0.3)"
    const plot = (ambiguity, s) => {
        if (!truep(ambiguity)) {return}
        const [x, y] = sr2coord(s, ambiguity)
        fill_square_around([x, y], radius, g)
    }
    R.move_history.forEach((z, s) => plot(z.ambiguity, s))
}

function draw_winrate_graph_score_loss(sr2coord, large_graph, g) {
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
        line(...flatten(R.winrate_history.map(to_xy).map(to_step)), g)
    })
    // emphasize blunders
    g.lineWidth = blunder_width
    each_key_value(blunder_style, (key, style_for_key) => {
        g.strokeStyle = style_for_key
        R.winrate_history.forEach(({cumulative_score_loss}, s, a) => {
            const prev_wrh = (a[s - 1] || {}).cumulative_score_loss
            const current = (cumulative_score_loss || {})[key]
            const prev = (prev_wrh || {})[key]
            const blunder_p = truep(current) && truep(prev) &&
                  (current - prev > - blunder_threshold)
            if (!blunder_p) {return}
            const [x0, y0] = sr2coord(s - 1, to_r(prev))
            const [x, y] = sr2coord(s, to_r(current))
            line([x, y0], [x, y], g)
        })
    })
    // scale
    const at_r = [90, 80, 0], to_loss = r => (100 - offset - r) / scale
    draw_winrate_graph_scale(at_r, to_loss, style.w, null, sr2coord, g)
}

function draw_winrate_graph_zone(sr2coord, g) {
    const half = 0.6  // > 0.5 for avoiding gaps in spectrum bar
    const rmin = - zone_indicator_height_percent
    R.move_history.forEach((z, s) => {
        g.fillStyle = zone_color_for_move(z.move)
        fill_rect(sr2coord(s - half, 0), sr2coord(s + half, rmin), g)
    })
}

function draw_winrate_graph_scale(at_r, r2val, color, x_maybe, sr2coord, g) {
    const unit_r = 10, s0 = clip_handicaps(0)
    const [x0, y0] = sr2coord(s0, 0), [_, y1] = sr2coord(s0, unit_r)
    const maxwidth = x0 * 0.8, fontsize = Math.min((y0 - y1) * 0.9, maxwidth)
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
    const f = (val, s) => truep(val) && plotter(...sr2coord(s, to_r(val)), s, g)
    ary.forEach(f)
}

/////////////////////////////////////////////////
// zone color

function zone_color_for_move(move, alpha) {return zone_color(...move2idx(move || ''), alpha)}

/////////////////////////////////////////////////
// exports

module.exports = {
    draw_winrate_graph,
}
