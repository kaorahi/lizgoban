/////////////////////////////////////////////////
// winrate bar

let winrate_bar_prev = 50

function draw_winrate_bar_sub(target_move, canvas, move_count, large_bar, pale_text_p) {
    const w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    const score_p = score_bar_p(), tics = score_p ? 19 : 9
    const xfor = percent => w * percent / 100
    const vline = percent => {const x = xfor(percent); line([x, 0], [x, h], g)}
    const z = R.winrate_history[move_count] || {}
    const b_wr0 = fake_winrate_for(z.r, z.score_without_komi, true)
    const b_wr = truep(b_wr0) ? b_wr0 : winrate_bar_prev
    const komi_wr = score_p && fake_winrate_for(0.5, R.komi, true)
    const prev_score = score_p && origin_score(), ready = !empty(R.suggest)
    winrate_bar_prev = b_wr
    if (R.pausing && !truep(b_wr0)) {
        draw_winrate_bar_unavailable(w, h, g)
        draw_winrate_bar_tics(0, null, tics, w, h, vline, g)
        return
    }
    draw_winrate_bar_areas(b_wr, w, h, xfor, vline, g)
    draw_winrate_bar_tics(b_wr, komi_wr, tics, w, h, vline, g)
    if (ready) {
        large_bar && draw_winrate_bar_horizontal_lines(w, h, g)
        draw_winrate_bar_last_move_eval(b_wr, prev_score, h, xfor, vline, g)
        R.winrate_trail && draw_winrate_trail(target_move, canvas)
        draw_winrate_bar_suggestions(w, h, xfor, vline, move_count, large_bar, g)
    }
    draw_winrate_bar_text(b_wr, prev_score, w, h, pale_text_p, !ready, g)
}

function draw_winrate_bar_text(b_wr, prev_score, w, h, pale_text_p, score_only_p, g) {
    if (!truep(b_wr)) {return}
    const scorep = score_bar_p(), b_sign = R.bturn ? 1 : -1
    const eval = scorep ? - (R.score_without_komi - prev_score) * b_sign
          : - (b_wr - origin_b_winrate()) * b_sign
    const visits = R.max_visits && kilo_str(R.max_visits)
    const fontsize = Math.min(h * 0.5, w * 0.04)
    const [wr_color, vis_color] = pale_text_p ?
          ['rgba(0,192,0,0.3)', 'rgba(160,160,160,0.3)'] :
          [GREEN, WINRATE_TRAIL_COLOR]
    g.save()
    g.textBaseline = 'middle'
    const write = (text, x, y_rel) =>
          fill_text(g, fontsize, text, x, fontsize * (y_rel || 0.5))
    const score_str = wr => (wr % 10 === 0) ? wr : ''
    const f = (wr_text, x, align, myturn) => {
        const cond = (pred, s) => (pred ? ` ${s} ` : '')
        const vis = cond(visits, visits)
        const ev = cond(truep(eval), `(${eval > 0 ? '+' : ''}${f2s(eval)})`)
        const win = cond(true, wr_text)
        g.textAlign = align; g.fillStyle = wr_color; write(win, x)
        myturn && (g.fillStyle = vis_color); write(myturn ? vis : ev, x, 1.5)
    }
    const {lower, l_quarter, center, u_quarter, upper} = score_bar_fitter.range()
    const [left, right] = scorep ? [lower, upper].map(score_str) :
          [b_wr, 100 - b_wr].map(wr => f2s(wr) + '%')
    !score_only_p && (f(left, 0, 'left', R.bturn), f(right, w, 'right', !R.bturn))
    if (scorep) {
        g.textAlign = 'center'; g.fillStyle = wr_color
        const tics = [[l_quarter, 0.25], [center, 0.5], [u_quarter, 0.75]]
        tics.forEach(([wr, rel_x]) => write(score_str(wr), w * rel_x))
    }
    g.restore()
}

function draw_winrate_bar_unavailable(w, h, g) {
    g.fillStyle = "#888"; fill_rect([0, 0], [w, h], g)
}

function draw_winrate_bar_areas(b_wr, w, h, xfor, vline, g) {
    const wrx = xfor(b_wr)
    g.lineWidth = 1
    // black area
    g.fillStyle = R.bturn ? BLACK : "#000"
    g.strokeStyle = WHITE; edged_fill_rect([0, 0], [wrx, h], g)
    // white area
    g.fillStyle = R.bturn ? "#fff" : WHITE
    g.strokeStyle = BLACK; edged_fill_rect([wrx, 0], [w, h], g)
}

function draw_winrate_bar_horizontal_lines(w, h, g) {
    const vs = tics_until(R.max_visits)
    g.strokeStyle = WINRATE_TRAIL_COLOR; g.lineWidth = 1
    winrate_bar_ys(vs, w, h).map(y => line([0, y], [w, y], g))
}

function draw_winrate_bar_tics(b_wr, komi_wr, tics, w, h, vline, g) {
    const thick = [25, 50, 75], komi_p = truep(komi_wr)
    const vl = (wr, light, dark) => {
        g.strokeStyle = (wr < b_wr) ? light : (dark || light); vline(wr)
    }
    seq(tics, 1).forEach(i => {
        const r = 100 * i / (tics + 1), center_p = (r === 50) && !komi_p
        g.lineWidth = center_p ? 5 : thick.includes(Math.round(r)) ? 3 : 1
        vl(r, ...(center_p ? [ORANGE] : [WHITE, BLACK]))
    })
    if (!komi_p) {return}
    // indicate komi
    const [too_black, too_white] = [(komi_wr <= 0), (komi_wr >= 100)], unit = w / tics
    const komi_line = () => {g.lineWidth = 5; vl(komi_wr, ORANGE)}
    const fade = (x0, x1) => {
        const transparent_orange = "rgba(252,141,73,0)"
        g.fillStyle = side_gradation(x0, x1, ORANGE, transparent_orange, g)
        fill_rect([x0, 0], [x1, h], g)
    }
    too_black ? fade(0, unit) : too_white ? fade(w, w - unit) : komi_line()
}


function draw_winrate_bar_komi(komi, h, xfor, g) {
    const dummy = 0
    const [x1, x2] = [-0.5, 0.5].map(d => xfor(fake_winrate_for(dummy, komi + d, true)))
    g.lineWidth = 1; g.strokeStyle = '#888'
    line([x1, 0], [x2, h], g)
}


function draw_winrate_bar_last_move_eval(b_wr, prev_score, h, xfor, vline, g) {
    const obw = origin_b_winrate(), dummy = 0
    const prev_b_wr = score_bar_p() ?
          fake_winrate_for(dummy, prev_score, true) : obw
    if (!truep(obw) || (b_wr === prev_b_wr)) {return}
    const [x1, x2] = num_sort([b_wr, prev_b_wr].map(xfor))
    const last_gain = - (b_wr - prev_b_wr) * (R.bturn ? 1 : -1)
    if (!truep(last_gain)) {return}
    const [stroke, fill] = (last_gain >= 0 ? [GREEN, PALE_GREEN] : [RED, PALE_RED])
    const lw = g.lineWidth = 3; g.strokeStyle = stroke; g.fillStyle = fill
    edged_fill_rect([x1, lw / 2], [x2, h - lw / 2], g)
}

function winrate_bar_max_radius(w, h) {return Math.min(h * 1, w * 0.1)}

/////////////////////////////////////////////////
// suggested moves on winrate bar

// draw

function draw_winrate_bar_suggestions(w, h, xfor, vline, move_count, large_bar, g) {
    g.lineWidth = 1
    const max_radius = Math.min(h, w * 0.05)
    const prev_color = 'rgba(64,128,255,0.8)'
    R.suggest.filter(s => s.visits > 0).forEach(s => {
        const {edge_color, fan_color, vline_color, aura_color,
               target_p, draw_order_p, winrate} = winrate_bar_suggest_prop(s, move_count)
        if (vline_color) {
            g.lineWidth = 3; g.strokeStyle = vline_color; vline(flip_maybe(winrate))
        }
        if (!orig_suggest_p(s)) {return}
        draw_winrate_bar_fan(s, w, h, edge_color, fan_color, aura_color,
                             target_p, large_bar, g)
        draw_order_p && large_bar && draw_winrate_bar_order(s, w, h, g)
    })
    R.previous_suggest &&
        draw_winrate_bar_fan(R.previous_suggest, w, h,
                             prev_color, TRANSPARENT, null,
                             false, large_bar, g)
}

function draw_winrate_bar_fan(s, w, h, stroke, fill, aura_color,
                              force_puct_p, large_bar, g) {
    const bturn = s.bturn === undefined ? R.bturn : s.bturn
    const plot_params = winrate_bar_xy(s, w, h, true, bturn)
    const [x, y, r, max_radius, x_puct, y_puct] = plot_params
    const half_center_angle = 60 / 2, max_slant = large_bar ? 45 : 30
    const direction =
          (bturn ? 180 : 0) + winrate_trail_rising(s) * max_slant * (bturn ? -1 : 1)
    const degs = [direction - half_center_angle, direction + half_center_angle]
    const draw_fan = () => {
        g.lineWidth = 1; [g.strokeStyle, g.fillStyle] = [stroke, fill]
        edged_fill_fan([x, y], r, degs, g)
    }
    draw_with_aura(draw_fan,
                   s, h, plot_params, large_bar && aura_color, force_puct_p, g)
}

function draw_with_aura(proc,
                        s, h, [x, y, r, max_radius, x_puct, y_puct, x_lcb],
                        aura_color, force_puct_p, g) {
    if (!aura_color) {proc(); return}
    const searched = winrate_trail_searched(s), rel_dy = (y - y_puct) / h
    const draw_puct_p = force_puct_p || s.visits_order === 0 ||
          (Math.abs(rel_dy) > 0.05 && s.visits > R.max_visits * 0.3) ||
          (rel_dy > 0.2 && s.visits > R.max_visits * 0.05)
    const draw_lcb_p = force_puct_p || s.visits > R.max_visits * 0.1 ||
          (s.order < 3 && s.winrate - s.lcb < 0.3)
    // circle
    g.strokeStyle = g.fillStyle = aura_color
    fill_circle([x, y], max_radius * 0.15 * Math.sqrt(searched), g)
    // proc
    g.save(); proc(); g.restore()
    // line
    g.lineWidth = 2
    draw_puct_p && !R.is_katago && line([x, y], [x_puct, clip(y_puct, 0, h)], g)
    draw_lcb_p && line([x, y], [x_lcb, y], g)
}

function draw_winrate_bar_order(s, w, h, g) {
    const fontsize = w * 0.03, [x, y] = winrate_bar_xy(s, w, h)
    const modified_fontsize = winrate_bar_order_set_style(s, fontsize, g)
    g.save()
    g.textAlign = R.bturn ? 'left' : 'right'; g.textBaseline = 'middle'
    fill_text(g, modified_fontsize, ` ${s.order + 1} `, x, y)
    g.restore()
}

// calc

function winrate_bar_xy(suggest, w, h, supplementary, bturn) {
    const real_wr = suggest.winrate, max_radius = winrate_bar_max_radius(w, h)
    const wr = fake_winrate(suggest, bturn)
    const x_for = winrate => w * flip_maybe(winrate, bturn) / 100
    const y_for = visits => winrate_bar_y(visits, w, h, max_radius)
    const x = x_for(wr), y = y_for(suggest.visits)
    if (!supplementary) {return [x, y]}
    // omit PUCT and LCB for score_bar
    const maybe_x_for = winrate => x_for(score_bar_p() ? wr : winrate)
    const [puct, equilibrium_visits] = puct_info(suggest)
    return [x, y, max_radius * Math.sqrt(suggest.prior), max_radius,
            maybe_x_for(wr + puct), y_for(equilibrium_visits), maybe_x_for(suggest.lcb)]
}

function winrate_bar_y(visits, w, h, max_radius) {
    const mr = max_radius || winrate_bar_max_radius(w, h)
    const hmin = mr * 0.15, hmax = h - mr * 0.1
    const relative_visits = visits / R.max_visits
    // relative_visits > 1 can happen for R.previous_suggest
    return clip(hmin * relative_visits + hmax * (1 - relative_visits), 0, h)
}

function winrate_bar_ys(vs, w, h) {
    const max_radius = winrate_bar_max_radius(w, h)
    return vs.map(v => winrate_bar_y(v, w, h, max_radius))
}

function puct_info(suggest) {
    const s0 = R.suggest[0]; if (!s0) {return []}
    // (ref.) UCTNode.cpp and GTP.cpp in Leela Zero source
    // fixme: should check --puct option etc. of leelaz
    const cfg_puct = 0.5, cfg_logpuct = 0.015, cfg_logconst = 1.7
    const parentvisits = R.visits, psa = suggest.prior, denom = 1 + suggest.visits
    const numerator = Math.sqrt(parentvisits *
                                Math.log(cfg_logpuct * parentvisits + cfg_logconst))
    const puct = cfg_puct * psa * (numerator / denom) * 100
    // wr0 - wr = cfg_puct * (numerator * (psa/denom - psa0/denom0)) * 100
    // ==> psa/denom = psa0/denom0 + (wr0 - wr) / (cfg_puct * numerator * 100)
    const psa_per_denom = s0.prior / (1 + s0.visits) +
          (s0.winrate - suggest.winrate) / (cfg_puct * numerator * 100)
    const equilibrium_visits = psa / clip(psa_per_denom, 1e-10) - 1
    return [puct, equilibrium_visits]
}

/////////////////////////////////////////////////
// score bar

function make_center_fitter(step) {
    let center = 0
    const update_center = sc => {
        const d = sc - center, out = Math.abs(d) > step
        out && ((center = center + step * Math.sign(d)), update_center(sc))
    }
    const range = () => ({
        lower: center - step * 2, l_quarter: center - step,
        center, u_quarter: center + step, upper: center + step * 2
    })
    return {update_center, range}
}
const score_bar_fitter = make_center_fitter(5)

/////////////////////////////////////////////////
// winrate trail

const winrate_trail_max_length = 50
const winrate_trail_max_suggestions = 10
const winrate_trail_limit_relative_visits = 0.3
const winrate_trail_engine_checker = change_detector()
let winrate_trail = {}, winrate_trail_move_count = 0, winrate_trail_visits = 0

function update_winrate_trail() {
    if (!R.winrate_trail || !truep(R.visits)) {return}
    const total_visits_increase = R.visits - winrate_trail_visits;
    // check visits for detecting restart of leelaz
    const new_trail_p =
          winrate_trail_move_count !== R.move_count || total_visits_increase < 0 ||
          (R.engine_id && winrate_trail_engine_checker.is_changed(R.engine_id))
    new_trail_p && (winrate_trail = {});
    [winrate_trail_move_count, winrate_trail_visits] = [R.move_count, R.visits]
    R.suggest.slice(0, winrate_trail_max_suggestions).forEach(s => {
        const move = s.move, wt = winrate_trail
        const trail = wt[move] || (wt[move] = []), len = trail.length
        const relative_visits = s.visits / R.max_visits, total_visits = R.visits
        merge(s, {relative_visits, total_visits})
        len > 0 && (s.searched = (s.visits - trail[0].visits) / total_visits_increase)
        s.searched === 0 && trail.shift()
        trail.unshift(s); thin_winrate_trail(trail)
    })
}

function thin_winrate_trail(trail) {
    const len = trail.length
    if (len <= winrate_trail_max_length) {return}
    const distance = (k1, k2) => {
        const t1 = trail[k1], t2 = trail[k2], diff = key => Math.abs(t1[key] - t2[key])
        return diff('visits')
    }
    const ideal_interval = distance(0, len - 1) / (winrate_trail_max_length - 1)
    const interval_around = (_, k) => (1 < k && k < len - 1) ?  // except 0, 1, and last
          distance(k - 1, k + 1) : Infinity
    const min_index = a => a.indexOf(Math.min(...a))
    const victim = distance(1, 2) < ideal_interval ? 1 :
          min_index(trail.map(interval_around))
    victim >= 0 && trail.splice(victim, 1)
}

function draw_winrate_trail(target_move, canvas) {
    const w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    const xy_for = s => winrate_bar_xy(s, w, h)
    const limit_visits = R.max_visits * winrate_trail_limit_relative_visits
    g.lineWidth = 2
    g.strokeStyle = target_move ? 'rgba(0,192,255,0.8)' : WINRATE_TRAIL_COLOR
    each_key_value(winrate_trail, (move, a, count) => {
        const ok = target_move ? (move === target_move) : (a[0].visits >= limit_visits)
        ok && line(...a.map(xy_for), g)
        // ok && a.map(xy_for).map(xy => circle(xy, 3, g))  // for debug
    })
}

function winrate_trail_rising(suggest) {
    const unit = 0.005, max_delta = 5, a = winrate_trail[suggest.move] || []
    const delta = clip(a.length - 1, 0, max_delta)
    return (delta < 1) ? 0 :
        clip((a[0].relative_visits - a[delta].relative_visits) / (delta * unit), -1, 1)
}

function winrate_trail_searched(suggest) {
    // suggest.searched > 1 can happen for some reason
    return clip(suggest.searched || 0, 0, 1)
}

/////////////////////////////////////////////////
// exports

module.exports = {
    draw_winrate_bar_sub, update_winrate_trail, score_bar_fitter,
    get_winrate_trail: () => winrate_trail,
}
