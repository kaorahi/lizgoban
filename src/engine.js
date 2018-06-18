/////////////////////////////////////////////////
// setup

let leelaz_process, start_args, the_analyze_interval_centisec
let command_queue, last_command_id, last_response_id, pondering = true

// game state
let b_prison = 0, w_prison = 0, bturn = true

// util
const {to_i, to_f, xor, clone, merge, flatten, each_key_value, array2hash, seq, do_ntimes}
      = require('./util.js')
const {idx2move, move2idx, idx2coord_translator_pair, uv2coord_translator_pair,
       board_size, sgfpos2move, move2sgfpos} = require('./coord.js')
function log(header, s) {console.log(`${header} ${s}`)}

/////////////////////////////////////////////////
// leelaz action

// process
function start(...args) {
    const [leelaz_command, leelaz_args, analyze_interval_centisec,
           board_handler, suggest_handler] = start_args = args
    leelaz_process = require('child_process').spawn(leelaz_command, leelaz_args)
    leelaz_process.stdout.on('data', each_line(stdout_reader))
    leelaz_process.stderr.on('data', each_line(with_skip('~begin', '~end', reader)))
    the_board_handler = board_handler; the_suggest_handler = suggest_handler
    the_analyze_interval_centisec = analyze_interval_centisec
    command_queue = []; last_command_id = -1; last_response_id = -1
    update()
}
function restart() {kill(); start(...start_args)}
function kill() {
    leelaz_process && (leelaz_process.stderr.on('data', () => null),
                       leelaz_process.kill('SIGKILL'))
}

function start_ponder() {pondering && leelaz(`lz-analyze ${the_analyze_interval_centisec}`)}
function stop_ponder() {leelaz('name')}
function showboard() {leelaz('showboard')}
function is_pondering() {return pondering}
function toggle_ponder() {pondering = !pondering; pondering ? start_ponder() : stop_ponder()}

// stateless wrapper of leelaz
let leelaz_previous_history = []
function set_board(history) {
    if (history.length === 0) {clear_leelaz_board(); return}
    const beg = common_header_length(history, leelaz_previous_history)
    const back = leelaz_previous_history.length - beg
    const rest = history.slice(beg)
    do_ntimes(back, undo1); rest.map(play1)
    if (back > 0 || rest.length > 0) {update()}
    leelaz_previous_history = clone(history)
}
function common_header_length(a, b) {
    const eq = (x, y) => (!!x.is_black === !!y.is_black && x.move === y.move)
    const k = a.findIndex((x, i) => !eq(x, b[i] || {}))
    return (k >= 0) ? k : a.length
}
function play1({move, is_black}) {leelaz('play ' + (is_black ? 'b ' : 'w ') + move)}
function undo1() {leelaz('undo')}

// util
function leelaz(s) {send_to_queue(s); log('queue>', s)}
function update() {showboard(); start_ponder()}
function clear_leelaz_board() {leelaz("clear_board"); leelaz_previous_history = []; update()}

/////////////////////////////////////////////////
// command queue

function send_to_queue(s) {
    // remove useless lz-analyze that will be canceled immediately
    command_queue = command_queue.filter(x => !pondering_command_p(x))
    // remove duplicated showboard
    command_queue.find(showboard_command_p) &&
        (command_queue = command_queue.filter(x => !showboard_command_p(x)).concat("showboard"))
    command_queue.push(s); try_send_from_queue()
}

function try_send_from_queue() {
    if (command_queue.length === 0 || !up_to_date_response()) {return}
    const cmd = command_queue.shift(), cmd_with_id = `${++last_command_id} ${cmd}`
    console.log('leelaz> ' + cmd_with_id); leelaz_process.stdin.write(cmd_with_id + "\n")
}

function up_to_date_response() {return last_response_id >= last_command_id}
function pondering_command_p(command) {return command.match(/^lz-analyze/)}
function showboard_command_p(command) {return command.match(/^showboard/)}

/////////////////////////////////////////////////
// stdout reader

// suggest = [suggestion_data, ..., suggestion_data]
// suggestion_data = {move: "Q16", visits: 17, winrate: 52.99, pv: v} etc.
// v = ["Q16", "D4", "Q3", ..., "R17"] etc.

function stdout_reader(s) {
    log('stdout|', s)
    let m = s.match(/^[=?](\d+)/)
    m && (last_response_id = to_i(m[1]))
    up_to_date_response() && s.match(/^info /) && suggest_reader(s)
    try_send_from_queue()
}

function suggest_reader(s) {
    const suggest = s.split(/info/).slice(1).map(suggest_parser)
          .sort((a, b) => (a.order - b.order))
    const [wsum, playouts] = suggest.map(h => [h.winrate, h.playouts])
          .reduce(([ws, ps], [w, p]) => [ws + w * p, ps + p], [0, 0])
    const winrate = wsum / playouts, b_winrate = bturn ? winrate : 100 - winrate
    const wrs = suggest.map(h => h.winrate)
    const min_winrate = Math.min(...wrs), max_winrate = Math.max(...wrs)
    // winrate is NaN if suggest = []
    the_suggest_handler({suggest, playouts, b_winrate, min_winrate, max_winrate})
}

// (sample of leelaz output for "lz-analize 10")
// info move D16 visits 3 winrate 4665 order 0 pv D16 D4 Q16 info move D4 visits 3 winrate 4658 order 1 pv D4 Q4 D16 info move Q16 visits 2 winrate 4673 order 2 pv Q16 Q4

// (sample with "pass")
// info move pass visits 2 winrate 683 order 159 pv pass Q7

function suggest_parser(s) {
    let [a, b] = s.split(/pv/), h = array2hash(a.trim().split(/\s+/))
    h.pv = b.trim().split(/\s+/)
    h.visits = to_i(h.visits); h.order = to_i(h.order); h.winrate = to_f(h.winrate) / 100
    h.playouts = h.visits; h.variation = h.pv  // for compatibility
    return h
}

/////////////////////////////////////////////////
// stderr reader

let current_reader

function reader(s) {log('stderr|', s); current_reader(s)}

function main_reader(s) {
    let m, c;
    (m = s.match(/\((.)\) to move/)) && (bturn = m[1] === 'X');
    (m = s.match(/\((.)\) Prisoners: *([0-9]+)/)) &&
        (c = to_i(m[2]), m[1] === 'X' ? b_prison = c : w_prison = c)
    s.match(/a b c d e f g h j k l m n o p q r s t/) && (current_reader = board_reader)
}

current_reader = main_reader

/////////////////////////////////////////////////
// board reader

// stones = [[stone, ..., stone], ..., [stone, ..., stone]] (19x19, see coord.js)
// stone = {stone: true, black: true} etc. or {} for empty position

// history = [move_data, ..., move_data]
// move_data = {move: "G16", is_black: false, b_winrate: 42.19} etc.
// history[0] is "first move", "first stone color (= black)", "winrate *after* first move"

let stones_buf = []
function board_reader(s) {
    let p = parse_board_line(s); p ? stones_buf.push(p) :
        (finish_board_reader(stones_buf), stones_buf = [], current_reader = main_reader)
}

function finish_board_reader(stones) {
    const stone_count = b_prison + w_prison + flatten(stones).filter(x => x.stone).length
    the_board_handler({bturn, stone_count, stones})
}

const char2stone = {
    X: {stone: true, black: true}, x: {stone: true, black: true, last: true},
    O: {stone: true, white: true}, o: {stone: true, white: true, last: true},
}

function parse_board_line(line) {
    const m = line.replace(/\(X\)/g, ' x ').replace(/\(O\)/g, ' o ').replace(/\(\.\)/g, ' . ')
          .replace(/\+/g, '.').replace(/\s/g, '').match(/[0-9]+([XxOo.]+)/)
    if (!m) {return false}
    return m[1].split('').map(c => clone(char2stone[c] || {}))
}

/////////////////////////////////////////////////
// reader helper

function each_line(f) {
    let buf = ''
    return stream => {
        let a = stream.toString().split('\n'), rest = a.pop()
        a.length > 0 && (a[0] = buf + a[0], buf = '', a.forEach(f))
        buf += rest
    }
}

function with_skip(from, to, f) {
    let skipping = false
    return s => skipping ? (skipping = !s.match(to)) :
        s.match(from) ? (skipping = true) : f(s)
}

/////////////////////////////////////////////////
// exports

module.exports = {
    start, restart, kill, set_board, update, is_pondering, toggle_ponder,
    common_header_length, each_line
}
