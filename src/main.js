/////////////////////////////////////////////////
// command line option

// example:
// npx electron src -j '{"leelaz_args": ["-g", "-w", "/foo/bar/network.gz"]}'
// npx electron src -j /foo/bar/config.json

require('./util.js').use(); require('./coord.js').use()
const PATH = require('path'), fs = require('fs')
const default_path_for = name => PATH.join(__dirname, '..', 'external', name)

const option = {
    leelaz_command: default_path_for('leelaz'),
    leelaz_args: ["-g", "-w", default_path_for('network.gz')],
    analyze_interval_centisec: 10,
    minimum_suggested_moves: 30,
    engine_log_line_length: 500,
    sabaki_command: default_path_for('sabaki'),
    minimum_auto_restart_millisec: 5000,
    wait_for_startup: true,
    endstate_leelaz: null,
    weight_dir: undefined,
    shortcut: null,
}
process.argv.forEach((x, i, a) => parse_option(x, a[i + 1]))
function parse_option(cur, succ) {
    const merge_json = str => merge_with_shortcut(JSON.parse(str))
    const merge_with_shortcut = orig =>
          (merge(option, orig), merge(option, from_shortcut(option)))
    const from_shortcut = orig => {
        const first_shortcut = (orig.shortcut || [{}])[0]
        const keys = ['leelaz_command', 'leelaz_args']
        return aa2hash(keys.map(k => [k, first_shortcut[k] || orig[k]]))
    }
    switch (cur) {
    case '-j': merge_json(succ); break
    case '-c': merge_json(fs.readFileSync(succ)); break
    }
}

/////////////////////////////////////////////////
// setup

// electron
const electron = require('electron')
const {dialog, app, clipboard, Menu} = electron, ipc = electron.ipcMain

// util
function safely(proc, ...args) {try {return proc(...args)} catch(e) {return null}}
const TMP = require('tmp')
const store = new (safely(require, 'electron-store') ||
                   // try old name for backward compatibility
                   safely(require, 'electron-config') ||
                   // ... and throw the original error when both fail
                   require('electron-store'))({name: 'lizgoban'})

// debug log
const debug_log_key = 'debug_log'
function update_debug_log() {debug_log(!!store.get(debug_log_key))}
function toggle_debug_log() {debug_log(!!toggle_stored(debug_log_key))}
update_debug_log()

// modules
const {create_game, create_game_from_sgf} = require('./game.js')
const P = require('./powered_goban.js')

// state
let game = create_game()
let sequence = [game], sequence_cursor = 0
let auto_analysis_signed_visits = Infinity, auto_play_count = 0
const simple_ui = false
let auto_play_sec = 0, auto_replaying = false, auto_bturn = true
let pausing = false, busy = false

// renderer state
// (cf.) "set_renderer_state" in powered_goban.js
// (cf.) "the_endstate_handler" and "the_suggest_handler" in engine.js
const stored_keys_for_renderer =
      ['lizzie_style', 'expand_winrate_bar', 'score_bar',
       'let_me_think', 'show_endstate']
const R = {stones: game.current_stones(), bturn: true, ...renderer_preferences()}
P.initialize(R, {on_change: update_let_me_think, on_suggest: try_auto}, {
    // functions used in powered_goban.js
    render, update_state, update_ponder, show_suggest_p, is_pass,
    auto_progress, is_auto_bturn, is_busy,
    error_from_powered_goban,
})
function render(given_R, is_board_changed) {
    renderer('render', given_R, is_board_changed)
}
function is_auto_bturn() {return auto_bturn}
function is_busy() {return busy}
function error_from_powered_goban(message) {
    dialog.showMessageBox({type: "error", buttons: ["OK"], message})
}

// sabaki
let attached = false, has_sabaki = true
fs.access(option.sabaki_command, null,
          (err) => err && fs.access(option.sabaki_command + '.exe', null,
                                    (err) => err && (has_sabaki = false)))

/////////////////////////////////////////////////
// electron

// app

app.on('ready', () => {
    start_leelaz(); new_window('double_boards')
    option.shortcut && apply_option_shortcut(option.shortcut[0], get_windows()[0])
})
app.on('window-all-closed', app.quit)
app.on('quit', kill_all_leelaz)

function start_leelaz() {
    debug_log("option: " + JSON.stringify(option))
    P.start_leelaz(leelaz_start_args, option.endstate_leelaz); update_menu()
}
function kill_all_leelaz() {P.kill_all_leelaz()}

// window

let windows = [], last_window_id = -1

function window_prop(win) {  // fixme: adding private data impolitely
    const private_key = 'lizgoban_window_prop'
    return win[private_key] || (win[private_key] = {
        window_id: -1, board_type: '', previous_board_type: ''
    })
}

function window_for_id(window_id) {
    return get_windows().find(win => window_prop(win).window_id === window_id)
}

function get_windows() {
    return windows = windows.filter(win => !win.isDestroyed())
}

function get_new_window(file_name, opt) {
    const win = new electron.BrowserWindow(opt)
    win.loadURL('file://' + __dirname + '/' + file_name)
    return win
}

function new_window(default_board_type) {
    const window_id = ++last_window_id, conf_key = 'window.id' + window_id
    const ss = electron.screen.getPrimaryDisplay().size
    const {board_type, previous_board_type, position, size, maximized}
          = store.get(conf_key) || {}
    const [x, y] = position || [0, 0]
    const [width, height] = size || [ss.height, ss.height * 0.6]
    const webPreferences = {nodeIntegration: true}
    const win = get_new_window('index.html',
                               {x, y, width, height, webPreferences, show: false})
    const prop = window_prop(win)
    merge(prop, {
        window_id, board_type: board_type || default_board_type, previous_board_type
    })
    win.on('close', () => set_stored(conf_key, {
        board_type: prop.board_type, previous_board_type: prop.previous_board_type,
        position: win.getPosition(), size: win.getSize(), maximized: win.isMaximized(),
    }))
    windows.push(win)
    maximized && win.maximize()
    win.once('ready-to-show', () => {update_ui(); win.show()})
}

// renderer

function renderer(channel, ...args) {renderer_gen(channel, false, ...args)}
function renderer_with_window_prop(channel, ...args) {
    renderer_gen(channel, true, ...args)
}
function renderer_gen(channel, win_prop_p, ...args) {
    // Caution [2018-08-08] [2019-06-20]
    // (1) JSON.stringify(NaN) is 'null' and JSON.stringify({foo: undefined}) is '{}'.
    // (2) IPC converts {foo: NaN} and {bar: undefined} to {}.
    // example:
    // [main.js] renderer('foo', {bar: NaN, baz: null, qux: 3, quux: undefined})
    // [renderer.js] ipc.on('foo', (e, x) => (tmp = x))
    // [result] tmp is {baz: null, qux: 3}
    get_windows().forEach(win => win.webContents
                          .send(channel, ...(win_prop_p ? [window_prop(win)] : []),
                                ...args))
}

/////////////////////////////////////////////////
// main flow (1) receive commands from renderer

// normal commands

const {set_endstate_diff_from} = P
const simple_api = {
    unset_busy, update_menu, toggle_board_type, toggle_let_me_think,
    copy_sgf_to_clipboard, set_endstate_diff_from,
}
const api = merge({}, simple_api, {
    restart, new_window, init_from_renderer, toggle_sabaki,
    toggle_pause,
    play, undo, redo, explicit_undo, pass, undo_ntimes, redo_ntimes, undo_to_start, redo_to_end,
    let_me_think_next,
    goto_move_count, toggle_auto_analyze, play_best, play_weak, auto_play, stop_auto,
    paste_sgf_from_clipboard, open_sgf, save_sgf,
    next_sequence, previous_sequence, nth_sequence, cut_sequence, duplicate_sequence,
    help,
    // for debug
    send_to_leelaz: P.send_to_leelaz,
})

function api_handler(channel, handler, busy) {
    return (e, ...args) => {
        channel === 'toggle_auto_analyze' || stop_auto_analyze()
        channel === 'play_best' || stop_auto_play()
        set_or_unset_busy(busy)
        handler(...args)
    }
}

each_key_value(api, (channel, handler) => {
    const simple = Object.keys(simple_api).indexOf(channel) >= 0
    ipc.on(channel,
           simple ? (e, ...a) => handler(...a) : api_handler(channel, handler))
})

// special commands

function cached(f) {
    let cache = {}; return key => cache[key] || (cache[key] = f(key))
}
const busy_handler_for =
      cached(subchannel => api_handler(subchannel, api[subchannel], true))
ipc.on('busy', (e, subchannel, ...args) => busy_handler_for(subchannel)(e, ...args))

ipc.on('close_window_or_cut_sequence', e => {
           stop_auto()
           get_windows().forEach(win => (win.webContents === e.sender) &&
                                 close_window_or_cut_sequence(win))
       })

/////////////////////////////////////////////////
// main flow (2) change game state and send it to powered_goban

function play(move, force_create, default_tag) {
    const [i, j] = move2idx(move), pass = (i < 0)
    if (!pass && (aa_ref(R.stones, i, j) || {}).stone) {wink(); return}
    const new_sequence_p = (game.len() > 0) && create_sequence_maybe(force_create)
    const tag = game.move_count > 0 && game.new_tag_maybe(new_sequence_p, game.move_count)
    update_state(); do_play(move, R.bturn, tag || default_tag || undefined)
    pass && wink()
}
function do_play(move, is_black, tag) {
    // We drop "double pass" to avoid halt of analysis by Leelaz.
    // B:D16, W:Q4, B:pass ==> ok
    // B:D16, W:Q4, B:pass, W:D4 ==> ok
    // B:D16, W:Q4, B:pass, W:pass ==> B:D16, W:Q4
    is_last_move_pass() && is_pass(move) ? game.pop() :
        game.push({move, is_black, tag, move_count: game.len() + 1})
    P.set_board(game)
}
function undo() {undo_ntimes(1)}
function redo() {redo_ntimes(1)}
function explicit_undo() {
    const delete_last = () => (game.pop(), P.set_board(game), update_state())
    game.move_count < game.len() ? undo() : wink_if_pass(delete_last)
}
const pass_command = 'pass'
function pass() {play(pass_command)}
function is_pass(move) {return move === pass_command}
function is_last_move_pass() {return is_pass(game.last_move())}

function undo_ntimes(n) {wink_if_pass(goto_move_count, game.move_count - n)}
function redo_ntimes(n) {undo_ntimes(- n)}
function undo_to_start() {undo_ntimes(Infinity)}
function redo_to_end() {redo_ntimes(Infinity)}

function goto_move_count(count) {
    const c = clip(count, 0, game.len())
    if (c === game.move_count) {return}
    update_state_to_move_count_tentatively(c)
    P.set_board(game, c)
}
function update_state_to_move_count_tentatively(count) {
    const forward = (count > game.move_count)
    const [from, to] = forward ? [game.move_count, count] : [count, game.move_count]
    const set_stone_at = (move, stone_array, stone) => {
        aa_set(stone_array, ...move2idx(move), stone)
    }
    game.slice(from, to).forEach(m => set_stone_at(m.move, R.stones, {
        stone: true, maybe: forward, maybe_empty: !forward, black: m.is_black
    }))
    const next_h = game.ref(game.move_count + 1)
    const next_s = P.stone_for_history_elem(next_h, R.stones) || {}
    next_s.next_move = false; game.move_count = count; R.bturn = (count % 2 === 0)
    update_state()
}

/////////////////////////////////////////////////
// another source of change: menu

function update_menu() {mac_p() ? update_app_menu() : update_window_menu()}
function update_app_menu() {
    const win = electron.BrowserWindow.getFocusedWindow() || get_windows()[0]
    win && electron.Menu.setApplicationMenu(menu_for_window(win))
}
function update_window_menu() {
    get_windows().forEach(win => win.setMenu(menu_for_window(win)))
}
function menu_for_window(win) {return Menu.buildFromTemplate(menu_template(win))}

function menu_template(win) {
    const menu = (label, submenu) => ({label, submenu: submenu.filter(truep)})
    const stop_auto_and = f => ((...a) => {stop_auto(); f(...a)})
    const ask_sec = redoing => ((this_item, win) => ask_auto_play_sec(win, redoing))
    const item = (label, accelerator, click, standalone_only, enabled, keep_auto) =>
          !(standalone_only && attached) && {
              label, accelerator, click: keep_auto ? click : stop_auto_and(click),
              enabled: enabled || (enabled === undefined)
          }
    const sep = {type: 'separator'}
    const insert_if = (pred, ...items) => pred ? items : []
    const lz_white = P.leelaz_for_white_p()
    const dup = until_current_move_p =>
          () => duplicate_sequence(until_current_move_p, true)
    const file_menu = menu('File', [
        item('New empty board', 'CmdOrCtrl+N', new_empty_board, true),
        item('New handicap game', undefined, ask_handicap_stones, true),
        item('New window', 'CmdOrCtrl+Shift+N',
             (this_item, win) => new_window(window_prop(win).board_type === 'suggest' ?
                                            'variation' : 'suggest')),
        sep,
        item('Open SGF...', 'CmdOrCtrl+O', open_sgf, true),
        item('Save SGF...', 'CmdOrCtrl+S', save_sgf, true),
        sep,
        item('Reset', 'CmdOrCtrl+R', restart),
        lz_white ?
            item('Load weights for black', 'Shift+L', load_leelaz_for_black) :
            item('Load network weights', 'Shift+L', load_weight),
        item('Load engine', undefined, load_engine),
        sep,
        item('Close', undefined, (this_item, win) => win.close()),
        item('Quit', undefined, app.quit),
    ])
    const edit_menu = menu('Edit', [
        item('Copy SGF', 'CmdOrCtrl+C', copy_sgf_to_clipboard, true),
        item('Paste SGF', 'CmdOrCtrl+V', paste_sgf_from_clipboard, true),
        sep,
        item('Delete board', 'CmdOrCtrl+X', cut_sequence, true),
        item('Undelete board', 'CmdOrCtrl+Z', uncut_sequence, true,
             exist_deleted_sequence()),
        item('Duplicate board', 'CmdOrCtrl+D', dup(false), true),
        item('Duplicate until current move', 'CmdOrCtrl+K', dup(true), true),
        sep,
        {label: 'Trial board', type: 'checkbox', checked: game.trial,
         click: toggle_trial},
    ])
    const view_menu = menu('View', [
        board_type_menu_item('Two boards A (main+PV)', 'double_boards', win),
        board_type_menu_item('Two boards B (main+raw)', 'double_boards_raw', win),
        board_type_menu_item('Two boards C (raw+sub)', 'double_boards_swap', win),
        board_type_menu_item('Two boards D (raw+PV)', 'double_boards_raw_pv', win),
        board_type_menu_item('Suggestions', 'suggest', win),
        board_type_menu_item('Principal variation', 'variation', win),
        board_type_menu_item('Raw board', 'raw', win),
        board_type_menu_item('Winrate graph', 'winrate_only', win),
        sep,
        store_toggler_menu_item('Let me think first', 'let_me_think', 'Shift+M',
                                toggle_let_me_think),
        sep,
        store_toggler_menu_item('Lizzie style', 'lizzie_style'),
        store_toggler_menu_item('Expand winrate bar', 'expand_winrate_bar', 'Shift+B'),
        ...insert_if(P.katago_p(),
                     store_toggler_menu_item('Score bar', 'score_bar', 'Shift+C')),
        ...insert_if(P.leelaz_for_endstate_p(),
            sep,
            store_toggler_menu_item(`Endstate (diff: ${P.get_endstate_diff_interval()} moves)`, 'show_endstate', 'Shift+E'),
            item('...longer diff', '{', endstate_diff_interval_adder(1),
                 false, R.show_endstate, true),
            item('...shorter diff', '}', endstate_diff_interval_adder(-1),
                 false, R.show_endstate, true))
    ])
    const tool_menu = menu('Tool', [
        item('Auto replay', 'Shift+A', ask_sec(true), true),
        item('Self play', 'Shift+P', ask_sec(false), true),
        item('...Skip to next', 'CmdOrCtrl+E', skip_auto,
             true, auto_analyzing_or_playing(), true),
        sep,
        {label: 'Alternative weights for white', accelerator: 'CmdOrCtrl+Shift+L',
         type: 'checkbox', checked: lz_white,
         click: stop_auto_and(lz_white ?
                              P.unload_leelaz_for_white : load_leelaz_for_white)},
        lz_white ?
            item('Swap black/white weights', 'Shift+S',
                 P.swap_leelaz_for_black_and_white) :
            item('Switch to previous weights', 'Shift+S',
                 switch_to_previous_weight, false, !!previous_weight_file),
        sep,
        ...insert_if(P.support_komi_p(),
            item(`Komi (${P.get_engine_komi()})`, undefined, ask_engine_komi)),
        item('Tag / Untag', 'Ctrl+Space', tag_or_untag),
        has_sabaki && {label: 'Attach Sabaki', type: 'checkbox', checked: attached,
                       accelerator: 'CmdOrCtrl+T', click: toggle_sabaki},
        item('Info', 'CmdOrCtrl+I', info),
    ])
    const debug_menu = menu('Debug', [
        store_toggler_menu_item('Debug log', debug_log_key, null, toggle_debug_log),
        {role: 'toggleDevTools'},
    ])
    const help_menu = menu('Help', [
        item('Help', undefined, help),
    ])
    return [file_menu, edit_menu, view_menu, tool_menu,
            ...shortcut_menu_maybe(menu, item, win), debug_menu, help_menu]
}

function board_type_menu_item(label, type, win) {
    return {label, type: 'radio', checked: window_prop(win).board_type === type,
            click: (this_item, win) => set_board_type(type, win)}
}

function store_toggler_menu_item(label, key, accelerator, on_click) {
    const toggle_it = () => toggle_stored(key)
    return {label, accelerator, type: 'checkbox', checked: store.get(key),
            click: on_click || toggle_it}
}

function toggle_stored(key) {
    const val = !get_stored(key); set_stored(key, val); update_state(); return val
}

function shortcut_menu_maybe(menu, item, win) {
    // option.shortcut = [rule, rule, ...]
    // rule = {label: "mixture", accelerator: "F2", board_type: "raw",
    //         empty_board: true, leelaz_command: "/foo/leelaz",
    //         leelaz_args: ["-g", "-w", "/foo/227.gz"],
    //         weight_file: "/foo/035.gz", "weight_file_for_white": "/foo/157.gz"}
    if (!option.shortcut) {return []}
    const doit = a => (wink(), apply_option_shortcut(a, win))
    const shortcut_menu_item = a => item(a.label, a.accelerator, () => doit(a), true)
    return [menu('Shortcut', option.shortcut.map(shortcut_menu_item))]
}

function apply_option_shortcut(rule, win) {
    // merge rule.option for backward compatibility to 1a88dd40
    const a = merge({}, rule, rule.option || {})
    const {empty_board, board_type, weight_file, weight_file_for_white,
           engine_for_white} = a
    const {leelaz_command, leelaz_args} = merge({}, option, a)
    const need_restart = (a.leelaz_command !== option.leelaz_command) ||
          (a.leelaz_args !== option.leelaz_args)
    const load = (switcher, file) => switcher(() => load_weight_file(file))
    empty_board && !game.is_empty() && new_empty_board()
    board_type && set_board_type(board_type, win)
    need_restart && merge_option_and_restart({leelaz_command, leelaz_args})
    weight_file && load(P.load_leelaz_for_black, weight_file)
    weight_file_for_white ? load(P.load_leelaz_for_white, weight_file_for_white) :
        P.unload_leelaz_for_white()
    engine_for_white && P.set_engine_for_white(engine_for_white)
    resume()
}

function merge_option_and_restart(opts) {
    P.unload_leelaz_for_white(); kill_all_leelaz()
    merge(option, opts); start_leelaz()
}

/////////////////////////////////////////////////
// another source of change: auto-analyze / auto-play

// common
function try_auto(force_next) {
    auto_playing() ? try_auto_play(force_next) :
        auto_analyzing() ? try_auto_analyze(force_next) : do_nothing()}
function skip_auto() {try_auto(true)}
function auto_progress() {
    return Math.max(auto_analysis_progress(), auto_play_progress())
}
function stop_auto() {stop_auto_analyze(); stop_auto_play(); update_ui()}
function auto_analyzing_or_playing() {return auto_analyzing() || auto_playing()}

// auto-analyze (redo after given visits)
function try_auto_analyze(force_next) {
    const done = force_next || (auto_analysis_progress() >= 1)
    const next = (pred, proc) => pred() ?
          proc() : (pause(), stop_auto_analyze(), update_ui())
    auto_bturn = xor(R.bturn, done)
    done && next(...(backward_auto_analysis_p() ? [undoable, undo] : [redoable, redo]))
}
function toggle_auto_analyze(visits) {
    if (game.is_empty()) {wink(); return}
    (auto_analysis_signed_visits === visits) ?
        (stop_auto_analyze(), update_ui()) :
        start_auto_analyze(visits)
}
function start_auto_analyze(visits) {
    auto_analysis_signed_visits = visits; rewind_maybe(); resume(); update_ui()
}
function stop_auto_analyze() {auto_analysis_signed_visits = Infinity}
function auto_analyzing() {return auto_analysis_signed_visits < Infinity}
function auto_analysis_progress() {
    return !auto_analyzing() ? -1 :
        (!R.suggest || !R.suggest[0]) ? 0 :
        R.suggest[0].visits / auto_analysis_visits()
}
function auto_analysis_visits() {return Math.abs(auto_analysis_signed_visits)}
function backward_auto_analysis_p() {return auto_analysis_signed_visits < 0}
function rewind_maybe() {
    backward_auto_analysis_p() ?
        (undoable() || redo_to_end()) : (redoable() || undo_to_start())
}
stop_auto_analyze()

// auto-play (auto-replay (redo) or self-play (play_best) in every XX seconds)
let last_auto_play_time = 0
function auto_play(sec, explicitly_playing_best) {
    explicitly_playing_best ? (auto_replaying = false) : (auto_play_count = Infinity)
    auto_replaying && rewind_maybe()
    auto_play_sec = sec || -1; stop_auto_analyze()
    update_auto_play_time(); update_let_me_think(); resume(); update_ui()
}
function try_auto_play(force_next) {
    force_next && (last_auto_play_time = - Infinity)
    auto_play_ready() && (auto_replaying ? try_auto_replay() : try_play_best())
    update_let_me_think(true)
}
function try_auto_replay() {do_as_auto_play(redoable(), redo)}
function auto_play_ready() {
    return !empty(R.suggest) && Date.now() - last_auto_play_time >= auto_play_sec * 1000
}
function do_as_auto_play(playable, proc) {
    playable ? (proc(), update_auto_play_time()) : (stop_auto_play(), pause())
}
function update_auto_play_time() {last_auto_play_time = Date.now(); auto_bturn = R.bturn}
function auto_play_progress() {
    return auto_playing(true) ?
        (Date.now() - last_auto_play_time) / (auto_play_sec * 1000) : -1
}
function ask_auto_play_sec(win, replaying) {
    auto_replaying = replaying; win.webContents.send('ask_auto_play_sec')
}
function increment_auto_play_count(n) {
    auto_playing(true) && stop_auto_play()
    auto_play_count += (n || 1)  // It is Infinity after all if n === Infinity
}
function decrement_auto_play_count() {auto_play_count--}
function stop_auto_play() {
    auto_playing() && ((auto_play_count = 0), let_me_think_exit_autoplay())
}
function auto_playing(forever) {
    return auto_play_count >= (forever ? Infinity : 1)
}

/////////////////////////////////////////////////
// play against leelaz

function play_best(n, weaken_method, ...weaken_args) {
    auto_play(null, true); increment_auto_play_count(n)
    try_play_best(weaken_method, ...weaken_args)
}
function play_weak(percent) {
    play_best(null, P.leelaz_for_white_p() ? 'random_leelaz' : 'random_candidate', percent)
}
function try_play_best(weaken_method, ...weaken_args) {
    // (ex)
    // try_play_best()
    // try_play_best('pass_maybe')
    // try_play_best('random_candidate', 30)
    // try_play_best('random_leelaz', 30)
    weaken_method === 'random_leelaz' && P.switch_to_random_leelaz(...weaken_args)
    if (empty(R.suggest)) {return}
    const move = (weaken_method === 'random_candidate' ?
                  weak_move(...weaken_args) : best_move())
    const pass_maybe =
          () => P.peek_value('pass', value => play(value < 0.9 ? 'pass' : move))
    const play_it = () => {
        decrement_auto_play_count()
        weaken_method === 'pass_maybe' ? pass_maybe() : play(move)
    }
    do_as_auto_play(move !== 'pass', play_it)
}
function best_move() {return R.suggest[0].move}
function weak_move(weaken_percent) {
    // (1) Converge winrate to 0 with move counts
    // (2) Occasionally play good moves with low probability
    // (3) Do not play too bad moves
    const r = clip((weaken_percent || 0) / 100, 0, 1)
    const initial_target_winrate = 40 * 10**(- r)
    const target = initial_target_winrate * 2**(- game.move_count / 100)  // (1)
    const flip_maybe = x => R.bturn ? x : 100 - x
    const current_winrate = flip_maybe(winrate_after(game.move_count))
    const u = Math.random()**(1 - r) * r  // (2)
    const next_target = current_winrate * (1 - u) + target * u  // (3)
    return nearest_move_to_winrate(next_target)
}
function nearest_move_to_winrate(target_winrate) {
    const min_by = (f, a) => {
        const b = a.map(f), m = Math.min(...b); return a[b.indexOf(m)]
    }
    const not_too_bad = R.suggest.filter(s => s.winrate >= target_winrate)
    const selected = min_by(s => Math.abs(s.winrate - target_winrate),
                  empty(not_too_bad) ? R.suggest : not_too_bad)
    debug_log(`weak_move: target_winrate=${target_winrate} ` +
              `move=${selected.move} winrate=${selected.winrate} ` +
              `visits=${selected.visits} order=${selected.order} ` +
              `winrate_order=${selected.winrate_order}`)
    return selected.move
}
function winrate_after(move_count) {
    const or_NaN = x => truep(x) ? x : NaN
    return move_count < 0 ? NaN :
        move_count === 0 ? P.get_initial_b_winrate() :
        or_NaN(game.ref(move_count).b_winrate)
}

/////////////////////////////////////////////////
// other actions

// board type
function toggle_board_type(window_id, type) {
    if (let_me_think_p() && !type) {toggle_board_type_in_let_me_think(); return}
    const win = window_for_id(window_id)
    const {board_type, previous_board_type} = window_prop(win)
    const new_type = (type && board_type !== type) ? type : previous_board_type
    set_board_type(new_type, win, !type)
}
function set_board_type(type, win, keep_let_me_think) {
    const prop = window_prop(win), {board_type, previous_board_type} = prop
    if (!type || type === board_type) {return}
    keep_let_me_think || stop_let_me_think()
    merge(prop, {board_type: type, previous_board_type: board_type}); update_ui()
}

// handicap stones & komi
function add_handicap_stones(k) {
    // [2019-04-29] ref.
    // https://www.nihonkiin.or.jp/teach/lesson/school/start.html
    // https://www.nihonkiin.or.jp/teach/lesson/school/images/okigo09.gif
    const exceptions = [5, 7], first = 'Q16', center = 'K10'
    const pos = [first, 'D4', 'Q4', 'D16', 'Q10', 'D10', 'K16', 'K4', center]
    const moves = pos.slice(0, k)
    exceptions.includes(k) && (moves[k - 1] = center)
    moves.forEach(m => do_play(m, true))
}
function ask_handicap_stones() {
    const proc = k => {game.is_empty() || new_empty_board(); add_handicap_stones(k)}
    ask_choice("Handicap stones", seq(8, 2), proc)
}
function ask_engine_komi() {
    const values = [-0.5, 0.5, 4.5, 5.5, 6.5, 7.5, 8.5]
    const proc = k => {P.set_engine_komi(k)}
    ask_choice(`Engine Komi (${P.get_engine_komi()})`, values, proc)
}
function ask_choice(message, values, proc) {
    const buttons = [...values.map(to_s), 'cancel']
    const action = response => {const v = values[response]; truep(v) && proc(v)}
    dialog.showMessageBox(null, {type: "question", message, buttons}, action)
}

// misc.
function toggle_trial() {game.trial = !game.trial; update_state()}
function close_window_or_cut_sequence(win) {
    get_windows().length > 1 ? win.close() :
        attached ? null :
        (sequence.length <= 1 && game.is_empty()) ? win.close() : cut_sequence()
}
function help() {
    const menu = [
        {label: 'File', submenu: [{role: 'close'}]},
        {label: 'View',
         submenu: [{role: 'zoomIn'}, {role: 'zoomOut'}, {role: 'resetZoom'}]}
    ]
    get_new_window('help.html').setMenu(Menu.buildFromTemplate(menu))
}
function info() {
    const f = (label, s) => s ?
          `<${label}>\n` + fold_text(JSON.stringify(s), 60, 5) + '\n\n' : ''
    const sa = P.all_start_args()
    const lz = P.leelaz_for_white_p() ?
          (f("leelaz (black)", sa.black) + f("leelaz (white)", sa.white)) :
          f("leelaz", sa.both)
    const message = lz +
          f("sgf file", game.sgf_file) +
          f("sgf", game.sgf_str)
    dialog.showMessageBox({type: "info",  buttons: ["OK"], message})
}
function endstate_diff_interval_adder(k) {
    return () => P.add_endstate_diff_interval(k)
}
function tag_or_untag() {
    if (game.move_count === 0) {wink(); return}
    game.add_or_remove_tag(); P.update_info_in_stones(); update_state()
}

/////////////////////////////////////////////////
// utils for actions

function undoable() {return game.move_count > 0}
function redoable() {return game.len() > game.move_count}
function pause() {pausing = true; update_ponder_and_ui()}
function resume() {pausing = false; update_ponder_and_ui()}
function toggle_pause() {pausing = !pausing; update_ponder_and_ui()}
function set_or_unset_busy(bool) {busy = bool; update_ponder()}
function set_busy() {set_or_unset_busy(true)}
function unset_busy() {set_or_unset_busy(false); update_state(true)}
function update_ponder() {P.set_pondering(pausing, busy)}
function update_ponder_and_ui() {update_ponder(); update_ui()}
function init_from_renderer() {update_state()}

function wink_if_pass(proc, ...args) {
    const rec = () => game.ref(game.move_count)
    const before = rec()
    proc(...args)
    const after = rec(), d = after.move_count - before.move_count
    if (Math.abs(d) !== 1) {return}
    const implicit_pass = !!before.is_black === !!after.is_black
    const pass = implicit_pass || is_pass((d === 1 ? after : before).move)
    pass && wink()
}
function wink() {renderer('wink')}

function fold_text(str, n, max_lines) {
    const fold_line =
          s => s.split('').map((c, i) => i % n === n - 1 ? c + '\n' : c).join('')
    const cut = s => s.split('\n').slice(0, max_lines).join('\n')
    return cut(str.split('\n').map(fold_line).join('\n'))
}

/////////////////////////////////////////////////
// let-me-think-first mode

// fixme: this mode uses the first window even if it is requested from other windows
function let_me_think_window() {return get_windows()[0]}

const let_me_think_board_type =
      {first_half: 'double_boards_swap', latter_half: 'double_boards'}
let let_me_think_previous_stage = null

function update_let_me_think(only_when_stage_is_changed) {
    if (!let_me_think_p()) {let_me_think_previous_stage = null; return}
    let_me_think_switch_board_type(only_when_stage_is_changed)
}
function let_me_think_switch_board_type(only_when_stage_is_changed) {
    const progress = auto_play_progress(); if (progress < 0) {return}
    const stage = progress < 0.5 ? 'first_half' : 'latter_half'
    if (only_when_stage_is_changed && stage === let_me_think_previous_stage) {return}
    let_me_think_set_board_type_for(stage)
}
function let_me_think_set_board_type_for(stage) {
    set_board_type(let_me_think_board_type[let_me_think_previous_stage = stage],
                   let_me_think_window(), true)
}

function toggle_board_type_in_let_me_think() {
    const win = let_me_think_window()
    const current_type = window_prop(win).board_type
    const all_types = Object.values(let_me_think_board_type)
    const other_type = all_types.find(type => type != current_type)
    set_board_type(other_type, win, true)
}
function let_me_think_exit_autoplay() {let_me_think_set_board_type_for('latter_half')}

function toggle_let_me_think() {set_let_me_think(!let_me_think_p())}
function stop_let_me_think() {set_let_me_think(false)}
function set_let_me_think(val) {
    set_stored('let_me_think', val); update_let_me_think(); update_state()
}
function let_me_think_p() {return store.get('let_me_think')}

function let_me_think_next(board_type) {
    const stay = (board_type === let_me_think_board_type.first_half)
    stay || (redoable() ? redo() : play_best())
    let_me_think_set_board_type_for(stay ? 'latter_half' : 'first_half')
}

/////////////////////////////////////////////////
// sequence (list of histories)

function new_empty_board() {insert_sequence(create_game(), true)}

function backup_game() {backup_and_replace_game(game.shallow_copy())}
function backup_and_replace_game(new_game) {
    game.is_empty() ? replace_sequence(new_game) : insert_sequence(new_game, true)
}

function create_sequence_maybe(force) {
    const create_p = force || game.move_count < game.len()
    const empty_now = game.move_count === 0
    return !create_p ? false : empty_now ? (new_empty_board(), true) :
        (backup_game(), game.delete_future(), merge(game, {trial: true}), true)
}

function next_sequence() {previous_or_next_sequence(1)}
function previous_sequence() {previous_or_next_sequence(-1)}
function previous_or_next_sequence(delta, effect) {
    sequence.length > 1 && nth_sequence(sequence_cursor + delta)
}
function nth_sequence(n) {
    const old = sequence_cursor
    if (n === old) {return}
    switch_to_nth_sequence(n)
    n < old ? previous_sequence_effect() : next_sequence_effect()
}

let cut_first_p = false
function cut_sequence() {
    cut_first_p = (sequence_cursor === 0)
    push_deleted_sequence(game); delete_sequence()
}
function uncut_sequence() {
    insert_before = (cut_first_p && sequence_cursor === 0)
    exist_deleted_sequence() &&
        insert_sequence(pop_deleted_sequence(), true, insert_before)
}

function duplicate_sequence(until_current_move_p, explicit) {
    const del_future = () => {
        game.delete_future(); P.set_board(game)
        P.update_info_in_stones()  // remove next_move mark
    }
    game.is_empty() ? new_empty_board() :
        (backup_game(), game.set_last_loaded_element(), (game.trial = !explicit),
         (until_current_move_p && del_future()),
         update_state())
}

function delete_sequence() {
    sequence.length === 1 && (sequence[1] = create_game())
    delete_sequence_internal()
    const nextp = (sequence_cursor === 0)
    switch_to_nth_sequence(Math.max(sequence_cursor - 1, 0))
    nextp ? next_sequence_effect() : previous_sequence_effect()
}
function delete_sequence_internal() {sequence.splice(sequence_cursor, 1)}

function insert_sequence(new_game, switch_to, before) {
    if (!new_game) {return}
    const f = switch_to ? switch_to_nth_sequence : goto_nth_sequence
    const n = sequence_cursor + (before ? 0 : 1)
    sequence.splice(n, 0, new_game); f(n); next_sequence_effect()
}
function replace_sequence(new_game) {
    sequence.splice(sequence_cursor, 1, new_game)
    switch_to_nth_sequence(sequence_cursor)
}

function switch_to_nth_sequence(n) {
    const len = sequence.length, wrapped_n = (n + len) % len
    goto_nth_sequence(wrapped_n); P.set_board(game); update_state()
}

function goto_nth_sequence(n) {game = sequence[sequence_cursor = n]}
function next_sequence_effect() {renderer('slide_in', 'next')}
function previous_sequence_effect() {renderer('slide_in', 'previous')}

const deleted_sequences = []
const max_deleted_sequences = 100
function push_deleted_sequence(sequence) {
    deleted_sequences.push(sequence)
    deleted_sequences.splice(max_deleted_sequences)
}
function pop_deleted_sequence() {return deleted_sequences.pop()}
function exist_deleted_sequence() {return !empty(deleted_sequences)}

/////////////////////////////////////////////////
// utils for updating renderer state

function update_state(keep_suggest_p) {
    const history_length = game.len(), sequence_length = sequence.length
    const sequence_ids = sequence.map(h => h.id)
    const pick_tagged = h => {
        const h_copy = P.append_endstate_tag_maybe(h)
        return h_copy.tag ? [h_copy] : []
    }
    const history_tags = flatten(game.map(pick_tagged))
    const {player_black, player_white, trial} = game
    P.set_and_render({
        history_length, sequence_cursor, sequence_length, attached,
        player_black, player_white, trial, sequence_ids, history_tags
    }, keep_suggest_p ? {} : {suggest: []})
    update_ui(true)
}

function update_ui(ui_only) {
    update_menu(); renderer_with_window_prop('update_ui', availability(), ui_only)
}

function set_stored(key, val) {
    store.set(key, val); stored_keys_for_renderer.includes(key) && (R[key] = val)
}
function get_stored(key) {
    return stored_keys_for_renderer.includes(key) ? R[key] : store.get(key)
}
function renderer_preferences() {
    return aa2hash(stored_keys_for_renderer.map(key => [key, store.get(key, false)]))
}

function show_suggest_p() {return auto_playing() || auto_analysis_visits() >= 10}

function availability() {
    return {
        undo: game.move_count > 0,
        redo: redoable(),
        attach: !attached,
        detach: attached,
        pause: !pausing,
        resume: pausing,
        bturn: R.bturn,
        wturn: !R.bturn,
        auto_analyze: !game.is_empty(),
        start_auto_analyze: !auto_analyzing_or_playing(),
        stop_auto: auto_progress() >= 0,
        simple_ui: simple_ui, normal_ui: !simple_ui,
        trial: game.trial,
    }
}

/////////////////////////////////////////////////
// leelaz process

// load weight file
let previous_weight_file = null
function load_weight() {
    return load_weight_file(select_files('Select weight file for leela zero')[0])
}
function load_weight_file(weight_file) {
    const current_weight_file = P.leelaz_weight_file()
    if (!weight_file) {return false}
    weight_file !== current_weight_file &&
        (previous_weight_file = current_weight_file)
    restart_with_args(leelaz_start_args(weight_file), true)
    return weight_file
}
function select_files(title) {
    return files = dialog.showOpenDialog(null, {
        properties: ['openFile'], title: title,
        defaultPath: option.weight_dir,
    }) || []
}
function switch_to_previous_weight() {load_weight_file(previous_weight_file)}

// load engine
function load_engine() {
    const leelaz_command = select_files('Select engine')[0]
    leelaz_command && merge_option_and_restart({leelaz_command})
}

// restart
function restart() {restart_with_args()}
function restart_with_args(h, new_weight_p) {P.restart(h, new_weight_p)}
let last_restart_time = 0
function auto_restart() {
    const buttons =
          ["retry", "load weight", "load engine", "save & quit", "quit"]
    const actions =
          [restart, load_weight, load_engine, () => (save_sgf(), app.quit()), app.quit];
    (Date.now() - last_restart_time >= option.minimum_auto_restart_millisec) ?
        (restart(), last_restart_time = Date.now()) :
        dialog.showMessageBox(null, {
            type: "error", message: "Leela Zero is down.", buttons: buttons,
        }, response => actions[response]())
}

// util
function leelaz_start_args(weight_file) {
    const leelaz_args = option.leelaz_args.slice()
    const komi = P.get_engine_komi()
    const h = {leelaz_args, komi, weight_file,
               restart_handler: auto_restart, ready_handler: on_ready}
    const opts = ['leelaz_command', 'analyze_interval_centisec', 'wait_for_startup',
                  'minimum_suggested_moves', 'engine_log_line_length']
    opts.forEach(key => h[key] = option[key])
    return h
}
function on_ready() {
    // fixme: on_ready is called by *every* leelaz
    // (leelaz_for_black, leelaz_for_white, and leelaz_for_endstate).
    // This interferes starting-up sequence of another leelaz in engine.js.
    switch_to_nth_sequence(sequence_cursor); stop_auto(); update_state()
}

/////////////////////////////////////////////////
// another leelaz for white

function load_leelaz_for_black() {P.load_leelaz_for_black(load_weight)}
function load_leelaz_for_white() {P.load_leelaz_for_white(load_weight)}

/////////////////////////////////////////////////
// SGF

function copy_sgf_to_clipboard() {clipboard.writeText(game.to_sgf()); wink()}
function paste_sgf_from_clipboard() {read_sgf(clipboard.readText())}

function open_sgf() {select_files('Select SGF file').forEach(load_sgf)}
function load_sgf(filename) {
    read_sgf(fs.readFileSync(filename, {encoding: 'utf8'}))
    game.sgf_file = filename
}

function save_sgf() {
    const f = dialog.showSaveDialog(null, {
        title: 'Save SGF file',
        // defaultPath: '.',
    })
    f && fs.writeFile(f, game.to_sgf(), err => {if (err) throw err})
}

function read_sgf(sgf_str) {
    const new_game = create_game_from_sgf(sgf_str)
    new_game ? backup_and_replace_game(new_game) :
        dialog.showErrorBox("Failed to read SGF", 'SGF text: "' + sgf_str + '"')
}

/////////////////////////////////////////////////
// Sabaki gameTree

function load_sabaki_gametree_on_new_game(gametree) {
    backup_game(); load_sabaki_gametree(gametree)
}

function load_sabaki_gametree(gametree, index) {
    if (!game.load_sabaki_gametree(gametree, index)) {return}
    P.set_board(game)
    // force update of board color when C-c and C-v are typed successively
    update_state()
}

/////////////////////////////////////////////////
// Sabaki

let sabaki_process

function start_sabaki(...sabaki_args) {
    const sabaki_command = option.sabaki_command
    debug_log('start sabaki: ' + JSON.stringify([sabaki_command, sabaki_args]))
    sabaki_process = require('child_process').spawn(sabaki_command, sabaki_args, {detached: true})
    sabaki_process.stdout.on('data', each_line(sabaki_reader))
    set_error_handler(sabaki_process, detach_from_sabaki)
}

function stop_sabaki() {
    // avoid "Error: kill ESRCH" when sabaki_process is down
    safely(() => {
        sabaki_process && (process.platform === 'win32' ? sabaki_process.kill() :
                           // ref. https://azimi.me/2014/12/31/kill-child_process-node-js.html
                           process.kill(- sabaki_process.pid))
    })
}

function sabaki_reader(line) {
    debug_log(`sabaki> ${line}`)
    const m = line.match(/^sabaki_dump_state:\s*(.*)/)
    m && load_sabaki_gametree(...(JSON.parse(m[1]).treePosition || []))
}

function attach_to_sabaki() {
    if (attached || !has_sabaki) {return}
    const sgf_file = TMP.fileSync({mode: 0644, prefix: 'lizgoban-', postfix: '.sgf'})
    const sgf_text = game.to_sgf()
    fs.writeSync(sgf_file.fd, sgf_text)
    debug_log(`temporary file (${sgf_file.name}) for sabaki: ${sgf_text}`)
    backup_game()
    start_sabaki(sgf_file.name + '#' + game.move_count)
    attached = true; P.update_leelaz(); update_state()
}

function detach_from_sabaki() {
    if (!attached || !has_sabaki) {return}
    stop_sabaki(); attached = false; P.update_leelaz(); update_state()
}

function toggle_sabaki() {
    stop_auto(); attached ? detach_from_sabaki() : attach_to_sabaki()
}
