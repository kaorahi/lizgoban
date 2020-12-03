// -*- coding: utf-8 -*-

// state
let the_target_move = null
function target_move() {return the_target_move}
function set_target_move(move) {the_target_move = move}

/////////////////////////////////////////////////
// various gobans

function draw_raw_goban(canvas, options) {
    const u = options.show_until
    truep(u) ? draw_goban_until(canvas, u, options) : draw_goban(canvas, null, options)
}

function draw_main_goban(canvas, options) {
    const opts = {read_only: R.attached, ...options}
    const u = options.show_until, h = options.selected_suggest
    // case I: "variation"
    if (target_move()) {draw_goban_with_variation(canvas, h, opts); return}
    // case II: "suggest" or "until"
    const mapping_to_winrate_bar = h.move && mapping_text(h, opts)
    truep(u) ? draw_goban_until(canvas, u, opts)
        : draw_goban_with_suggest(canvas, {...opts, mapping_to_winrate_bar})
}

function draw_goban_until(canvas, show_until, opts) {
    const all_p = (show_until === Infinity)
    const displayed_stones = stones_until(all_p ? R.move_count : show_until, all_p)
    const serious = in_match_p(true)
    draw_goban(canvas, displayed_stones,
               {draw_last_p: true, draw_next_p: !serious,
                draw_loss_p: !serious && R.show_endstate,
                draw_endstate_diff_p: R.show_endstate && !serious, ...opts,
                cheap_shadow_p: true,
                draw_visits_p: false, draw_coordinates_p: true})
}

function stones_until(show_until, all_p, for_endstate) {
    // fixme: need cleaning (for_endstate)
    const recent_moves = Math.min(3, show_until - R.init_len), thick_moves = 7
    const near_future_moves = 7
    const unnumbered =
          clip_init_len(for_endstate ? Infinity : all_p ? 0 : show_until - recent_moves)
    const highlighted_after = for_endstate ? Infinity :
          all_p ? clip(show_until, 0, R.history_length) - recent_moves : show_until - 1
    const thin_before =  for_endstate ? 0 :
          all_p ? highlighted_after - thick_moves + 1 : 0
    const displayed_stones = copy_stones_for_display()
    each_stone(displayed_stones, (h, idx) => {
        const ss = h.anytime_stones
        const [target, future] = latest_move_and_nearest_future_move(ss, show_until)
        if (target) {
            h.black = target.is_black
            h.last = [show_until, thin_before - 1].includes(target.move_count)
                && show_until > R.init_len
            h.displayed_colors = h.stone ? [BLACK, WHITE] : [MAYBE_BLACK, MAYBE_WHITE]
            h.stone = true
            const m = target.move_count - unnumbered
            const variation_last = (target.move_count > highlighted_after)
            const thin_movenums = (target.move_count < thin_before)
            const movenum_for = k => all_p ? to_s(k) :
                  k === recent_moves ? '1' : 'abcdefghijklmnopqrstuvwxyz'[k - 1]
            // clean me: to_s to avoid highlight of "1"
            m > 0 && merge(h, {movenums: [movenum_for(m)], variation_last,
                               thin_movenums, tag: null})
        } else {
            for_endstate && (h.stone = false)
            const mc = (future || {}).move_count || 0, k = mc - show_until + 1
            const movenums = k > 1 && k <= near_future_moves ? [k] : []
            h.stone && merge(h, {displayed_colors: [PALER_BLACK, PALER_WHITE],
                                 movenums, thin_movenums: true,
                                 last: false, future_stone: true})
        }
        h.displayed_tag = h.tag
        const next_stone = ss && ss.find(z => (z.move_count === show_until + 1))
        h.next_move = !!next_stone; h.next_is_black = (next_stone || {}).is_black
    })
    return displayed_stones
}

function draw_goban_with_suggest(canvas, opts) {
    const displayed_stones = copy_stones_for_display()
    R.suggest.forEach(h => merge_stone_at(h.move, displayed_stones, {suggest: true, data: h}))
    each_stone(displayed_stones, h => {h.displayed_tag = h.tag && h.stone})
    const s0 = R.suggest[0]
    const expected_move = expected_pv()[0]
    expected_move && !empty(R.suggest) && s0.move !== expected_move &&
        set_expected_stone(expected_move, s0.move, displayed_stones)
    draw_goban(canvas, displayed_stones,
               {draw_last_p: true, draw_next_p: true, draw_expected_p: true,
                draw_loss_p: R.show_endstate,
                draw_endstate_p: R.show_endstate, draw_endstate_diff_p: R.show_endstate,
                mapping_tics_p: !opts.main_canvas_p, ...opts})
}

function add_movenum_to_stones(stones, from) {
    each_stone(stones, h => {
        const target = h.stone && latest_move(h.anytime_stones, R.move_count)
        const target_move_count = (target || {}).move_count || 0
        const m = target_move_count - from; if (m <= 0) {return}
        const d = R.move_count - target_move_count
        const movenums = [m], thin_movenums = (d > 10), variation_last = (d === 0)
        const displayed_tag = false
        merge(h, {movenums, thin_movenums, variation_last, displayed_tag})
    })
}

function draw_goban_with_variation(canvas, suggest, opts) {
    const {variation_expected} = opts
    const reliable_moves = 7
    const [variation, expected] = variation_expected || [suggest.pv || [], expected_pv()]
    const pv_visits = !variation_expected && !showing_branch_p() && suggest.pvVisits
    const [v, e] = variation_expected ? [expected, variation] : [variation, expected]
    const mark_unexpected_p =
          (expected[0] === variation[0]) || opts.force_draw_expected_p ||
          suggest === (R.suggest[0] || {})
    const displayed_stones = copy_stones_for_display(opts.stones)
    const bturn = opts.stones ? opts.bturn : R.bturn
    variation.forEach((move, k) => {
        const b = xor(bturn, k % 2 === 1), w = !b
        merge_stone_at(move, displayed_stones, {
            stone: true, black: b, white: w,
            variation: true, movenums: [k + 1],
            variation_last: k === variation.length - 1, is_vague: k >= reliable_moves
        })
    })
    mark_unexpected_p && set_expected_stone_for_variation(e, v, displayed_stones)
    const mapping_to_winrate_bar = mapping_text(suggest, opts)
    draw_goban(canvas, displayed_stones,
               {draw_last_p: true, draw_expected_p: true,
                mapping_to_winrate_bar, pv_visits, ...opts})
}

function draw_goban_with_principal_variation(canvas, options) {
    draw_readonly_goban_with_variation(canvas, R.suggest[0] || {}, options)
}

function draw_goban_with_expected_variation(canvas, options) {
    const title = 'expected variation at the previous move'
    const pv = expected_pv(), expected_variation = (R.suggest[0] || {}).pv
    draw_goban_with_given_variation(canvas, pv, expected_variation, title, options)
}

function draw_goban_with_future_moves(canvas, options) {
    const title = 'succeeding moves', pv_len = 15
    const pv = R.future_moves.slice(0, Math.max(keyboard_moves.length, pv_len))
    draw_goban_with_given_variation(canvas, pv, [], title, options)
}

function draw_goban_with_given_variation(canvas, pv, expected_pv, title, options) {
    const variation_expected = [pv, expected_pv]
    const opts = {...options, variation_expected,
                  draw_visits_p: `  ${title}`, trial_p: 'ref'}
    draw_readonly_goban_with_variation(canvas, {}, opts)
}

function draw_readonly_goban_with_variation(canvas, suggest, options) {
    const opts = {read_only: true, force_draw_expected_p: true,
                  mapping_to_winrate_bar: false, ...options}
    draw_goban_with_variation(canvas, suggest, opts)
}

function draw_goban_with_subboard_stones_suggest(canvas, options) {
    const {stones, suggest, bturn, gain} = R.subboard_stones_suggest
    const draw_visits_p = truep(gain) && gain <= blunder_threshold &&
            `  ${bturn ? 'B' : 'W'} ${f2s(gain, 1)} pts`
    const opts = {stones, bturn, mapping_to_winrate_bar: false, draw_next_p: true,
                  ...options,
                  // draw_visits_p must be later than options
                  draw_visits_p, trial_p: 'ref'}
    draw_goban_with_variation(canvas, suggest, opts)
}

function draw_endstate_goban(canvas, options) {
    const past_p = past_endstate_p(options.draw_endstate_value_p)
    const scores = winrate_history_values_of('score_without_komi')
    const {show_until} = options, mc = R.move_count
    const default_mc = R.move_count - R.endstate_diff_interval
    const past_mc = clip_init_len(finite_or(show_until, default_mc))
    const past_score = scores[past_mc]
    const past_text = (d_i, es) =>
          `  at ${mc2movenum(past_mc)} (${Math.abs(d_i)} move${Math.abs(d_i) > 1 ? 's' : ''} ${d_i > 0 ? 'before' : 'after'})` +
          (truep(es) ? `  score = ${f2s(es - R.komi)}` : '')
    const common = {read_only: true, draw_endstate_p: R.show_endstate,
                    draw_endstate_diff_p: R.show_endstate}
    const current = {draw_visits_p: true, draw_next_p: true}
    const past = {draw_visits_p: past_text(R.move_count - past_mc, past_score)}
    const opts = {...common, ...(options || {}), ...(past_p ? past : current),
                  cheap_shadow_p: true}
    const displayed_stones = past_p ? stones_until(past_mc, false, true) : R.stones
    draw_goban(canvas, displayed_stones, opts)
}

function draw_thumbnail_goban(canvas, stones, trial_p) {
    const opts = {draw_last_p: true, draw_next_p: true, pausing_p: trial_p}
    const displayed_stones = copy_stones_for_display(stones)
    each_stone(displayed_stones, h => h.stone && (h.displayed_tag = h.tag))
    draw_goban(canvas, displayed_stones, opts)
}

/////////////////////////////////////////////////
// generic goban

function draw_goban(canvas, stones, opts) {
    const {draw_last_p, draw_next_p, draw_visits_p, draw_expected_p, first_board_p,
           pausing_p, trial_p,
           draw_loss_p, draw_coordinates_p, cheap_shadow_p,
           draw_endstate_p, draw_endstate_diff_p, draw_endstate_value_p,
           read_only, mapping_tics_p, mapping_to_winrate_bar, pv_visits,
           hovered_move, show_until, main_canvas_p, handle_mouse_on_goban}
          = opts || {}
    const {margin, hm, g, idx2coord, coord2idx, unit} = goban_params(canvas)
    const large_font_p = !main_canvas_p
    const font_unit = Math.min(margin, canvas.height / 20)
    // draw
    draw_board(hm, pausing_p, trial_p, canvas, g)
    draw_grid(unit, idx2coord, g)
    draw_coordinates_p && draw_coordinates(unit, idx2coord, g)
    mapping_tics_p && draw_mapping_tics(unit, canvas, g)
    draw_visits_p && draw_visits(draw_visits_p, font_unit, g)
    first_board_p && draw_progress(!main_canvas_p, margin, canvas, g)
    mapping_to_winrate_bar && !(draw_endstate_value_p && draw_endstate_p) &&
        draw_mapping_text(mapping_to_winrate_bar, font_unit, canvas, g)
    pv_visits && draw_pv_visits(pv_visits, font_unit, idx2coord, g)
    !read_only && hovered_move && draw_cursor(hovered_move, unit, idx2coord, g)
    const drawp = {
        draw_last_p, draw_next_p, draw_expected_p, draw_loss_p, cheap_shadow_p,
        draw_endstate_p, draw_endstate_diff_p, draw_endstate_value_p, large_font_p,
        hovered_move, show_until, pv_visits,
    }
    draw_on_board(stones || R.stones, drawp, unit, idx2coord, g)
    draw_endstate_p && !hide_endstate_clusters_p() &&
        draw_endstate_clusters(draw_endstate_value_p, unit, idx2coord, g)
    // mouse events
    const mouse_handler = handle_mouse_on_goban || do_nothing
    mouse_handler(canvas, coord2idx, read_only)
}

function draw_board(hm, pausing_p, trial_p, canvas, g) {
    const {width, height} = canvas
    const image_p = R.board_image_p && !!(R.image || {}).board
    image_p ? draw_board_by_image(width, height, hm, pausing_p, trial_p, g) :
        draw_board_by_paint(width, height, hm, pausing_p, trial_p, g)
}

function draw_board_by_image(w, h, hm, pausing_p, trial_p, g) {
    g.drawImage(R.image.board, 0, 0, w, h)
    g.strokeStyle = g.fillStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2 * hm
    pausing_p && fill_rect([0, 0], [w, h], g)
    trial_p && rect([0, 0], [w, h], g)  // draw border
}

function draw_board_by_paint(w, h, hm, pausing_p, trial_p, g) {
    g.strokeStyle = BLACK; g.fillStyle = goban_bg(pausing_p, trial_p, true)
    g.lineWidth = 1
    edged_fill_rect([0, 0], [w, h], g)
    g.fillStyle = goban_bg(pausing_p, trial_p)
    fill_rect([hm, hm], [w - hm, h - hm], g)
}

function draw_grid(unit, idx2coord, g) {
    const bsize = board_size()
    g.strokeStyle = BLACK; g.fillStyle = BLACK; g.lineWidth = 1
    seq(bsize).forEach(i => {
        line(idx2coord(i, 0), idx2coord(i, bsize - 1), g)
        line(idx2coord(0, i), idx2coord(bsize - 1, i), g)
    })
    const star_radius = unit * 0.1, ijs = stars[bsize] || []
    ijs.forEach(ij => fill_circle(idx2coord(...ij), star_radius, g))
}

function draw_coordinates(unit, idx2coord, g) {
    const fontsize = unit * 0.4, maxwidth = unit / 2, bsize = board_size()
    const edges = [-0.75, bsize - 0.25]
    const draw = (text, i, j) =>
          fill_text(g, fontsize, text, ...idx2coord(i, j), maxwidth)
    g.save()
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = BLACK
    seq(bsize).forEach(i => {
        const [row, col] = idx2rowcol(i, i)
        edges.forEach(e => {draw(row, i, e); draw(col, e, i)})
    })
    g.restore()
}

function draw_visits(text_maybe, margin, g) {
    if (typeof text_maybe === 'string') {
        draw_visits_text(text_maybe, margin, g); return
    }
    if (!truep(R.visits)) {return}
    const maybe = (z, g) => truep(z) ? g(z >= 1000 ? kilo_str(z) : f2s(z)) : ''
    const bg = truep(R.background_visits) ? `${R.background_visits}/` : ''
    const vps = maybe(R.visits_per_sec, z => `  (${z} v/s)`)
    const score = truep(R.endstate_sum) && !R.in_match && (R.endstate_sum - R.komi)
    const esum = maybe(score, z => `  score = ${z}`)
    const text = `  visits = ${bg}${R.visits}${esum}${vps}`
    draw_visits_text(text, margin, g)
}

function draw_visits_text(text, margin, g) {
    g.save()
    g.fillStyle = MAYBE_BLACK
    g.textAlign = 'left'; g.textBaseline = 'middle'
    fill_text(g, margin / 2, text, 0, margin / 4)
    g.restore()
}

function draw_pv_visits(pv_visits, margin, idx2coord, g) {
    const at = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 40, 50]
    const bsize = board_size(), half = margin / 2, v0 = pv_visits[0]
    const fontsize = half, maxwidth = half, x = g.canvas.width - 1
    g.save()
    g.textAlign = 'right'; g.textBaseline = 'middle'
    let prev_y = - Infinity
    const draw_text = (v, k) => {
        const [_, y] = idx2coord((1 - v / v0) * (bsize - 1), 0)
        const major = y - prev_y > fontsize; prev_y = y
        g.fillStyle = major ? VAGUE_BLACK : PALE_BLACK
        fill_text(g, fontsize, to_s(k), x, y, maxwidth)
    }
    at.slice().forEach(k => draw_text(pv_visits[k - 1], k))
    g.fillStyle = 'rgba(255,0,0,0.3)'; g.textAlign = 'right'; g.textBaseline = 'top'
    fill_text(g, fontsize, kilo_str(v0), x, 1)
    g.restore()
}

function draw_progress(highlightp, margin, canvas, g) {
    if (R.progress < 0) {return}
    g.fillStyle = highlightp ? GREEN : R.bturn ? BLACK : WHITE
    fill_rect([0, canvas.height - margin / 10],
              [canvas.width * R.progress, canvas.height], g)
}

function draw_cursor(hovered_move, unit, idx2coord, g) {
    const [i, j] = move2idx(hovered_move); if (i < 0) {return}
    const xy = idx2coord(i, j)
    g.fillStyle = R.bturn ? PALE_BLACK : PALE_WHITE
    fill_circle(xy, unit / 4, g)
}

function draw_on_board(stones, drawp, unit, idx2coord, g) {
    const {draw_last_p, draw_next_p, draw_expected_p, draw_loss_p, cheap_shadow_p,
           draw_endstate_p, draw_endstate_diff_p, draw_endstate_value_p,
           large_font_p, hovered_move, show_until, pv_visits}
          = drawp
    const stone_radius = unit * 0.5
    const draw_exp = (move, exp_p, h, xy) => draw_expected_p && move &&
          draw_expected_mark(h, xy, exp_p, stone_radius, g)
    const each_coord =
          proc => each_stone(stones, (h, idx) => proc(h, idx2coord(...idx), idx))
    if (draw_endstate_value_p && draw_endstate_p) {
        const past_p = past_endstate_p(draw_endstate_value_p)
        draw_endstate_stones(each_coord, past_p, cheap_shadow_p, show_until,
                             stone_radius, g)
        return
    }
    // (1) ownership, (2) halo, (3) shadow, (4) stone etc. in this order
    draw_endstate_p && !hide_endstate_p() &&
        each_coord((h, xy, idx) => draw_endstate(h.endstate, xy, stone_radius, g))
    R.lizzie_style && !R.busy &&
        each_coord((h, xy, idx) => draw_halo_lizzie(h, xy, stone_radius, g))
    each_coord((h, xy, idx) => draw_shadow_maybe(h, xy, stone_radius, cheap_shadow_p, g))
    each_coord((h, xy, idx) => {
        h.stone &&
            draw_stone(h, xy, stone_radius, draw_last_p, draw_loss_p, pv_visits, g)
        if (R.busy) {return}
        h.suggest && draw_suggest(h, xy, stone_radius, large_font_p, g)
        draw_next_p && h.next_move && draw_next_move(h, xy, stone_radius, g)
        draw_next_p && h.branches && draw_branches(h, xy, stone_radius, g)
        draw_expected_p && (draw_exp(h.expected_move, true, h, xy),
                            draw_exp(h.unexpected_move, false, h, xy))
        R.lizzie_style && h.suggest && draw_suggest_lizzie(h, xy, stone_radius, g)
        h.displayed_tag && draw_tag(h.tag, xy, stone_radius, g)
        draw_endstate_diff_p && !hide_endstate_p() &&
            draw_endstate_diff(h.endstate_diff, xy, stone_radius, g)
    })
    !R.lizzie_style && !R.busy &&
        each_coord((h, xy) => h.suggest && (h.data.visits > 0)
                   && draw_winrate_mapping_line(h, xy, unit, g))
}

function draw_endstate_stones(each_coord, past_p, cheap_shadow_p,
                              show_until, stone_radius, g) {
    if (past_p && !R.prev_endstate_clusters) {return}
    const d = finitep(show_until) ?
          (R.move_count - show_until) : R.endstate_diff_interval
    const sign = Math.sign(d)
    each_coord((h, xy, idx) => draw_shadow_maybe(h, xy, stone_radius, cheap_shadow_p, g))
    each_coord((h, xy, idx) => {
        const stone_p = h.stone
        past_p && draw_endstate(h.endstate_diff, xy, stone_radius, g)
        stone_p && draw_stone(h, xy, stone_radius, true, false, null, g)
        past_p && h.next_move && draw_next_move(h, xy, stone_radius, g)
        draw_endstate_value(h, past_p, sign, xy, stone_radius, g)
    })
}

function goban_bg(pausing_p, trial_p, border) {
    const key = (trial_p === 'ref') ? 'r' :
          ((pausing_p ? 'p' : '') + (trial_p && border ? 't' : ''))
    return GOBAN_BG_COLOR[key]
}

function draw_endstate_clusters(boundary_p, unit, idx2coord, g) {
    const style = boundary_p ?
          {black: 'rgba(0,255,255,0.5)', white: 'rgba(255,0,0,0.5)'} :
          {black: 'rgba(0,255,0,0.2)', white: 'rgba(255,0,255,0.2)'}
    const size = {major: 3, minor: 2}
    const past_p = past_endstate_p(boundary_p)
    const cs = (past_p ? R.prev_endstate_clusters : R.endstate_clusters) || []
    const area_sum = sum(cs.map(cluster => {
        const {color, type, ownership_sum, selfstone_sum, center_idx} = cluster
        const signed_area_count = Math.round(ownership_sum - selfstone_sum)
        const area_count = Math.sign(ownership_sum) * signed_area_count
        if (area_count < 1) {return 0}
        boundary_p && draw_endstate_boundary(cluster, unit, idx2coord, g)
        const text = to_s(area_count), xy = idx2coord(...center_idx)
        g.save()
        g.textAlign = 'center'; g.textBaseline = 'middle'
        g.fillStyle = style[color]; fill_text(g, size[type] * unit, text, ...xy)
        g.restore()
        return signed_area_count
    }))
    const es = past_p ? R.prev_endstate_sum : R.endstate_sum
    const compensation = truep(es) ? Math.round(es - area_sum) : 0
    const cmp_text = compensation === 0 ? '' : `+${to_s(Math.abs(compensation))}`
    g.save()
    g.textAlign = 'right'; g.textBaseline = 'top'
    g.fillStyle = style[compensation > 0 ? 'black' : 'white']
    fill_text(g, size['minor'] * unit, cmp_text, ...idx2coord(-1.3, board_size()))
    g.restore()
}

function draw_endstate_boundary(cluster, unit, idx2coord, g) {
    const style = {black: '#080', white: '#c4c'}
    cluster.boundary.forEach(([ij, direction]) => {
        const width = unit * 0.1, r = unit / 2
        const [di, dj] = around_idx_diff[direction]
        const [qi, qj] = [Math.abs(dj), Math.abs(di)]
        const mul = (a, coef) => a.map(z => z * coef)
        // See coord.js for the relation between [i][j] and (x, y).
        const [dx, dy] = mul([dj, di], r - width / 2), [qx, qy] = mul([qj, qi], r)
        const [x0, y0] = idx2coord(...ij), [x, y] = [x0 + dx, y0 + dy]
        g.strokeStyle = style[cluster.color]; g.lineWidth = width
        line([x - qx, y - qy], [x + qx, y + qy], g)
    })
}

function past_endstate_p(flag) {return flag === 'past'}

/////////////////////////////////////////////////
// on goban grids

// stone

function draw_stone(h, xy, radius, draw_last_p, draw_loss_p, pv_visits, g) {
    const {b_color, w_color, stone_image, style} = stone_style_for(h)
    const hide_loss_p = h.suggest || h.future_stone
    const draw_stone_by_image = () => draw_square_image(stone_image, xy, radius, g)
    const draw_stone_by_gradation = () => {
        const [x, y] = xy, d = radius * 0.5
        g.fillStyle = h.black ?
            skew_radial_gradation(x - d, y - d, 0, x, y, radius, '#444', '#000', g) :
            skew_radial_gradation(x - d, y - d, 0, x, y, radius, '#eee', '#ccc', g)
        fill_circle(xy, radius, g)
    }
    const draw_stone_by_paint = () => {
        g.lineWidth = 1; g.strokeStyle = b_color
        g.fillStyle = h.black ? b_color : w_color
        edged_fill_circle(xy, radius, g)
    }
    stone_image ? draw_stone_by_image() :
        style === '3D' ? draw_stone_by_gradation() : draw_stone_by_paint()
    draw_loss_p && !hide_loss_p && draw_loss(h, xy, radius, g)
    draw_last_p && h.last && h.move_count > R.init_len &&
        draw_last_move(h, xy, radius, g)
    h.movenums && draw_movenums(h, xy, radius, pv_visits, g)
}

function stone_style_for(h) {
    const [b_color, w_color] = h.displayed_colors ||
          (h.maybe ? [MAYBE_BLACK, MAYBE_WHITE] :
           h.maybe_empty ? [PALE_BLACK, PALE_WHITE] :
           h.is_vague ? [VAGUE_BLACK, VAGUE_WHITE] :
           [BLACK, WHITE])
    const normal_stone_p = (b_color === BLACK)
    const stone_image = normal_stone_p && ((stone_image_p() && stone_image_for(h)) ||
                                           (face_image_p() && face_image_for(h)))
    const style = normal_stone_p && R.stone_style
    return {b_color, w_color, stone_image, style}
}

function stone_image_p() {
    const im = R.image
    return R.stone_image_p && im && (im.black_stone || im.white_stone)
}
function face_image_p() {
    return !stone_image_p() && R.face_image_rule && (R.stone_style === 'Face')
}

function stone_image_for(h) {return stone_image_for_key(h, 'black_stone', 'white_stone')}
function face_image_for(h) {
    if (h.movenums) {return null}
    const {endstate, black} = h, es = (black ? 1 : -1) * (endstate || 0)
    // const wr = ((R.winrate_history[R.move_count] || {}).r || 50) / 50 - 1
    // const es = (black ? 1 : -1) * true_or(endstate, wr)
    const [_, b, w] = R.face_image_rule.find(([threshold, _b, _w]) => es < threshold)
          || last(R.face_image_rule)
    return stone_image_for_key(h, b, w)
}
function stone_image_for_key(h, b_key, w_key) {return R.image[h.black ? b_key : w_key]}

function draw_movenums(h, xy, radius, pv_visits, g) {
    const movenums = num_sort(h.movenums), mn0 = movenums[0], mc = mn0 - 1
    const bw = h.thin_movenums ? ['rgba(0,0,0,0.2)', 'rgba(255,255,255,0.3)'] :
          h.is_vague ? [MAYBE_BLACK, MAYBE_WHITE] : [BLACK, WHITE]
    // clean me: Don't use GREEN when mn0 is the string '1'. (see stones_until())
    const color = (mn0 === 1) ? GREEN : h.variation_last ? RED : bw[h.black ? 1 : 0]
    const [pv0, pv] = (pv_visits && mc) ? pv_visits.slice(mc - 1, mc + 1) : []
    const inevitability = true_or(pv0 && pv && (pv / pv0), 1), min_rad_coef = 0.3
    const rad_coef = clip(Math.sqrt(inevitability), min_rad_coef)
    draw_text_on_stone(movenums.join(','), color, xy, radius * rad_coef, g)
}

function draw_tag(tag, xy, radius, g) {draw_text_on_stone(tag, BLUE, xy, radius, g)}

function draw_text_on_stone(text, color, xy, radius, g) {
    const l = text.length, [x, y] = xy, max_width = radius * 1.5
    const fontsize = to_i(radius * (l < 3 ? 1.8 : l < 6 ? 1.2 : 0.9))
    g.save()
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillStyle = color; fill_text(g, fontsize, text, x, y, max_width)
    g.restore()
}

function draw_last_move(h, xy, radius, g) {
    const facep = face_image_p() && !h.movenums
    const bturn = xor(h.black, facep), size = facep ? 1 : 0.8
    g.strokeStyle = bturn ? WHITE : BLACK; g.lineWidth = 2
    circle(xy, radius * size, g)
}

const next_move_line_width = 3, branch_line_width = next_move_line_width
function draw_next_move(h, xy, radius, g) {
    g.strokeStyle = h.next_is_black ? BLACK : WHITE
    g.lineWidth = next_move_line_width; circle(xy, radius, g)
}
function draw_branches(h, xy, radius, g) {
    const branch_tag_color = 'rgba(0,0,255,0.3)'
    const tag = h.branches.map(z => z.tag).sort().join('')
    const draw1 = ({is_black, past_p}) => {
        const [shape, thick, dash] = past_p ?
              [triangle_around, 1, [radius / 5]] :
              [square_around, branch_line_width, [radius / 10]]
        g.strokeStyle = is_black ? BLACK : WHITE
        g.lineWidth = thick; g.setLineDash(dash)
        shape(xy, radius, g)
    }
    g.save()
    h.branches.forEach(draw1)
    draw_text_on_stone(tag, branch_tag_color, xy, radius, g)
    g.restore()
}

// ref. https://github.com/featurecat/lizzie/issues/671#issuecomment-586090067
function draw_loss(h, xy, radius, g) {
    const {gain, punished} = h, NOTHING = []
    const [color, size, draw, min_width] = !truep(gain) ? NOTHING :
          (gain <= big_blunder_threshold) ? [RED, 1, rev_triangle_around, 0.7] :
          (gain <= blunder_threshold) ? [BLUE, 0.7, rev_triangle_around, 0.5] :
          // annoying in auto_analysis with visits = 1
          // (gain >= 5) ? ['#0c0', 1, 1, triangle_around] :
          NOTHING
    if (!draw || face_image_p()) {return}
    const line_width = truep(punished) ? clip(punished * 0.2, min_width, 3) : 1
    g.strokeStyle = color; g.lineWidth = line_width
    draw(xy, radius * size - line_width, g)
}

function draw_shadow_maybe(h, xy, radius, cheap_shadow_p, g) {
    if (!h.stone) {return}
    const {stone_image, style} = stone_style_for(h)
    const shadow_p = stone_image || (style && style !== '2D')
    if (!shadow_p) {return}
    cheap_shadow_p ? draw_cheap_shadow(xy, radius, g) :
        draw_gorgeous_shadow(xy, radius, g)
}

function draw_gorgeous_shadow([x, y], radius, g) {
    const f = (mag, alpha, shift_p) => {
        const dr = radius * mag, r_in = radius - dr, r_out = radius + dr
        const color = `rgba(0,0,0,${alpha})`
        const [cx, cy] = shift_p ? [x + dr, y + dr] : [x, y]
        g.fillStyle = radial_gradation(cx, cy, r_in, r_out, color, TRANSPARENT, g)
        fill_circle([cx, cy], r_out, g)
    }
    f(0.3, 0.2, false); f(0.15, 0.2, true)
}

function draw_cheap_shadow([x, y], radius, g) {
    g.strokeStyle = 'rgba(0,0,0,0.1)'; g.lineWidth = radius * 0.2
    circle([x, y], radius, g)
}

// suggestions

// suggest_as_stone = {suggest: true, data: suggestion_data}
// See "suggestion reader" section in engine.js for suggestion_data.

function draw_suggest(h, xy, radius, large_font_p, g) {
    if (h.data.visits === 0) {draw_suggest_0visits(h, xy, radius, g); return}
    if (minor_suggest_p(h)) {draw_minor_suggest(h, xy, radius, g); return}
    const suggest = h.data, {stroke, fill} = suggest_color(suggest)
    g.lineWidth = 1; g.strokeStyle = stroke; g.fillStyle = fill
    edged_fill_circle(xy, radius, g)
    !R.lizzie_style && draw_suggestion_order(h, xy, radius, stroke, large_font_p, g)
}

function draw_suggest_lizzie(h, xy, radius, g) {
    const suggest = h.data; if (suggest.visits === 0 || minor_suggest_p(h)) {return}
    const lizzie_text_color = 'rgba(0,0,0,0.7)'
    const [x, y] = xy, max_width = radius * 1.8, champ_color = RED
    const fontsize = to_i(radius * 0.8), half = fontsize / 2
    const y_upper = y - half, y_lower = y + half
    const [winrate_text, visits_text] = suggest_texts(suggest)
    const score_text = score_bar_p() && f2s(suggest.score_without_komi - R.komi)
    const orig_p = orig_suggest_p(suggest)
    orig_p && draw_suggestion_order_lizzie(h, xy, radius, g)
    g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillStyle = suggest.winrate_order === 0 ? champ_color : lizzie_text_color
    fill_text(g, fontsize, score_text || winrate_text, x, y_upper, max_width)
    g.fillStyle = suggest.order === 0 ? champ_color : lizzie_text_color
    orig_p && fill_text(g, fontsize, visits_text, x, y_lower, max_width)
    g.restore()
}

function minor_suggest_p(h) {return minor_suggest_p_gen(h, 20)}
function too_minor_suggest_p(h) {return minor_suggest_p_gen(h, 50)}
function minor_suggest_p_gen(h, order) {return h.data.order >= order && !h.next_move}

function draw_halo_lizzie(h, xy, stone_radius, g) {
    const suggest = h.data || {}; if (suggest.order !== 0) {return}
    const width = next_move_line_width * 1.5
    const radius = stone_radius + width / 2
    g.strokeStyle = '#0f0'; g.lineWidth = width; circle(xy, radius, g)
}

function draw_minor_suggest(h, xy, radius, g) {
    if (too_minor_suggest_p(h)) {return}
    g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,0.2)'
    triangle_around(xy, radius * 0.5, g)
}

function draw_suggest_0visits(h, xy, radius, g) {
    const limit_order = 4, size = (1 + log10(h.data.prior) / limit_order)
    if (size <= 0) {return}
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,0,0,0.2)'
    circle(xy, radius * size, g)
}

function draw_suggestion_order(h, xy, radius, color, large_font_p, g) {
    draw_suggestion_order_gen(false, h, xy, radius, color, large_font_p, g)
}
function draw_suggestion_order_lizzie(h, xy, radius, g) {
    draw_suggestion_order_gen(true, h, xy, radius, null, false, g)
}
function draw_suggestion_order_gen(lizzie, h, [x, y], radius, color, large_font_p, g) {
    if (h.data.order >= 9) {return}
    const both_champ = (h.data.order + h.data.winrate_order === 0)
    const either_champ = (h.data.order * h.data.winrate_order === 0)
    const huge = [2, -1], large = [1.5, -0.5], normal = [1, -0.1], small = [0.8, 0.3]
    const font_modifier = large_font_p && both_champ && 'bold '
    const either = (champ, other) => both_champ ? champ : other
    const [fontsize, d] = (lizzie ? small : large_font_p ? huge : either(large, normal))
          .map(c => c * radius)
    const w = fontsize, x0 = x + d + w / 2, y0 = y - d - w / 2
    g.save()
    g.fillStyle = BLUE
    lizzie && fill_rect([x + d, y - d - w], [x + d + w, y - d], g)
    g.fillStyle = lizzie ? WHITE : either_champ ? RED : color
    g.textAlign = 'center'; g.textBaseline = 'middle'
    fill_text_with_modifier(g, font_modifier, fontsize, h.data.order + 1, x0, y0, w)
    g.restore()
}

// misc

function draw_expected_mark(h, [x, y], expected_p, radius, g) {
    const x1 = x - radius, y1 = y + radius, d = radius / 2
    g.fillStyle = xor(R.bturn, expected_p) ? BLACK : WHITE  // whose plan?
    fill_line([x1, y1 - d], [x1, y1], [x1 + d, y1], g)
    g.strokeStyle = expected_p ? EXPECTED_COLOR : UNEXPECTED_COLOR; g.lineWidth = 2
    square_around([x, y], radius, g)
}

function draw_endstate(endstate, xy, radius, g) {
    if (!truep(endstate)) {return}
    const c = (endstate >= 0) ? 64 : 255, alpha = Math.abs(endstate) * 0.7
    g.fillStyle = `rgba(${c},${c},${c},${alpha})`
    fill_square_around(xy, radius, g)
}

function draw_endstate_value(h, past_p, sign, xy, radius, g) {
    const quantized = false, ten = '10', max_width = radius * 1.5
    const {endstate, endstate_diff} = h
    if (!truep(endstate) || (past_p && !truep(endstate_diff))) {return}
    const e = endstate - (past_p ? endstate_diff * sign : 0)
    const a = Math.abs(e), v = Math.round(a * 10)
    const c = quantized ? ((v > 6) ? 2 : (v > 3) ? 1 : 0.5) : Math.sqrt(a) * 2
    g.save()
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillStyle = (e >= 0) ? '#080' : '#f0f'
    fill_text(g, radius * c, v === 10 ? ten : to_s(v), ...xy, max_width)
    g.restore()
}

function draw_endstate_diff(diff, xy, radius, g) {
    if (!diff || face_image_p()) {return}
    const size = 0.2, [c, r, f, thicker] = diff > 0 ?
          ['#080', 1, square_around, 1.5] : ['#f0f', 1, x_shape_around, 1]
    const thick = (R.endstate_diff_interval > 5 ? 1.5 : 3) * thicker
    g.lineWidth = Math.abs(diff * thick); g.strokeStyle = c; f(xy, radius * size * r, g)
}

/////////////////////////////////////////////////
// mapping from goban to winrate bar

function draw_winrate_mapping_line(h, xy, unit, g) {
    if (minor_suggest_p(h)) {return}
    const b_winrate = flip_maybe(fake_winrate(h.data))
    const order = h.next_move ? 0 : Math.min(h.data.order, h.data.winrate_order)
    g.lineWidth = 1.5 / (order * 2 + 1)
    g.strokeStyle = RED
    line(xy, ...mapping_line_coords(b_winrate, unit, g.canvas), g)
}

function draw_mapping_text(mapping_to_winrate_bar, margin, canvas, g) {
    const {text, subtext, at} = mapping_to_winrate_bar
    const y = canvas.height - margin / 6, fontsize = margin / 2
    // main text
    g.fillStyle = RED
    g.textAlign = at < 10 ? 'left' : at < 90 ? 'center' : 'right'
    fill_text(g, fontsize, text, canvas.width * at / 100, y)
    // subtext
    const [sub_at, sub_align] = at > 50 ? [0, 'left'] : [100, 'right']
    g.fillStyle = 'rgba(255,0,0,0.5)'; g.textAlign = sub_align
    fill_text(g, fontsize, subtext, canvas.width * sub_at / 100, y)
}

function draw_mapping_tics(unit, canvas, g) {
    // mini winrate bar
    const boundary = b_winrate()
    const draw = (c, l, r) => {g.fillStyle = c; fill_rect(l, r, g)}
    if (truep(boundary)) {
        const [[b0, b1], [m0, m1], [w0, w1]] =
              [0, boundary, 100].map(wr => mapping_line_coords(wr, unit, canvas))
        draw(...(R.bturn ? [BLACK, b0, m1] : [WHITE, m0, w1]))
    }
    // tics
    seq(9, 1).forEach(k => {
        const r = k * 10
        g.strokeStyle = (R.bturn && r < boundary) ? WHITE : BLACK
        g.lineWidth = (r === 50 ? 3 : 1)
        line(...mapping_line_coords(r, unit, canvas), g)
    })
}

function mapping_text(suggest) {
    const [winrate_text, visits_text, prior_text, score_text, score_stdev_text]
          = suggest_texts(suggest) || []
    const v = visits_text ? ` (${visits_text})` : ''
    const text = winrate_text && `${winrate_text}${v}`
    const pr = prior_text ? ` prior = ${prior_text} ` : ''
    const dev = score_stdev_text ? `(±${score_stdev_text})` : ''
    const sc = score_text ? ` score = ${score_text}${dev} ` : ''
    const subtext = text && (pr + sc)
    const at = flip_maybe(fake_winrate(suggest))
    return text && {text, subtext, at}
}

function mapping_line_coords(b_winrate, unit, canvas) {
    const x1 = canvas.width * b_winrate / 100, y1 = canvas.height, d = unit * 0.3
    return [[x1, y1 - d], [x1, y1]]
}

/////////////////////////////////////////////////
// zone color chart

function draw_zone_color_chart(canvas) {
    const {g, idx2coord, half_unit} = goban_params(canvas)
    clear_canvas(canvas, TRANSPARENT, g)
    seq(board_size()).forEach(i => seq(board_size()).forEach(j => {
        const xy = idx2coord(i, j)
        g.fillStyle = zone_color(i, j); fill_square_around(xy, half_unit, g)
    }))
}

/////////////////////////////////////////////////
// utils

// goban

function goban_params(canvas) {
    const w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    const margin = Math.min(w, h) / (board_size() + 1), hm = margin / 2
    const [idx2coord, coord2idx] = idx2coord_translator_pair(canvas, margin, margin, true)
    const unit = idx2coord(0, 1)[0] - idx2coord(0, 0)[0], half_unit = unit / 2
    return {w, h, g, margin, hm, idx2coord, coord2idx, unit, half_unit}
}

// stones

function copy_stones_for_display(stones) {
    return (stones || R.stones).map(row => row.map(s => merge({}, s)))
}

function each_stone(stones, proc) {
    stones.forEach((row, i) => row.forEach((h, j) => proc(h, [i, j])))
}

function merge_stone_at(move, stone_array, stone) {
    const get_movenums = s => s.movenums || []
    const ary_or_undef = a => empty(a) ? undefined : a
    const merge_stone = (stone0, stone1) => stone0 &&
        merge(stone0, stone1,
              {movenums: ary_or_undef([stone0, stone1].flatMap(get_movenums))})
    // do nothing if move is pass
    const [i, j] = move2idx(move)
    i >= 0 && merge_stone(aa_ref(stone_array, i, j), stone)
}

// visits & winrate

function suggest_texts(suggest) {
    const conv = (key, digits, offset) => f2s(suggest[key] + (offset || 0), digits)
    const conv_maybe = (key, digits, offset) => truep(suggest[key]) && conv(key, digits, offset)
    const score = conv('score_without_komi', 2, - R.komi)
    const score_stdev = conv_maybe('scoreStdev', 2), prior = conv_maybe('prior', 3)
    // need ' ' because '' is falsy
    return suggest.visits === 0 ? [' ', '', prior] :
        ['' + to_i(suggest.winrate) + '%', kilo_str(suggest.visits), prior,
         score, score_stdev]
}

// previously expected move

function expected_pv() {return ((R.previous_suggest || {}).pv || []).slice(1)}

function set_expected_stone_for_variation(expected, variation, displayed_stones) {
    const with_turn = (s, z) => s ? (s + to_s(z % 2)) : ''
    const head = (a, k) => a.slice(0, k + 1).map(with_turn).sort().join()
    const eq_until = (_, k) => head(expected, k) === head(variation, k) ? k : -1
    const last_eq = Math.max(...variation.map(eq_until)), first_diff = last_eq + 1
    const expected_move = expected[first_diff], unexpected_move = variation[first_diff]
    expected_move && unexpected_move &&
        set_expected_stone(expected_move, unexpected_move, displayed_stones)
}

function set_expected_stone(expected_move, unexpected_move, displayed_stones) {
    merge_stone_at(expected_move, displayed_stones, {expected_move: true})
    merge_stone_at(unexpected_move, displayed_stones, {unexpected_move: true})
}

// endstate

function hide_endstate_p() {return R.long_busy || !R.is_endstate_drawable}
function hide_endstate_clusters_p() {return R.busy || !R.is_endstate_drawable}

/////////////////////////////////////////////////
// exports

module.exports = {
    draw_raw_goban,
    draw_main_goban,
    draw_goban_with_principal_variation,
    draw_goban_with_expected_variation,
    draw_goban_with_future_moves,
    draw_goban_with_subboard_stones_suggest,
    draw_endstate_goban,
    draw_thumbnail_goban,
    draw_zone_color_chart,
    target_move, set_target_move,
}
