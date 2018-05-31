/////////////////////////////////////////////////
// setup

// leelaz
const leelaz_command = __dirname + '/leelaz'
const leelaz_args = ['-g', '-w', __dirname + '/network']
const update_interval_msec = 1000

const leelaz_process = require('child_process').spawn(leelaz_command, leelaz_args)

// electron
const electron = require('electron')
const ipc = electron.ipcMain

// game state
let history = [], stone_count = 0, b_prison = 0, w_prison = 0, bturn = true
let sequence = [history], sequence_cursor = 0;
history.stone_count = stone_count

// util
const {to_i, to_f, xor, clone, flatten, each_key_value, seq, do_ntimes}
      = require('./util.js')
const {board_size, idx2coord_translator_pair, move2idx, idx2move, sgfpos2move, move2sgfpos}
      = require('./coord.js')
const clipboard = electron.clipboard
const SGF = require('@sabaki/sgf')

/////////////////////////////////////////////////
// electron

let window

electron.app.on('ready', () => {
    let ss = electron.screen.getPrimaryDisplay().size
    window = new electron.BrowserWindow({width: ss.width * 0.8, height: ss.height * 0.8})
    window.loadURL('file://' + __dirname + '/index.html')
    window.setMenu(null)
    leelaz_process.stderr.on('data', each_line(with_skip('~begin', '~end', reader)))
    setInterval(update, update_interval_msec)
    showboard()
})
electron.app.on('window-all-closed', () => electron.app.quit())

function renderer(channel, x) {window && window.webContents.send(channel, x)}

/////////////////////////////////////////////////
// from renderer

const api = {
    play: play, undo: undo, redo: redo, explicit_undo: explicit_undo, pass: () => play('pass'),
    undo_ntimes: undo_ntimes, redo_ntimes: redo_ntimes,
    undo_to_start: undo_to_start, redo_to_end: redo_to_end,
    paste_sgf_from_clipboard: paste_sgf_from_clipboard,
    copy_sgf_to_clipboard: copy_sgf_to_clipboard, open_sgf: open_sgf,
    next_sequence: next_sequence, previous_sequence: previous_sequence,
}

function api_handler(handler) {return (e, ...args) => {handler(...args); showboard()}}

each_key_value(api, (channel, handler) => ipc.on(channel, api_handler(handler)))

/////////////////////////////////////////////////
// leelaz action

// game play
function play(move) {create_sequence_maybe(); play_move({move: move, is_black: bturn})}
function play_move({move: move, is_black: is_black}) {
    renderer('suggest', [])
    leelaz_action('play ' + (is_black ? 'b ' : 'w ') + move)
}
function undo() {leelaz_action('undo')}
function redo() {redo_ntimes(1)}
function explicit_undo() {
    (stone_count === history.length) && history.pop()
    leelaz_action('undo')
}
function clear_board() {clear_leelaz_board(); history.splice(0); stone_count = 0; bturn = true}

// multi-undo/redo
function undo_ntimes(n) {do_ntimes(n, undo)}
function redo_ntimes(n) {
    seq(Math.min(n, future_len()), stone_count).forEach(i => play_move(history[i]))
}
function undo_to_start() {undo_ntimes(stone_count)}
function redo_to_end() {redo_ntimes(future_len())}

// for renderer
function showboard() {leelaz('showboard')}
function start_ponder() {leelaz('time_left b 0 0')}
function stop_ponder() {leelaz('name')}

// util
function update() {stop_ponder(); start_ponder()}
function leelaz_action(s) {skip_suggest(); leelaz(s)}
function leelaz(s) {leelaz_process.stdin.write(s + '\n'); console.log('> ' + s)}
function clear_leelaz_board() {leelaz_action("clear_board")}
function future_len() {return history.length - stone_count}

/////////////////////////////////////////////////
// reader

let current_reader

function reader(s) {console.log(s); current_reader(s)}

function main_reader(s) {
    let m, c;
    (m = s.match(/\((.)\) to move/)) && (bturn = m[1] === 'X');
    (m = s.match(/\((.)\) Prisoners: *([0-9]+)/)) &&
        (c = to_i(m[2]), m[1] === 'X' ? b_prison = c : w_prison = c)
    s.match(/NN eval=/) && (current_reader = suggest_reader)
    s.match(/a b c d e f g h j k l m n o p q r s t/) && (current_reader = board_reader)
}

current_reader = main_reader

/////////////////////////////////////////////////
// board reader

// stones = [[stone, ..., stone], ..., [stone, ..., stone]] (19x19, see coord.js)
// stone = {stone: true, black: true} etc. or {} for empty position

// history = [move_data, ..., move_data]
// move_data = {move: "G16", is_black: false} etc.

let stones_buf = []
function board_reader(s) {
    let p = parse_board_line(s); p ? stones_buf.push(p) :
        (finish_board_reader(stones_buf), stones_buf = [], current_reader = main_reader)
}

function finish_board_reader(stones) {
    stone_count = b_prison + w_prison + flatten(stones).filter(x => x.stone).length
    store_last_move(stones)
    renderer('state', {bturn: bturn, stone_count: stone_count, stones: stones,
                       history_length: history.length,
                       sequence_cursor: sequence_cursor, sequence_length: sequence.length,
                       availability: availability()})
}

function store_last_move(stones) {
    let j, i = stones.findIndex(b => (j = (b || []).findIndex(h => h.last)) >= 0)
    if (i < 0) {return}
    let last_move = idx2move(i, j), b = stones[i][j].black
    history[stone_count - 1] = {move: last_move, is_black: b}
}

const char2stone = {
    X: {stone: true, black: true}, x: {stone: true, black: true, last: true},
    O: {stone: true, white: true}, o: {stone: true, white: true, last: true},
}

function parse_board_line(line) {
    const m = line.replace(/\(X\)/g, ' x ').replace(/\(O\)/g, ' o ')
          .replace(/\+/g, '.').replace(/\s/g, '').match(/[0-9]+([XxOo.]+)/)
    if (!m) {return false}
    return m[1].split('').map(c => clone(char2stone[c] || {}))
}

/////////////////////////////////////////////////
// suggestion reader

// suggest = [suggestion_data, ..., suggestion_data]
// suggestion_data = {move: "Q16", playouts: 17, winrate: 52.99, variation: v} etc.
// v = ["Q16", "D4", "Q3", ..., "R17"] etc.

let suggest_buf = []
function suggest_reader(s) {
    if (s.match(/^\s*$/)) {return}
    let m = s.match(/([A-T0-9]+) +-> +([0-9]+).*V: *([0-9.]+)%.*PV: *([A-T0-9 ]*)/)
    m ? suggest_buf.push({move: m[1], playouts: to_i(m[2]), winrate: to_f(m[3]),
                          variation: m[4].trim().split(/ +/)}) :
    (finish_suggest_reader(suggest_buf), suggest_buf = [], current_reader = main_reader)
}

// avoid flicker of stone colors after each play
let skip_next_suggest = false
function skip_suggest() {skip_next_suggest = true}

function finish_suggest_reader(suggest) {
    if (skip_next_suggest) {suggest = []; skip_next_suggest = false}
    let [wsum, psum] = suggest.map(h => [h.winrate, h.playouts])
        .reduce(([ws, ps], [w, p]) => [ws + w * p, ps + p], [0, 0])
    let wrs = suggest.map(h => h.winrate)
    // winrate is NaN if suggest = []
    renderer('suggest', {suggest: suggest, playouts: psum, winrate: wsum / psum,
                         min_winrate: Math.min(...wrs), max_winrate: Math.max(...wrs)})
}

/////////////////////////////////////////////////
// availability

function availability() {
    return {
        undo: stone_count > 0,
        redo: future_len() > 0,
        previous_sequence: sequence_cursor > 0,
        next_sequence: sequence_cursor < sequence.length - 1,
    }
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
// sequence

function backup_history() {
    if (history.length === 0) {return}
    sequence.splice(sequence_cursor, 0, clone_history())
    goto_nth_sequence(sequence_cursor + 1)
}

function create_sequence_maybe() {
    (stone_count < history.length) && (backup_history(), history.splice(stone_count))
}

function next_sequence() {switch_to_nth_sequence(sequence_cursor + 1)}

function previous_sequence() {switch_to_nth_sequence(sequence_cursor - 1)}

function switch_to_nth_sequence(n) {
    (0 <= n) && (n < sequence.length) &&
        (store_stone_count(history), clear_leelaz_board(), goto_nth_sequence(n),
         stone_count = 0, redo_ntimes(history.stone_count))
}

function clone_history() {const hist = clone(history); store_stone_count(hist); return hist}

function store_stone_count(hist) {hist.stone_count = stone_count}

function goto_nth_sequence(n) {history = sequence[sequence_cursor = n]}

/////////////////////////////////////////////////
// SGF

function copy_sgf_to_clipboard() {clipboard.writeText(history_to_sgf(history))}

function paste_sgf_from_clipboard() {read_sgf(clipboard.readText())}

function open_sgf() {
    const fs = electron.dialog.showOpenDialog(null, {
        properties: ['openFile'],
        title: 'Select SGF file',
        // defaultPath: '.',
    })
    fs && fs.forEach(f => load_sabaki_gametree(SGF.parseFile(f)))
}

function history_to_sgf(hist) {
    return '(;KM[7.5]PW[]PB[]' +
        hist.map(({move: move, is_black: is_black}) =>
                 (is_black ? ';B[' : ';W[') + move2sgfpos(move) + ']').join('') +
        ')'
}

function read_sgf(sgf_str) {load_sabaki_gametree(SGF.parse(sgf_str))}

function load_sabaki_gametree(gametree) {
    backup_history(); clear_board(); load_sabaki_gametree_sub(gametree); redo_to_end()
}

function load_sabaki_gametree_sub(gametree) {
    const nodes = gametree[0].nodes
    let f = (positions, is_black) => {
        (positions || []).forEach(pos => history.push({move: sgfpos2move(pos), is_black: is_black}))
    }
    nodes.forEach(h => {f(h.AB, true); f(h.B, true); f(h.W, false)})
}
