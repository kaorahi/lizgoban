// -*- coding: utf-8 -*-

/////////////////////////////////////////////////
// setup

const {globalize} = require('./globalize.js')
globalize({
    clip_init_len, latest_move, latest_move_and_nearest_future_move, b_winrate,
    origin_b_winrate, origin_score, fake_winrate, fake_winrate_for, score_bar_p,
    mc2movenum, alternative_engine_for_white_p, zone_color,
    winrate_history_values_of,
    winrate_bar_suggest_prop, winrate_bar_order_set_style, suggest_color,
})

/////////////////////////////////////////////////
// draw_*

const {
    draw_raw_goban, draw_main_goban,
    draw_goban_with_principal_variation,
    draw_goban_with_expected_variation,
    draw_goban_with_future_moves,
    draw_goban_with_subboard_stones_suggest,
    draw_goban_with_original_pv,
    draw_endstate_goban, draw_thumbnail_goban, draw_zone_color_chart,
    target_move, set_target_move,
} = require('./draw_goban.js')

const {
    draw_winrate_bar_sub, update_winrate_trail, score_bar_fitter,
    get_pv_trail_for, get_winrate_trail,
} = require('./draw_winrate_bar.js')
function draw_winrate_bar(...args) {draw_winrate_bar_sub(target_move(), ...args)}

const {draw_winrate_graph} = require('./draw_winrate_graph.js')

const {draw_visits_trail_sub} = require('./draw_visits_trail.js')
function draw_visits_trail(...args) {draw_visits_trail_sub(get_winrate_trail(), ...args)}

const {
    draw_endstate_distribution, hide_endstate_distribution,
} = require('./draw_endstate_dist.js')

/////////////////////////////////////////////////
// for mapping from goban to winrate bar

// convert score to "winrate of corresponding position on winrate bar"
// to cheat drawing functions in score_bar mode
function fake_winrate(suggest, bturn) {
    return fake_winrate_for(suggest.winrate, suggest.score_without_komi, bturn)
}
function fake_winrate_for(winrate, score_without_komi, bturn) {
    if (!score_bar_p()) {return winrate}
    score_bar_fitter.update_center(R.score_without_komi - R.komi)
    const {lower, upper} = score_bar_fitter.range()
    const score = score_without_komi - R.komi
    const fake_b_wr = 100 * (score - lower) / (upper - lower)
    return clip(flip_maybe(fake_b_wr, bturn), 0, 100)
}

function score_bar_p() {return R.score_bar && R.is_katago}

/////////////////////////////////////////////////
// winrate bar style

function winrate_bar_suggest_prop(s, move_count) {
    // const
    const next_color = '#48f'
    const next_vline_color = 'rgba(64,128,255,0.5)'
    const target_vline_color = 'rgba(255,64,64,0.5)'
    const normal_aura_color = 'rgba(235,148,0,0.8)'
    const target_aura_color = 'rgba(0,192,0,0.8)'
    // main
    const {move} = s, winrate = fake_winrate(s)
    const target = target_move()
    const edge_color = target ? 'rgba(128,128,128,0.5)' : '#888'
    const target_p = (move === target), next_p = is_next_move(move, move_count)
    const alpha = target_p ? 1.0 : target ? 0.3 : 0.8
    const {fill} = suggest_color(s, alpha)
    const fan_color = (!target && next_p) ? next_color : fill
    const vline_color = target_p ? target_vline_color :
          next_p ? next_vline_color : null
    const aura_color = target_p ? target_aura_color : normal_aura_color
    const major = s.visits >= R.max_visits * 0.3 || s.prior >= 0.3 ||
          s.order < 3 || s.winrate_order < 3 || target_p || next_p
    const eliminated = target && !target_p
    const draw_order_p = major && !eliminated
    return {edge_color, fan_color, vline_color, aura_color, alpha,
            target_p, draw_order_p, next_p, winrate}
}

function suggest_color(suggest, alpha) {
    const hue = winrate_color_hue(suggest.winrate, suggest.score_without_komi)
    const alpha_emphasis = emph => {
        const max_alpha = 0.5, visits_ratio = clip(suggest.visits / (R.visits + 1), 0, 1)
        return max_alpha * visits_ratio ** (1 - emph)
    }
    const hsl_e = (h, s, l, emph) => hsla(h, s, l, alpha || alpha_emphasis(emph))
    const stroke = hsl_e(hue, 100, 20, 0.85), fill = hsl_e(hue, 100, 50, 0.4)
    return {stroke, fill}
}

function winrate_color_hue(winrate, score) {
    const cyan_hue = 180, green_hue = 120, yellow_hue = 60, red_hue = 0
    const unit_delta_hue = green_hue - yellow_hue
    const unit_delta_winrate = 5, unit_delta_score = 5
    // winrate gain
    const wr0 = flip_maybe(origin_b_winrate())
    const delta_by_winrate = (winrate - wr0) / unit_delta_winrate
    // score gain
    const s0 = origin_score()
    const delta_by_score_maybe = truep(score) && truep(s0) &&
          (score - s0) * (R.bturn ? 1 : -1) / unit_delta_score
    const delta_by_score = delta_by_score_maybe || delta_by_winrate
    // color for gain
    const delta_hue = (delta_by_winrate + delta_by_score) / 2 * unit_delta_hue
    return to_i(clip(yellow_hue + delta_hue, red_hue, cyan_hue))
}

function origin_b_winrate() {return origin_gen(b_winrate)}
function origin_score() {
    const prev_score = nth_prev => winrate_history_ref('score_without_komi', nth_prev)
    return origin_gen(prev_score)
}
function origin_gen(get_prev) {return [1, 2, 0].map(get_prev).find(truep)}

function winrate_bar_order_set_style(s, fontsize, g) {
    const firstp = (s.order === 0)
    g.fillStyle = firstp ? WINRATE_BAR_FIRST_ORDER_COLOR : WINRATE_BAR_ORDER_COLOR
    return fontsize * (firstp ? 1.5 : 1)
}

/////////////////////////////////////////////////
// zone color

function zone_color(i, j, alpha) {
    if (i < 0 || j < 0) {return TRANSPARENT}
    const mid = (board_size() - 1) / 2
    // right = 0/4, top = 1/4, left = 2/4, bottom = 3/4, right = 4/4
    const direction = (Math.atan2(i - mid, mid - j) / Math.PI + 1) * 0.5
    const height = 1 - Math.max(...[i, j].map(k => Math.abs(k - mid))) / mid
    const h = zone_hue(direction), l = 50 + 50 * height
    return hsla(h, 70, l, alpha)
}

const zone_hue_knot = [
    // These colors looks approximately equidistant for my eyes.
    0, // red
    15,
    30, // orange
    45,
    60, // yellow
    70, //        (very near to yellow)
    120, // green
    160, //        (near to cyan)
    180, // cyan
    200, //        (near to cyan)
    240, // blue
    270, //        (near to purple)
    280, // purple
    290, //        (near to purple)
    320, // pink
    340,
    360, // (red)
]

function zone_hue(direction) {
    // 0 <= direction <= 1
    const epsilon = 1e-8, d = clip((direction + 3/8) % 1, 0, 1 - epsilon)
    // piecewise linear interpolation
    const n = zone_hue_knot.length - 1
    const k = Math.floor(d * n), s = d * n - k
    return (1 - s) * zone_hue_knot[k] + s * zone_hue_knot[k + 1]
}

/////////////////////////////////////////////////
// utils

// stones

function is_next_move(move, move_count) {
    const [i, j] = move2idx(move); if (i < 0) {return false}
    const s = aa_ref(R.stones, i, j) || {}, as = s.anytime_stones || []
    const mc_p = truep(move_count) && move_count !== R.move_count
    return mc_p ? !!as.find(z => z.move_count === move_count + 1) : s.next_move
}

function latest_move(moves, show_until) {
    return latest_move_and_nearest_future_move(moves, show_until)[0]
}
function latest_move_and_nearest_future_move(moves, show_until) {
    if (!moves) {return []}
    const n = moves.findIndex(z => (z.move_count > show_until))
    const nearest_future = moves[n], latest = (n >= 0) ? moves[n - 1] : last(moves)
    return [latest, nearest_future]
}

// handicaps

function clip_init_len(move_count) {return clip(move_count, R.init_len)}
function mc2movenum(move_count) {return clip(move_count - R.init_len, 0)}
function max_movenum() {return mc2movenum(R.history_length)}

// visits & winrate

function b_winrate(nth_prev) {return winrate_history_ref('r', nth_prev)}
function winrate_history_ref(key, nth_prev) {
    const mc = finite_or(move_count_for_suggestion(), R.move_count)
    const [whs, rest] = R.winrate_history_set
    const winrate_history = !truep(nth_prev) ? R.winrate_history :
          (alternative_engine_for_white_p() && !R.bturn) ? whs[1] : whs[0]
    return (winrate_history[mc - (nth_prev || 0)] || {})[key]
}

function winrate_history_values_of(key) {return R.winrate_history.map(h => h[key])}

function alternative_engine_for_white_p() {
    const a = R.winrate_history_set; return a && (a[0].length > 1)
}

//////////////////////////////////

module.exports = {
    movenum: () => mc2movenum(R.move_count), max_movenum, clip_init_len,
    draw_thumbnail_goban,
    draw_raw_goban, draw_main_goban,
    draw_goban_with_principal_variation,
    draw_goban_with_expected_variation,
    draw_goban_with_future_moves,
    draw_goban_with_subboard_stones_suggest,
    draw_goban_with_original_pv,
    draw_endstate_goban,
    draw_winrate_graph, draw_winrate_bar, draw_visits_trail, draw_zone_color_chart,
    draw_endstate_distribution, hide_endstate_distribution,
    get_pv_trail_for,
    update_winrate_trail, clear_canvas, is_next_move, latest_move,
    target_move, set_target_move,
}
