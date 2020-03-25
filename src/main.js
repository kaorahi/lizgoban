/////////////////////////////////////////////////
// electron
const electron = require('electron')
const {dialog, app, clipboard, Menu} = electron, ipc = electron.ipcMain

/////////////////////////////////////////////////
// command line option

// example:
// npx electron . -j '{"leelaz_args": ["-g", "-w", "/foo/bar/network.gz"]}'
// npx electron . -c /foo/bar/config.json

const {globalize} = require('./globalize.js')
globalize(require('./util.js'), require('./coord.js'))
const PATH = require('path'), fs = require('fs')
const http = require('http'), https = require('https')
const default_path_for = name =>
      // suppose three cases:
      // 1. npx electron src (obsolete)
      // 2. npx electron .
      // 3. *.AppImage, *.exe, etc.
      PATH.join(app.isPackaged ? app.getAppPath() : __dirname, '..', 'external', name)

const default_option = {
    analyze_interval_centisec: 20,
    minimum_suggested_moves: 30,
    engine_log_line_length: 500,
    sabaki_command: default_path_for('sabaki'),
    minimum_auto_restart_millisec: 5000,
    autosave_deleted_boards: 5,
    autosave_sec: 300,
    wait_for_startup: true,
    use_bogoterritory: true,
    endstate_leelaz: null,
    working_dir: process.env.PORTABLE_EXECUTABLE_DIR || default_path_for('.'),
    weight_dir: undefined,
    sgf_dir: undefined,
    exercise_dir: 'exercise',
    max_cached_engines: 3,
    preset: [{label: "leelaz", engine: ["leelaz", "-g", "-w", "network.gz"]}],
    force_shadow: false,
}
const option = {}
let white_preset = []

const default_config_paths = [
    default_path_for('.'), process.env.PORTABLE_EXECUTABLE_DIR,
]
parse_argv()

function parse_argv() {
    const prepended_args = dir => ['-c', PATH.resolve(dir, 'config.json')]
    const argv = [
        '-j', JSON.stringify(default_option),
        ...flatten(default_config_paths.filter(truep).map(prepended_args)),
        ...process.argv,
    ]
    argv.forEach((x, i, a) => parse_option(x, a[i + 1]))
}
function parse_option(cur, succ) {
    const read_file = path => safely(fs.readFileSync, path) || '{}'
    const merge_json = str => merge_with_preset(JSON.parse(str))
    const merge_with_preset = orig => {
        // accept obsolete key "shortcut" for backward compatibility
        orig.shortcut && (orig.preset = [...(orig.preset || []), ...orig.shortcut])
        merge(option, orig); expand_preset(option.preset)
        update_white_preset(option.preset)
    }
    const update_white_preset = preset => {
        const new_white_preset = (preset || []).map(h => {
            const {label, leelaz_command, leelaz_args, engine_for_white} = h
            return (leelaz_command && leelaz_args && !engine_for_white) &&
                {label, engine_for_white: [leelaz_command, ...leelaz_args]}
        }).filter(truep)
        !empty(new_white_preset) && (white_preset = new_white_preset)
    }
    switch (cur) {
    case '-j': merge_json(succ); break
    case '-c': merge_json(read_file(succ)); break
    }
}

function option_path(key) {
    const path = option[key]; if (!path) {return path}
    const ret = PATH.resolve(option.working_dir, path)
    key.endsWith('_dir') && safely(fs.mkdirSync, ret)
    return ret
}

/////////////////////////////////////////////////
// setup

// util
const TMP = require('tmp')
const ELECTRON_STORE = safely(require, 'electron-store') ||
                   // try old name for backward compatibility
                   safely(require, 'electron-config') ||
                   // ... and throw the original error when both fail
                   require('electron-store')
const store = new ELECTRON_STORE({name: 'lizgoban'})
const {katago_supported_rules, katago_rule_from_sgf_rule} = require('./katago_rules.js')

// debug log
const debug_log_key = 'debug_log'
function update_debug_log() {debug_log(!!store.get(debug_log_key) && !app.isPackaged)}
function toggle_debug_log() {debug_log(!!toggle_stored(debug_log_key))}
update_debug_log()

// game
const GAME = require('./game.js')
function create_game_with_gorule(gorule) {
    const new_game = GAME.create_game(); merge(new_game, {gorule}); return new_game
}
function create_games_from_sgf(sgf_str) {
    const gs = GAME.create_games_from_sgf(sgf_str)
    const set_gorule = new_game => {
        new_game.gorule =
            katago_rule_from_sgf_rule(new_game.sgf_gorule) || get_gorule(true)
    }
    gs.forEach(set_gorule); return gs
}

// state
let game = create_game_with_gorule(store.get('gorule', default_gorule))
let sequence = [game], sequence_cursor = 0
let auto_analysis_signed_visits = Infinity, auto_play_count = 0
const simple_ui = false
let auto_play_sec = 0, auto_replaying = false
let pausing = false, busy = false

// renderer state
// (cf.) "set_renderer_state" in powered_goban.js
// (cf.) "the_endstate_handler" and "the_suggest_handler" in engine.js
const default_for_stored_key = {
    lizzie_style: true, expand_winrate_bar: false, score_bar: true,
    let_me_think: false, show_endstate: true, gorule: default_gorule,
    stone_image_p: true, board_image_p: true, stone_style: 'dome',
}
const stored_keys_for_renderer = Object.keys(default_for_stored_key)
const R = {stones: game.current_stones(), bturn: true, ...renderer_preferences()}

globalize({  // for ai.js
    is_bturn: () => R.bturn,
    invalid_weight_for_white: () => {
        show_error('Invalid weights file (for white)')
        unload_leelaz_for_white()
    },
    max_cached_engines: option.max_cached_engines,
    unsupported_size_handler,
})
const AI = require('./ai.js')
function unsupported_size_handler() {
    if (is_pausing()) {return}
    toast('Unsupported board size by this engine.', 2 * 1000)
    pause(); stop_auto(); update_all()
}
globalize({  // for powered_goban.js
    R, AI, on_suggest: try_auto, M: {
        // functions used in powered_goban.js
        render, show_suggest_p, is_pass,
        auto_progress, is_busy, is_long_busy, is_pausing, is_bogoterritory,
        tuning_message: () => tuning_message,
    }
})
const P = require('./powered_goban.js')

function render(given_R, is_board_changed) {
    renderer('render', given_R, is_board_changed)
}
function is_busy() {return busy}
function is_pausing() {return pausing}
function is_bogoterritory() {return option.use_bogoterritory}
function show_error(message) {
    dialog.showMessageBox({type: "error", buttons: ["OK"], message})
}

// images
const image_paths = [
    ['black_stone', 'black.png'],
    ['white_stone', 'white.png'],
    ['board', 'board.png'],
].map(([key, name]) => [key, PATH.resolve(option.working_dir, name)]).filter(([key, path]) => fs.existsSync(path))

// sabaki
let attached = false, has_sabaki = true
fs.access(option.sabaki_command, null,
          (err) => err && fs.access(option.sabaki_command + '.exe', null,
                                    (err) => err && (has_sabaki = false)))

/////////////////////////////////////////////////
// electron

// app

app.on('ready', () => {
    restart_leelaz_by_preset(option.preset[0], true); new_window('double_boards')
    restore_session()
})
app.on('window-all-closed', app.quit)
app.on('quit', () => {store_session(); kill_all_leelaz()})

function start_leelaz(...args) {
    debug_log("option: " + JSON.stringify(option))
    AI.start_leelaz(leelaz_start_args(...args), option.endstate_leelaz)
}
function kill_all_leelaz() {AI.kill_all_leelaz()}

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
    windows.push(win)
    maximized && win.maximize()
    win.on('close', () => set_stored(conf_key, {
        board_type: prop.board_type, previous_board_type: prop.previous_board_type,
        position: win.getPosition(), size: win.getSize(), maximized: win.isMaximized(),
    }))
    win.once('ready-to-show', () => win.show())
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
    unset_busy, toggle_board_type, toggle_let_me_think, toggle_stored,
    copy_sgf_to_clipboard, set_endstate_diff_interval, set_endstate_diff_from, update_menu,
}
const api = merge({}, simple_api, {
    new_window, init_from_renderer,
    toggle_pause,
    play, undo, redo, explicit_undo, pass, undo_ntimes, redo_ntimes, undo_to_start, redo_to_end,
    let_me_think_next, goto_next_something, goto_previous_something,
    goto_move_count, toggle_auto_analyze, play_best, play_weak, auto_play, stop_auto,
    paste_sgf_or_url_from_clipboard,
    read_sgf, open_url, set_game_info,
    next_sequence, previous_sequence, nth_sequence, cut_sequence, duplicate_sequence,
    // for debug
    send_to_leelaz: AI.send_to_leelaz,
})

// let last_channel
function api_handler(channel, handler, busy) {
    return (e, ...args) => {
        channel === 'toggle_auto_analyze' || stop_auto_analyze()
        channel === 'play_best' || stop_auto_play()
        set_or_unset_busy(busy)
        apply_api(channel, handler, args)
    }
}
function apply_api(channel, handler, args) {
    const keep_board = ['toggle_pause', 'unset_busy', 'set_endstate_diff_from']
    const whether = a => (a.indexOf(channel) >= 0)
    debug_log(`API ${channel} ${JSON.stringify(args)}`)
    handler(...args); update_all(whether(keep_board))
}

each_key_value(api, (channel, handler) => {
    const simple = Object.keys(simple_api).indexOf(channel) >= 0
    const simple_api_handler = (e, ...a) => apply_api(channel, handler, a)
    ipc.on(channel, simple ? simple_api_handler : api_handler(channel, handler))
})

// special commands

function cached(f) {
    let cache = {}; return key => cache[key] || (cache[key] = f(key))
}
const busy_handler_for =
      cached(subchannel => api_handler(subchannel, api[subchannel], true))
ipc.on('busy', (e, subchannel, ...args) => busy_handler_for(subchannel)(e, ...args))

ipc.on('close_window_or_cut_sequence',
       e => apply_api('close_window_or_cut_sequence', () => {
           stop_auto()
           get_windows().forEach(win => (win.webContents === e.sender) &&
                                 close_window_or_cut_sequence(win))
       }, []))

// update after every command

function update_all(keep_board) {
    debug_log('update_all start')
    keep_board || set_board()
    update_state(keep_board); update_ponder(); update_ui(); update_menu()
    debug_log('update_all done')
}

/////////////////////////////////////////////////
// main flow (2) change game state and send it to powered_goban

function play(move, force_create, default_tag, comment) {
    const [i, j] = move2idx(move), pass = (i < 0)
    if (!pass && (aa_ref(R.stones, i, j) || {}).stone) {wink(); return}
    const new_sequence_p = (game.len() > 0) && create_sequence_maybe(force_create)
    const tag = game.move_count > 0 && game.new_tag_maybe(new_sequence_p, game.move_count)
    do_play(move, R.bturn, tag || default_tag || undefined, comment)
    pass && wink()
    autosave_later()
}
function do_play(move, is_black, tag, comment) {
    // We drop "double pass" to avoid halt of analysis by Leelaz.
    // B:D16, W:Q4, B:pass ==> ok
    // B:D16, W:Q4, B:pass, W:D4 ==> ok
    // B:D16, W:Q4, B:pass, W:pass ==> B:D16, W:Q4
    is_last_move_pass() && is_pass(move) ? game.pop() :
        game.push({move, is_black, tag, move_count: game.len() + 1, comment})
}
function undo() {undo_ntimes(1)}
function redo() {redo_ntimes(1)}
function explicit_undo() {
    const delete_last_move = () => {game.pop(); autosave_later()}
    game.move_count <= game.handicaps ? wink() :
        game.move_count < game.len() ? undo() : wink_if_pass(delete_last_move)
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
    game.move_count = clip(count, game.handicaps, game.len())
}

function goto_next_something() {goto_previous_or_next_something()}
function goto_previous_something() {goto_previous_or_next_something(true)}
function goto_previous_or_next_something(backwardp) {
    const sign = backwardp ? -1 : 1
    const valid = h => (h.move_count - game.move_count) * sign > 0
    const comment_p = h => h.comment && !h.comment.match(/^{{.*}}$/)
    const check_blunder = h => truep(h.gain) && h.gain <= blunder_threshold &&
          `${h.is_black ? 'B' : 'W'} ${Math.round(h.gain)}`
    let reason = ''
    const interesting = (h, k, ary) => {
        reason = valid(h) && [
            comment_p(h) && snip_text(h.comment, 40, 0, '...'),
            h.tag,
            check_blunder(ary[k + sign] || {}),  // show the board BEFORE the blunder
        ].filter(truep).join(' / '); return reason
    }
    const all = game.array_until(Infinity); backwardp && all.reverse()
    const hit = all.find(interesting)
    hit ? (goto_move_count(hit.move_count), toast(reason, 1000)) :
        backwardp ? undo_to_start() : redo_to_end()
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
function menu_for_window(win) {
    return Menu.buildFromTemplate(safe_menu_maybe() || menu_template(win))
}

function safe_menu_maybe() {
    // Application crashed sometimes by menu operations in auto-play.
    // Updating menu may be dangerous when submenu is open.
    // So, avoid submenu in doubtful cases.
    const f = (label, accelerator, click) => ({label, accelerator, click})
    const help_menu = f('Help', undefined, help)
    const auto = auto_analyzing_or_playing() && [
        f('Stop(Esc)', 'Esc', () => {stop_auto(); update_all()}),
        f('Skip(Ctrl+E)', 'Ctrl+E', skip_auto),
        help_menu,
    ]
    const wait = !AI.engine_info().current.is_ready && [
        f('Cancel(Esc)', 'Esc', () => {AI.restore(); update_all()}),
        help_menu,
    ]
    return auto || wait
}

function menu_template(win) {
    const menu = (label, submenu) =>
          ({label, submenu: submenu.filter(truep), enabled: !empty(submenu)})
    const exec = (...fs) => ((...a) => fs.forEach(f => f && f(...a)))
    const update = () => update_all()
    const ask_sec = redoing => ((this_item, win) => ask_auto_play_sec(win, redoing))
    const item = (label, accelerator, click, standalone_only, enabled, keep_auto) =>
          !(standalone_only && attached) && {
              label, accelerator,
              click: exec(!keep_auto && stop_auto, click, update),
              enabled: enabled || (enabled === undefined)
          }
    const sep = {type: 'separator'}
    const insert_if = (pred, ...items) => pred ? items : []
    const lz_white = AI.leelaz_for_white_p()
    const dup = until_current_move_p =>
          () => duplicate_sequence(until_current_move_p, true)
    const file_menu = menu('File', [
        item('New empty board', 'CmdOrCtrl+N', () => new_empty_board(), true),
        item('New handicap game', 'Shift+H', ask_handicap_stones, true),
        ...[19, 13, 9].map(n => item(`New ${n}x${n} board`, undefined,
                                     () => new_empty_board(n), true,
                                     n === 19 || AI.katago_p())),
        item('New window', 'CmdOrCtrl+Shift+N',
             (this_item, win) => new_window(window_prop(win).board_type === 'suggest' ?
                                            'variation' : 'suggest')),
        sep,
        item('Open SGF...', 'CmdOrCtrl+O', open_sgf, true),
        item('Save SGF...', 'CmdOrCtrl+S', save_sgf, true),
        sep,
        item('Close', undefined, (this_item, win) => win.close()),
        item('Quit', undefined, app.quit),
    ])
    const edit_menu = menu('Edit', [
        item('Copy SGF', 'CmdOrCtrl+C', copy_sgf_to_clipboard, true),
        item('Paste SGF or URL', 'CmdOrCtrl+V', paste_sgf_or_url_from_clipboard, true),
        sep,
        item('Delete board', 'CmdOrCtrl+X', cut_sequence, true),
        item('Undelete board', 'CmdOrCtrl+Z', uncut_sequence, true,
             exist_deleted_sequence()),
        item('Duplicate board', 'CmdOrCtrl+D', dup(false), true),
        item('Duplicate until current move', 'CmdOrCtrl+K', dup(true), true),
        {label: 'Trial board', type: 'checkbox', checked: game.trial,
         click: exec(toggle_trial, update)},
        sep,
        menu('Flip / rotate',
             ['half_turn', false, 'horizontal_flip', 'vertical_flip', false,
              'clockwise_rotation', 'counterclockwise_rotation']
             .map(key => key ? item(key.replace(/_/g, ' '), undefined,
                                    () => game.transform(key)) : sep)
            ),
        item(`Komi (${game.get_komi()})`, undefined, () => ask_komi(win)),
        menu(`Rule (${get_gorule()})`, AI.is_gorule_supported() ? gorule_submenu() : []),
        item('Info', 'CmdOrCtrl+I', () => ask_game_info(win)),
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
        menu('Stone', stone_style_submenu()),
        store_toggler_menu_item('Lizzie style', 'lizzie_style'),
        store_toggler_menu_item('Expand winrate bar', 'expand_winrate_bar', 'Shift+B'),
        ...insert_if(AI.katago_p(),
                     store_toggler_menu_item('Score bar', 'score_bar', 'Shift+C')),
        ...insert_if(AI.support_endstate_p(),
            sep,
            store_toggler_menu_item(`Ownership`, 'show_endstate', 'Shift+E'),
            item(`Ownership diff (${P.get_endstate_diff_interval()} moves)`,
                 undefined, (this_item, win) => ask_endstate_diff_interval(win),
                 false, R.show_endstate, true)),
    ])
    const tool_menu = menu('Tool', [
        item('Auto replay', 'Shift+A', ask_sec(true), true),
        item('AI vs. AI', 'Shift+P', ask_sec(false), true),
        sep,
        item('Next something', '>', goto_next_something),
        item('Previous something', '<', goto_previous_something),
        sep,
        ...insert_if(option.exercise_dir,
                     item('Store as exercise', '!', store_as_exercise),
                     item('Exercise', '?', () => load_random_exercise(win), true),
                     item('Recent exercise', 'CmdOrCtrl+?',
                          () => load_recent_exercise(win), true),
                     menu('Delete exercise', [
                         ...insert_if(is_exercise_file(game.sgf_file),
                                      item('Delete this', 'CmdOrCtrl+!', delete_exercise)),
                     ]),
                     item('Open exercise', 'Alt+?', open_exercise_dir, true),
                     sep),
        item('Tag / Untag', 'Ctrl+Space', tag_or_untag),
        has_sabaki && {label: 'Attach Sabaki', type: 'checkbox', checked: attached,
                       accelerator: 'CmdOrCtrl+T', click: toggle_sabaki},
    ])
    const white_unloader_item =
          item('Unload white engine', 'CmdOrCtrl+Shift+U',
               () => {unload_leelaz_for_white(); AI.backup()},
               false, lz_white)
    const engine_menu = menu('Engine', [
        item(lz_white ? 'Load weights for black' : 'Load network weights',
             'Shift+L', load_leelaz_for_black),
        item('Alternative weights for white', 'CmdOrCtrl+Shift+L',
             load_leelaz_for_white),
        white_unloader_item,
        item('Swap black/white engines', 'Shift+S',
             AI.swap_leelaz_for_black_and_white, false, !!lz_white),
        // item('Switch to previous engine', 'Shift+T', () => AI.restore(1)),
        sep,
        item('Reset', 'CmdOrCtrl+R', restart),
    ])
    const debug_menu = menu('Debug', [
        store_toggler_menu_item('Debug log', debug_log_key, null, toggle_debug_log),
        store_toggler_menu_item('Stone image', 'stone_image_p'),
        store_toggler_menu_item('Board image', 'board_image_p'),
        {role: 'toggleDevTools'},
    ])
    const help_menu = menu('Help', [
        item('Help', undefined, help),
    ])
    return [file_menu, edit_menu, view_menu, tool_menu, engine_menu,
            ...preset_menu_maybe({menu, item, sep, white_unloader_item, win}),
            ...(app.isPackaged ? [] : [debug_menu]),
            help_menu]
}

function board_type_menu_item(label, type, win) {
    return {label, type: 'radio', checked: window_prop(win).board_type === type,
            click: (this_item, win) => (set_board_type(type, win), update_all())}
}

function gorule_submenu() {
    return katago_supported_rules.map(label => ({
        label, type: 'radio', checked: get_gorule() === label,
        click: () => {set_gorule(label, true); update_all()},
    }))
}
function get_gorule(stored_p) {
    return (!stored_p && game.gorule) || get_stored('gorule') || default_gorule
}
function set_gorule(new_gorule, set_as_default_p) {
    if (!katago_supported_rules.includes(new_gorule)) {wink(); return}
    game.gorule = new_gorule; set_as_default_p && set_stored('gorule', new_gorule)
}

function stone_style_submenu() {
    const label_table = [
        ['2D', 'paint'], ['2.5D', 'flat'], ['3D', 'dome'],
    ]
    return label_table.map(([label, val]) => ({
        label, type: 'radio', checked: R.stone_style === val,
        click: () => {set_stored('stone_style', val); update_all()},
    }))
}

function store_toggler_menu_item(label, key, accelerator, on_click) {
    const toggle_it = () => toggle_stored(key)
    return {label, accelerator, type: 'checkbox', checked: get_stored(key),
            click: (...a) => {(on_click || toggle_it)(...a); update_all()}}
}

function toggle_stored(key) {
    const val = !get_stored(key); set_stored(key, val); return val
}

function unload_leelaz_for_white() {AI.unload_leelaz_for_white()}

// preset

function preset_menu_maybe(menu_tools) {
    // option.preset = [rule, rule, ...]
    // rule = {label: "mixture", accelerator: "F2", board_type: "raw",
    //         empty_board: true,
    //         engine: ["/foo/leelaz", "-g", "-w", "/foo/227.gz"]}
    const {menu, sep, white_unloader_item} = menu_tools
    const items = preset_menu_items(option.preset, menu_tools)
    if (empty(items)) {return []}
    const white_menu = preset_menu_for_white(menu_tools)
    const recent_menu = preset_menu_for_recent(menu_tools)
    return [menu('Preset', [
        recent_menu, sep, ...items, sep, white_menu, white_unloader_item
    ])]
}
function preset_menu_for_white(menu_tools) {
    const {menu} = menu_tools
    const items = preset_menu_items(white_preset, menu_tools, true)
    return menu('Engine for white', items)
}
function preset_menu_items(preset, menu_tools, white_p) {
    const {item, win} = menu_tools
    if (!preset || empty(preset)) {return []}
    const doit = a => {
        apply_preset(a, win); toast(`${a.label}${white_p ? ' (for white)' : ''}`, 1000)
    }
    const item_for = a => item(a.label, a.accelerator, () => doit(a))
    return preset.map(item_for)
}
function preset_menu_for_recent(menu_tools) {
    const {menu, item, sep} = menu_tools
    const label = ({black, white}, k) =>
          `${black.preset_label_text}${white ? " / " + white.preset_label_text : ""}` +
          ([' (current)', ' (prev)'][k] || '')
    const accel = k => (k === 1 && 'Shift+T')
    const item_for = (info, k) => item(label(info, k), accel(k), () => AI.restore(k))
    const is = AI.info_for_restore().map(item_for)
    return menu('Recent', [is[1], sep, ...is.slice(2), sep, is[0]])
}

function apply_preset(rule, win) {
    const cur = AI.engine_info().black
    const extended = {...cur, ...rule}
    const {label, empty_board, board_type, weight_file, weight_file_for_white,
           engine_for_white} = rule
    const f = h => JSON.stringify([h.leelaz_command, h.leelaz_args])
    const need_restart = cur && (f(cur) !== f(extended))
    const load = (switcher, file) => switcher(() => load_weight_file(file))
    const preset_label = {label: label || ''}
    empty_board && !game.is_empty() && new_empty_board()
    board_type && set_board_type(board_type, win)
    need_restart && restart_leelaz_by_preset(extended)
    // backward compatibility for obsolete "weight_file" and "weight_file_for_white"
    weight_file && load_weight_file(weight_file)
    weight_file_for_white ? load_weight_file(weight_file_for_white, true) :
        unload_leelaz_for_white()
    engine_for_white && AI.set_engine_for_white(engine_for_white, preset_label)
    AI.backup(); resume()
}

function expand_preset(preset) {
    const expand_ary = ([a, b]) => a === 'built-in' ? default_path_for(b) : b
    const expand = z => (typeof z === 'string') ? z : expand_ary(z)
    preset.forEach(rule => {
        // merge rule.option for backward compatibility to 1a88dd40
        merge(rule, rule.option || {})
        const {engine} = rule; if (!engine) {return}
        const [leelaz_command, ...leelaz_args] = engine.map(expand)
        merge(rule, {leelaz_command, leelaz_args})
    })
}

function restart_leelaz_by_preset(rule, first_p) {
    const {leelaz_command, leelaz_args, label} = rule
    if (!leelaz_command || !leelaz_args) {no_engine_error(first_p); return}
    unload_leelaz_for_white(); kill_all_leelaz()
    start_leelaz(leelaz_command, leelaz_args, label)
}

function no_engine_error(quit_p) {
    const message = 'Engine is not specified in the preset item in the configuration.'
    dialog.showErrorBox('No engine', message)
    quit_p && app.quit()
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
function stop_auto() {stop_auto_analyze(); stop_auto_play()}
function auto_analyzing_or_playing() {return auto_analyzing() || auto_playing()}

// auto-analyze (redo after given visits)
function try_auto_analyze(force_next) {
    const done = force_next || (auto_analysis_progress() >= 1)
    const finish = () => (pause(), stop_auto_analyze())
    const next = (pred, proc) => {pred() ? proc() : finish(); update_all()}
    done && next(...(backward_auto_analysis_p() ? [undoable, undo] : [redoable, redo]))
}
function toggle_auto_analyze(visits) {
    if (game.is_empty()) {wink(); return}
    (auto_analysis_signed_visits === visits) ?
        stop_auto_analyze() :
        start_auto_analyze(visits)
}
function start_auto_analyze(visits) {
    auto_analysis_signed_visits = visits; rewind_maybe(); resume()
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
let last_auto_play_time = 0, default_auto_play_sec = 1
function auto_play(sec, explicitly_playing_best) {
    sec && (default_auto_play_sec = sec)
    explicitly_playing_best ? (auto_replaying = false) : (auto_play_count = Infinity)
    auto_replaying && rewind_maybe()
    auto_play_sec = sec || -1; stop_auto_analyze()
    update_auto_play_time()
    update_let_me_think(); resume()
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
    update_all()
}
function update_auto_play_time() {last_auto_play_time = Date.now()}
function auto_play_progress() {
    return auto_playing(true) ?
        (Date.now() - last_auto_play_time) / (auto_play_sec * 1000) : -1
}
function ask_auto_play_sec(win, replaying) {
    auto_replaying = replaying
    generic_input_dialog(win, 'Auto play seconds:', default_auto_play_sec, 'auto_play')
}
function ask_game_info(win, asking_komi_p) {
    const supported_rules = AI.is_gorule_supported() && katago_supported_rules
    win.webContents.send('ask_game_info', info_text(), game.sgf_gorule, get_gorule(),
                         supported_rules, asking_komi_p)
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
    play_best(null, AI.leelaz_for_white_p() ? 'random_leelaz' : 'random_candidate', percent)
}
function try_play_best(weaken_method, ...weaken_args) {
    // (ex)
    // try_play_best()
    // try_play_best('pass_maybe')
    // try_play_best('random_candidate', 30)
    // try_play_best('random_leelaz', 30)
    weaken_method === 'random_leelaz' && AI.switch_to_random_leelaz(...weaken_args)
    if (empty(R.suggest)) {return}
    // comment
    const comment = `{{by ${AI.engine_info().current.preset_label_text}}}`
    const play_com = m => play(m, false, null, comment)
    // move
    const move = (weaken_method === 'random_candidate' ?
                  weak_move(...weaken_args) : best_move())
    const pass_maybe =
          () => AI.peek_value('pass', value => {
              play_com(value < 0.9 ? 'pass' : move); update_all()
          }) || toast('Not supported (Leela Zero only)')
    const play_it = () => {
        decrement_auto_play_count()
        weaken_method === 'pass_maybe' ? pass_maybe() : play_com(move)
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
    merge(prop, {board_type: type, previous_board_type: board_type})
}

// handicap stones & komi
function add_handicap_stones(k) {
    merge(game, {handicaps: k, komi: handicap_komi})
    // [2019-04-29] ref.
    // https://www.nihonkiin.or.jp/teach/lesson/school/start.html
    // https://www.nihonkiin.or.jp/teach/lesson/school/images/okigo09.gif
    const size = board_size(), exceptional_ks = [5, 7]
    const i1 = size > 9 ? 3 : 2, i2 = Math.floor(size / 2), i3 = size - 1 - i1
    const corners = [[i1, i3], [i3, i1], [i3, i3], [i1, i1]]
    const edges = [[i2, i3], [i2, i1], [i1, i2], [i3, i2]]
    const center = [i2, i2]
    const pos = [...corners, ...edges, center].map(ij => idx2move(...ij))
    const moves = pos.slice(0, k)
    exceptional_ks.includes(k) && (moves[k - 1] = last(pos))
    moves.forEach(m => do_play(m, true))
}
function ask_handicap_stones() {
    const proc = k => {game.is_empty() || new_empty_board(); add_handicap_stones(k)}
    ask_choice("Handicap stones", seq(8, 2), proc)
}
function ask_komi(win) {
    const other = 'other...', values = [0, 5.5, 6.5, 7.5, other]
    const proc = k => {k === other ? ask_game_info(win, true) : (game.komi = k)}
    ask_choice(`Komi (${game.get_komi()})`, values, proc)
}
function ask_choice(message, values, proc) {
    const buttons = [...values.map(to_s), 'cancel']
    const action = z => {
        const v = values[z.response]; truep(v) && proc(v); update_all()
    }
    dialog.showMessageBox(null, {type: "question", message, buttons}).then(action)
}

// misc.
function toggle_trial() {game.trial = !game.trial}
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
    const opt = {webPreferences: {nodeIntegration: true}}
    get_new_window('help.html', opt).setMenu(Menu.buildFromTemplate(menu))
}
function info_text() {
    const f = (label, s) => s ?
          `<${label}>\n` + JSON.stringify(s) + '\n\n' : ''
    const sa = AI.all_start_args()
    const lz = AI.leelaz_for_white_p() ?
          (f("engine (black)", sa.black) + f("engine (white)", sa.white)) :
          f("engine", sa.black)
    const {sgf_file} = game
    const message = f("sgf file", game.sgf_file) + lz + f("sgf", game.sgf_str)
    return message
}
function set_game_info(player_black, player_white, komi, sgf_gorule, gorule, comment) {
    set_gorule(gorule, gorule !== game.gorule)
    merge(game, {player_black, player_white, komi, sgf_gorule})
    merge(game.ref_current(), {comment})
}
function ask_endstate_diff_interval(win) {
    generic_input_dialog(win, 'Ownership diff interval (moves):',
                         P.get_endstate_diff_interval(), 'set_endstate_diff_interval')
}
function set_endstate_diff_interval(k) {P.set_endstate_diff_interval(k)}
function tag_or_untag() {
    if (game.move_count === 0) {wink(); return}
    game.add_or_remove_tag(); P.update_info_in_stones()
}

/////////////////////////////////////////////////
// utils for actions

let long_busy = false
const [set_long_busy_later, unset_long_busy] =
      deferred_procs([() => {long_busy = true}, 1000], [() => {long_busy = false}, 0])
function is_long_busy() {return long_busy}

function undoable() {return game.move_count > game.handicaps}
function redoable() {return game.len() > game.move_count}
function pause() {pausing = true}
function resume() {pausing = false}
function toggle_pause() {pausing = !pausing}
function set_or_unset_busy(bool) {
    xor(bool, busy) && (bool ? set_long_busy_later() : unset_long_busy())
    busy = bool
}
function set_busy() {set_or_unset_busy(true)}
function unset_busy() {set_or_unset_busy(false)}
function update_ponder() {
    AI.set_pondering(pausing, busy); pausing && (R.endstate = null)
}
function init_from_renderer() {}

function set_board() {
    const bsize = game.board_size
    bsize !== board_size() && AI.restart(leelaz_start_args_for_board_size(bsize))
    AI.set_board(P.set_board(game), game.get_komi(), get_gorule(), R.show_endstate)
    AI.switch_leelaz(); update_let_me_think(true)
}

function generic_input_dialog(win, label, init_val, channel) {
    win.webContents.send('generic_input_dialog', label, init_val, channel)
}

function wink_if_pass(proc, ...args) {
    const rec = () => game.ref_current()
    const before = rec()
    proc(...args)
    const after = rec(), d = after.move_count - before.move_count
    if (Math.abs(d) !== 1) {return}
    const implicit_pass = !!before.is_black === !!after.is_black
    const h = (d === 1 ? after : before)
    const pass = implicit_pass || is_pass(h.move) || h.illegal
    pass && wink()
}
function wink() {renderer('wink')}
function toast(message, millisec) {renderer('toast', message, millisec)}

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
    only_when_stage_is_changed && update_all()
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
    set_stored('let_me_think', val); update_let_me_think()
}
function let_me_think_p() {return store.get('let_me_think')}

function let_me_think_next(board_type) {
    const stay = (board_type === let_me_think_board_type.first_half)
    stay || (redoable() ? redo() : play_best())
    let_me_think_set_board_type_for(stay ? 'latter_half' : 'first_half')
}

/////////////////////////////////////////////////
// sequence (list of games)

function create_game() {
    return create_game_with_gorule(get_stored('gorule') || default_gorule)
}

function new_empty_board(given_board_size) {
    const new_game = create_game()
    new_game.board_size = given_board_size || board_size()
    insert_sequence(new_game)
}

function backup_game() {backup_and_replace_game(game.shallow_copy())}
function backup_and_replace_game(new_game, before) {
    game.is_empty() ? replace_sequence(new_game) : insert_sequence(new_game, before)
    const stones = new_game.current_stones()
    P.add_info_to_stones(stones, new_game)
    // setTimeout for updating of new_game.trial in create_sequence_maybe()
    setTimeout(() => renderer('take_thumbnail', new_game.id, stones, new_game.trial))
}

function create_sequence_maybe(force) {
    const create_p = force || game.move_count < game.len()
    const empty_now = game.move_count === 0
    return !create_p ? false : empty_now ? (new_empty_board(), true) :
        (backup_game(), game.delete_future(),
         merge(game, {trial: true, sgf_file: "", sgf_str: ""}), true)
}

function next_sequence() {previous_or_next_sequence(1)}
function previous_sequence() {previous_or_next_sequence(-1)}
function previous_or_next_sequence(delta) {
    const bsize = board_size(), same_board_size_p = gm => gm.board_size === bsize
    if (sequence.filter(same_board_size_p).length <= 1) {wink(); return}
    const n = sequence_cursor + delta, len = sequence.length
    nth_sequence((n + len) % len)
    // skip different sizes because engine takes long time to change board size
    !same_board_size_p(game) && previous_or_next_sequence(delta)
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
        backup_and_replace_game(pop_deleted_sequence(), insert_before)
}

function duplicate_sequence(until_current_move_p, explicit) {
    const del_future = () => {
        game.delete_future(); P.update_info_in_stones()  // remove next_move mark
    }
    game.is_empty() ? new_empty_board() :
        (backup_game(), game.set_last_loaded_element(), (game.trial = !explicit),
         (until_current_move_p && del_future()))
}

function delete_sequence() {
    sequence.length === 1 && (sequence[1] = create_game())
    delete_sequence_internal()
    const nextp = (sequence_cursor === 0)
    switch_to_nth_sequence(Math.max(sequence_cursor - 1, 0))
    nextp ? next_sequence_effect() : previous_sequence_effect()
    autosave_later()
}
function delete_sequence_internal() {sequence.splice(sequence_cursor, 1)}

function insert_sequence(new_game, before) {
    if (!new_game) {return}
    const n = sequence_cursor + (before ? 0 : 1)
    sequence.splice(n, 0, new_game); switch_to_nth_sequence(n); next_sequence_effect()
    autosave_later()
}
function replace_sequence(new_game) {
    sequence.splice(sequence_cursor, 1, new_game)
    switch_to_nth_sequence(sequence_cursor)
    autosave_later()
}

function switch_to_nth_sequence(n) {
    AI.cancel_past_requests()  // avoid hang-up caused by fast repeated operations
    game = sequence[sequence_cursor = n]
}
function next_sequence_effect() {renderer('slide_in', 'next')}
function previous_sequence_effect() {renderer('slide_in', 'previous')}

const deleted_sequences = []
const max_deleted_sequences = 100
function push_deleted_sequence(sequence) {
    deleted_sequences.push(sequence)
    const expired = deleted_sequences.length - max_deleted_sequences
    expired > 0 && deleted_sequences.splice(0, expired)
}
function pop_deleted_sequence() {return deleted_sequences.pop()}
function exist_deleted_sequence() {return !empty(deleted_sequences)}

function sequence_prop_of(given_game) {
    const pick_tag = h => {
        const h_copy = P.append_endstate_tag_maybe(h); return h_copy.tag || ''
    }
    const tags = given_game.map(pick_tag).join('')
          .replace(endstate_diff_tag_letter, '')
    const {player_black, player_white, handicaps, move_count, trial} = given_game
    return {player_black, player_white, handicaps, move_count, trial, len: given_game.len(), tags}
}

/////////////////////////////////////////////////
// autosave

const stored_session = new ELECTRON_STORE({name: 'lizgoban_session'})
function store_session() {
    debug_log('store_session start')
    // reverse sequence so that one can recover the same order by repeated ctrl-z
    const rev_seq = sequence.slice().reverse()
    const deleted_seq = deleted_sequences.slice(- option.autosave_deleted_boards)
    const saved_seq = [...deleted_seq, ...rev_seq].filter(g => !g.is_empty())
    stored_session.set('sequences', saved_seq.map(g => g.to_sgf()))
    debug_log('store_session done')
}
function restore_session() {
    debug_log('restore_session start')
    const loaded_seq = flatten(stored_session.get('sequences', []).map(create_games_from_sgf))
    deleted_sequences.push(...loaded_seq)
    debug_log('restore_session done')
}

let autosave_timer = null
function autosave_later() {
    const f = () => {store_session(); autosave_timer = null}
    const delay = option.autosave_sec * 1000
    !truep(autosave_timer) && (autosave_timer = setTimeout(f, delay))
}

/////////////////////////////////////////////////
// utils for updating renderer state

function update_state(keep_suggest_p) {
    const history_length = game.len(), sequence_length = sequence.length
    const sequence_ids = sequence.map(h => h.id)
    const sequence_props = aa2hash(sequence.map(h => [h.id, sequence_prop_of(h)]))
    const pick_tagged = h => {
        const h_copy = P.append_endstate_tag_maybe(h)
        return h_copy.tag ? [h_copy] : []
    }
    const history_tags = flatten(game.map(pick_tagged))
    const {player_black, player_white, trial} = game
    P.set_and_render({
        history_length, sequence_cursor, sequence_length, attached,
        player_black, player_white, trial, sequence_ids, sequence_props, history_tags,
        image_paths,
    }, keep_suggest_p ? {} : {suggest: []})
}

function update_ui(ui_only) {
    renderer_with_window_prop('update_ui', availability(), ui_only)
}

function set_stored(key, val) {
    store.set(key, val); stored_keys_for_renderer.includes(key) && (R[key] = val)
}
function get_stored(key) {
    return stored_keys_for_renderer.includes(key) ? R[key] : store.get(key)
}
function renderer_preferences() {
    const key_and_val = key => [key, store.get(key, default_for_stored_key[key])]
    return aa2hash(stored_keys_for_renderer.map(key_and_val))
}

function show_suggest_p() {return auto_playing() || auto_analysis_visits() >= 10}

function availability() {
    return {
        undo: undoable(),
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
function load_weight(white_p) {
    const dir = option_path('weight_dir') || PATH.dirname(AI.leelaz_weight_file(white_p))
    const ret = load_weight_file(select_weight_file(dir), white_p)
    AI.backup(); return ret
}
function load_weight_file(weight_file, white_p) {
    if (!weight_file) {return false}
    const current_weight_file = AI.leelaz_weight_file(white_p)
    weight_file !== current_weight_file && !white_p &&
        (previous_weight_file = current_weight_file)
    AI.load_weight_file(weight_file, white_p)
    return weight_file
}
function load_leelaz_for_black() {load_weight()}
function load_leelaz_for_white() {load_weight(true)}

function select_weight_file(dir) {
    return select_files('Select weight file for engine', dir)[0]
}
function select_files(title, dir) {
    return dialog.showOpenDialogSync(null, {
        properties: ['openFile'], title: title,
        defaultPath: dir,
    }) || []
}

// restart
function restart() {AI.restart()}
let last_restart_time = 0, asking_recovery = false
function auto_restart(startup_log) {
    const {leelaz_command, weight_file} = AI.engine_info().black || {}
    const [e, w] = [leelaz_command, weight_file].map(s => PATH.basename(s || ''))
    const log = startup_log.join('\n')
    const info_for = (title, file) =>
          `(${title}) [${PATH.basename(file || '')}] @ ${PATH.dirname(file || '')}`
    const info = `
${info_for('engine', leelaz_command)}
${info_for('weight', weight_file)}
------------------`
    const message = `Engine is down. What to do?
${info}
${log}`
    const buttons = ["RESTORE", "retry", "load weights", "(ignore)"]
    const actions = [AI.restore, restart, load_weight, do_nothing]
    const do_action =
          z => {actions[z.response](); asking_recovery = false; update_all()}
    const recover = () => {
        asking_recovery = true  // avoid duplicated dialogs
        dialog.showMessageBox(null, {type: "error", message, buttons,}).then(do_action)
    };
    (Date.now() - last_restart_time >= option.minimum_auto_restart_millisec) ?
        (restart(), last_restart_time = Date.now()) : (asking_recovery || recover())
}

// util
function leelaz_start_args(given_leelaz_command, given_leelaz_args, label) {
    const {working_dir} = option
    const leelaz_command = PATH.resolve(option.working_dir, given_leelaz_command)
    const leelaz_args = given_leelaz_args.slice()
    const preset_label = {label: label || ''}
    const h = {leelaz_command, leelaz_args, preset_label, working_dir, illegal_handler,
               // weight_file is set for consistency with set_engine_for_white()
               // so that cached engines are reused correctly
               // (cf. start_args_equal())
               tuning_handler: make_tuning_handler(), weight_file: null,
               restart_handler: auto_restart, ready_handler: on_ready}
    const opts = ['analyze_interval_centisec', 'wait_for_startup',
                  'minimum_suggested_moves', 'engine_log_line_length']
    opts.forEach(key => h[key] = option[key])
    return {...h, ...leelaz_start_args_for_board_size(board_size())}
}
function leelaz_start_args_for_board_size(default_board_size) {
    return {default_board_size}
}
let tuning_message
function on_ready(update_only_p) {
    if (update_only_p) {update_all(); return}
    // fixme: on_ready is called by *every* leelaz
    // (leelaz_for_black and leelaz_for_white).
    // This interferes starting-up sequence of another leelaz in engine.js.
    tuning_message && tuning_is_done()
    switch_to_nth_sequence(sequence_cursor); stop_auto()
    update_all()
}
function make_tuning_handler() {
    let n = 0, toast_sec = 20
    const warning = 'Initial tuning may take a long time. (See the title bar.)'
    return line => {
        const m = line.match(/Tuning (.*)/); if (!m) {return}
        n === 0 && (pause(), toast(warning, toast_sec * 1000))
        tuning_message = `Tuning KataGo (step ${++n}) [${m[1].slice(0, 20)}]`
        update_all()
    }
}
function tuning_is_done() {
    const message = 'Finished initial tuning.'
    dialog.showMessageBox({type: "info",  buttons: ["OK"], message})
    tuning_message = null; resume(); update_all()
}

function illegal_handler({move, is_black, move_count}) {
    const message = `Illegal: ${is_black ? 'B' : 'W'}(${move_count - game.handicaps}) ${move}`
    toast(message, 5000); AI.cancel_past_requests(); update_all()
}

/////////////////////////////////////////////////
// SGF

function copy_sgf_to_clipboard() {clipboard.writeText(game.to_sgf()); wink()}
function paste_sgf_or_url_from_clipboard() {
    const s = clipboard.readText(); s.startsWith('http') ? open_url(s) : read_sgf(s)
}

function open_sgf() {open_sgf_in(option_path('sgf_dir'))}
function open_sgf_in(dir, proc) {
    select_files('Select SGF file', dir).forEach(proc || load_sgf)
}
function load_sgf(filename) {
    read_sgf(fs.readFileSync(filename, {encoding: 'utf8'}))
    game.sgf_file = filename
}

function save_sgf() {
    const f = dialog.showSaveDialogSync(null, {
        title: 'Save SGF file',
        defaultPath: option_path('sgf_dir'),
    }); if (!f) {return}
    const ext = '.sgf', filename = f + (f.endsWith(ext) ? '' : ext)
    const if_success = () => (game.sgf_file = filename)
    save_sgf_to(filename, if_success)
}
function save_sgf_to(filename, if_success) {
    const callback = err => {if (err) {throw err} else {if_success && if_success()}}
    fs.writeFile(filename, game.to_sgf(), callback)
}

function read_sgf(sgf_str) {
    const new_games = create_games_from_sgf(sgf_str)
    empty(new_games) ?
        dialog.showErrorBox("Failed to read SGF", snip(sgf_str, 200)) :
        new_games.reverse().forEach(backup_and_replace_game)
    // keep sequence_cursor trickily!
    // (see the second argument of backup_and_replace_game)
}

function open_url(url) {
    const on_get = res => {
        if (res.statusCode !== 200) {
            show_error(`Failed to get ${url}`); res.resume(); return
        }
        let str = ''
        res.setEncoding('utf8')
        res.on('data', chunk => {str += chunk})
        res.on('end', () => {read_sgf(str); update_all()})
    }
    const protocol = url.startsWith('https') ? https : http
    ask_choice(`Open ${url}`, ['OK'], _ => protocol.get(url, on_get))
}

// personal exercise book

function store_as_exercise() {
    const path = PATH.join(exercise_dir(), exercise_filename())
    save_sgf_to(path); toast('stored as exercise')
}
function load_random_exercise(win) {
    const random_choice = a => a[Math.floor(Math.random() * a.length)]
    load_exercise(random_choice, win, true)
}
function load_recent_exercise(win) {
    const neg_mtime = fn => - fs.statSync(expand_exercise_filename(fn)).mtimeMs
    const recent = a => sort_by(a, neg_mtime)[0]
    load_exercise(recent, win)
}
let seen_exercises = []
function load_exercise(selector, win, random_flip_p) {
    const dir = exercise_dir()
    const valid = name =>
          is_exercise_filename(name) && seen_exercises.indexOf(name) < 0 &&
          exercise_board_size(name) === board_size()
    const files = (fs.readdirSync(dir) || []).filter(valid)
    const retry = () => {seen_exercises = []; load_exercise(selector, win)}
    if (empty(files)) {empty(seen_exercises) ? wink() : retry(); return}
    const fn = selector(files); seen_exercises.push(fn)
    set_board_type('raw', win); load_as_exercise(expand_exercise_filename(fn))
    random_flip_p && game.random_flip_rotate()
}
function load_as_exercise(file) {
    load_sgf(file); goto_move_count(exercise_move_count(file))
}
function open_exercise_dir() {open_sgf_in(exercise_dir(), load_as_exercise)}
function delete_exercise() {
    const dir = exercise_dir(), file = game.sgf_file, name = PATH.basename(file)
    if (!is_exercise_file(file)) {wink(); return}
    const new_file = PATH.join(dir, `_${name}`)
    const done = () => {
        game.sgf_file = new_file; toast('deleted from exercise')
    }
    fs.rename(file, new_file, done)
}
function exercise_dir() {return option_path('exercise_dir')}

const exercise_format = {pre: 'exercise', sep: '_', post: '.sgf'}
function exercise_filename() {
    const {pre, sep, post} = exercise_format
    const mc = to_s(game.move_count).padStart(3, '0')
    const ti = (new Date()).toJSON().replace(/:/g, '') // cannot use ":" in Windows
    return `${pre}${board_size()}${sep}${ti}${sep}${mc}${post}`
}
function is_exercise_filename(filename) {
    const {pre, sep, post} = exercise_format
    return filename.startsWith(pre) && filename.endsWith(post)
}
function expand_exercise_filename(filename) {return PATH.join(exercise_dir(), filename)}
function is_exercise_file(path) {
    const in_dir_p = (f, d) => d && (PATH.resolve(d, PATH.basename(f)) === f)
    const name = PATH.basename(path)
    return in_dir_p(path, exercise_dir()) && is_exercise_filename(name)
}
function exercise_move_count(filename) {
    const {pre, sep, post} = exercise_format
    return to_i(last(filename.split(sep)).split(post)[0])
}
function exercise_board_size(filename) {
    const {pre, sep, post} = exercise_format
    return to_i(filename.split(sep)[0].split(pre)[1] || 19)
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
    m && (game.load_sabaki_gametree(...(JSON.parse(m[1]).treePosition || [])),
          update_all())
}

function attach_to_sabaki() {
    if (attached || !has_sabaki) {return}
    const sgf_file = TMP.fileSync({mode: 0644, prefix: 'lizgoban-', postfix: '.sgf'})
    const sgf_text = game.to_sgf()
    fs.writeSync(sgf_file.fd, sgf_text)
    debug_log(`temporary file (${sgf_file.name}) for sabaki: ${sgf_text}`)
    backup_game()
    start_sabaki(sgf_file.name + '#' + game.move_count)
    attached = true; AI.update_leelaz()
}

function detach_from_sabaki() {
    if (!attached || !has_sabaki) {return}
    stop_sabaki(); attached = false; AI.update_leelaz()
}

function toggle_sabaki() {
    stop_auto(); attached ? detach_from_sabaki() : attach_to_sabaki()
}
