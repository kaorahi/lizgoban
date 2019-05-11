/////////////////////////////////////////////////
// setup

require('./util.js').use(); require('./coord.js').use()

// color constant
const BLACK = "#000", WHITE = "#fff"
const GRAY = "#ccc", DARK_GRAY = "#444"
const RED = "#f00", GREEN = "#0c0", BLUE = "#88f", YELLOW = "#ff0"
const ORANGE = "#fc8d49"
const DARK_YELLOW = "#c9a700", TRANSPARENT = "rgba(0,0,0,0)"
const MAYBE_BLACK = "rgba(0,0,0,0.5)", MAYBE_WHITE = "rgba(255,255,255,0.5)"
const VAGUE_BLACK = 'rgba(0,0,0,0.3)', VAGUE_WHITE = 'rgba(255,255,255,0.3)'
const PALE_BLUE = "rgba(128,128,255,0.5)"
const PALE_BLACK = "rgba(0,0,0,0.1)", PALE_WHITE = "rgba(255,255,255,0.3)"
const PALE_RED = "rgba(255,0,0,0.1)", PALE_GREEN = "rgba(0,255,0,0.1)"
const WINRATE_TRAIL_COLOR = 'rgba(160,160,160,0.8)'
const WINRATE_BAR_ORDER_COLOR = '#d00', WINRATE_BAR_FIRST_ORDER_COLOR = '#0a0'
const EXPECTED_COLOR = 'rgba(0,0,255,0.3)', UNEXPECTED_COLOR = 'rgba(255,0,0,0.8)'
// p: pausing, t: trial
const GOBAN_BG_COLOR = {"": "#f9ca91", p: "#a38360", t: "#f7e3cd", pt: "#a09588"}

// state
let R = {}, target_move = null, first_board_canvas = null
function set_state(given_R) {R = given_R}  // fixme: ugly

/////////////////////////////////////////////////
// various gobans

function draw_main_goban(canvas, options) {
    const opts = {draw_visits_p: true, read_only: R.attached, ...options}
    const u = options.show_until, h = options.selected_suggest
    target_move = !u && (h.visits > 0) && h.move
    // case I: "variation"
    if (target_move) {draw_goban_with_variation(canvas, h, opts); return}
    // case II: "suggest" or "until"
    const [i, j] = h.move ? move2idx(h.move) : [-1, -1]
    const s = (i >= 0 && R.stones[i] && R.stones[i][j]) || {}
    const show_until = u ||
          (s.stone && s.tag && (s.move_count !== R.move_count) && s.move_count)
    const mapping_to_winrate_bar = h.move && mapping_text(h, opts)
    show_until ? draw_goban_until(canvas, show_until, opts)
        : draw_goban_with_suggest(canvas, {...opts, mapping_to_winrate_bar})
}

function draw_goban_until(canvas, show_until, opts) {
    const displayed_stones = copy_stones_for_display()
    const latest_move = ss => {
        const n = ss.findIndex(z => (z.move_count > show_until))
        return n >= 0 ? ss[n - 1] : last(ss)
    }
    each_stone(displayed_stones, (h, idx) => {
        const ss = h.anytime_stones, target = ss && latest_move(ss)
        if (target) {
            h.black = target.is_black; h.last = (target.move_count === show_until)
            h.displayed_colors =
                h.last ? [BLACK, WHITE] :
                h.stone ? [MAYBE_BLACK, MAYBE_WHITE] : [PALE_BLACK, PALE_WHITE]
        }
        h.stone = !!target; h.displayed_tag = h.tag
    })
    draw_goban(canvas, displayed_stones, {draw_last_p: true, ...opts})
}

function draw_goban_with_suggest(canvas, opts) {
    const displayed_stones = copy_stones_for_display()
    R.suggest.forEach(h => merge_stone_at(h.move, displayed_stones, {suggest: true, data: h}))
    each_stone(displayed_stones, (h, idx) => (h.displayed_tag = h.tag && h.stone))
    const s0 = R.suggest[0]
    const expected_move = expected_pv()[0]
    expected_move && !empty(R.suggest) && s0.move !== expected_move &&
        set_expected_stone(expected_move, s0.move, displayed_stones)
    draw_goban(canvas, displayed_stones,
               {draw_last_p: true, draw_next_p: true, draw_expected_p: true,
                draw_endstate_p: R.show_endstate, tag_clickable_p: true,
                mapping_tics_p: !opts.main_canvas_p, ...opts})
}

function draw_goban_with_variation(canvas, suggest, opts) {
    const reliable_moves = 7
    const variation = suggest.pv || []
    const expected = expected_pv()
    let mark_unexpected_p = (expected[0] === variation[0]) || opts.force_draw_expected_p
    const displayed_stones = copy_stones_for_display()
    variation.forEach((move, k) => {
        const b = xor(R.bturn, k % 2 === 1), w = !b, expected_move = expected[k]
        merge_stone_at(move, displayed_stones, {
            stone: true, black: b, white: w,
            variation: true, movenums: [k + 1],
            variation_last: k === variation.length - 1, is_vague: k >= reliable_moves
        })
        if (mark_unexpected_p && expected_move && expected_move !== move) {
            set_expected_stone(expected[k], move, displayed_stones)
            mark_unexpected_p = false
        }
    })
    const mapping_to_winrate_bar = mapping_text(suggest, opts)
    draw_goban(canvas, displayed_stones,
               {draw_last_p: true, draw_expected_p: true,
                mapping_to_winrate_bar, ...opts})
}

function draw_goban_with_principal_variation(canvas, options) {
    const opts = {read_only: true, force_draw_expected_p: true,
                  mapping_to_winrate_bar: false, ...options}
    draw_goban_with_variation(canvas, R.suggest[0] || {}, opts)
}

/////////////////////////////////////////////////
// generic goban

function draw_goban(canvas, stones, opts) {
    const {draw_last_p, draw_next_p, draw_visits_p, draw_expected_p, draw_endstate_p,
           tag_clickable_p, read_only, mapping_tics_p, mapping_to_winrate_bar}
          = opts || {}
    const large_font_p = !opts.main_canvas_p
    const margin = canvas.height * 0.05, hm = margin / 2
    const g = canvas.getContext("2d")
    const [idx2coord, coord2idx] = idx2coord_translator_pair(canvas, margin, margin, true)
    const unit = idx2coord(0, 1)[0] - idx2coord(0, 0)[0]
    const hovered_move = canvas.lizgoban_hovered_move
    // call proc if first_board_canvas is not set yet
    const if_first_board = proc => (first_board_canvas || proc())
    const draw_progress_and_memorize_canvas = () => {
        draw_progress(!opts.main_canvas_p, margin, canvas, g)
        first_board_canvas = canvas
    }
    // clear
    g.strokeStyle = BLACK; g.fillStyle = goban_bg(true); g.lineWidth = 1
    edged_fill_rect([0, 0], [canvas.width, canvas.height], g)
    g.fillStyle = goban_bg()
    fill_rect([hm, hm], [canvas.width - hm, canvas.height - hm], g)
    // draw
    draw_grid(unit, idx2coord, g)
    mapping_tics_p && draw_mapping_tics(unit, canvas, g)
    draw_visits_p && draw_visits(margin, canvas, g)
    if_first_board(draw_progress_and_memorize_canvas)
    mapping_to_winrate_bar &&
        draw_mapping_text(mapping_to_winrate_bar, margin, canvas, g)
    !read_only && hovered_move && draw_cursor(hovered_move, unit, idx2coord, g)
    const drawp = {
        draw_last_p, draw_next_p, draw_expected_p, draw_endstate_p, large_font_p,
        draw_recent_p: draw_last_p && draw_endstate_p, tag_clickable_p,
    }
    draw_on_board(stones || R.stones, drawp, unit, idx2coord, g)
    // mouse events
    canvas.onmousedown = e =>
        (!read_only && !R.attached &&
         (opts.play_here(e, coord2idx, opts.tag_clickable_p), opts.hover_off(canvas)))
    canvas.onmousemove = e => opts.hover_here(e, coord2idx, canvas)
    canvas.onmouseleave = e => opts.hover_off(canvas)
}

function draw_grid(unit, idx2coord, g) {
    g.strokeStyle = BLACK; g.fillStyle = BLACK; g.lineWidth = 1
    seq(board_size).forEach(i => {
        line(idx2coord(i, 0), idx2coord(i, board_size - 1), g)
        line(idx2coord(0, i), idx2coord(board_size - 1, i), g)
    })
    const star_radius = unit * 0.1, stars = [3, 9, 15]
    stars.forEach(i => stars.forEach(j => fill_circle(idx2coord(i, j), star_radius, g)))
}

function draw_visits(margin, canvas, g) {
    if (!truep(R.visits)) {return}
    draw_visits_text(margin, canvas, g)
}

function draw_visits_text(margin, canvas, g) {
    const format = z => Math.round(z * 10) / 10
    const esum = truep(R.endstate_sum) ? `  endstate = ${format(R.endstate_sum)}` : ''
    g.save()
    g.fillStyle = MAYBE_BLACK; set_font(margin / 2, g)
    g.textAlign = 'left'; g.textBaseline = 'middle'
    g.fillText(`  visits = ${R.visits}${esum}`, 0, margin / 4)
    g.restore()
}

function draw_progress(highlightp, margin, canvas, g) {
    if (R.progress < 0) {return}
    g.fillStyle = highlightp ? GREEN : R.progress_bturn ? BLACK : WHITE
    fill_rect([0, canvas.height - margin / 10],
              [canvas.width * R.progress, canvas.height], g)
}

function draw_cursor(hovered_move, unit, idx2coord, g) {
    const xy = idx2coord(...move2idx(hovered_move))
    g.fillStyle = R.bturn ? PALE_BLACK : PALE_WHITE
    fill_circle(xy, unit / 4, g)
}

function draw_on_board(stones, drawp, unit, idx2coord, g) {
    const {draw_last_p, draw_recent_p, draw_next_p, draw_expected_p,
           draw_endstate_p, large_font_p, tag_clickable_p}
          = drawp
    const stone_radius = unit * 0.5
    const draw_exp = (move, exp_p, h, xy) => draw_expected_p && move &&
          draw_expected_mark(h, xy, exp_p, stone_radius, g)
    const each_coord =
          proc => each_stone(stones, (h, idx) => proc(h, idx2coord(...idx), idx))
    each_coord((h, xy, idx) => {
        draw_endstate_p && draw_endstate(h.endstate, xy, stone_radius, g)
        h.stone ? draw_stone(h, xy, stone_radius, draw_last_p, draw_recent_p, g) :
            h.suggest ? draw_suggest(h, xy, stone_radius, large_font_p, g) : null
        draw_next_p && h.next_move && draw_next_move(h, xy, stone_radius, g)
        draw_expected_p && (draw_exp(h.expected_move, true, h, xy),
                            draw_exp(h.unexpected_move, false, h, xy))
        const highlight_tag_p = tag_clickable_p &&
              idx2move(...idx) === g.canvas.lizgoban_hovered_move
        h.displayed_tag && draw_tag(h.tag, xy, stone_radius, highlight_tag_p, g)
        draw_endstate_p && draw_endstate_diff(h.endstate_diff, xy, stone_radius, g)
    })
    each_coord((h, xy) => h.suggest && (h.data.visits > 0)
               && draw_winrate_mapping_line(h, xy, unit, g))
}

function goban_bg(border) {
    return GOBAN_BG_COLOR[(R.pausing ? 'p' : '') + (R.trial && border ? 't' : '')]
}

/////////////////////////////////////////////////
// on goban grids

// stone

function draw_stone(h, xy, radius, draw_last_p, draw_recent_p, g) {
    const [b_color, w_color] = h.displayed_colors ||
          (h.maybe ? [MAYBE_BLACK, MAYBE_WHITE] :
           h.maybe_empty ? [PALE_BLACK, PALE_WHITE] :
           h.is_vague ? [VAGUE_BLACK, VAGUE_WHITE] :
           [BLACK, WHITE])
    const last_or_recent = (draw_last_p && h.last) || (draw_recent_p && h.recent)
    g.lineWidth = 1; g.strokeStyle = b_color
    g.fillStyle = h.black ? b_color : w_color
    edged_fill_circle(xy, radius, g)
    h.movenums && draw_movenums(h, xy, radius, g)
    last_or_recent && draw_last_or_recent_move(h, xy, radius, g)
}

function draw_movenums(h, xy, radius, g) {
    const movenums = h.movenums.slice().sort((a, b) => a - b)
    const bw = h.is_vague ? [MAYBE_BLACK, MAYBE_WHITE] : [BLACK, WHITE]
    const color = (movenums[0] === 1) ? GREEN : h.variation_last ? RED :
          bw[h.black ? 1 : 0]
    draw_text_on_stone(movenums.join(','), color, xy, radius, g)
}

function draw_tag(tag, xy, radius, highlight_tag_p, g) {
    draw_text_on_stone(tag, highlight_tag_p ? GREEN : BLUE, xy, radius, g)
}

function draw_text_on_stone(text, color, xy, radius, g) {
    const l = text.length, [x, y] = xy, max_width = radius * 1.5
    const fontsize = to_i(radius * (l < 3 ? 1.8 : l < 6 ? 1.2 : 0.9))
    g.save()
    set_font(fontsize, g); g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillStyle = color; g.fillText(text, x, y, max_width)
    g.restore()
}

function draw_last_or_recent_move(h, xy, radius, g) {
    const color = [[WHITE, BLACK], ["rgba(255,255,255,0.2)", "rgba(0,0,0,0.1)"]]
    const b2i = z => (z ? 0 : 1)
    g.strokeStyle = color[b2i(h.last)][b2i(h.black)]; g.lineWidth = 2
    circle(xy, radius * 0.8, g)
}

function draw_next_move(h, xy, radius, g) {
    g.strokeStyle = h.next_is_black ? BLACK : WHITE; g.lineWidth = 3; circle(xy, radius, g)
}

// suggestions

// suggest_as_stone = {suggest: true, data: suggestion_data}
// See "suggestion reader" section in engine.js for suggestion_data.

function draw_suggest(h, xy, radius, large_font_p, g) {
    if (h.data.visits === 0) {draw_suggest_0visits(h, xy, radius, g); return}
    const suggest = h.data, {stroke, fill, lizzie_text_color} = suggest_color(suggest)
    g.lineWidth = 1; g.strokeStyle = stroke; g.fillStyle = fill
    edged_fill_circle(xy, radius, g)
    if (R.lizzie_style) {
        const [x, y] = xy, max_width = radius * 1.8, champ_color = RED
        const fontsize = to_i(radius * 0.8), next_y = y + fontsize
        const [winrate_text, visits_text] = suggest_texts(suggest)
        g.save(); set_font(fontsize, g); g.textAlign = 'center'
        g.fillStyle = suggest.winrate_order === 0 ? champ_color : lizzie_text_color
        g.fillText(winrate_text, x, y, max_width)
        g.fillStyle = suggest.order === 0 ? champ_color : lizzie_text_color
        g.fillText(visits_text, x, next_y , max_width)
        g.restore()
    }
    draw_suggestion_order(h, xy, radius, g.strokeStyle, large_font_p, g)
}

function draw_suggest_0visits(h, xy, radius, g) {
    const limit_order = 4, size = (1 + log10(h.data.prior) / limit_order)
    if (size <= 0) {return}
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,0,0,0.2)'
    circle(xy, radius * size, g)
}

function draw_suggestion_order(h, [x, y], radius, color, large_font_p, g) {
    if (h.data.order >= 9) {return}
    const lizzie = R.lizzie_style
    const both_champ = (h.data.order + h.data.winrate_order === 0)
    const either_champ = (h.data.order * h.data.winrate_order === 0)
    const huge = [2, -1], large = [1.5, -0.5], normal = [1, -0.1], small = [0.8, 0.3]
    const font_modifier = large_font_p && both_champ ? 'bold ' : ''
    const either = (champ, other) => both_champ ? champ : other
    const [fontsize, d] = (lizzie ? small : large_font_p ? huge : either(large, normal))
          .map(c => c * radius)
    const w = fontsize
    g.save()
    g.fillStyle = BLUE
    lizzie && fill_rect([x + d, y - d - w], [x + d + w, y - d], g)
    g.fillStyle = lizzie ? WHITE : either_champ ? RED : color
    set_font(font_modifier + fontsize, g)
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(h.data.order + 1, x + d + w / 2, y - d - w / 2, w)
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

function draw_endstate_diff(diff, xy, radius, g) {
    if (!diff) {return}
    const size = 0.2, [c, r, f, thicker] = diff > 0 ?
          ['#080', 1, square_around, 1.5] : ['#f0f', 1, x_shape_around, 1]
    const thick = (R.endstate_diff_interval > 5 ? 1.5 : 3) * thicker
    g.lineWidth = Math.abs(diff * thick); g.strokeStyle = c; f(xy, radius * size * r, g)
}

/////////////////////////////////////////////////
// mapping from goban to winrate bar

function draw_winrate_mapping_line(h, xy, unit, g) {
    const b_winrate = flip_maybe(h.data.winrate)
    const order = h.next_move ? 0 : Math.min(h.data.order, h.data.winrate_order)
    g.lineWidth = 1.5 / (order * 2 + 1)
    g.strokeStyle = RED
    line(xy, ...mapping_line_coords(b_winrate, unit, g.canvas), g)
}

function draw_mapping_text(mapping_to_winrate_bar, margin, canvas, g) {
    const {text, subtext, at} = mapping_to_winrate_bar
    const y = canvas.height - margin / 6
    g.fillStyle = RED; set_font(margin / 2, g)
    // main text
    g.textAlign = at < 10 ? 'left' : at < 90 ? 'center' : 'right'
    g.fillText(text, canvas.width * at / 100, y)
    // subtext
    const [sub_at, sub_align] = at > 50 ? [0, 'left'] : [100, 'right']
    g.fillStyle = 'rgba(255,0,0,0.5)'; g.textAlign = sub_align
    g.fillText(subtext, canvas.width * sub_at / 100, y)
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
    const [winrate_text, visits_text, prior_text] = suggest_texts(suggest) || []
    const v = visits_text ? ` (${visits_text})` : ''
    const text = winrate_text && `${winrate_text}${v}`
    const subtext = text && ` prior = ${prior_text} `
    const at = flip_maybe(suggest.winrate)
    return text && {text, subtext, at}
}

function mapping_line_coords(b_winrate, unit, canvas) {
    const x1 = canvas.width * b_winrate / 100, y1 = canvas.height, d = unit * 0.3
    return [[x1, y1 - d], [x1, y1]]
}

/////////////////////////////////////////////////
// winrate bar

let winrate_bar_prev = 50

function draw_winrate_bar(canvas, large_bar, pale_text_p) {
    const w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    const tics = 9
    const xfor = percent => w * percent / 100
    const vline = percent => {const x = xfor(percent); line([x, 0], [x, h], g)}
    const b_wr0 = b_winrate(), b_wr = truep(b_wr0) ? b_wr0 : winrate_bar_prev
    winrate_bar_prev = b_wr
    if (R.pausing && !truep(b_wr0)) {
        draw_winrate_bar_unavailable(w, h, g)
        draw_winrate_bar_tics(0, tics, vline, g)
        return
    }
    draw_winrate_bar_areas(b_wr, w, h, xfor, vline, g)
    large_bar && draw_winrate_bar_horizontal_lines(w, h, g)
    draw_winrate_bar_tics(b_wr, tics, vline, g)
    draw_winrate_bar_last_move_eval(b_wr, h, xfor, vline, g)
    R.winrate_trail && draw_winrate_trail(canvas)
    draw_winrate_bar_suggestions(w, h, xfor, vline, large_bar, g)
    draw_winrate_bar_text(w, h, pale_text_p, g)
}

function draw_winrate_bar_text(w, h, pale_text_p, g) {
    const b_wr = b_winrate(), eval = last_move_eval()
    const visits = R.max_visits && kilo_str(R.max_visits)
    const fontsize = Math.min(h * 0.5, w * 0.04)
    if (!truep(b_wr)) {return}
    g.save()
    set_font(fontsize, g); g.textBaseline = 'middle'
    const f = (wr, x, align, myturn) => {
        const cond = (pred, s) => (pred ? ` ${s} ` : '')
        const vis = cond(visits, visits)
        const ev = cond(truep(eval), `(${eval > 0 ? '+' : ''}${f2s(eval)})`)
        const win = cond(true, `${f2s(wr)}%`)
        const [wr_color, vis_color] = pale_text_p ?
              ['rgba(0,192,0,0.3)', 'rgba(160,160,160,0.3)'] :
              [GREEN, WINRATE_TRAIL_COLOR]
        g.textAlign = align; g.fillStyle = wr_color; g.fillText(win, x, fontsize * 0.5)
        myturn && (g.fillStyle = vis_color)
        g.fillText(myturn ? vis : ev, x, fontsize * 1.5)
    }
    f(b_wr, 0, 'left', R.bturn)
    f(100 - b_wr, w, 'right', !R.bturn)
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

function draw_winrate_bar_tics(b_wr, tics, vline, g) {
    seq(tics, 1).forEach(i => {
        const r = 100 * i / (tics + 1)
        g.lineWidth = 1; g.strokeStyle = (r < b_wr) ? WHITE : BLACK; vline(r)
    })
    g.lineWidth = 3; g.strokeStyle = (b_wr > 50) ? WHITE : BLACK; vline(50)
}

function draw_winrate_bar_last_move_eval(b_wr, h, xfor, vline, g) {
    const eval = last_move_eval(), b_eval = last_move_b_eval()
    if (!truep(eval)) {return}
    const [x1, x2] = [b_wr, b_wr - b_eval].map(xfor).sort()
    const [stroke, fill] = (eval >= 0 ? [GREEN, PALE_GREEN] : [RED, PALE_RED])
    const lw = g.lineWidth = 3; g.strokeStyle = stroke; g.fillStyle = fill
    edged_fill_rect([x1, lw / 2], [x2, h - lw / 2], g)
}

/////////////////////////////////////////////////
// suggested moves on winrate bar

// draw

function draw_winrate_bar_suggestions(w, h, xfor, vline, large_bar, g) {
    g.lineWidth = 1
    const max_radius = Math.min(h, w * 0.05)
    const prev_color = 'rgba(64,128,255,0.8)'
    R.suggest.filter(s => s.visits > 0).forEach(s => {
        const {edge_color, fan_color, vline_color, aura_color,
               target_p, draw_order_p, winrate} = winrate_bar_suggest_prop(s)
        draw_winrate_bar_fan(s, w, h, edge_color, fan_color, aura_color,
                             target_p, large_bar, g)
        draw_order_p && large_bar && draw_winrate_bar_order(s, w, h, g)
        if (vline_color) {
            g.lineWidth = 3; g.strokeStyle = vline_color; vline(flip_maybe(winrate))
        }
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
    draw_puct_p && line([x, y], [x_puct, clip(y_puct, 0, h)], g)
    draw_lcb_p && line([x, y], [x_lcb, y], g)
}

function draw_winrate_bar_order(s, w, h, g) {
    const fontsize = w * 0.03, [x, y] = winrate_bar_xy(s, w, h)
    g.save()
    winrate_bar_order_set_style(s, fontsize, g)
    g.textAlign = R.bturn ? 'left' : 'right'; g.textBaseline = 'middle'
    g.fillText(` ${s.order + 1} `, x, y)
    g.restore()
}

// style

function winrate_bar_suggest_prop(s) {
    // const
    const next_color = '#48f'
    const next_vline_color = 'rgba(64,128,255,0.5)'
    const target_vline_color = 'rgba(255,64,64,0.5)'
    const normal_aura_color = 'rgba(235,148,0,0.8)'
    const target_aura_color = 'rgba(0,192,0,0.8)'
    // main
    const {move, winrate} = s
    const edge_color = target_move ? 'rgba(128,128,128,0.5)' : '#888'
    const target_p = (move === target_move), next_p = is_next_move(move)
    const alpha = target_p ? 1.0 : target_move ? 0.3 : 0.8
    const {fill} = suggest_color(s, alpha)
    const fan_color = (!target_move && next_p) ? next_color : fill
    const vline_color = target_p ? target_vline_color :
          next_p ? next_vline_color : null
    const aura_color = target_p ? target_aura_color : normal_aura_color
    const major = s.visits >= R.max_visits * 0.3 || s.prior >= 0.3 ||
          s.order < 3 || s.winrate_order < 3 || target_p || next_p
    const eliminated = target_move && !target_p
    const draw_order_p = major && !eliminated
    return {edge_color, fan_color, vline_color, aura_color, alpha,
            target_p, draw_order_p, next_p, winrate}
}

function suggest_color(suggest, alpha) {
    const hue = winrate_color_hue(suggest.winrate)
    const alpha_emphasis = emph => {
        const max_alpha = 0.5, visits_ratio = suggest.visits / (R.visits + 1)
        return max_alpha * visits_ratio ** (1 - emph)
    }
    const hsl_e = (h, s, l, emph) => hsla(h, s, l, alpha || alpha_emphasis(emph))
    const stroke = hsl_e(hue, 100, 20, 0.85), fill = hsl_e(hue, 100, 50, 0.4)
    const lizzie_text_color = hsl_e(0, 0, 0, 0.75)
    return {stroke, fill, lizzie_text_color}
}

function winrate_color_hue(winrate) {
    const cyan_hue = 180, green_hue = 120, yellow_hue = 60, red_hue = 0
    const unit_delta_points = 5, unit_delta_hue = green_hue - yellow_hue
    const wr0 = flip_maybe(b_winrate(1) || b_winrate())
    const delta_hue = (winrate - wr0) * unit_delta_hue / unit_delta_points
    return to_i(clip(yellow_hue + delta_hue, red_hue, cyan_hue))
}

function winrate_bar_max_radius(w, h) {return Math.min(h * 1, w * 0.1)}

function winrate_bar_order_set_style(s, fontsize, g) {
    const firstp = (s.order === 0)
    set_font(fontsize * (firstp ? 1.5 : 1), g)
    g.fillStyle = firstp ? WINRATE_BAR_FIRST_ORDER_COLOR : WINRATE_BAR_ORDER_COLOR
}

// calc

function winrate_bar_xy(suggest, w, h, supplementary, bturn) {
    const wr = suggest.winrate, max_radius = winrate_bar_max_radius(w, h)
    const x_for = winrate => w * flip_maybe(winrate, bturn) / 100
    const y_for = visits => winrate_bar_y(visits, w, h, max_radius)
    const x = x_for(wr), y = y_for(suggest.visits)
    if (!supplementary) {return [x, y]}
    const [puct, equilibrium_visits] = puct_info(suggest)
    return [x, y, max_radius * Math.sqrt(suggest.prior), max_radius,
            x_for(wr + puct), y_for(equilibrium_visits), x_for(suggest.lcb)]
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
// winrate graph

function draw_winrate_graph(canvas, goto_move_count, unset_busy) {
    const w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    const tics = 9, xmargin = w * 0.02, fontsize = to_i(w * 0.04)
    const smax = Math.max(R.history_length, 1)
    // s = move_count, r = winrate
    const [sr2coord, coord2sr] =
          uv2coord_translator_pair(canvas, [0, smax], [100, 0], xmargin, 0)
    clear_canvas(canvas, BLACK, g)
    draw_winrate_graph_frame(w, h, tics, g)
    draw_winrate_graph_move_count(smax, fontsize, sr2coord, g)
    draw_winrate_graph_future(w, h, sr2coord, g)
    draw_winrate_graph_tag(fontsize, sr2coord, g)
    draw_winrate_graph_score(sr2coord, g)
    draw_winrate_graph_curve(sr2coord, g)
    const goto_here = e =>
          !R.attached && winrate_graph_goto(e, coord2sr, goto_move_count)
    canvas.onmousedown = goto_here
    canvas.onmousemove = e => (e.buttons === 1) && goto_here(e)
    canvas.onmouseup = e => unset_busy()
}

function draw_winrate_graph_frame(w, h, tics, g) {
    // horizontal lines (tics)
    g.strokeStyle = DARK_GRAY; g.fillStyle = DARK_GRAY; g.lineWidth = 1
    seq(tics, 1).forEach(i => {const y = h * i / (tics + 1); line([0, y], [w, y], g)})
    // // frame
    // g.strokeStyle = GRAY; g.fillStyle = GRAY; g.lineWidth = 1
    // rect([0, 0], [w, h], g)
    // 50% line
    g.strokeStyle = GRAY; g.fillStyle = GRAY; g.lineWidth = 1
    line([0, h / 2], [w, h / 2], g)
}

function draw_winrate_graph_future(w, h, sr2coord, g) {
    const [x, y] = sr2coord(R.move_count, 50)
    const paint = (partial, l_alpha, r_alpha, y0, y1) => {
        const c = a => `rgba(255,255,255,${a})`
        const grad = side_gradation(x, (1 - partial) * x + partial * w,
                                    c(l_alpha), c(r_alpha), g)
        g.fillStyle = grad; fill_rect([x, y0], [w, y1], g)
    }
    const alpha = 0.2
    paint(0.5, alpha, 0, 0, y); paint(1, alpha, alpha, y, h)
}

function draw_winrate_graph_move_count(smax, fontsize, sr2coord, g) {
    g.strokeStyle = DARK_GRAY; g.fillStyle = DARK_GRAY; g.lineWidth = 1
    set_font(fontsize, g)
    g.textAlign = R.move_count < smax / 2 ? 'left' : 'right'
    g.fillText(' ' + R.move_count + ' ', ...sr2coord(R.move_count, 0))
}

function draw_winrate_graph_curve(sr2coord, g) {
    let prev = null, cur = null
    const draw_predict = (r, s, p) => {
        g.strokeStyle = YELLOW; g.lineWidth = 1; line(sr2coord(s, r), sr2coord(s, p), g)
    }
    R.winrate_history.forEach((h, s) => {
        if (!truep(h.r)) {return}
        truep(h.predict) && draw_predict(h.r, s, h.predict)
        g.strokeStyle = isNaN(h.move_eval) ? GRAY : h.pass ? PALE_BLUE :
            (h.move_eval < 0) ? RED : (s > 1 && !truep(h.predict)) ? YELLOW : GREEN
        g.lineWidth = (s <= R.move_count ? 3 : 1)
        cur = sr2coord(s, h.r); prev && line(prev, cur, g); prev = cur
    })
}

function draw_winrate_graph_score(sr2coord, g) {
    const to_r = score => 50 + score
    R.winrate_history.map(h => h.score_without_komi).forEach((score, s) => {
        if (!truep(score)) {return}
        const diff_target_p = R.endstate_diff_interval > 5 &&
              (s === R.move_count - R.endstate_diff_interval)
        const [radius, alpha] = diff_target_p ? [3, 0.7] : [2, 0.3]
        const xy = sr2coord(s, to_r(score))
        g.fillStyle = `rgba(0,255,255,${alpha})`; fill_circle(xy, radius, g)
    })
}

function draw_winrate_graph_tag(fontsize, sr2coord, g) {
    R.winrate_history.forEach((h, s) => {
        if (!h.tag) {return}
        const [x, ymax] = sr2coord(s, 0)
        const [yt, yl] = (h.r < 50 ? [0.05, 0.1] : [0.95, 0.9]).map(c => ymax * c)
        g.save()
        set_font(fontsize, g); g.textAlign = 'center'; g.textBaseline = 'middle'
        g.strokeStyle = BLUE; g.lineWidth = 1; line([x, yl], [x, ymax / 2], g)
        g.fillStyle = BLUE; g.fillText(h.tag, x, yt)
        g.restore()
    })
}

function winrate_graph_goto(e, coord2sr, goto_move_count) {
    const [s, r] = coord2sr(...mouse2coord(e))
    s >= 0 && goto_move_count(clip(s, 0, R.history_length))
}

/////////////////////////////////////////////////
// winrate trail

const winrate_trail_max_length = 50
const winrate_trail_max_suggestions = 10
const winrate_trail_limit_relative_visits = 0.3
let winrate_trail = {}, winrate_trail_move_count = 0, winrate_trail_visits = 0

function update_winrate_trail() {
    const total_visits_increase = R.visits - winrate_trail_visits;
    // check visits for detecting restart of leelaz
    (winrate_trail_move_count !== R.move_count ||
     winrate_trail_visits > R.visits) && (winrate_trail = {});
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

function draw_winrate_trail(canvas) {
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
// visits trail

function draw_visits_trail(canvas) {
    const w = canvas.width, h = canvas.height, g = canvas.getContext("2d")
    const fontsize = h / 10, top_margin = 3
    const v2x = v => v / R.visits * w
    const v2y = v => (1 - v / R.max_visits) * (h - top_margin) + top_margin
    const xy_for = z => [v2x(z.total_visits), v2y(z.visits)]
    canvas.onmousedown = canvas.onmousemove = canvas.onmouseup = e => {}
    g.fillStyle = BLACK; fill_rect([0, 0], [w, h], g)
    if (!R.visits || !R.max_visits) {return}
    draw_visits_trail_grid(fontsize, w, h, v2x, v2y, g)
    R.suggest.forEach(s => draw_visits_trail_curve(s, fontsize, h, xy_for, g))
}

function draw_visits_trail_grid(fontsize, w, h, v2x, v2y, g) {
    const kilo = (v, x, y) => g.fillText(' ' + kilo_str(v).replace('.0', ''), x, y)
    g.save()
    g.lineWidth = 1; set_font(fontsize, g)
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

function draw_visits_trail_curve(s, fontsize, h, xy_for, g) {
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
    winrate_bar_order_set_style(s, fontsize, g)
    g.fillText(ord === 1 ? '1' : `${ord} `, x, y)
    g.restore()
}

/////////////////////////////////////////////////
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

const [line, fill_line, edged_fill_line] = drawers_trio(line_gen)
const [rect, fill_rect, edged_fill_rect] = drawers_trio(rect_gen)
const [circle, fill_circle, edged_fill_circle] = drawers_trio(circle_gen)
const [fan, fill_fan, edged_fill_fan] = drawers_trio(fan_gen)
const [square_around, fill_square_around, edged_fill_square_around] =
      drawers_trio(square_around_gen)

function x_shape_around([x, y], radius, g) {
    line([x - radius, y - radius], [x + radius, y + radius], g)
    line([x - radius, y + radius], [x + radius, y - radius], g)
}

function set_font(fontsize, g) {g.font = '' + fontsize + 'px sans-serif'}

function side_gradation(x0, x1, color0, color1, g) {
    const grad = g.createLinearGradient(x0, 0, x1, 0)
    grad.addColorStop(0, color0); grad.addColorStop(1, color1)
    return grad
}

function hsla(h, s, l, alpha) {
    return 'hsla(' + h + ',' + s + '%,' + l + '%,' + (alpha === undefined ? 1 : alpha) + ')'
}

/////////////////////////////////////////////////
// utils

// stones

function copy_stones_for_display() {
    return R.stones.map(row => row.map(s => merge({}, s)))
}

function each_stone(stones, proc) {
    stones.forEach((row, i) => row.forEach((h, j) => proc(h, [i, j])))
}

function merge_stone_at(move, stone_array, stone) {
    const get_movenums = s => s.movenums || []
    const ary_or_undef = a => empty(a) ? undefined : a
    const merge_stone = (stone0, stone1) =>
        merge(stone0, stone1,
              {movenums: ary_or_undef(flatten([stone0, stone1].map(get_movenums)))})
    // do nothing if move is pass
    const [i, j] = move2idx(move); (i >= 0) && merge_stone(stone_array[i][j], stone)
}

function is_next_move(move) {
    [i, j] = move2idx(move); return (i >= 0) && R.stones[i][j].next_move
}

// visits & winrate

function suggest_texts(suggest) {
    const prior = to_s(suggest.prior).slice(0, 5)
    // need ' ' because '' is falsy
    return suggest.visits === 0 ? [' ', '', prior] :
        ['' + to_i(suggest.winrate) + '%', kilo_str(suggest.visits), prior]
}

function b_winrate(nth_prev) {return winrate_history_ref('r', nth_prev)}
function last_move_b_eval() {return winrate_history_ref('move_b_eval')}
function last_move_eval() {return winrate_history_ref('move_eval')}
function winrate_history_ref(key, nth_prev) {
    return (R.winrate_history[R.move_count - (nth_prev || 0)] || {})[key]
}

function flip_maybe(x, bturn) {
    return (bturn === undefined ? R.bturn : bturn) ? x : 100 - x
}

// previously expected move

function expected_pv() {return ((R.previous_suggest || {}).pv || []).slice(1)}

function set_expected_stone(expected_move, unexpected_move, displayed_stones) {
    merge_stone_at(expected_move, displayed_stones, {expected_move: true})
    merge_stone_at(unexpected_move, displayed_stones, {unexpected_move: true})
}

// math

function tics_until(max) {
    const v = Math.pow(10, Math.floor(log10(max)))
    const unit_v = (max > v * 5) ? v * 2 : (max > v * 2) ? v : v / 2
    return seq(to_i(max / unit_v + 2)).map(k => unit_v * k)  // +1 for margin
}

function log10(z) {return Math.log(z) / Math.log(10)}

// [0,1,2,3,4,5,6,7,8,9,10,11,12].map(k => kilo_str(10**k))  ==>
// ['1','10','100','1.0K','10K','100K','1.0M','10M','100M','1.0G','10G','100G','1000G']
function kilo_str(x) {
    return kilo_str_sub(x, [[1e9, 'G'], [1e6, 'M'], [1e3, 'k']])
}
function kilo_str_sub(x, rules) {
    if (empty(rules)) {return to_s(x)}
    const [[base, unit], ...rest] = rules
    if (x < base) {return kilo_str_sub(x, rest)}
    // +0.1 for "1.0K" instead of "1K"
    const y = (x + 0.1) / base, z = Math.floor(y)
    return (y < 10 ? to_s(y).slice(0, 3) : to_s(z)) + unit
}

//////////////////////////////////

module.exports = {
    set_state,
    draw_main_goban, draw_goban_with_principal_variation, draw_goban,
    draw_winrate_graph, draw_winrate_bar, draw_visits_trail,
    update_winrate_trail, clear_canvas, is_next_move,
    target_move: () => target_move,
    first_board_canvas: () => first_board_canvas,
    reset_first_board_canvas: () => (first_board_canvas = null),
}
