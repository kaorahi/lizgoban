/////////////////////////////////////////////////
// command line option

// example:
// npx electron src -j '{"leelaz_args": ["-g", "-w", "/foo/bar/network.gz"]}'

let option = {
    leelaz_command: __dirname + "/../external/leelaz",
    leelaz_args: ["-g", "-w", __dirname + "/../external/network.gz"],
    analyze_interval_centisec: 10,
    sabaki_command: __dirname + '/../external/sabaki',
    minimum_auto_restart_millisec: 5000
}
process.argv.forEach((x, i, a) => (x === "-j") && Object.assign(option, JSON.parse(a[i + 1])))
console.log("option: " + JSON.stringify(option))

/////////////////////////////////////////////////
// setup

// electron
const electron = require('electron')
const {dialog, app, clipboard, Menu} = electron, ipc = electron.ipcMain

// leelaz
const leelaz = require('./engine.js')

// state
let history = [], sequence = [history], sequence_cursor = 0;
history.move_count = 0; history.initial_b_winrate = NaN
history.player_black = history.player_white = ""
let auto_analysis_playouts = Infinity, play_best_until = -1
const simple_ui = false

// renderer state
// (cf.) "set_and_render" in this file
// (cf.) "the_board_handler" and "the_suggest_handler" in engine.js
let R = {stones: [[]]}

// util
const {to_i, to_f, xor, truep, clone, merge, last, flatten, each_key_value, array2hash, seq, do_ntimes}
      = require('./util.js')
const {idx2move, move2idx, idx2coord_translator_pair, uv2coord_translator_pair,
       board_size, sgfpos2move, move2sgfpos} = require('./coord.js')
const SGF = require('@sabaki/sgf'), fs = require('fs'), TMP = require('tmp')
const config = new (require('electron-config'))({name: 'lizgoban'})

// sabaki
let attached = false, has_sabaki = true
fs.access(option.sabaki_command, null,
          (err) => err && fs.access(option.sabaki_command + '.exe', null,
                                    (err) => err && (has_sabaki = false)))

/////////////////////////////////////////////////
// electron

let windows = [], last_window_id = -1

function get_windows() {
    return windows = windows.filter(win => !win.isDestroyed())
}

function get_new_window(file_name, opt) {
    const win = new electron.BrowserWindow(opt)
    win.loadURL('file://' + __dirname + '/' + file_name)
    return win
}

function new_window(default_board_type) {
    const id = ++last_window_id, conf_key = 'window.id' + id
    const ss = electron.screen.getPrimaryDisplay().size
    const {board_type, position, size} = config.get(conf_key) || {}
    const [x, y] = position || [0, 0]
    const [width, height] = size || [ss.height, ss.height * 0.6]
    const win = get_new_window('index.html', {x, y, width, height, show: false})
    win.lizgoban_window_id = id
    win.lizgoban_board_type = board_type || default_board_type
    win.on('close',
           () => config.set(conf_key, {board_type: win.lizgoban_board_type,
                                       position: win.getPosition(), size: win.getSize()}))
    windows.push(win)
    win.once('ready-to-show', () => {update_ui(); win.show()})
}

app.on('ready', () => {
    leelaz.start(option.leelaz_command, option.leelaz_args, option.analyze_interval_centisec,
                 board_handler, suggest_handler, auto_restart)
    update_menu()
    new_window('double_boards')
})
app.on('window-all-closed', quit)
function quit() {leelaz.kill(), app.quit()}

function renderer(channel, ...args) {
    get_windows().forEach(win => win.webContents.send(channel, ...args))
}

/////////////////////////////////////////////////
// from renderer

const api = {
    restart, new_window, init_from_renderer, toggle_ponder, attach_to_sabaki, detach_from_sabaki,
    play, undo, redo, explicit_undo, pass, undo_ntimes, redo_ntimes, undo_to_start, redo_to_end,
    goto_move_count, toggle_auto_analyze, stop_auto_analyze, play_best, stop_play_best,
    paste_sgf_from_clipboard, copy_sgf_to_clipboard, open_sgf, save_sgf,
    next_sequence, previous_sequence, help,
    // for debug
    send_to_leelaz: leelaz.send_to_leelaz,
}

function api_handler(channel, handler) {
    return (e, ...args) => {
        channel !== 'toggle_auto_analyze' && stop_auto_analyze()
        channel !== 'play_best' && stop_play_best()
        handler(...args)
    }
}

each_key_value(api, (channel, handler) => ipc.on(channel, api_handler(channel, handler)))

/////////////////////////////////////////////////
// action

// game play
function play(move) {
    const [i, j] = move2idx(move), pass = (i < 0)
    if (!pass && (!R.stones[i] || !R.stones[i][j] || R.stones[i][j].stone)) {return}
    !pass && (R.stones[i][j] = {stone: true, black: R.bturn, maybe: true})
    create_sequence_maybe(); update_state(); do_play(move, R.bturn)
}
function do_play(move, is_black) {
    history.splice(R.move_count); history.push({move, is_black}); set_board(history)
}
function undo() {undo_ntimes(1)}
function redo() {redo_ntimes(1)}
function explicit_undo() {
    (R.move_count < history.length) ? undo() : (history.pop(), set_board(history))
}
function pass() {play('pass')}

// multi-undo/redo
function undo_ntimes(n) {goto_move_count(R.move_count - n)}
function redo_ntimes(n) {undo_ntimes(- n)}
function undo_to_start() {undo_ntimes(Infinity)}
function redo_to_end() {redo_ntimes(Infinity)}

// util
function set_board(history) {
    leelaz.set_board(history); R.move_count = history.length
    R.bturn = !(history[history.length - 1] || {}).is_black
}
function goto_move_count(count) {set_board(history.slice(0, Math.max(count, 0)))}
function future_len() {return history.length - R.move_count}
function restart() {
    leelaz.restart(); switch_to_nth_sequence(sequence_cursor)
    stop_auto_analyze(); stop_play_best(); update_ui()
}
function toggle_ponder() {leelaz.toggle_ponder(); update_ui()}
function init_from_renderer() {leelaz.update()}

// auto-analyze
function try_auto_analyze(current_playouts) {
    (current_playouts >= auto_analysis_playouts) &&
        (R.move_count < history.length ? redo() :
         (toggle_ponder(), (auto_analysis_playouts = Infinity), update_ui()))
}
function toggle_auto_analyze(playouts) {
    if (history.length === 0) {return}
    auto_analysis_playouts = (auto_analysis_playouts === playouts) ? Infinity :
        (future_len() > 0 || goto_move_count(0),
         leelaz.is_pondering() || toggle_ponder(),
         playouts)
    update_ui()
}
function stop_auto_analyze() {auto_analysis_playouts = Infinity}
function auto_analyzing() {return auto_analysis_playouts < Infinity}
stop_auto_analyze()

// play best move(s)
function play_best(n) {
    stop_auto_analyze()
    play_best_until = Math.max(play_best_until, R.move_count) + (n || 1); try_play_best()
}
function try_play_best() {
    finished_playing_best() ? stop_play_best() :
        R.suggest.length > 0 && play(R.suggest[0].move)
}
function stop_play_best() {play_best_until = -1}
function finished_playing_best() {return play_best_until <= R.move_count}
stop_play_best()

// auto-restart
let last_restart_time = 0
function auto_restart() {
    (Date.now() - last_restart_time >= option.minimum_auto_restart_millisec) ?
        (restart(), last_restart_time = Date.now()) :
        dialog.showMessageBox(null, {
            type: "error", message: "Leela Zero is down.",
            buttons: ["retry", "save SGF and quit", "quit"],
        }, response => [restart, () => (save_sgf(), quit()), quit][response]())
}

// help
function help() {
    const menu = [
        {label: 'File', submenu: [{role: 'close'}]},
        {label: 'View',
         submenu: [{role: 'zoomIn'}, {role: 'zoomOut'}, {role: 'resetZoom'}]}
    ]
    get_new_window('help.html').setMenu(Menu.buildFromTemplate(menu))
}

/////////////////////////////////////////////////
// from leelaz to renderer

function set_renderer_state(...args) {merge(R, ...args)}
function set_and_render(...args) {set_renderer_state(...args); renderer('render', R)}

// board
function board_handler(h) {
    set_renderer_state(h)
    add_next_mark_to_stones(R.stones, history, R.move_count)
    update_state()
}

function update_state() {
    const history_length = history.length, sequence_length = sequence.length, suggest = []
    const player_black = history.player_black, player_white = history.player_white
    set_and_render({
        history_length, suggest, sequence_cursor, sequence_length, attached,
        player_black, player_white
    })
    update_ui(true)
}

function update_ui(ui_only) {
    update_menu(); renderer('update_ui', availability(), ui_only)
}

function add_next_mark_to_stones(stones, history, move_count) {
    if (move_count >= history.length) {return}
    let h = history[move_count], [i, j] = move2idx(h.move), s = (i >= 0) && stones[i][j]
    s && (s.next_move = true) && (s.next_is_black = h.is_black)
}

// suggest
function suggest_handler(h) {
    R.move_count > 0 && (history[R.move_count - 1].suggest = h.suggest)
    R.move_count > 0 ? history[R.move_count - 1].b_winrate = h.b_winrate
        : (history.initial_b_winrate = h.b_winrate)
    const initial_b_winrate = history.initial_b_winrate
    const last_move_b_eval = (h.b_winrate - winrate_before(R.move_count, initial_b_winrate))
    const last_move_eval = last_move_b_eval * (R.bturn ? -1 : 1)
    const winrate_history = winrate_from_history(history, initial_b_winrate)
    show_suggest_p() || (h.suggest = [])
    set_and_render({last_move_b_eval, last_move_eval, winrate_history}, h)
    try_play_best(); try_auto_analyze(h.playouts)
}

function show_suggest_p() {
    return !finished_playing_best() || auto_analysis_playouts >= 10
}  // fixme: customize

/////////////////////////////////////////////////
// sequence (list of histories)

function backup_history() {
    if (history.length === 0) {return}
    store_move_count(history)
    sequence.splice(sequence_cursor + 1, 0, history.slice())  // shallow copy
    set_renderer_state({winrate_history: []})
    goto_nth_sequence(sequence_cursor + 1)
}

function create_sequence_maybe() {
    (R.move_count < history.length) &&
        (backup_history(), history.splice(R.move_count),
         (history.player_black = history.player_white = ""))
}

function next_sequence() {switch_to_nth_sequence(sequence_cursor + 1)}
function previous_sequence() {switch_to_nth_sequence(sequence_cursor - 1)}

function switch_to_nth_sequence(n) {
    (0 <= n) && (n < sequence.length) &&
        (store_move_count(history), set_board([]), goto_nth_sequence(n),
         R.move_count = 0, redo_ntimes(history.move_count))
}

function store_move_count(hist) {hist.move_count = R.move_count}
function goto_nth_sequence(n) {history = sequence[sequence_cursor = n]}

/////////////////////////////////////////////////
// winrate history

function winrate_before(move_count, initial_b_winrate) {return winrate_after(move_count - 1)}

function winrate_after(move_count, initial_b_winrate) {
    return move_count < 0 ? NaN :
        move_count === 0 ? initial_b_winrate :
        (history[move_count - 1] || {b_winrate: NaN}).b_winrate
}

function winrate_from_history(history, initial_b_winrate) {
    return [initial_b_winrate].concat(history.map(m => m.b_winrate)).map((r, s, a) => {
        if (!truep(r)) {return {}}
        const move_eval = a[s - 1] && (r - a[s - 1]) * (history[s - 1].is_black ? 1 : -1)
        const predict = winrate_suggested(s)
        return {r, move_eval, predict}
    })
}

function winrate_suggested(move_count) {
    const {move, is_black} = history[move_count - 1] || {}
    const {suggest} = history[move_count - 2] || {}
    const sw = ((suggest || []).find(h => h.move === move) || {}).winrate
    return truep(sw) && (is_black ? sw : 100 - sw)
}

/////////////////////////////////////////////////
// availability

function availability() {
    return {
        undo: R.move_count > 0,
        redo: future_len() > 0,
        previous_sequence: sequence_cursor > 0,
        next_sequence: sequence_cursor < sequence.length - 1,
        attach: !attached,
        detach: attached,
        pause: leelaz.is_pondering(),
        resume: !leelaz.is_pondering(),
        bturn: R.bturn,
        wturn: !R.bturn,
        auto_analyze: history.length > 0,
        start_auto_analyze: !auto_analyzing(),
        stop_auto_analyze: auto_analyzing(),
        normal_ui: !simple_ui
    }
}

/////////////////////////////////////////////////
// SGF

function copy_sgf_to_clipboard() {clipboard.writeText(history_to_sgf(history))}
function paste_sgf_from_clipboard() {read_sgf(clipboard.readText())}

function open_sgf() {
    const files = dialog.showOpenDialog(null, {
        properties: ['openFile'],
        title: 'Select SGF file',
        // defaultPath: '.',
    })
    files && files.forEach(load_sgf)
}

function load_sgf(filename) {
    read_sgf(fs.readFileSync(filename, {encoding: 'binary'}))
}

function save_sgf() {
    const f = dialog.showSaveDialog(null, {
        title: 'Save SGF file',
        // defaultPath: '.',
    })
    f && fs.writeFile(f, history_to_sgf(history))
}

function history_to_sgf(hist) {
    const f = (t, p) => `${t}[${SGF.escapeString(p || '')}]`
    return `(;KM[7.5]${f('PW', history.player_white)}${f('PB', history.player_black)}` +
        hist.map(({move: move, is_black: is_black}) =>
                 (is_black ? ';B[' : ';W[') + move2sgfpos(move) + ']').join('') +
        ')'
}

function read_sgf(sgf_str) {
    try {load_sabaki_gametree_on_new_history(parse_sgf(sgf_str)[0])}
    catch (e) {dialog.showErrorBox("Failed to read SGF", str)}
}

function parse_sgf(sgf_str) {
    // pick "(; ... ... ])...)"
    return SGF.parse((sgf_str.match(/\(\s*;[^]*\][\s\)]*\)/) || [''])[0])
}

/////////////////////////////////////////////////
// Sabaki gameTree

function load_sabaki_gametree_on_new_history(gametree) {
    backup_history(); load_sabaki_gametree(gametree)
}

function load_sabaki_gametree(gametree, index) {
    if (!gametree || !gametree.nodes) {return}
    const parent_nodes = nodes_from_sabaki_gametree(gametree.parent)
    const new_history = history_from_sabaki_nodes(parent_nodes.concat(gametree.nodes))
    const com = leelaz.common_header_length(history, new_history)
    // keep old history for keeping winrate
    history.splice(com, Infinity, ...new_history.slice(com))
    const idx = (!index && index !== 0) ? Infinity : index
    const nodes_until_index = parent_nodes.concat(gametree.nodes.slice(0, idx + 1))
    const history_until_index = history_from_sabaki_nodes(nodes_until_index)
    history.player_black = (gametree.nodes[0].PB || [""])[0]
    history.player_white = (gametree.nodes[0].PW || [""])[0]
    set_board(history.slice(0, history_until_index.length))
}

function history_from_sabaki_nodes(nodes) {
    let new_history = []
    const f = (positions, is_black) => {
        (positions || []).forEach(pos => {
            const move = sgfpos2move(pos)
            move && new_history.push({move: sgfpos2move(pos), is_black: is_black})
        })
    }
    nodes.forEach(h => {f(h.AB, true); f(h.B, true); f(h.W, false)})
    return new_history
}

function nodes_from_sabaki_gametree(gametree) {
    return (gametree === null) ? [] :
        nodes_from_sabaki_gametree(gametree.parent).concat(gametree.nodes)
}

/////////////////////////////////////////////////
// Sabaki

let sabaki_process

function start_sabaki(...sabaki_args) {
    const sabaki_command = option.sabaki_command
    console.log('start sabaki: ' + JSON.stringify([sabaki_command, sabaki_args]))
    sabaki_process = require('child_process').spawn(sabaki_command, sabaki_args, {detached: true})
    sabaki_process.stdout.on('data', leelaz.each_line(sabaki_reader))
    leelaz.set_error_handler(sabaki_process, detach_from_sabaki)
}

function stop_sabaki() {
    // avoid "Error: kill ESRCH" when sabaki_process is down
    try {
        sabaki_process && (process.platform === 'win32' ? sabaki_process.kill() :
                           // ref. https://azimi.me/2014/12/31/kill-child_process-node-js.html
                           process.kill(- sabaki_process.pid))
    } catch (e) {}
}

function sabaki_reader(line) {
    console.log(`sabaki> ${line}`)
    const m = line.match(/^sabaki_dump_state:\s*(.*)/)
    m && load_sabaki_gametree(...(JSON.parse(m[1]).treePosition || []))
}

function attach_to_sabaki() {
    if (attached || !has_sabaki) {return}
    const sgf_file = TMP.fileSync({mode: 0644, prefix: 'lizgoban-', postfix: '.sgf'})
    const sgf_text = history_to_sgf(history)
    fs.writeSync(sgf_file.fd, sgf_text)
    console.log(`temporary file (${sgf_file.name}) for sabaki: ${sgf_text}`)
    backup_history()
    start_sabaki(sgf_file.name + '#' + R.move_count)
    attached = true; leelaz.update()
}

function detach_from_sabaki() {
    if (!attached || !has_sabaki) {return}
    stop_sabaki(); attached = false; leelaz.update()
}

function toggle_sabaki() {attached ? detach_from_sabaki() : attach_to_sabaki()}

/////////////////////////////////////////////////
// menu

function update_menu() {
    get_windows()
        .forEach(win => win.setMenu(simple_ui ? null :
                                    Menu.buildFromTemplate(menu_template(win))))
}

function menu_template(win) {
    const menu = (label, submenu) => ({label, submenu: submenu.filter(truep)})
    const file_menu = menu('File', [
        {label: 'New window', accelerator: 'CmdOrCtrl+N',
         click: (item, win) =>
         new_window(win.lizgoban_board_type === 'suggest' ? 'variation' : 'suggest')
        },
        {label: 'Open SGF...', accelerator: 'CmdOrCtrl+O', click: open_sgf},
        {label: 'Save SGF...', accelerator: 'CmdOrCtrl+S', click: save_sgf},
        {type: 'separator'},
        {label: 'Reset', accelerator: 'CmdOrCtrl+R', click: restart},
        {type: 'separator'},
        {label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: quit},
    ])
    const edit_menu = menu('Edit', [
        {label: 'Copy SGF', accelerator: 'CmdOrCtrl+C', click: copy_sgf_to_clipboard},
        {label: 'Paste SGF', accelerator: 'CmdOrCtrl+V', click: paste_sgf_from_clipboard},
    ])
    const view_menu = menu('View', [
        board_type_menu_item('Two boards', 'double_boards', win),
        board_type_menu_item('Suggestions', 'suggest', win),
        board_type_menu_item('Principal variation', 'variation', win),
        board_type_menu_item('Raw board', 'raw', win),
        board_type_menu_item('Winrate graph', 'winrate_only', win),
    ])
    const tool_menu = menu('Tool', [
        has_sabaki && {label: 'Attach Sabaki', type: 'checkbox', checked: attached,
                       click: toggle_sabaki},
        {role: 'toggleDevTools'},
    ])
    const help_menu = menu('Help', [
        {label: 'Help', click: help},
    ])
    return [file_menu, edit_menu, view_menu, tool_menu, help_menu]
}

function board_type_menu_item(label, btype, win) {
    return {label, type: 'radio', checked: win.lizgoban_board_type === btype,
            click: () => {win.lizgoban_board_type = btype; update_ui()}}
}
