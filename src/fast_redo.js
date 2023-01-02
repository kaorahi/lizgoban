'use strict'

const fast_redo_moves_per_sec = [
    // [delay (sec), moves_per_sec]
    [0.0, 3],
    [1.0, 20],
    [2.0, 100],
]
const fast_redo_drawing_interval_millisec = 20

let fast_redo_request = null, fast_redo_timer = null

function start_fast_redo(proc) {
    if (fast_redo_request) {return}
    const time = Date.now()
    const mps_after_sec = piecewise_linear(fast_redo_moves_per_sec)
    const moves_per_sec = t => mps_after_sec((t - time) / 1000)
    fast_redo_request = {time, moves_per_sec, proc, next_check_at: time}
    try_fast_redo()
}
function stop_fast_redo() {clearTimeout(fast_redo_timer); fast_redo_request = null}

function try_fast_redo() {
    const req = fast_redo_request; if (!req) {return}
    const delay = clip(req.next_check_at - Date.now(), 0)
    clearTimeout(fast_redo_timer)
    fast_redo_timer = setTimeout(try_fast_redo_now, delay)
}
function try_fast_redo_now() {
    const req = fast_redo_request
    if (!req || req.move_count === R.move_count) {return}
    const now = Date.now(), dt_sec = (now - req.time) / 1000
    const moves = Math.round(req.moves_per_sec(now) * dt_sec)
    req.next_check_at = now + fast_redo_drawing_interval_millisec
    if (moves < 1) {try_fast_redo(); return}  // after updating of next_check_at
    req.move_count = R.move_count
    req.time = now
    req.proc(moves)
}

function piecewise_linear(pairs) {
    // (ex.)
    // g = piecewise_linear([[0, 1], [2, 3], [5, 9]])
    // seq(10, -2).map(x => [x, g(x)])
    // ==> [[-2,1],[-1,1],[0,1],[1,2],[2,3],[3,5],[4,7],[5,9],[6,9],[7,9]]
    const x_f_table = pairs.map(([x0, y0], k, a) => {
        const next = a[k + 1]; if (!next) {return null}
        const [x1, y1] = next, x = k > 0 ? x0 : - Infinity
        const f = clipped_translator([x0, x1], [y0, y1])
        return {x, f}
    }).filter(truep).reverse()
    return x => x_f_table.find(h => x >= h.x).f(x)
}

//////////////////////////////////////
// exports

module.exports = {
    start_fast_redo,
    stop_fast_redo,
    try_fast_redo,
}
