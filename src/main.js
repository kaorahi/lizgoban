/////////////////////////////////////////////////
// setup

// electron
const electron = require('electron')
const {dialog, app} = electron
const ipc = electron.ipcMain

// leelaz
const leelaz = require('./engine.js')
const {update, stop_ponder} = leelaz

// game state
let history = [], stones = [[]], stone_count = 0, b_prison = 0, w_prison = 0, bturn = true
let sequence = [history], sequence_cursor = 0;
history.stone_count = stone_count

// socket
const socket_port = 8848
const SOCKET_IO = require("socket.io")
let attached = false

// util
const {to_i, to_f, xor, clone, merge, flatten, each_key_value, array2hash, seq, do_ntimes}
      = require('./util.js')
const {board_size, idx2coord_translator_pair, move2idx, idx2move, sgfpos2move, move2sgfpos}
      = require('./coord.js')
const clipboard = electron.clipboard
const SGF = require('@sabaki/sgf')
const config = new (require('electron-config'))({name: 'lizgoban'})

/////////////////////////////////////////////////
// electron

let windows = [], last_window_id = -1

function new_window(default_board_type) {
    const id = ++last_window_id, conf_key = 'window.id' + id
    const ss = electron.screen.getPrimaryDisplay().size
    const {board_type, position, size} = config.get(conf_key) || {}
    const [x, y] = position || [0, 0]
    const [width, height] = size || [ss.height * 0.7, ss.height * 0.9]
    const win = new electron.BrowserWindow({x, y, width, height})
    win.lizgoban_window_id = id
    win.lizgoban_board_type = board_type || default_board_type
    win.loadURL('file://' + __dirname + '/index.html')
    win.setMenu(null)
    win.on('close',
           () => config.set(conf_key, {board_type: win.lizgoban_board_type,
                                       position: win.getPosition(), size: win.getSize()}))
    windows.push(win)
}

app.on('ready', () => {
    leelaz.start(board_handler, suggest_handler)
    new_window('suggest')
})
app.on('window-all-closed', quit)
function quit() {leelaz.kill(), app.quit()}

function renderer(channel, ...args) {
    windows = windows.filter(win => !win.isDestroyed())
    windows.forEach(win => win.webContents.send(channel, ...args))
}

/////////////////////////////////////////////////
// from renderer

const api = {
    restart, new_window, update, stop_ponder, attach_to_sabaki, detach_from_sabaki,
    play, undo, redo, explicit_undo, pass, undo_ntimes, redo_ntimes, undo_to_start, redo_to_end,
    paste_sgf_from_clipboard, copy_sgf_to_clipboard, open_sgf,
    next_sequence, previous_sequence,
}

function api_handler(handler) {return (e, ...args) => handler(...args)}

each_key_value(api, (channel, handler) => ipc.on(channel, api_handler(handler)))

/////////////////////////////////////////////////
// leelaz action

// game play
function play(move) {
    const [i, j] = move2idx(move); if ((i >= 0) && stones[i][j].stone) {return}
    create_sequence_maybe(); play_move({move: move, is_black: bturn})
}
function play_move(h) {
    renderer('play_maybe', h)
    history.splice(stone_count); history.push(h); set_board(history)
}
function undo() {undo_ntimes(1)}
function redo() {redo_ntimes(1)}
function explicit_undo() {
    (stone_count < history.length) ? undo() : (history.pop(), set_board(history))
}
function pass() {play('pass')}

// multi-undo/redo
function undo_ntimes(n) {goto_stone_count(stone_count - n)}
function redo_ntimes(n) {undo_ntimes(- n)}
function undo_to_start() {undo_ntimes(Infinity)}
function redo_to_end() {redo_ntimes(Infinity)}

// util
function set_board(history) {
    leelaz.set_board(history); stone_count = history.length
    bturn = !(history[history.length - 1] || {}).is_black
}
function goto_stone_count(count) {set_board(history.slice(0, Math.max(count, 0)))}
function future_len() {return history.length - stone_count}
function restart() {leelaz.restart(); switch_to_nth_sequence(sequence_cursor)}

/////////////////////////////////////////////////
// from leelaz

// board
function board_handler(h) {
    stones = h.stones
    add_next_mark_to_stones(stones, history, h.stone_count)
    renderer('state', {bturn: bturn, stone_count: stone_count, stones: stones,
                       history_length: history.length,
                       sequence_cursor: sequence_cursor, sequence_length: sequence.length,
                       attached: attached, availability: availability()})
}

function add_next_mark_to_stones(stones, history, stone_count) {
    if (stone_count >= history.length) {return}
    let h = history[stone_count], [i, j] = move2idx(h.move), s = (i >= 0) && stones[i][j]
    s && (s.next_move = true) && (s.next_is_black = h.is_black)
}

// suggest
function suggest_handler(h) {renderer('suggest', h)}

/////////////////////////////////////////////////
// availability

function availability() {
    return {
        undo: stone_count > 0,
        redo: future_len() > 0,
        previous_sequence: sequence_cursor > 0,
        next_sequence: sequence_cursor < sequence.length - 1,
        attach: !attached,
        detach: attached,
    }
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
        (store_stone_count(history), set_board([]), goto_nth_sequence(n),
         stone_count = 0, redo_ntimes(history.stone_count))
}

function clone_history() {const hist = clone(history); store_stone_count(hist); return hist}

function store_stone_count(hist) {hist.stone_count = stone_count}

function goto_nth_sequence(n) {history = sequence[sequence_cursor = n]}

/////////////////////////////////////////////////
// SGF

function copy_sgf_to_clipboard() {clipboard.writeText(history_to_sgf(history))}

function paste_sgf_from_clipboard() {try_read_sgf(read_sgf, clipboard.readText())}

function open_sgf() {
    const fs = dialog.showOpenDialog(null, {
        properties: ['openFile'],
        title: 'Select SGF file',
        // defaultPath: '.',
    })
    fs && fs.forEach(f => try_read_sgf(g => load_sabaki_gametree(SGF.parseFile(g)), f))
}

function try_read_sgf(f, arg) {
    try {return f(arg)} catch (e) {dialog.showErrorBox("Failed to read SGF", arg)}
}

function history_to_sgf(hist) {
    return '(;KM[7.5]PW[]PB[]' +
        hist.map(({move: move, is_black: is_black}) =>
                 (is_black ? ';B[' : ';W[') + move2sgfpos(move) + ']').join('') +
        ')'
}

function read_sgf(sgf_str) {load_sabaki_gametree_on_new_history(SGF.parse(sgf_str)[0])}

function load_sabaki_gametree_on_new_history(gametree) {
    backup_history(); load_sabaki_gametree(gametree)
}

function load_sabaki_gametree(gametree, index) {
    if (!gametree || !gametree.nodes) {return}
    history.splice(0)
    const nodes = gametree.nodes
    let f = (positions, is_black) => {
        (positions || []).forEach(pos => {
            const move = sgfpos2move(pos)
            move && history.push({move: sgfpos2move(pos), is_black: is_black})
        })
    }
    nodes.forEach(h => {f(h.AB, true); f(h.B, true); f(h.W, false)})
    set_board(history.slice(0, index === undefined ? Infinity : index))
}

/////////////////////////////////////////////////
// socket for Sabaki

let io

function attach_to_sabaki() {
    if (attached) {return}
    io = SOCKET_IO.listen(socket_port)
    io.on("connection", socket => {
        socket.on('sabaki_treepos', ([tree, index]) => load_sabaki_gametree(tree, index))
    })
    attached = true; update()
}

function detach_from_sabaki() {
    if (!attached) {return}
    io.close(); attached = false; update()
}
