// -*- coding: utf-8 -*-

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

const {
    option, option_path, image_paths, white_preset,
    default_for_stored_key, stored_keys_for_renderer,
    keep_backward_compatibility_of_stone_style,
} = require('./option.js')

/////////////////////////////////////////////////
// setup

// util
const TMP = require('tmp'), XYZ2SGF = require('xyz2sgf')
const ELECTRON_STORE = safely(require, 'electron-store') ||
                   // try old name for backward compatibility
                   safely(require, 'electron-config') ||
                   // ... and throw the original error when both fail
                   require('electron-store')
globalize({ELECTRON_STORE})
const store = new ELECTRON_STORE({name: 'lizgoban'})
const http = require('http'), https = require('https')
const {gzipSync, gunzipSync} = require('zlib')
const {katago_supported_rules, katago_rule_from_sgf_rule} = require('./katago_rules.js')
const {
    exercise_filename, is_exercise_filename, exercise_move_count, exercise_board_size,
    update_exercise_metadata_for, get_all_exercise_metadata,
    random_exercise_chooser, recent_exercise_chooser, recently_seen_exercises_in,
} = require('./exercise.js')(exercise_mtime)
const {tsumego_frame} = require('./tsumego_frame.js')
const {ladder_branches, ladder_is_seen, last_ladder_branches, cancel_ladder_hack}
      = require('./ladder.js')
const {branch_at, update_branch_for} = require('./branch.js')
function update_branch() {update_branch_for(game, sequences_and_brothers())}

// debug log
const debug_log_key = 'debug_log'
function update_debug_log() {debug_log(!!store.get(debug_log_key) && !app.isPackaged)}
function toggle_debug_log() {debug_log(!!toggle_stored(debug_log_key))}
update_debug_log()

// game
const GAME = require('./game.js')
GAME.use_note_property(option.record_note_to_SGF)
function create_game_with_gorule(gorule) {
    const new_game = GAME.create_game(); merge(new_game, {gorule}); return new_game
}
function create_games_from_sgf(sgf_str, cache_suggestions_p) {
    toast('loading...', 1000); return create_games_from_sgf_internal(sgf_str, cache_suggestions_p)
}
function create_games_from_sgf_internal(sgf_str, cache_suggestions_p) {
    const too_many_games = 30
    const gs = GAME.create_games_from_sgf(sgf_str, cache_suggestions_p)
    const set_gorule = new_game => {
        const {sgf_gorule, komi} = new_game
        new_game.gorule =
            katago_rule_from_sgf_rule(sgf_gorule, komi) || get_gorule(true)
    }
    // set 9x9 engine before cooking 9x9 games so that cached suggestions
    // are loaded correctly
    !empty(gs) && set_AI_board_size_maybe(gs[0].board_size)
    const f = (g, k) => {
        set_gorule(g); g.needs_cooking_lizzie_cache = true
        k < too_many_games && P.set_ambiguity_etc_in_game(g)
    }
    gs.forEach(f); return gs
}

// state
let repl = null
let game; set_game(create_game_with_gorule(store.get('gorule', default_gorule)))
let sequence = [game], sequence_cursor = 0
let auto_analysis_signed_visits = Infinity, auto_play_count = 0
let auto_analysis_steps = 1
let auto_play_sec = 0, auto_playing_strategy = 'replay'
let pausing = false, busy = false
let exercise_metadata = null

function set_game(new_game) {
    game = new_game
    repl_update_game()
}

// renderer state
// (cf.) "set_renderer_state" in powered_goban.js
// (cf.) "the_endstate_handler" and "the_suggest_handler" in engine.js
const R = {stones: game.current_stones(), bturn: true, ...renderer_preferences()}
game.komi = get_stored('komi_for_new_game')

keep_backward_compatibility_of_stone_style(get_stored, set_stored)

globalize({  // for ai.js
    is_bturn: () => R.bturn,
    invalid_weight_for_white: () => {
        show_error('Invalid weights file (for white)')
        unload_leelaz_for_white()
    },
    max_cached_engines: option.max_cached_engines,
    command_failure_handler,
})
const AI = require('./ai.js')
function command_failure_handler(command, info) {
    switch (command) {
    case 'boardsize': if (is_pausing()) {return}; break;
    }
    toast(info, 2 * 1000)
    pause(); stop_auto(); update_all()
}
globalize({  // for powered_goban.js
    R, AI, on_suggest: try_auto, M: {
        // functions used in powered_goban.js
        render, show_suggest_p, is_pass,
        auto_progress, is_busy, is_long_busy, is_pausing, is_bogoterritory,
        branch_at, ladder_branches,
        tuning_message: () => tuning_message,
        plot_order_p: () => option.plot_order_p,
        plot_shorttermScoreError_p: () => option.plot_shorttermScoreError_p,
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

// sabaki
let attached = false, has_sabaki = true
fs.access(option.sabaki_command, null,
          (err) => err && fs.access(option.sabaki_command + '.exe', null,
                                    (err) => err && (has_sabaki = false)))

/////////////////////////////////////////////////
// electron

// app

app.whenReady().then(() => {
    const first_preset = option.preset[0]
    if (!restart_leelaz_by_preset(first_preset, true)) {return}
    apply_preset(first_preset, new_window('double_boards'))
    option.repl && start_repl()
})
app.on('window-all-closed', app.quit)
app.on('quit', () => {store_session(true); kill_all_leelaz()})

function start_leelaz(...args) {
    debug_log("option: " + JSON.stringify(option))
    AI.start_leelaz(leelaz_start_args(...args), option.endstate_leelaz)
}
function kill_all_leelaz() {AI.kill_all_leelaz()}

// window & renderer

const {
    window_prop, window_for_id, get_windows, get_new_window, webPreferences, new_window,
    renderer, renderer_with_window_prop,
} = require('./window.js')(electron, store, set_stored)

/////////////////////////////////////////////////
// main flow (1) receive commands from renderer

// normal commands

const {set_showing_until} = P
const simple_api = {
    unset_busy, toggle_board_type, toggle_let_me_think, toggle_stored,
    copy_sgf_to_clipboard, set_endstate_diff_interval, set_showing_until, update_menu,
    set_match_param, ladder_is_seen, force_color_to_play, cancel_forced_color,
    enable_menu,
}
const api = {
    ...simple_api,
    init_from_renderer,
    toggle_pause,
    play, undo, redo, explicit_undo, pass, undo_ntimes, redo_ntimes, undo_to_start, redo_to_end,
    edit_middle,
    let_me_think_next, goto_next_something, goto_previous_something,
    goto_move_count, toggle_auto_analyze, play_best, play_weak, stop_auto,
    submit_auto_play, submit_auto_replay, auto_play_in_match,
    start_auto_redo,
    stop_match,
    new_empty_board, add_handicap_stones,
    paste_sgf_or_url_from_clipboard,
    read_sgf, open_url, set_game_info,
    next_sequence, previous_sequence, nth_sequence, cut_sequence, duplicate_sequence,
    switch_to_game_id,
    increase_exercise_stars,
    detach_from_sabaki,
    update_analysis_region: AI.update_analysis_region,

    // for debug
    send_to_leelaz: AI.send_to_leelaz,
}

function api_handler(channel, handler, busy) {
    return (e, ...args) => {
        channel === 'toggle_auto_analyze' || stop_auto_analyze()
        channel === 'play_best' || stop_auto_play()
        stop_auto_redo()
        set_or_unset_busy(busy)
        apply_api(channel, handler, args)
    }
}
function apply_api(channel, handler, args) {
    const silently = ['ladder_is_seen']
    const keep_board = ['toggle_pause', !is_busy() && 'unset_busy', 'set_showing_until']
    const whether = a => (a.indexOf(channel) >= 0)
    debug_log(`API ${channel} ${JSON.stringify(args)}`)
    handler(...args); whether(silently) || update_all(whether(keep_board))
}

function simple_or_normal_api_handler(channel, handler) {
    const simple = !!simple_api[channel]
    const simple_api_handler = (e, ...a) => apply_api(channel, handler, a)
    return simple ? simple_api_handler : api_handler(channel, handler)
}
each_key_value(api, (channel, handler) => {
    ipc.on(channel, simple_or_normal_api_handler(channel, handler))
})

function mimic(channel, ...args) {
    const api_h = simple_or_normal_api_handler(channel, api[channel])
    const dummy_event = null
    return api_h(dummy_event, ...args)
}

// special commands

function cached(f) {
    let cache = {}; return key => cache[key] || (cache[key] = f(key))
}
const busy_handler_for =
      cached(subchannel => api_handler(subchannel, api[subchannel], true))
ipc.on('busy', (e, subchannel, ...args) => busy_handler_for(subchannel)(e, ...args))

function ipc_with_sender_window(channel, proc) {
    ipc.on(channel,
           (e, ...args) => apply_api(channel, (...a) => {
               stop_auto()
               get_windows().forEach(win => (win.webContents === e.sender) &&
                                     proc(win, ...a))
           }, args))
}
each_key_value({
    close_window_or_cut_sequence, ask_new_game,
}, (channel, proc) => ipc_with_sender_window(channel, proc))

ipc.on('app_version', e => (e.returnValue = app.getVersion()))

// update after every command

function update_all(keep_board) {
    debug_log(`update_all start (keep_board = ${keep_board})`)
    keep_board || set_board()
    update_state(keep_board); update_ponder(); update_ui(); update_menu()
    debug_log('update_all done')
}

/////////////////////////////////////////////////
// main flow (2) change game state and send it to powered_goban

function play(move, force_create, default_tag, comment, auto_play_in_match_sec) {
    const force_create_p = force_create && (force_create !== 'never_redo')
    const [i, j] = move2idx(move), pass = (i < 0)
    if (!pass && (aa_ref(R.stones, i, j) || {}).stone) {wink(); return}
    const next_move_count = game.move_count + 1
    const is_next_move = gm => !force_create && (move === gm.ref(next_move_count).move)
    if (is_next_move(game)) {redo(); return}
    const another_game = (branch_at(game.move_count) || []).find(is_next_move)
    if (another_game) {switch_to_game(another_game, next_move_count); return}
    const new_sequence_p = (game.len() > 0) && create_sequence_maybe(force_create_p)
    const tag = game.move_count > 0 && game.new_tag_maybe(new_sequence_p, game.move_count)
    do_play(move, black_to_play_now_p(), tag || default_tag || undefined, comment)
    pass && wink()
    truep(auto_play_in_match_sec) &&
        auto_play_in_match(auto_play_in_match_sec, get_auto_moves_in_match())
    autosave_later()
}
function black_to_play_now_p() {return black_to_play_p(R.forced_color_to_play, R.bturn)}
function do_play(move, is_black, tag, note) {
    // We drop "double pass" to avoid halt of analysis by Leelaz.
    // B:D16, W:Q4, B:pass ==> ok
    // B:D16, W:Q4, B:pass, W:D4 ==> ok
    // B:D16, W:Q4, B:pass, W:pass ==> B:D16, W:Q4
    is_last_move_pass() && is_pass(move) ? game.pop() :
        game.push({move, is_black, tag, move_count: game.len() + 1, note})
}
function undo() {undo_ntimes(1)}
function redo() {redo_ntimes(1)}
function explicit_undo() {
    game.move_count <= game.init_len ? wink() :
        game.move_count < game.len() ? undo() : wink_if_pass(delete_last_move)
}
function delete_last_move() {game.pop(); update_branch(); autosave_later()}
const pass_command = 'pass'
function pass() {play(pass_command)}
function is_pass(move) {return move === pass_command}
function is_last_move_pass() {return is_pass(game.last_move())}

function undo_ntimes(n) {wink_if_pass(goto_move_count, game.move_count - n)}
function redo_ntimes(n) {undo_ntimes(- n)}
function undo_to_start() {undo_ntimes(Infinity)}
function redo_to_end() {redo_ntimes(Infinity)}

function goto_move_count(count) {
    game.move_count = clip(count, game.init_len, game.len())
}

function goto_next_something() {goto_previous_or_next_something()}
function goto_previous_something() {goto_previous_or_next_something(true)}
function goto_previous_or_next_something(backwardp) {
    const sign = backwardp ? -1 : 1
    const valid = h => (h.move_count - game.move_count) * sign > 0
    const comment_p = h => h.comment
    const check_blunder = h => truep(h.gain) && h.gain <= blunder_threshold &&
          `${h.is_black ? 'B' : 'W'} ${Math.round(h.gain)}`
    let reason = ''
    const interesting = (h, k, ary) => {
        const {resolved_by_connection, resolved_by_capture} = h.ko_state || {}
        reason = valid(h) && [
            comment_p(h) && snip_text(h.comment, 40, 0, '...'),
            h.tag,
            branch_at(h.move_count) && 'branch',
            (resolved_by_connection || resolved_by_capture) && 'ko',
            h.illegal && 'illegal',
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

let force_normal_menu_p = false

// to ignore accelerators (e.g. Shift+N) on input forms in custom dialogs
let the_menu_enabled_p = true
function enable_menu(bool) {the_menu_enabled_p = bool}
function menu_enabled_p() {return the_menu_enabled_p}

function update_menu() {mac_p() ? update_app_menu() : update_window_menu()}
function update_app_menu() {
    const win = electron.BrowserWindow.getFocusedWindow() || get_windows()[0]
    win && Menu.setApplicationMenu(menu_for_window(win))
}
function update_window_menu() {
    get_windows().forEach(win => win.setMenu(menu_for_window(win)))
}
function menu_for_window(win) {
    const safe_menu = safe_menu_maybe(); !safe_menu && (force_normal_menu_p = false)
    const menu = !force_normal_menu_p && safe_menu || menu_template(win)
    return Menu.buildFromTemplate(menu)
}

function safe_menu_maybe() {
    // Application crashed sometimes by menu operations in auto-play.
    // Updating menu may be dangerous when submenu is open.
    // So, avoid submenu in doubtful cases.
    const f = (label, accelerator, click) => ({label, accelerator, click})
    const help_menu = f('Help', undefined, help)
    // in autoanalysis
    const auto = auto_analyzing_or_playing() && [
        f('Stop(Esc)', 'Esc', () => {stop_auto(); update_all()}),
        f('Skip(Ctrl+E)', 'Ctrl+E', skip_auto),
        help_menu,
    ]
    // in initalization
    const restore = () => {
        toast('Canceled.'); cancel_tuning(); AI.restore(); update_all()
    }
    const force_normal_menu = () => {
        toast('Engine is not ready.'); force_normal_menu_p = true; update_window_menu()
    }
    const fallback = win => {
        const message = `
If you are in trouble, you may find some hints in the startup log.

Really start LizGoban with no engine? (not recommended)
`
        ask_game_info(win)
        ask_choice(message, ['OK'], force_normal_menu)
    }
    const cancel = (_, win) => empty(AI.info_for_restore()) ? fallback(win) : restore()
    const wait = !AI.engine_info().current.is_ready && [
        f('Cancel(Esc)', 'Esc', cancel),
        help_menu,
    ]
    // either
    return auto || wait
}

function menu_template(win) {
    const menu = (label, submenu) =>
          ({label, submenu: submenu.filter(truep)})
    const exec = (...fs) => ((...a) => menu_enabled_p() && fs.forEach(f => f && f(...a)))
    const update = () => update_all()
    const ask_sec = replaying => ((this_item, win) => ask_auto_play_sec(win, replaying))
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
        item('New game', 'CmdOrCtrl+N', (this_item, win) => ask_new_game(win), true),
        R.in_match ?
            item('Stop match', 'Shift+G',
                 (this_item, win) => stop_match(window_prop(win).window_id), true) :
            item('Match vs. AI', 'Shift+G', (this_item, win) => start_match(win), true),
        item('Pair Go match', undefined,
             (this_item, win) => start_match(win, 3), true, !(R.in_match && R.in_pair_go)),
        sep,
        item('Open SGF etc....', 'CmdOrCtrl+O', open_sgf_etc, true),
        item('Save SGF with analysis...', 'CmdOrCtrl+S', () => save_sgf(true), true),
        item('Save SGF...', 'CmdOrCtrl+Shift+S', () => save_sgf(false), true),
        sep,
        item('New empty board', 'Shift+N', () => new_empty_board(), true),
        item('New handicap game', 'Shift+H', ask_handicap_stones, true),
        ...[19, 13, 9].map(n => item(`New ${n}x${n} board`, undefined,
                                     () => new_empty_board(n), true,
                                     n === 19 || AI.katago_p())),
        item('(new window)', undefined,
             (this_item, win) => {
                 const message = '"New window" is no longer maintained and will be removed in future versions. If you have a special reason to use this feature, please post it to GitHub issues from the link "Project Home" at the bottom of "Help > en".'
                 dialog.showErrorBox('Obsolete feature', message)
                 new_window(window_prop(win).board_type === 'suggest' ?
                            'variation' : 'suggest')
             }),
        sep,
        item('Close', undefined, (this_item, win) => win.close()),
        item('Quit', undefined, app.quit),
    ])
    const edit_menu = menu('Edit', [
        item('Copy SGF', 'CmdOrCtrl+Shift+C', () => copy_sgf_to_clipboard(false), true),
        item('Copy SGF with analysis', 'CmdOrCtrl+C', () => copy_sgf_to_clipboard(true), true),
        item('Paste (SGF, URL, image)', 'CmdOrCtrl+V', paste_sgf_or_url_from_clipboard, true),
        sep,
        item('Delete board', 'CmdOrCtrl+X', cut_sequence, true),
        item('Undelete board', 'CmdOrCtrl+Z', uncut_sequence, true,
             exist_deleted_sequence()),
        item('Duplicate board', 'CmdOrCtrl+D', dup(false), true),
        item('Duplicate until current move', 'CmdOrCtrl+K', dup(true), true),
        {label: 'Trial board', type: 'checkbox', checked: game.trial,
         accelerator: 'Shift+I', click: exec(toggle_trial, update)},
        sep,
        menu('Flip / rotate / etc.', [
            ...(['half_turn', false, 'horizontal_flip', 'vertical_flip', false,
                 'clockwise_rotation', 'counterclockwise_rotation']
                .map(key => key ? item(key.replace(/_/g, ' '), undefined,
                                       () => transform_board(key)) : sep)),
            sep,
            item('resize to 19x19 (bottom left)', undefined, resize_to_19x19),
        ]),
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
        store_toggler_menu_item('Coordinates', 'always_show_coordinates'),
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
        item('Quick overview', 'Shift+V', start_quick_overview, true),
        store_toggler_menu_item('... Auto overview', 'auto_overview'),
        item('Auto replay', 'Shift+A', ask_sec(true), true),
        item('Silent replay', undefined,
             (this_item, win) => ask_auto_redo_sec(win), true),
        sep,
        item('AI vs. AI', 'Shift+P', ask_sec(false), true),
        store_toggler_menu_item('...Random opening', 'random_opening_p'),
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
        item('Clear analysis', undefined, P.delete_cache, false, R.use_cached_suggest_p),
        item('...Restore analysis', undefined, P.undelete_cache, false, R.use_cached_suggest_p),
        sep,
        item('Tag / Untag', 'Ctrl+Space', tag_or_untag),
        has_sabaki && {label: 'Attach Sabaki', type: 'checkbox', checked: attached,
                       accelerator: 'CmdOrCtrl+T', click: toggle_sabaki},
        menu('Experimental...', [
            obsolete_toggler_menu_item('Reuse analysis', 'use_cached_suggest_p'),
            ...insert_if(AI.katago_p(),
                         store_toggler_menu_item('Show aggressive/defensive', 'show_aggressive_defensive')),
            sep,
            item("Tsumego frame", 'Shift+f',
                 () => add_tsumego_frame(), true, game.move_count > 0),
            item("Tsumego frame (ko)", 'CmdOrCtrl+Shift+f',
                 () => add_tsumego_frame(true), true, game.move_count > 0),
            sep,
            item("Save Q&&A images", 'PrintScreen', save_q_and_a_images),
        ]),
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
        {label: 'REPL', type: 'checkbox', checked: repl_p(), click: toggle_repl},
        store_toggler_menu_item('Stone image', 'stone_image_p'),
        store_toggler_menu_item('Board image', 'board_image_p'),
        {label: 'Keep bright board', type: 'checkbox', checked: R.keep_bright_board,
         click: () => {R.keep_bright_board = !R.keep_bright_board; update_all()}},
        sep,
        item('Import diagram image', undefined, open_demo_image),
        sep,
        {role: 'zoomIn'}, {role: 'zoomOut'}, {role: 'resetZoom'},
        sep,
        {role: 'toggleDevTools'},
    ])
    const help_menu = menu('Help', [
        item('en (English)', undefined, help),
        item('ja (日本語)', undefined, () => open_help('help_ja.html')),
        sep,
        item('Contributors', undefined, () => open_help('contributors.html')),
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
    const styles = ['2D', '2.5D', '3D', ...(option.face_image_rule ? ['Face'] : [])]
    return styles.map(label => ({
        label, type: 'radio', checked: R.stone_style === label,
        click: () => {set_stored('stone_style', label); update_all()},
    }))
}

function store_toggler_menu_item(label, key, accelerator, on_click) {
    const toggle_it = () => toggle_stored(key)
    const do_it = (...a) => {(on_click || toggle_it)(...a); update_all()}
    return {label, accelerator, type: 'checkbox', checked: get_stored(key),
            click: (...a) => menu_enabled_p() && do_it(...a)}
}

function toggle_stored(key) {
    const val = !get_stored(key); set_stored(key, val); return val
}

function unload_leelaz_for_white() {AI.unload_leelaz_for_white()}

function obsolete_toggler_menu_item(label, key, accelerator) {
    const message = 'This preference will be removed in future versions. If you have a special reason to change the default value, please post it to GitHub issues from the link "Project Home" at the bottom of "Help > en".'
    const f = () => toggle_stored(key)
    const with_warning = (f, title, message) =>
          (...args) => (dialog.showErrorBox(title, message), f(...args))
    const on_click =  with_warning(f, `Obsolete preference: "${label}"`, message)
    return store_toggler_menu_item(label, key, accelerator, on_click)
}

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
    const menu_label = a => {
        const {label, engine_for_white, label_for_white} = a
        const w = !white_p && label_for_white ? ` / ${label_for_white}` : ''
        return `${label}${w}`
    }
    const toast_label = a => menu_label(a) + (white_p ? ' (for white)' : '')
    const doit = a => {apply_preset(a, win); toast(toast_label(a), 1000)}
    const item_for = a => item(menu_label(a), a.accelerator, () => doit(a))
    return preset.map(item_for)
}
function preset_menu_for_recent(menu_tools) {
    const {menu, item, sep} = menu_tools
    const label = ({black, white}, k) =>
          `${black.preset_label_text}${white ? " / " + white.preset_label_text : ""}` +
          ([' (current)', ' (prev)'][k] || '')
    const accel = k => (k === 1 && 'Shift+T')
    const item_for = (info, k) => {
        const lab = label(info, k), doit = () => {toast(lab); AI.restore(k)}
        return item(lab, accel(k), doit)
    }
    const is = AI.info_for_restore().map(item_for)
    return menu('Recent', [is[1], sep, ...is.slice(2), sep, is[0]])
}

function apply_preset(rule, win) {
    const stored = ['stone_style', 'random_opening_p', 'auto_overview']
    stored.forEach(key => (rule[key] !== undefined) && set_stored(key, rule[key]))
    const {empty_board, board_type, match, rules, handicap, komi} = rule
    empty_board && !game.is_empty() && new_empty_board()
    handicap && add_handicap_stones(handicap)
    rules && set_gorule(rules)
    truep(komi) && set_komi(komi)
    board_type && set_board_type(board_type, win)
    match && start_match(win, to_i(match))
    const is_engine_updated = update_engines_by_preset(rule)
    AI.backup(); is_engine_updated && resume()
}

function update_engines_by_preset(rule) {
    const {label, label_for_white, engine_for_white,
           weight_file, weight_file_for_white} = rule
    const cur = AI.engine_info().black, extended = {...cur, ...rule}
    const f = h => JSON.stringify([h.leelaz_command, h.leelaz_args])
    const need_restart = cur && (f(cur) !== f(extended))
    const preset_label_for_white = {label: label_for_white || (label || '') + '(W)'}
    const is_engine_specified_explicitly = rule.leelaz_command || weight_file
    need_restart && restart_leelaz_by_preset(extended)
    // backward compatibility for obsolete "weight_file" and "weight_file_for_white"
    weight_file && load_weight_file(weight_file)
    weight_file_for_white ? load_weight_file(weight_file_for_white, true) :
        (is_engine_specified_explicitly && unload_leelaz_for_white())
    engine_for_white && AI.set_engine_for_white(engine_for_white, preset_label_for_white)
    const is_updated =
          need_restart || weight_file || weight_file_for_white || engine_for_white
    return is_updated
}

function restart_leelaz_by_preset(rule, first_p) {
    const {leelaz_command, leelaz_args, label} = rule
    if (!leelaz_command || !leelaz_args) {no_engine_error(first_p); return false}
    unload_leelaz_for_white(); kill_all_leelaz()
    start_leelaz(leelaz_command, leelaz_args, label)
    return true
}

function no_engine_error(quit_p) {
    const message = 'Engine is not specified in the preset item in the configuration.'
    dialog.showErrorBox('No engine', message)
    quit_p && app.quit()
}

/////////////////////////////////////////////////
// another source of change: auto-analyze / auto-play (match) / auto-redo

// common
function try_auto(force_next) {
    const prog = [[auto_playing, try_auto_play],
                  [auto_analyzing, try_auto_analyze],
                  [auto_redoing, try_auto_redo]]
    prog.find(([pred, proc]) => pred() && (proc(force_next), true))
}
function skip_auto() {try_auto(true)}
function auto_progress(time_only_p) {
    return Math.max(time_only_p ? -1 : auto_analysis_progress(),
                    auto_play_progress(), auto_redo_progress())
}
function stop_auto() {stop_auto_analyze(); stop_auto_play(); stop_auto_redo()}
function auto_analyzing_or_playing() {return auto_analyzing() || auto_playing() || auto_redoing()}

// auto-analyze (redo after given visits)
let on_auto_analyze_finished = pause
function try_auto_analyze(force_next) {
    const done = force_next || (auto_analysis_progress() >= 1)
    const finish = () => (stop_auto_analyze(), on_auto_analyze_finished())
    const next = (pred, proc) => {
        pred() ? proc(auto_analysis_steps) : finish(); update_all()
    }
    done && next(...(backward_auto_analysis_p() ?
                     [undoable, undo_ntimes] : [redoable, redo_ntimes]))
}
function toggle_auto_analyze(visits) {
    if (game.is_empty()) {wink(); return}
    (auto_analysis_signed_visits === visits) ?
        stop_auto_analyze() :
        start_auto_analyze(visits)
}
function start_auto_analyze(visits, steps, on_finish) {
    if (!AI.engine_info().current.is_ready) {return}
    set_auto_analysis_signed_visits(visits); auto_analysis_steps = steps || 1
    on_auto_analyze_finished = on_finish || pause
    rewind_maybe(); resume()
}
function start_quick_overview() {
    start_auto_analyze(1, 15, is_pausing() ? pause : do_nothing)
}
function stop_auto_analyze() {set_auto_analysis_signed_visits(Infinity)}
function set_auto_analysis_signed_visits(visits) {
    auto_analysis_signed_visits = visits
    AI.set_instant_analysis(auto_analysis_visits() <= 1)
}
function auto_analyzing() {return auto_analysis_signed_visits < Infinity}
function auto_analysis_progress() {
    const best = P.orig_suggest()[0]
    return !auto_analyzing() ? -1 : !best ? 0 : best.visits / auto_analysis_visits()
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
function start_auto_play(strategy, sec, count) {
    const replaying = (strategy === 'replay')
    if (replaying && sec < 0) {start_auto_redo(sec); return}
    // var
    auto_playing_strategy = strategy
    auto_play_sec = true_or(sec, -1)
    truep(count) && (auto_play_count = count)
    // proc
    replaying && rewind_maybe()
    stop_auto_analyze(); update_auto_play_time(); update_let_me_think(); resume()
}
function try_auto_play(force_next) {
    const proc = {
        replay: () => do_as_auto_play(redoable(), redo),
        best: () => try_play_best(...auto_play_weaken),
        random_opening: () => try_play_best('random_opening'),
    }[auto_playing_strategy]
    force_next && (last_auto_play_time = - Infinity)
    auto_play_ready() && proc()
    update_let_me_think(true)
}
function auto_play_ready() {
    return !empty(P.orig_suggest()) && Date.now() - last_auto_play_time >= auto_play_sec * 1000
}
function do_as_auto_play(playable, proc) {
    playable ? (proc(), update_auto_play_time()) : (stop_auto_play(), pause())
    update_all()
}
function update_auto_play_time() {last_auto_play_time = Date.now()}
function auto_play_progress() {
    return auto_playing() ?
        (Date.now() - last_auto_play_time) / (auto_play_sec * 1000) : -1
}
function ask_auto_play_sec(win, replaying) {
    const mismatched_komi = !replaying && AI.different_komi_for_black_and_white()
    const warning = mismatched_komi ? '(Different komi for black & white) ' : ''
    const label = 'Auto play seconds:'
    const cannel = replaying ? 'submit_auto_replay' : 'submit_auto_play'
    generic_input_dialog(win, label, default_auto_play_sec, cannel, warning)
}
function submit_auto_play_or_replay(sec, replaying) {
    const rand_p = store.get('random_opening_p')
    const strategy = replaying ? 'replay' : rand_p ? 'random_opening' : 'best'
    default_auto_play_sec = sec; start_auto_play(strategy, sec, Infinity)
}
function submit_auto_play(sec) {submit_auto_play_or_replay(sec, false)}
function submit_auto_replay(sec) {submit_auto_play_or_replay(sec, true)}
function increment_auto_play_count(n) {
    auto_playing(true) && stop_auto_play()
    auto_play_count += (n || 1)  // It is Infinity after all if n === Infinity
}
function decrement_auto_play_count() {auto_play_count--}
function stop_auto_play() {
    if (!auto_playing()) {return}
    auto_play_count = 0; let_me_think_exit_autoplay()
}
function auto_playing(forever) {
    return auto_play_count >= (forever ? Infinity : 1)
}

// match
let auto_play_weaken = [], pondering_in_match = false
function start_match(win, auto_moves_in_match) {
    const resetp = (auto_moves_in_match === 'reset_param')
    set_auto_moves_in_match(resetp ? 1 : to_i(auto_moves_in_match))
    resetp && renderer('reset_match_param')
    set_board_type('raw', win); R.in_match = true
}
function stop_match(window_id) {
    R.in_match = false; auto_play_weaken = []
    truep(window_id) && toggle_board_type(window_id, null, "raw")
}
function set_match_param(weaken) {
    let m
    auto_play_weaken =
        (weaken === 'diverse') ? ['random_opening'] :
        (m = weaken.match(/^([1-9])$/)) ? ['random_candidate', to_i(m[1]) * 10] :
        (m = weaken.match(/^-([0-9.]+)pt$/)) ? ['lose_score', to_f(m[1])] :
        []
}
function auto_play_in_match(sec, count) {
    pondering_in_match = !pausing
    start_auto_play('best', sec, count || 1)
}
let the_auto_moves_in_match = 1
function get_auto_moves_in_match() {return clip(the_auto_moves_in_match, 1)}
function set_auto_moves_in_match(k) {the_auto_moves_in_match = k}

// auto-redo (without additional analysis)
let the_auto_redo_progress = 0, auto_redo_millisec = 0, auto_redo_timer = null
let auto_redo_progress_by = 0
function auto_redoing() {
    // Caution: setTimeout() returns not an integer but a Timeout object.
    // <https://nodejs.org/api/timers.html#timers_settimeout_callback_delay_args>
    // So if we return auto_redo_timer itself here, we get
    // "Failed to serialize arguments" error in webContents.send()
    // because availability() is not serialized safely
    // when it is passed to renderer. [2020-09-05]
    return truep(auto_redo_timer)
}
function try_auto_redo(force) {
    const epsilon = 1e-10
    if (!redoable()) {stop_auto_redo(); update_all(); return}
    the_auto_redo_progress += auto_redo_progress_by
    force && (the_auto_redo_progress = 1)
    const redo_p = the_auto_redo_progress > 1 - epsilon
    redo_p ? (redo(), (the_auto_redo_progress = 0), update_all()) :
        (update_let_me_think(true), update_all(true))
    try_auto_redo_later()
}
function try_auto_redo_later() {
    clear_auto_redo_timer()  // avoid duplicated timers by try_auto_redo(true)
    const min_interval_millisec = 2000, n_unit = let_me_think_p() ? 2 : 1
    const n = Math.floor(auto_redo_millisec / n_unit / min_interval_millisec) * n_unit
    const interval = auto_redo_millisec / clip(n, n_unit)
    auto_redo_progress_by = interval / auto_redo_millisec
    auto_redo_timer = setTimeout(try_auto_redo, interval)
}
function clear_auto_redo_timer() {clearTimeout(auto_redo_timer); auto_redo_timer = null}
function stop_auto_redo() {clear_auto_redo_timer(); let_me_think_exit_autoplay()}

function auto_redo_progress() {return auto_redoing() ? the_auto_redo_progress : -1}
function ask_auto_redo_sec(win) {
    generic_input_dialog(win, 'Auto redo seconds:', default_auto_play_sec,
                         'start_auto_redo')
}
function start_auto_redo(sec) {
    default_auto_play_sec = sec
    the_auto_redo_progress = 0, auto_redo_millisec = Math.abs(sec) * 1000
    stop_auto(); pause(); rewind_maybe(); update_let_me_think(); try_auto_redo_later()
}

/////////////////////////////////////////////////
// play against leelaz

function play_best(n, weaken_method, ...weaken_args) {
    start_auto_play('best'); increment_auto_play_count(n)
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
    // try_play_best('lose_score', 0.1)
    weaken_method === 'random_leelaz' && AI.switch_to_random_leelaz(...weaken_args)
    if (empty(P.orig_suggest())) {return}
    // comment
    const play_com = m => {
        const base = `by ${AI.engine_info().current.preset_label_text}`
        const {order} = P.orig_suggest().find(s => s.move === m) || {}
        const more = (truep(order) && order > 0) ? [`(order = ${order + 1})`] : []
        const comment = [base, ...more].join(' ')
        play(m, 'never_redo', null, comment)
    }
    // move
    const move =
          weaken_method === 'random_candidate' ? weak_move(...weaken_args) :
          weaken_method === 'lose_score' ? weak_move_by_score(...weaken_args) :
          weaken_method === 'random_opening' ? random_opening_move(...weaken_args) :
          best_move()
    const pass_maybe =
          () => AI.peek_value('pass', value => {
              play_com(value < 0.9 ? 'pass' : move); update_all()
          }) || toast('Not supported')
    const play_it = () => {
        decrement_auto_play_count()
        weaken_method === 'pass_maybe' ? pass_maybe() : play_com(move)
        R.in_match && !pondering_in_match && !auto_playing() && pause()
    }
    do_as_auto_play(move !== 'pass', play_it)
}
function best_move() {return P.orig_suggest()[0].move}
function random_opening_move() {
    // const
    const param = option.random_opening
    const movenum = game.move_count - game.init_len
    const discount = clip(1 - movenum / param.random_until_movenum, 0)
    const suggest = P.orig_suggest(), best = suggest[0]
    const top_visits = Math.max(...suggest.map(s => s.visits))
    const log = (selected, label, val) => selected !== best && debug_log(`random_opening_move: movenum=${movenum + 1}, order=${selected.order}, ${label}=${JSON.stringify(val)}, visits=${selected.visits}, w_loss=${best.winrate - selected.winrate}, s_loss=${best.scoreMean - selected.scoreMean}`)
    // main
    if (movenum <= param.prior_until_movenum && best.prior) {
        const selected = weighted_random_choice(suggest, s => s.prior)
        log(selected, 'prior', selected.prior)
        return selected.move
    }
    if (Math.random() > discount) {return best.move}
    const admissible = s => {
        if (s === best) {return true}
        const ok = (key, limit, sign) =>
              (best[key] - s[key]) * (sign || 1) < param[limit] * discount
        const o_ok = ok('order', 'max_order', -1)
        const w_ok = ok('winrate', 'winrate_loss')
        const s_ok = !truep(best.scoreMean) || ok('scoreMean', 'score_loss')
        const v_ok = s.visits >= top_visits * param.relative_visits
        return o_ok && w_ok && s_ok && v_ok
    }
    const candidates = suggest.filter(admissible), uniform = () => 1
    const selected = weighted_random_choice(candidates, uniform)
    log(selected, 'candidates', candidates.map(h => h.order))
    return selected.move
}
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
    const suggest = weak_move_candidates()
    const not_too_bad = suggest.filter(s => s.winrate >= target_winrate)
    const selected = min_by(empty(not_too_bad) ? suggest : not_too_bad,
                            s => Math.abs(s.winrate - target_winrate))
    debug_log(`weak_move: target_winrate=${target_winrate} ` +
              `move=${selected.move} winrate=${selected.winrate} ` +
              `visits=${selected.visits} order=${selected.order} ` +
              `winrate_order=${selected.winrate_order}`)
    return selected.move
}
function winrate_after(move_count) {
    return move_count < 0 ? NaN :
        move_count === 0 ? P.get_initial_b_winrate() :
        true_or(game.ref(move_count).b_winrate, NaN)
}
function weak_move_by_score(average_losing_points) {
    if (!AI.katago_p()) {return best_move()}
    const suggest = weak_move_candidates()
    const current_score = game.ref_current().score_without_komi || 0
    const losing_points = Math.random() * average_losing_points * 2
    const target_score = current_score - losing_points * (is_bturn() ? 1 : -1)
    const selected =
          min_by(suggest, s => Math.abs(s.score_without_komi - target_score))
    debug_log(`weak_move_by_score: current_score=${current_score} ` +
              `target_score=${target_score} ` +
              `move=${selected.move} score=${selected.score_without_komi} ` +
              `visits=${selected.visits} order=${selected.order} ` +
              `winrate_order=${selected.winrate_order}`)
    return selected.move
}
function weak_move_candidates() {
    const suggest = P.orig_suggest()
    const too_small_visits = (suggest[0] || {}).visits * 0.02
    return suggest.filter(s => s.visits > too_small_visits)
}

/////////////////////////////////////////////////
// other actions

// board type
function toggle_board_type(window_id, type, if_type) {
    if (let_me_think_p() && !type) {toggle_board_type_in_let_me_think(); return}
    const win = window_for_id(window_id)
    const {board_type, previous_board_type} = window_prop(win)
    if (truep(if_type) && (board_type !== if_type)) {return}
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
    game.is_empty() || new_empty_board()
    // [2019-04-29] ref.
    // https://www.nihonkiin.or.jp/teach/lesson/school/start.html
    // https://www.nihonkiin.or.jp/teach/lesson/school/images/okigo09.gif
    // [2020-05-12] ref.
    // http://www.lysator.liu.se/~gunnar/gtp/gtp2-spec-draft2/gtp2-spec.html#sec:fixed-handicap-placement
    const size = board_size(), exceptional_ks = [5, 7]
    const i1 = size > 12 ? 3 : 2, i2 = Math.floor(size / 2), i3 = size - 1 - i1
    const corners = [[i1, i3], [i3, i1], [i3, i3], [i1, i1]]
    const edges = [[i2, i3], [i2, i1], [i1, i2], [i3, i2]]
    const center = [i2, i2]
    const pos = [...corners, ...edges, center].map(ij => idx2move(...ij))
    const moves = pos.slice(0, k)
    exceptional_ks.includes(k) && (moves[k - 1] = last(pos))
    moves.forEach(m => do_play(m, true))
    const len = game.len(), komi = get_stored('komi_for_new_handicap_game')
    merge(game, {init_len: len, handicaps: len, komi})
}
function ask_handicap_stones() {
    ask_choice("Handicap stones", seq(8, 2), add_handicap_stones)
}
function ask_komi(win) {
    const other = 'other...', values = [0, 5.5, 6.5, 7.5, other]
    const proc = k => {k === other ? ask_game_info(win, true) : set_komi(k)}
    ask_choice(`Komi (${game.get_komi()})`, values, proc)
}
function set_komi(k) {
    const update_default_p = game.is_fresh(), handicap_p = game.init_len > 0
    game.komi = k
    update_default_p &&
        set_stored(handicap_p ? 'komi_for_new_handicap_game' : 'komi_for_new_game', k)
}
function ask_choice(message, values, proc) {
    const buttons = [...values.map(to_s), 'cancel']
    const action = z => {
        const v = values[z.response]; truep(v) && proc(v); update_all()
    }
    dialog.showMessageBox(null, {type: "question", message, buttons}).then(action)
}

// misc.
function force_color_to_play(bturn) {R.forced_color_to_play = bturn ? 'black' : 'white'}
function cancel_forced_color() {R.forced_color_to_play = null}
function toggle_trial() {game.trial = !game.trial}
function close_window_or_cut_sequence(win) {
    get_windows().length > 1 ? win.close() :
        attached ? null :
        (sequence.length <= 1 && game.is_empty()) ? win.close() : cut_sequence()
}
function help() {open_help('help.html')}
function open_help(file_name) {
    const menu = [
        {label: '←', click: (it, win) => win.webContents.goBack()},
        {label: '→', click: (it, win) => win.webContents.goForward()},
        {label: 'File', submenu: [{role: 'close'}]},
        {label: 'View',
         submenu: [{role: 'zoomIn'}, {role: 'zoomOut'}, {role: 'resetZoom'}]},
    ]
    const opt = {webPreferences}
    get_new_window(file_name, opt).setMenu(Menu.buildFromTemplate(menu))
}
function open_clipboard_image() {
    // window
    const size = get_windows()[0].getSize()
    const opt = {webPreferences, width: size[0], height: size[1]}
    const file_name = 'sgf_from_image/sgf_from_image.html'
    const win = get_new_window(file_name, opt)
    // menu
    const debug = {label: 'Debug', submenu: [{role: 'toggleDevTools'}]}
    const usage = {label: 'Usage', click: open_demo_image}
    const tips = {label: 'Tips', click: () => win.webContents.send('highlight_tips')}
    const menu = [
        {label: 'File', submenu: [{role: 'close'}]},
        {label: 'View',
         submenu: [{role: 'zoomIn'}, {role: 'zoomOut'}, {role: 'resetZoom'}]},
        {label: 'Help', submenu: [usage, tips]},
        ...(app.isPackaged ? [] : [debug]),
    ]
    // init
    win.setMenu(Menu.buildFromTemplate(menu))
}
function open_demo_image() {open_image_url('demo.png')}
function info_text() {
    const f = (label, s) => s ?
          `<${label}>\n` + JSON.stringify(s) + '\n\n' : ''
    const sa = AI.all_start_args()
    const lz = AI.leelaz_for_white_p() ?
          (f("engine (black)", sa.black) + f("engine (white)", sa.white)) :
          f("engine", sa.black)
    const slog = `<startup log>\n${AI.startup_log().join("\n")}`
    const sgf = snip_text(game.sgf_str || '', 500, 0, over => `...${over}...`)
    const message = f("sgf file", game.sgf_file) + lz + f("sgf", sgf) + slog
    return message
}
function ask_new_game(win) {ask_game_info(win, false, true)}
function ask_game_info(win, asking_komi_p, initial_p) {
    const {board_size, handicaps} = game
    const params = {
        info_text: info_text(), sgf_rule: game.sgf_gorule, current_rule: get_gorule(),
        supported_rules: AI.is_gorule_supported() && katago_supported_rules,
        handicaps, asking_komi_p, initial_p,
    }
    win.webContents.send('ask_game_info', params)
}
function set_game_info(player_black, player_white, size, handicaps,
                       komi, sgf_gorule, gorule, comment, initial_p) {
    initial_p && new_empty_board(2 <= size && size <= 19 && size)
    initial_p && handicaps > 0 && 2 <= handicaps && handicaps <= 9 &&
        add_handicap_stones(handicaps)
    set_gorule(gorule, gorule !== game.gorule); set_komi(komi)
    merge(game, {player_black, player_white, sgf_gorule})
    merge(game.ref_current(), {comment})
}
function ask_endstate_diff_interval(win) {
    generic_input_dialog(win, 'Ownership diff interval (moves):',
                         P.get_endstate_diff_interval(), 'set_endstate_diff_interval')
}
function set_endstate_diff_interval(k) {P.set_endstate_diff_interval(k)}
function tag_or_untag() {
    if (game.move_count === 0) {wink(); return}
    game.trial_from = game.move_count - 1
    game.add_or_remove_tag(); P.update_info_in_stones()
}
function transform_board(key) {
    // set dummy endstate for cheating set_tentative_endstate_maybe()
    game.transform(key); game.ref_current().endstate = [[]]
}
function resize_to_19x19() {
    // use SGF to clear recorded analysis
    read_sgf(game.shallow_copy({board_size: 19}).to_sgf(), null, true)
}
function save_q_and_a_images() {
    const pre = 'qa', format = {pre, sep: '_', post: ''}, dir = exercise_dir()
    const path = PATH.join(dir, exercise_filename(game, format))
    const filenames = ['a', 'b'].map(z => `${path}_${z}.png`)
    const msg_path = `${PATH.join(dir, pre)}...`
    renderer('save_q_and_a_images', ...filenames, msg_path)
}
function edit_middle(move) {
    const stone_p = (aa_ref(R.stones, ...move2idx(move)) || {}).stone
    if (!stone_p && !redoable()) {do_play(move, black_to_play_now_p()); return}
    const editing_p = game.trial && game.successive_edit_middle_p()
    const new_game = game.shallow_copy()
    with_game(new_game, edit_middle_sub, move, stone_p)
    const modified = (new_game.ref_last() !== game.ref_last()) || (new_game.len() !== game.len())
    if (!modified) {return}
    const replace = editing_p ? replace_sequence : backup_and_replace_game
    new_game.brothers = [game]; replace(new_game); clear_sgf(true); update_branch()
}
function edit_middle_sub(move, stone_p) {
    const last_move_p = move === game.ref_current().move
    const ed = game.edit_middle
    last_move_p ? ed(explicit_undo) : stone_p ? delete_move(move) : ed(play, move)
}
function delete_move(move) {
    const mc = game.latest_move_count_for(move); if (mc <= 0) {return}
    with_move_count(mc, () => game.edit_middle(delete_last_move))
    mc <= game.init_len && game.init_len--
}

function with_game(tmp_game, proc, ...args) {
    const orig = game; set_game(tmp_game); proc(...args); set_game(orig)
}
function with_move_count(tmp_mc, proc, ...args) {
    const diff = game.move_count - tmp_mc  // move_count can be changed in proc
    game.move_count = tmp_mc; proc(...args); game.move_count = game.move_count + diff
}

/////////////////////////////////////////////////
// tsumego frame

function add_tsumego_frame(ko_p) {
    if (game.move_count === 0) {return}
    const play1 = ([i, j, is_black]) => do_play(idx2move(i, j), is_black)
    const bturn = is_bturn(), komi = AI.engine_info().engine_komi
    const [fill, analysis_region] =
          tsumego_frame(game.current_stones(), komi, bturn, ko_p)
    if (empty(fill)) {wink(); return}
    duplicate_sequence(true, true); fill.forEach(play1)
    set_gorule(default_gorule)
    const [i0, j0, is_black0] = last(fill) || []
    !!is_black0 === !!bturn && do_play('pass', !bturn)
    renderer('update_analysis_region', analysis_region)
}

/////////////////////////////////////////////////
// utils for actions

let long_busy = false
const [set_long_busy_later, cancel_long_busy] =
      deferred_procs([() => {long_busy = true}, 1000], [() => {long_busy = false}, 0])
function is_long_busy() {return long_busy}
function unset_long_busy() {long_busy = false; cancel_long_busy()}

function undoable() {return game.move_count > game.init_len}
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
function update_ponder() {AI.set_pondering(pausing, busy)}
function init_from_renderer() {
    const proc = () => {warn_disabled_cache(), restore_session()}
    setTimeout(proc, 100)
}
function warn_disabled_cache() {
    const key = 'use_cached_suggest_p', label = 'Reuse analysis'
    if (R[key]) {return}
    const message = `"${label}" is disabled. Enable it?`
    const yes = 'YES (recommended)', values = [yes]
    const proc = k => k === yes && (toggle_stored(key), toast(`"${label}" is enabled.`))
    ask_choice(message, values, proc)
}

function set_board() {
    set_AI_board_size_maybe(game.board_size)
    const hist = P.set_board(game)
    AI.set_board(hist, game.get_komi(), get_gorule(), R.show_endstate, aggressive(), get_stored('show_aggressive_defensive'))
    AI.switch_leelaz(); update_let_me_think(true)
}
function set_AI_board_size_maybe(bsize) {
    bsize !== board_size() && AI.restart(leelaz_start_args_for_board_size(bsize))
}
function aggressive() {
    const in_case = (R.in_match || AI.leelaz_for_white_p()); if (!in_case) {return ''}
    const {handicaps} = game, komi = game.get_komi()
    const b = (handicaps === 0 && komi >= 15) && 'b'
    const w = (handicaps > 0 || komi <= 0) && 'w'
    return b || w || ''
}

function generic_input_dialog(win, label, init_val, channel, warning) {
    win.webContents.send('generic_input_dialog', label, init_val, channel, warning || '')
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
    if (!let_me_think_p(true)) {let_me_think_previous_stage = null; return}
    let_me_think_switch_board_type(only_when_stage_is_changed)
}
function let_me_think_switch_board_type(only_when_stage_is_changed) {
    const epsilon = 1e-10  // for auto_redo
    const progress = auto_progress(true); if (progress < 0) {return}
    const stage = progress < 0.5 - epsilon ? 'first_half' : 'latter_half'
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
function let_me_think_exit_autoplay() {
    let_me_think_p(true) && let_me_think_set_board_type_for('latter_half')
}

function toggle_let_me_think() {set_let_me_think(!let_me_think_p())}
function stop_let_me_think() {set_let_me_think(false)}
function set_let_me_think(val) {
    set_stored('let_me_think', val); update_let_me_think()
}
function let_me_think_p(strictly) {
    return store.get('let_me_think') && !(strictly && R.in_match)
}

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
    new_game.komi = get_stored('komi_for_new_game')
    insert_sequence(new_game)
}

function backup_game(delete_future_p) {
    backup_and_replace_game(game.shallow_copy(), false, delete_future_p)
}
function backup_and_replace_game(new_game, before, delete_future_p) {
    game.is_empty() ? replace_sequence(new_game) : insert_sequence(new_game, before)
    delete_future_p && game.delete_future()
    update_branch()
    const stones = new_game.current_stones(), will_modified_afterward = in_exercise_p()
    P.add_info_to_stones(stones, new_game)
    // setTimeout for updating of new_game.trial in create_sequence_maybe()
    !will_modified_afterward &&
        setTimeout(() => renderer('take_thumbnail', new_game.id, stones, new_game.trial))
}

function create_sequence_maybe(force) {
    const create_p = force || game.move_count < game.len()
    const empty_now = game.move_count === 0
    return !create_p ? false : empty_now ? (new_empty_board(), true) :
        (backup_game(true), clear_sgf(true), true)
}
function clear_sgf(trial) {merge(game, {trial, sgf_file: "", sgf_str: ""})}

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
function switch_to_game(another_game, move_count) {
    const n = sequence.indexOf(another_game)
    n >= 0 ? nth_sequence(n) : backup_and_replace_game(another_game)
    goto_move_count(move_count)
}
function switch_to_game_id(id, move_count) {
    const llb = last_ladder_branches()
    const bs = [...sequences_and_brothers(), ...llb]
    const another_game = bs.find(g => g.id === id); if (!another_game) {return}
    const ladder_p = llb.includes(another_game)
    const mc = ladder_p ? Infinity : move_count
    ladder_p && cancel_ladder_hack(another_game)
    switch_to_game(another_game, mc)
}

let cut_first_p = false
function cut_sequence() {
    cut_first_p = (sequence_cursor === 0)
    push_deleted_sequence(game); delete_sequence()
}
function uncut_sequence() {
    const insert_before = (cut_first_p && sequence_cursor === 0)
    exist_deleted_sequence() &&
        backup_and_replace_game(pop_deleted_sequence(), insert_before)
}

function duplicate_sequence(until_current_move_p, explicit) {
    const remove_next_move_mark = () => P.update_info_in_stones()
    game.is_empty() ? new_empty_board() :
        (backup_game(until_current_move_p),
         game.set_last_loaded_element(), (game.trial = !explicit),
         (until_current_move_p && remove_next_move_mark()))
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
    P.renew_game()
    set_game(sequence[sequence_cursor = n])
    update_branch()
}
function next_sequence_effect() {renderer('slide_in', 'next')}
function previous_sequence_effect() {renderer('slide_in', 'previous')}

function sequence_prop_of(given_game) {
    const pick_tag = h => {
        const h_copy = P.append_implicit_tags_maybe(h); return h_copy.tag || ''
    }
    const tags = exclude_implicit_tags(given_game.map(pick_tag).join(''))
    const {player_black, player_white, init_len, move_count, trial} = given_game
    return {player_black, player_white, init_len, move_count, trial, len: given_game.len(), tags}
}

function sequences_and_brothers() {return [...sequence, ...game.brothers]}

/////////////////////////////////////////////////
// deleted_sequences

// deleted_sequences = [pgame, pgame, ...]
// pgame = game or "packed game"

// "packed game" = compressed SGF.
// We need to recover cached suggestions into the "current" engine's
// record from autosaved games.
// So we want to call create_games_from_sgf() not in restore_session()
// but in pop_deleted_sequence() lazily.
// This is the reason why we keep pgame in deleted_sequences.
// In addition, we also store another version of SGF without cached suggestions
// into pgame for efficiency.

const deleted_sequences = []
const max_deleted_sequences = 100
function push_deleted_sequence(sequence) {
    deleted_sequences.push(pgame_from_game(sequence))
    const expired = deleted_sequences.length - max_deleted_sequences
    expired > 0 && deleted_sequences.splice(0, expired)
}
function pop_deleted_sequence() {
    return game_from_pgame(deleted_sequences.pop(), R.use_cached_suggest_p)
}
function exist_deleted_sequence() {return !empty(deleted_sequences)}
function empty_deleted_sequence_p(pgame) {
    return !is_pgame(pgame) && pgame.is_empty()
}

function make_pgame(longer_stored, shorter_stored) {
    return {pgame_p: true, longer_stored, shorter_stored}
}
function is_pgame(z) {return (z || {}).pgame_p}

function game_from_pgame(pgame, cache_suggestions_p) {
    return is_pgame(pgame) ?
        game_from_stored(stored_from_pgame(pgame, cache_suggestions_p), cache_suggestions_p) : pgame
}
function pgame_from_game(game) {return game}

function stored_from_pgame(pgame, cache_suggestions_p) {
    return is_pgame(pgame) ?
        pgame[cache_suggestions_p ? 'longer_stored' : 'shorter_stored'] :
    stored_from_game(pgame, cache_suggestions_p)
}
function pgame_from_stored(stored) {
    const too_large = 20 * 400  // rough bound of letters * moves
    const shorter = (stored.length < too_large) ? stored :
          stored_from_game(game_from_stored(stored, true, true))
    return make_pgame(stored, shorter)
}

// internal
function game_from_stored(stored, cache_suggestions_p, internal_p) {
    const f = internal_p ? create_games_from_sgf_internal : create_games_from_sgf
    return f(uncompress(stored), cache_suggestions_p)[0]
}
function stored_from_game(game, cache_suggestions_p) {
    return compress(game.to_sgf(cache_suggestions_p, true))
}

/////////////////////////////////////////////////
// autosave

const stored_session = new ELECTRON_STORE({name: 'lizgoban_session'})
function store_session(cache_suggestions_p) {
    debug_log('store_session start')
    const nonempty = g => !empty_deleted_sequence_p(g)
    // reverse sequence so that one can recover the same order by repeated ctrl-z
    const rev_seq = sequence.slice().reverse().filter(nonempty)
    const deleted_seq =
          deleted_sequences.slice(- option.autosave_deleted_boards).filter(nonempty)
    const saved_seq = [...deleted_seq, ...rev_seq]
    const cache_lim = Math.max(rev_seq.length, option.autosave_cached_suggestions)
    const cache_p = k => cache_suggestions_p && (saved_seq.length - k) <= cache_lim
    const stored = saved_seq.map((g, k) => stored_from_pgame(g, cache_p(k)))
    stored_session.set('sequences_gz_b64', stored)
    debug_log('store_session done')
}
function restore_session() {
    debug_log('restore_session start')
    deleted_sequences.push(...stored_session.get('sequences_gz_b64', []).map((stored, k, all) => {
        toast(`restoring autosaved games (${k + 1}/${all.length})...`)
        return pgame_from_stored(stored)
    }))
    debug_log('restore_session done')
}

let autosave_timer = null
function autosave_later() {
    const f = () => {store_session(); autosave_timer = null}
    const delay = option.autosave_sec * 1000
    !truep(autosave_timer) && (autosave_timer = setTimeout(f, delay))
}

function compress(str) {return gzipSync(str).toString('base64')}
function uncompress(str) {return gunzipSync(Buffer.from(str, 'base64')).toString()}

/////////////////////////////////////////////////
// utils for updating renderer state

function update_state(keep_suggest_p) {
    const history_length = game.len(), sequence_length = sequence.length
    const sequence_ids = sequence.map(h => h.id)
    const sequence_props = aa2hash(sequence.map(h => [h.id, sequence_prop_of(h)]))
    const pick_tagged = h => {
        const h_copy = P.append_implicit_tags_maybe(h)
        return h_copy.tag ? [h_copy] : []
    }
    const history_tags = game.flatMap(pick_tagged)
    const {player_black, player_white, trial} = game
    const su = P.move_count_for_suggestion(), showing_until_p = finitep(su)
    const cur = game.ref(showing_until_p ? su : game.move_count)
    const prev_su = showing_until_p && game.ref(su - 1)
    const showing_bturn = !cur.is_black
    const subboard_stones_suggest = prev_su && prev_su.suggest && {
        ...subboard_stones_suggest_for(su, prev_su), gain: cur.gain,
    }
    const amm = get_auto_moves_in_match()
    const in_pair_go = R.in_match && (amm !== 1) && (amm === 3 ? 'pair_go' : amm)
    const more = (cur.suggest && !is_busy()) ? {background_visits: null, ...cur} :
          keep_suggest_p ? {} : {suggest: []}
    const {face_image_rule, pv_trail_max_suggestions} = option
    update_exercise_metadata()
    P.set_and_render(!keep_suggest_p, {
        history_length, sequence_cursor, sequence_length, attached,
        player_black, player_white, trial, sequence_ids, sequence_props, history_tags,
        image_paths, face_image_rule, exercise_metadata,
        showing_bturn, subboard_stones_suggest,
        in_pair_go,
        pv_trail_max_suggestions,
    }, more)
}
function subboard_stones_suggest_for(su, prev_su) {
    const bturn = !prev_su.is_black, suggest = (prev_su.suggest || [{}])[0]
    const stones = game.stones_at(su - 1)
    P.add_next_mark_to_stones(stones, game, su - 1)
    return {stones, suggest, bturn}
}

function update_ui() {
    renderer_with_window_prop('update_ui', availability())
    update_title()
}

const title_change_detector = change_detector('')
function update_title() {
    const b = R.player_black, w = R.player_white
    const n = x => x || '?'
    const names = (b || w) ? `(B: ${n(b)} / W: ${n(w)})` : ''
    const tags = current_tag_letters()
    const tag_text = tags ? `[${tags}]` : ''
    const title = `LizGoban ${names} ${tag_text} ${R.weight_info || ''}`
    title_change_detector.is_changed(title) &&
        get_windows().forEach(win => win.setTitle(title))
}
function current_tag_letters() {
    return exclude_implicit_tags(R.history_tags.map(x => x.tag).join(''))
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
    const auto_p = auto_analyzing_or_playing()
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
        start_auto_analyze: !auto_p,
        stop_auto: auto_p,
        trial: game.trial,
    }
}

/////////////////////////////////////////////////
// leelaz process

// load weight file
function load_weight(white_p) {
    const dir = option_path('weight_dir') ||
          PATH.dirname(AI.leelaz_weight_file(white_p) || '')
    const weight_file = select_weight_file(dir)
    weight_file && (load_weight_file(weight_file, white_p), AI.backup())
}
function load_weight_file(weight_file, white_p) {
    AI.load_weight_file(weight_file, white_p)
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
function leelaz_start_args(leelaz_command, given_leelaz_args, label) {
    const {working_dir} = option
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
    if (update_only_p) {update_all(true); return}
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
    const action = () => {resume(); update_all()}
    dialog.showMessageBox({type: "info",  buttons: ["OK"], message}).then(action)
    tuning_message = null; update_all()
}
function cancel_tuning() {tuning_message && (tuning_message = null)}

function illegal_handler({move, is_black, move_count}) {
    const message = `Illegal: ${is_black ? 'B' : 'W'}(${move_count - game.init_len}) ${move}`
    toast(message, 5000); AI.cancel_past_requests(); update_all()
}

/////////////////////////////////////////////////
// SGF

function copy_sgf_to_clipboard(cache_suggestions_p) {
    clipboard.writeText(game.to_sgf(cache_suggestions_p)); wink()
}
function paste_sgf_or_url_from_clipboard() {
    if (!clipboard.readImage().isEmpty()) {open_clipboard_image(); return}
    const s = clipboard.readText(); s.match('^(file|https?)://') ? open_url(s) : read_sgf(s)
}

function open_sgf_etc() {open_sgf_etc_in(option_path('sgf_dir'))}
function open_sgf_etc_in(dir, proc) {
    select_files('Select SGF etc.', dir).forEach(proc || load_sgf_etc)
}
function load_sgf_etc(filename) {
    const res = sgf_str => {read_sgf(sgf_str, filename); update_all()}
    const rej = () => {load_sgf(filename); update_all()}
    XYZ2SGF.fileToConvertedString(filename).then(res, rej)
}
function load_sgf(filename, internally) {
    read_sgf(fs.readFileSync(filename, {encoding: 'utf8'}), filename, internally)
}

function save_sgf(cache_suggestions_p) {
    const f = dialog.showSaveDialogSync(null, {
        title: 'Save SGF file',
        defaultPath: option_path('sgf_dir'),
    }); if (!f) {return}
    const ext = '.sgf', filename = f + (f.endsWith(ext) ? '' : ext)
    const if_success = () => (game.sgf_file = filename)
    save_sgf_to(filename, if_success, !cache_suggestions_p)
}
function save_sgf_to(filename, if_success, force_short_p, force_note_p) {
    const callback = err => {if (err) {throw err} else {if_success && if_success()}}
    fs.writeFile(filename, game.to_sgf(!force_short_p, force_note_p), callback)
}

function read_sgf(sgf_str, filename, internally) {
    const new_games = create_games_from_sgf(sgf_str, R.use_cached_suggest_p)
    if (empty(new_games)) {
        dialog.showErrorBox("Failed to read SGF", snip(sgf_str, 200)); return
    }
    const trunk = new_games[0]
    const common_props = {sgf_file: filename || "", brothers: new_games}
    const auto_p = store.get('auto_overview')
    new_games.forEach(g => merge(g, common_props, {trial: g !== trunk}))
    trunk.merge_common_header(game); backup_and_replace_game(trunk)
    if (internally) {return}
    auto_p ? (!AI.leelaz_for_white_p() && start_quick_overview()) : undo_to_start()
}

function open_url(url) {
    const u = safely(() => (new URL(url))), open = () => open_url_sub(url, u)
    if (!u) {show_error(`broken URL: ${url}`); return}
    u.protocol === 'file:' ? open() : ask_choice(`Open ${url}`, ['OK'], open)
}
function open_url_sub(url, u) {
    // image
    const image_p = u.pathname.match(/(jpg|jpeg|gif|png|webp)$/i)
    if (image_p) {open_image_url(url); return}
    // SGF
    const on_get = res => {
        if (res.statusCode !== 200) {
            toast(`Failed to get ${url}`); res.resume(); return
        }
        let str = ''
        res.setEncoding('utf8')
        res.on('data', chunk => {str += chunk})
        res.on('end', () => {read_sgf(str); update_all()})
    }
    switch (u.protocol) {
    case 'https:': https.get(url, on_get); break;
    case 'http:': http.get(url, on_get); break;
    case 'file:': load_sgf_etc(u.pathname); break;
    default: toast(`Unsupported protocol: ${url}`); break;
    }
}
function open_image_url(url) {clipboard.writeText(url); open_clipboard_image()}

// personal exercise book

function store_as_exercise() {
    const path = PATH.join(exercise_dir(), exercise_filename(game))
    save_sgf_to(path, null, true, true); toast('stored as exercise')
}
function load_random_exercise(win) {load_exercise(random_exercise_chooser, win, true)}
function load_recent_exercise(win) {load_exercise(recent_exercise_chooser, win)}
function exercise_mtime(fn) {return fs.statSync(expand_exercise_filename(fn)).mtimeMs}
let seen_exercises = []
function revive_seen_exercises(metadata) {
    const hours = 18  // avoid showing same exercises within X hours
    seen_exercises = recently_seen_exercises_in(seen_exercises, metadata, hours)
}

function load_exercise(selector, win, random_flip_p) {
    const metadata = get_all_exercise_metadata()
    revive_seen_exercises(metadata)
    const dir = exercise_dir()
    const valid = name =>
          is_exercise_filename(name) && seen_exercises.indexOf(name) < 0 &&
          exercise_board_size(name) === board_size()
    const files = (fs.readdirSync(dir) || []).filter(valid)
    const retry = () => {seen_exercises = []; load_exercise(selector, win, random_flip_p)}
    if (empty(files)) {empty(seen_exercises) ? wink() : retry(); return}
    const fn = selector(files, metadata); seen_exercises.push(fn)
    start_match(win, 'reset_param'); load_as_exercise(expand_exercise_filename(fn))
    random_flip_p && game.random_flip_rotate()
    game.set_last_loaded_element(); tag_or_untag()
    update_exercise_metadata({seen_at: (new Date()).toJSON()})
}
function load_as_exercise(file) {
    load_sgf(file, true); goto_move_count(exercise_move_count(file)); game.trial = true
}
function open_exercise_dir() {open_sgf_etc_in(exercise_dir(), load_as_exercise)}
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

function expand_exercise_filename(filename) {return PATH.join(exercise_dir(), filename)}
function is_exercise_file(path) {
    if (!path) {return}
    const in_dir_p = (f, d) => d && (PATH.resolve(d, PATH.basename(f)) === f)
    const name = PATH.basename(path)
    return in_dir_p(path, exercise_dir()) && is_exercise_filename(name)
}

const exercise_metadata_checker = change_detector()
function update_exercise_metadata(prop) {
    if (!in_exercise_p()) {
        exercise_metadata = null; exercise_metadata_checker.reset(); return
    }
    const key = exercise_metadata_key()
    const changed = prop || exercise_metadata_checker.is_changed(key)
    changed && (exercise_metadata = update_exercise_metadata_for(key, prop || {}))
}
function exercise_metadata_key() {return PATH.basename(game.sgf_file || '')}

function increase_exercise_stars(delta) {
    if (!in_exercise_p()) {return}
    const stars = R.exercise_metadata.stars += delta
    update_exercise_metadata({stars})
}

function in_exercise_p() {return is_exercise_file(game.sgf_file)}

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
    const sgf_file = TMP.fileSync({mode: 0o644, prefix: 'lizgoban-', postfix: '.sgf'})
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
    stop_auto(); stop_match(); attached ? detach_from_sabaki() : attach_to_sabaki()
}

/////////////////////////////////////////////////
// REPL for debug

function toggle_repl() {repl ? repl.close() : start_repl()}
function repl_p() {return !!repl}
function start_repl() {
    const repl_context = {
        // unoffical: may be changed in future
        game, sequence, sequence_cursor, option, R, api, update_all,
        // official
        mimic,
    }
    repl = require('repl').start('LizGoban> ')
    repl.on('exit', () => {repl = null; console.log('REPL is closed.'); update_all()})
    merge(repl.context, repl_context)
}
function repl_update_game() {repl_p() && merge(repl.context, {game})}
