'use strict'

/////////////////////////////////////////////////
// visits trail

function draw_visits_trail_sub(winrate_trail, canvas) {
    const w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    const fontsize = h / 10, top_margin = 3
    const v2x = v => v / R.visits * w
    const v2y = v => (1 - v / R.max_visits) * (h - top_margin) + top_margin
    const xy_for = z => [v2x(z.total_visits), v2y(z.visits)]
    canvas.onmousedown = canvas.onmousemove = canvas.onmouseup = e => {}
    g.fillStyle = BLACK; fill_rect([0, 0], [w, h], g)
    if (!R.visits || !R.max_visits) {return}
    draw_visits_trail_grid(fontsize, w, h, v2x, v2y, g)
    R.suggest.forEach(s => draw_visits_trail_curve(s, winrate_trail, fontsize, h, xy_for, g))
    draw_visits_trail_background_visits(w, h, v2x, g)
}

function draw_visits_trail_grid(fontsize, w, h, v2x, v2y, g) {
    const kilo = (v, x, y) => fill_text(g, fontsize, ' ' + kilo_str(v).replace('.0', ''), x, y)
    g.save()
    g.lineWidth = 1
    g.strokeStyle = g.fillStyle = WINRATE_TRAIL_COLOR; g.textAlign = 'left'
    g.textBaseline = 'top'
    tics_until(R.visits).forEach(v => {
        if (!v) {return}; const x = v2x(v); line([x, 0], [x, h], g); kilo(v, x, 0)
    })
    g.textBaseline = 'bottom'
    tics_until(R.max_visits).forEach(v => {
        if (!v) {return}; const y = v2y(v); line([0, y], [w, y], g); kilo(v, 0, y)
    })
    g.restore()
}

function draw_visits_trail_curve(s, winrate_trail, fontsize, h, xy_for, g) {
    const {move} = s, a = winrate_trail[move]
    if (!a) {return}
    const {alpha, target_p, draw_order_p, next_p} = winrate_bar_suggest_prop(s)
    const xy = a.map(xy_for)
    a.forEach((fake_suggest, k) => {  // only use fake_suggest.winrate
        if (k === 0) {return}
        g.strokeStyle = g.fillStyle = suggest_color(fake_suggest, alpha).fill
        g.lineWidth = (a[k].order === 0 && a[k-1].order === 0) ? 8 : 2
        line(xy[k], xy[k - 1], g)
        next_p && !target_p && fill_circle(xy[k], 4, g)
    })
    draw_order_p && draw_visits_trail_order(s, a, target_p, fontsize, h, xy_for, g)
}

function draw_visits_trail_order(s, a, forcep, fontsize, h, xy_for, g) {
    const [x, y] = xy_for(a[0]), low = y > 0.8 * h, ord = s.order + 1
    if (low && !forcep) {return}
    g.save()
    g.textAlign = 'right'; g.textBaseline = low ? 'bottom' : 'top'
    const modified_fontsize = winrate_bar_order_set_style(s, fontsize, g)
    fill_text(g, modified_fontsize, ord === 1 ? '1' : `${ord} `, x, y)
    g.restore()
}

function draw_visits_trail_background_visits(w, h, v2x, g) {
    if (!truep(R.background_visits)) {return}
    const x = v2x(R.background_visits)
    g.save()
    g.strokeStyle = GREEN; g.lineWidth = 3; line([x, 0], [x, h], g)
    g.fillStyle = '#888'; g.textAlign = 'center'; g.textBaseline = 'middle'
    fill_text(g, h / 5, 'Reused', w / 2, h / 2)
    g.restore()
}

/////////////////////////////////////////////////
// exports

module.exports = {
    draw_visits_trail_sub,
}
