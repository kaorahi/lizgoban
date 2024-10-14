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
    option, option_path, option_expand_path, image_paths, white_preset,
    preference_spec,
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
const jschardet = require('jschardet'), iconv = require('iconv-lite')
const {gzipSync, gunzipSync} = require('zlib')
const {katago_supported_rules, katago_rule_from_sgf_rule} = require('./katago_rules.js')
const {select_weak_move, weak_move_prop} = require('./weak_move.js')
const rankcheck_move = require('./rankcheck_move.js')
const {should_resign_p} = require('./resign.js')
const {
    exercise_filename, is_exercise_filename, exercise_move_count, exercise_board_size,
    update_exercise_metadata_for, get_all_exercise_metadata,
    random_exercise_chooser, recent_exercise_chooser, recently_seen_exercises_in,
} = require('./exercise.js')(exercise_mtime)
const {tsumego_frame} = require('./tsumego_frame.js')
const {ladder_branches, ladder_is_seen, last_ladder_branches, cancel_ladder_hack}
      = require('./ladder.js')
const {branch_at, update_branch_for} = require('./branch.js')
const {generate_persona_param} = require('./persona_param.js')
const {engine_log_conf} = require('./engine.js')

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
// auto_playing_strategy = 'play', 'replay', 'random_opening'
let auto_play_sec = 0, auto_playing_strategy = 'replay'
let pausing = false, busy = false
let exercise_metadata = null, exercise_match_p = false
let adjust_sanity_p = false
let auto_play_weaken_for_bw = {}; clear_auto_play_weaken_for_bw()
let debug_menu_p = !app.isPackaged

function set_game(new_game) {
    game = new_game
    repl_update_game()
}

// renderer state
// (cf.) "set_renderer_state" in powered_goban.js
// (cf.) "the_suggest_handler" in engine.js
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
    humansl_profile_request_callback: update_all,
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
        ...aa2hash([
            'plot_order_p',
            'plot_endstate_surprise_p',
            'plot_score_stdev_p',
            'plot_shorttermScoreError_p',
            'amb_gain_recent',
        ].map(key => [key, () => option[key]])),
    }
})
const P = require('./powered_goban.js')

function render(given_R, is_board_changed) {
    // to avoid flicker in let-me-think-first mode,
    // send window_prop to update board_type surely
    // by set_and_render() in suggest_handler() [2024-07-08]
    renderer_with_window_prop('render', given_R, is_board_changed)
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
    AI.start_leelaz(leelaz_start_args(...args))
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

const {set_showing_until, hold_suggestion_for_a_while} = P
const simple_api = {
    unset_busy, toggle_board_type, toggle_let_me_think, toggle_stored,
    copy_sgf_to_clipboard, set_endstate_diff_interval, set_showing_until, update_menu,
    hold_suggestion_for_a_while,
    set_match_param, ladder_is_seen, force_color_to_play, cancel_forced_color,
    set_sanity_from_renderer,
    set_humansl_profile_in_match,
    open_image_url,
    memorize_settings_for_sgf_from_image, archive_sgf_from_image,
    enable_menu,
}
const api = {
    ...simple_api,
    init_from_renderer,
    toggle_pause,
    play, undo, redo, explicit_undo, pass, undo_ntimes, redo_ntimes, undo_to_start, redo_to_end,
    edit_middle,
    let_me_think_next, goto_next_something, goto_previous_something,
    goto_move_count_anyway,
    goto_move_count, toggle_auto_analyze, play_best, stop_auto,
    submit_auto_play, submit_auto_replay, auto_play_in_match,
    start_auto_redo,
    stop_match,
    play_pass_maybe,
    new_empty_board, add_handicap_stones,
    paste_sgf_or_url_from_clipboard,
    read_sgf, open_url, set_game_info,
    next_sequence, previous_sequence, nth_sequence, cut_sequence, duplicate_sequence,
    switch_to_game_id,
    debug_increase_komi,
    increase_exercise_stars,
    detach_from_sabaki,
    update_analysis_region,
    set_persona_code, set_adjust_sanity_p,
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
    const silently = [
        'ladder_is_seen', 'play_pass_maybe', 'hold_suggestion_for_a_while',
        // to avoid unintentional cancel of kata-search_analyze_cancellable
        'submit_auto_play', 'enable_menu',
    ]
    const keep_board = ['toggle_pause', !is_busy() && 'unset_busy', 'set_showing_until']
    const whether = a => (a.indexOf(channel) >= 0)
    debug_log(`API ${channel} ${JSON.stringify(args)}`)
    handler(...args); whether(silently) || update_all(whether(keep_board))
    debug_log(`API (done) ${channel} ${JSON.stringify(args)}`)
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

const busy_handler_for =
      cached(subchannel => api_handler(subchannel, api[subchannel], true))
ipc.on('busy', (e, subchannel, ...args) => busy_handler_for(subchannel)(e, ...args))

function ipc_with_sender_window(channel, proc) {
    ipc.on(channel,
           (e, ...args) => apply_api(channel, (...a) => {
               stop_auto()
               proc(electron.BrowserWindow.fromWebContents(e.sender), ...a)
           }, args))
}
each_key_value({
    close_window_or_cut_sequence, ask_new_game, read_sgf_from_image,
}, (channel, proc) => ipc_with_sender_window(channel, proc))

ipc.on('app_version', e => (e.returnValue = app.getVersion()))

ipc.on('get_preferences',
       e => (e.returnValue =
             preference_spec.map(([key, label, shortcut]) => [key, get_stored(key), label, shortcut])))
ipc.on('set_preference', (e, key, val) => {set_stored(key, val); update_all()})

const humansl_comparison_keys = [
        'humansl_stronger_profile', 'humansl_weaker_profile',
        'humansl_color_enhance',
]
ipc.on('get_humansl_comparison', e => {
    e.returnValue = AI.is_supported('sub_model_humanSL') &&
        aa2hash(humansl_comparison_keys.map(key => [key, get_stored(key)]))
})
ipc.on('set_humansl_comparison', (e, p) => {
    humansl_comparison_keys.forEach(key => set_stored(key, p[key]))
    update_ponder_surely()
})

// update after every command

function update_all(keep_board) {
    debug_log(`update_all start (keep_board = ${keep_board})`)
    keep_board || set_board()
    update_engine_log_conf()
    update_state(keep_board); update_ponder(); update_ui(); update_menu()
    debug_log('update_all done')
}

/////////////////////////////////////////////////
// main flow (2) change game state and send it to powered_goban

function play(move, force_create, default_tag, comment, auto_play_in_match_sec) {
    if (move === 'resign') {resign(); return}
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
    // need to send 'play' to engine before auto_play_in_match,
    // that can send 'genmove' immediately.
    update_all()
    apply_move_effect(pass)
    truep(auto_play_in_match_sec) &&
        auto_play_in_match(auto_play_in_match_sec, get_auto_moves_in_match())
    autosave_later()
}
function apply_move_effect(pass) {pass && wink(); play_move_sound(pass)}

function black_to_play_now_p() {return black_to_play_p(R.forced_color_to_play, is_bturn())}
function do_play(move, is_black, tag, note) {
    // We drop "double pass" to avoid halt of analysis by Leelaz.
    // B:D16, W:Q4, B:pass ==> ok
    // B:D16, W:Q4, B:pass, W:D4 ==> ok
    // B:D16, W:Q4, B:pass, W:pass ==> B:D16, W:Q4
    is_last_move_pass() && is_pass(move) ? game.pop() :
        game.push({move, is_black, tag, move_count: game.len() + 1, note})
}
function resign() {
    toast(`${is_bturn() ? 'B' : 'W'}: resign`)
    play_move_sound(true)
    pause(); stop_auto(); update_all()
}
function undo() {undo_ntimes(1)}
function redo() {redo_ntimes(1)}
function explicit_undo() {
    !undoable() ? wink() :
        // delete if the last move, just undo otherwise
        redoable() ? undo() : wink_if_pass(delete_last_move)
}
function delete_last_move() {game.pop(); update_branch(); autosave_later()}
function pass() {play(pass_command)}
function is_pass(move) {return move === pass_command}
function is_last_move_pass() {return is_pass(game.last_move())}

function undo_ntimes(n) {wink_if_pass(goto_move_count, game.move_count - n)}
function redo_ntimes(n) {undo_ntimes(- n)}
function undo_to_start() {undo_ntimes(Infinity)}
function redo_to_end() {redo_ntimes(Infinity)}

function goto_move_count(count) {
    goto_move_count_anyway(clip(count, game.init_len, game.len()))
}
function goto_move_count_anyway(count) {game.move_count = count}

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
            P.overlooked_high_policy_p(ary[k + sign] || {}, h) && 'policy',
        ].filter(truep).join(' / '); return reason
    }
    const all = game.array_until(Infinity); backwardp && all.reverse()
    const hit = all.find(interesting)
    hit ? (goto_move_count(hit.move_count), toast(reason, 1000)) :
        backwardp ? undo_to_start() : redo_to_end()
}

function genmove(...args) {genmove_gen('genmove', AI.genmove, ...args)}
function genmove_analyze(...args) {
    genmove_gen('genmove_analyze', AI.genmove_analyze, ...args)
}
function genmove_gen(name, f, sec, play_func) {
    const cur = game.ref_current()
    const note = `${name} by ${AI.current_preset_label()}`
    const default_play_func = (move, note) => {
        play(move, false, undefined, note); update_ponder_surely()
    }
    const play_it = play_func || default_play_func
    const if_ok = move => {
        if (cur !== game.ref_current()) {if_ng_gen(`ignore obsolete ${name}`); return}
        play_it(move, note)
    }
    const if_ng_gen = message => {
        toast(message); stop_auto(); AI.cancel_past_requests()
        update_ponder_surely()
    }
    const if_ng = res => if_ng_gen(`${name} failded: ${res}`)
    const callback = (ok, res) => (ok ? if_ok : if_ng)(res)
    f(sec, callback)
}

/////////////////////////////////////////////////
// another source of change: menu

let force_normal_menu_p = false

// to ignore accelerators (e.g. Shift+N) on input forms in custom dialogs
let the_menu_enabled_p = true
function enable_menu(bool) {the_menu_enabled_p = bool; update_menu()}
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
        menu('Pair match', [
            pair_match_menu(null, item), sep,
            ...[90, 75, 50, 25, 10].map(r => pair_match_menu(r, item)),
        ]),
        sep,
        item('Open SGF etc....', 'CmdOrCtrl+O', open_sgf_etc, true),
        menu('Open recent', openrecent_submenu(item, sep)),
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
        item('Reopen image', undefined, reveal_sgf_from_image_window, true,
             hidden_sgf_from_image_window_p()),
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
            item('Swap stone colors', undefined, swap_stone_colors),
            item('resize to 19x19 (bottom left)', undefined, resize_to_19x19),
        ]),
        item(`Komi (${game.get_komi()})`, undefined, () => ask_komi(win)),
        menu(`Rule (${get_gorule()})`, AI.is_gorule_supported() ? gorule_submenu() : []),
        item('Info', 'CmdOrCtrl+I', () => ask_game_info(win)),
        sep,
        item('Preferences', 'CmdOrCtrl+,', open_preference),
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
        ...insert_if(option.sound_file,
                     sep,
                     store_toggler_menu_item('Sound', 'sound')),
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
        ...insert_if(option.exercise_dir, menu('Exercise', [
            item('Store as exercise', '!', store_as_exercise),
            item('Exercise', '?', () => load_random_exercise(win), true),
            item('Recent exercise', 'CmdOrCtrl+?',
                 () => load_recent_exercise(win), true),
            menu('Delete exercise', [
                ...insert_if(is_exercise_file(game.sgf_file),
                             item('Delete this', 'CmdOrCtrl+!', delete_exercise)),
            ]),
            item('Open exercise', 'Alt+?', () => open_exercise_dir(win), true),
        ]), sep),
        item("Tsumego frame", 'Shift+f',
             () => add_tsumego_frame(), true, game.move_count > 0),
        item("Tsumego frame (ko)", 'CmdOrCtrl+Shift+f',
             () => add_tsumego_frame(true), true, game.move_count > 0),
        sep,
        item('Clear analysis', undefined, P.delete_cache, false, R.use_cached_suggest_p),
        item('...Restore analysis', undefined, P.undelete_cache, false, R.use_cached_suggest_p),
        sep,
        item('Tag / Untag', 'Ctrl+Space', tag_or_untag),
        has_sabaki && {label: 'Attach Sabaki', type: 'checkbox', checked: attached,
                       accelerator: 'CmdOrCtrl+T', click: toggle_sabaki},
        menu('Experimental...', [
            obsolete_toggler_menu_item('Reuse analysis', 'use_cached_suggest_p'),
            sep,
            item("Save Q&&A images", 'PrintScreen', save_q_and_a_images),
            ...(debug_menu_p ? [] :
                [sep, item('Enable debug menu', undefined,
                           () => {debug_menu_p = true})]),
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
             swap_leelaz_for_black_and_white, false, !!lz_white),
        // item('Switch to previous engine', 'Shift+T', () => AI.restore(1)),
        sep,
        ...humansl_profile_menu_items(menu, item, sep),
        item('Reset', 'CmdOrCtrl+R', restart),
    ])
    const debug_menu = menu('Debug', [
        store_toggler_menu_item('Debug log', debug_log_key, null, toggle_debug_log),
        store_toggler_menu_item('...Snip similar lines', 'engine_log_snip_similar_lines'),
        {label: 'REPL', type: 'checkbox', checked: repl_p(), click: toggle_repl},
        store_toggler_menu_item('Stone image', 'stone_image_p'),
        store_toggler_menu_item('Board image', 'board_image_p'),
        simple_toggler_menu_item('Keep bright board', 'keep_bright_board'),
        item('Copy GTP sequence', undefined,
             () => {clipboard.writeText(game.array_until(game.move_count).map(({move, is_black}) => `play ${is_black ? 'B' : 'W'} ${move}`).join('\\n')); wink()}, true, true, true),
        simple_toggler_menu_item('Show policy', 'debug_show_policy'),
        sep,
        ...['black', 'white', 'common'].map(player =>
            item(`Paste to ${player} strategy`, undefined,
                 () => paste_to_auto_play_weaken_for_bw(player),
                 true, current_match_param_p())),
        ...[
            ['Swap b/w strategies', swap_auto_play_weaken_for_bw],
            ['Clear b/w strategies', clear_auto_play_weaken_for_bw],
        ].map(([l, a]) => item(l, undefined, a, true, auto_play_weaken_for_bw_p())),
        sep,
        item('Import diagram image', 'Alt+CmdOrCtrl+Shift+i', open_demo_image),
        option.screenshot_region_command &&
            item('Set screenshot region', undefined, set_screenshot_region),
        option.screenshot_capture_command &&
            item('Capture screenshot', 'Alt+CmdOrCtrl+Shift+c', capture_screenshot),
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
            ...(debug_menu_p ? [debug_menu] : []),
            help_menu]
}

function humansl_profile_menu_items(menu, item, sep) {
    function submenu_with(humansl_profile) {
        const cur = humansl_profile()
        if (R.in_match || !stringp(cur)) {return [cur, []]}
        const prof_item = p => {
            const label = p || '(none)'
            return item(label, undefined, () => {humansl_profile(p); toast(label)})
        }
        const items_for = ps => ps.map(prof_item)
        const none = prof_item('')
        const ranks = items_for(humansl_rank_profiles)
        const preaz = menu('pre AZ', items_for(humansl_preaz_profiles))
        const proyear = menu('pro year', items_for(humansl_proyear_profiles))
        return [cur, [none, ...ranks, preaz, proyear]]
    }
    function menu_for(text, cur, submenu) {
        const label = `HumProfile${text}` + (stringp(cur) ? ` (${cur})` : '')
        return {label, submenu, enabled: !empty(submenu)}
    }
    const [b_cur, b_submenu] = submenu_with(AI.humansl_profile_for_black)
    const [w_cur, w_submenu] = submenu_with(AI.humansl_profile_for_white)
    const b_text = empty(w_submenu) ? '' : ' for black'
    const b_menu = menu_for(b_text, b_cur, b_submenu)
    const w_menu = menu_for(' for white', w_cur, w_submenu)
    return [sep, b_menu, w_menu]
}

function pair_match_menu(random_pair_match_percentage, item) {
    const rp = random_pair_match_percentage, r = truep(rp) && rp * 0.01
    const label = truep(r) ? `Random (AI ${rp}%)` : 'Alternative'
    const action = (this_item, win) => {start_match(win, 3, r); update_menu()}
    return item(label, undefined, action, true)
}

function openrecent_submenu(item, sep) {
    // files
    const item_for_file = f => item(f, undefined, () => load_sgf_etc(f))
    const file_items = store.get('recent_files', []).map(item_for_file)
    // deleted boards
    const del = deleted_sequences.slice(- option.max_recent_deleted).reverse()
    const desc = pg => is_pgame(pg) ?
          stored_from_pgame(pg).desc : game_description(pg)
    const item_for_deleted = pg =>
          item(desc(pg), undefined, () => uncut_this_sequence(pg))
    const deleted_items = del.map(item_for_deleted)
    return [...file_items, sep, ...deleted_items]
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

function simple_toggler_menu_item(label, key) {
    const click = () => {R[key] = !R[key]; update_all()}
    return {label, type: 'checkbox', checked: R[key], click}
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
function swap_leelaz_for_black_and_white() {
    AI.swap_leelaz_for_black_and_white()
    swap_auto_play_weaken_for_bw()
}

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
    const {
        empty_board, board_type, match, rules, handicap, komi,
        auto_play_weaken_for_b, auto_play_weaken_for_w,
    } = rule
    const bsize = rule.board_size
    const new_board_p = (empty_board && !game.is_empty()) ||
          (bsize && bsize !== board_size())
    new_board_p && new_empty_board(bsize)
    handicap && add_handicap_stones(handicap)
    rules && set_gorule(rules)
    truep(komi) && set_komi(komi)
    board_type && set_board_type(board_type, win)
    match && start_match(win, ...(is_a(match, 'object') ? match : [to_i(match)]))
    !match && (match !== undefined) && stop_match(window_prop(win).window_id)
    const set_weaken = (bw, val) => truep(val) && set_auto_play_weaken_for_bw(bw, val)
    set_weaken('black', auto_play_weaken_for_b)
    set_weaken('white', auto_play_weaken_for_w)
    const is_engine_updated = update_engines_by_preset(rule)
    AI.backup(); is_engine_updated && !R.in_match && resume()
}

function update_engines_by_preset(rule) {
    const {label, label_for_white, engine_for_white,
           weight_file, weight_file_for_white, wait_for_startup_for_white} = rule
    const cur = AI.engine_info().black, extended = {...cur, ...rule}
    const f = h => JSON.stringify([h.leelaz_command, h.leelaz_args])
    const need_restart = cur && (f(cur) !== f(extended))
    const preset_label_for_white = {label: label_for_white || (label || '') + '(W)'}
    const is_engine_specified_explicitly = rule.leelaz_command || weight_file
    need_restart && restart_leelaz_by_preset(extended)
    !need_restart && is_engine_specified_explicitly && label &&
        (AI.all_start_args().black.preset_label = {label})
    // backward compatibility for obsolete "weight_file" and "weight_file_for_white"
    weight_file && load_weight_file(weight_file)
    weight_file_for_white ? load_weight_file(weight_file_for_white, true) :
        (is_engine_specified_explicitly && unload_leelaz_for_white())
    engine_for_white && AI.set_engine_for_white(engine_for_white, preset_label_for_white, wait_for_startup_for_white)
    const is_updated =
          need_restart || weight_file || weight_file_for_white || engine_for_white
    return is_updated
}

function restart_leelaz_by_preset(rule, first_p) {
    const {leelaz_command, leelaz_args, label, wait_for_startup} = rule
    if (!leelaz_command || !leelaz_args) {no_engine_error(first_p); return false}
    unload_leelaz_for_white(); kill_all_leelaz()
    start_leelaz(leelaz_command, leelaz_args, label, wait_for_startup)
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
    if (auto_genmove_p()) {return 0.5}
    return Math.max(time_only_p ? -1 : auto_analysis_progress(),
                    auto_play_progress(), auto_redo_progress())
}
function stop_auto() {stop_auto_analyze(); stop_auto_play(); stop_auto_redo()}
function auto_analyzing_or_playing() {return auto_analyzing() || auto_playing() || auto_redoing()}

// auto-analyze (redo after given visits)
let on_auto_analyze_finished = pause
function try_auto_analyze(force_next) {
    const done = force_next || (auto_analysis_progress() >= 1)
    const finish = () => (stop_auto_analyze(), on_auto_analyze_finished(), update_all())
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
    const best_move_visits = P.orig_suggest()[0]?.visits, total_visits = R?.visits
    const v = game.move_count > 4 ? best_move_visits : total_visits
    return !auto_analyzing() ? -1 : true_or(v, 0) / auto_analysis_visits()
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
    // (normal cases)
    // Just set "I'm in auto play" here and let the analysis run.
    // Then try_auto_play will play a move when the condition is satisfied.
    // (special cases, e.g. genmove)
    // Call genmove etc. here and let it play a move.
    start_normal_auto_play(strategy, sec, count)
    start_auto_genmove_maybe()  // for special cases
}
function start_normal_auto_play(strategy, sec, count) {
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
let the_scheduled_auto_play_proc = null
function start_scheduled_auto_play(proc) {
    the_scheduled_auto_play_proc = proc
    start_normal_auto_play(auto_playing_strategy, auto_play_sec, auto_play_count)
}
function scheduled_auto_play_proc() {
    const f = the_scheduled_auto_play_proc
    return f && (() => {f(); the_scheduled_auto_play_proc = null})
}

let doing_auto_play_p = false
function try_auto_play(force_next) {
    if (auto_genmove_p()) {return}
    const proc = scheduled_auto_play_proc() || {
        replay: () => do_as_auto_play(redoable(), () => {redo(); play_move_sound()}),
        play: () => try_play_weak(current_auto_play_weaken()),
        random_opening: () => try_play_weak(['random_opening']),
    }[auto_playing_strategy]
    const do_proc = () => {
        doing_auto_play_p = true
        const f = () => {
            should_resign_p(game, R) ? resign() : proc()
            doing_auto_play_p = false
        }
        let_me_think_play(f)
    }
    force_next && (last_auto_play_time = - Infinity)
    auto_play_ready() && !doing_auto_play_p && do_proc()
    update_let_me_think(true)
}
function current_auto_play_weaken() {
    // In pair matches, the specified weaken method is applied only to
    // the opponent AI. The partner AI ignores it and plays normally.
    const is_partner =
          (pair_match_info() === 'pair_match') && (auto_play_count === 2)
    const partner_weaken = is_partner && default_weaken()
    return auto_play_weaken_for_current_bw() || partner_weaken || auto_play_weaken
}
function auto_play_ready() {
    return !R.is_suggest_by_genmove && !empty(P.orig_suggest()) && Date.now() - last_auto_play_time >= auto_play_sec * 1000
}
function do_as_auto_play(playable, proc, silent) {
    // to avoid color flicker of progress bar, clear it before proc()
    const u = update_auto_play_time, do_it = () => {u(); proc(); u()}
    const stop_it = () => {stop_auto_play(), pause(), update_all()}
    playable ? do_it() : stop_it()
    !silent && update_ponder_surely()
    start_auto_genmove_maybe()
}
function update_auto_play_time() {last_auto_play_time = Date.now()}
function auto_play_progress() {
    return auto_playing() ?
        (Date.now() - last_auto_play_time) / (auto_play_sec * 1000) : -1
}
function ask_auto_play_sec(win, replaying) {
    const mismatched_komi = !replaying && AI.different_komi_for_black_and_white()
    const warning = mismatched_komi ? '(Different komi for black & white?) ' : ''
    const label = 'Auto play seconds:'
    const cannel = replaying ? 'submit_auto_replay' : 'submit_auto_play'
    generic_input_dialog(win, label, default_auto_play_sec, cannel, warning)
}
function submit_auto_play_or_replay(sec, replaying) {
    const strategy = replaying ? 'replay' : default_strategy()
    default_auto_play_sec = sec; start_auto_play(strategy, sec, Infinity)
}
function submit_auto_play(sec) {submit_auto_play_or_replay(sec, false)}
function submit_auto_replay(sec) {submit_auto_play_or_replay(sec, true)}
function increment_auto_play_count(n) {
    auto_playing(true) && stop_auto_play()
    auto_play_count += (n || 1)  // It is Infinity after all if n === Infinity
}
function decrement_auto_play_count() {
    auto_play_count--
    const random_pair_match_p = (pair_match_info() === 'pair_match') &&
          truep(R.random_pair_match_rate) && (auto_play_count % 2 === 0)
    random_pair_match_p &&
        (auto_play_count = (Math.random() < R.random_pair_match_rate) ? 2 : 0)
}
function stop_auto_play() {
    scheduled_auto_play_proc()  // call this to clear the value
    doing_auto_play_p = false  // safety for recovery from irregular cases
    if (!auto_playing()) {return}
    auto_play_count = 0; let_me_think_exit_autoplay()
}
function auto_playing(forever) {
    return auto_play_count >= (forever ? Infinity : 1)
}

function default_strategy() {
    const rand_p = store.get('random_opening_p') && !auto_play_weaken_for_bw_p()
    return rand_p ? 'random_opening' : 'play'
}
function default_weaken() {
    const weaken = {best: [], random_opening: ['random_opening']}
    return weaken[default_strategy()]
}

// genmove as an exceptional auto-play
function get_auto_play_weaken() {
    // !R.in_match is necessary for paste_to_auto_play_weaken_for_bw
    const cur = !R.in_match && auto_play_weaken_for_current_bw()
    return cur || auto_play_weaken
}
function auto_genmove_p() {return auto_genmove_func() === genmove}
function auto_genmove_func() {
    const strategy_ok = ['play', 'random_opening'].includes(auto_playing_strategy)
    const maybe = auto_playing() && strategy_ok; if (!maybe) {return null}
    const [weaken_method, ...weaken_args] = get_auto_play_weaken() || ['plain']
    const search_analyze = AI.is_supported('kata-search_cancellable') && genmove_analyze
    const func_for_method = {
        genmove, genmove_analyze,
        ...rankcheck_family_table(weaken_args),
        plain: search_analyze,
        plain_diverse: search_analyze,
    }
    return func_for_method[weaken_method]
}
function start_auto_genmove_maybe() {
    const genmove_func = auto_genmove_func(); if (!genmove_func) {return}
    const play_func = (move, comment) => {
        const selected = {move, comment}
        const rand_p = (auto_playing_strategy === 'random_opening') ||
              (current_auto_play_weaken()?.[0] === 'plain_diverse')
        rand_p ?
            try_play_weak(['random_opening'],
                          {normal_move_in_random_opening: selected}) :
            play_selected_weak_move(selected, get_auto_play_weaken())
    }
    resume(); update_all()  // just for bright board effect
    genmove_func(auto_play_sec, play_func)
}
function rankcheck_family_table(weaken_args) {
    const get_state = () => [
        auto_playing_strategy, !!auto_playing(), get_auto_play_weaken(),
        game.ref_current(),
    ]
    const state = get_state()
    const same_state_p = () => get_state().every((z, k) => z === state[k])
    const rankcheck_etc = aa2hash([
        // [weaken_method, func]
        ['rankcheck', 'get_rankcheck_move'],
        ['center', 'get_center_move'],
        ['edge', 'get_edge_move'],
        ['hum_persona', 'get_hum_persona_move'],
    ].map(([key, proc]) => [key, (dummy_sec, play_func) => {
        const args = [
            get_humansl_profile_in_match(true),
            AI.peek_kata_raw_human_nn, update_ponder_surely, ...weaken_args,
        ]
        const play_it = a => same_state_p() &&
              start_scheduled_auto_play(() => play_func(...a))
        return rankcheck_move[proc](...args).then(play_it)
    }]))
    return rankcheck_etc
}

// match
let auto_play_weaken = [], pondering_in_match = false
function start_match(win, auto_moves_in_match, random_pair_match_rate) {
    const resetp = (auto_moves_in_match === 'reset_param')
    resetp && set_stored('humansl_profile_in_match', '')
    set_auto_moves_in_match(resetp ? 1 : to_i(auto_moves_in_match))
    merge(R, {random_pair_match_rate})
    renderer('set_humansl_profile_in_match_from_main', R.humansl_profile_in_match)
    renderer(resetp ? 'reset_match_param' : 'set_match_param')
    set_board_type('raw', win); R.in_match = true
}
function stop_match(window_id) {
    R.in_match = exercise_match_p = false; auto_play_weaken = []
    truep(window_id) && toggle_board_type(window_id, null, "raw")
}

function set_match_param(weaken) {
    let m
    const literal = [
        'plain', 'plain_diverse', 'genmove', 'genmove_analyze', 'best',
        'rankcheck', 'center', 'edge',
    ]
    const alias = {
        diverse: 'random_opening',
        pass: 'pass_maybe',
    }
    const simple_method = literal.includes(weaken) ? weaken : alias[weaken]
    auto_play_weaken =
        simple_method ? [simple_method] :
        (weaken === 'persona') ? ['persona', get_stored('persona_code'), get_stored('sanity'), adjust_sanity_p] :
        (weaken === 'hum_persona') ? ['hum_persona', null, get_stored('persona_code')] :
        (m = weaken.match(/^policy([0-9.]+)$/)) ? ['policy', to_f(m[1])] :
        (m = weaken.match(/^([1-9])$/)) ? ['random_candidate', to_i(m[1]) * 10] :
        (m = weaken.match(/^-([0-9.]+)pt$/)) ? ['lose_score', to_f(m[1])] :
        (m = weaken.match(/^swap([1-9])$/)) ? ['random_leelaz', to_i(m[1]) * 10] :
        []
}
function auto_play_in_match(sec, count) {
    pondering_in_match = !pausing
    start_auto_play('play', sec, count || 1)
}
let the_auto_moves_in_match = 1
function get_auto_moves_in_match() {return clip(the_auto_moves_in_match, 1)}
function set_auto_moves_in_match(k) {the_auto_moves_in_match = k}

// auto_play_weaken_for_bw (player = 'black' or 'white')
function get_auto_play_weaken_for_bw(player) {
    return auto_play_weaken_for_bw[player]
}
function set_auto_play_weaken_for_bw(player, val) {
    auto_play_weaken_for_bw[player] = val
}
function clear_auto_play_weaken_for_bw() {
    ['black', 'white'].forEach(player => set_auto_play_weaken_for_bw(player, null))
}
function auto_play_weaken_for_current_bw() {
    return get_auto_play_weaken_for_bw(is_bturn() ? 'black' : 'white')
}
function auto_play_weaken_for_bw_p() {
    // !! to avoid undefined
    return !!['black', 'white'].find(get_auto_play_weaken_for_bw)
}
function current_match_param_p() {return !empty(auto_play_weaken)}
function paste_to_auto_play_weaken_for_bw(player) {
    const mp = get_current_match_param()
    if (!mp) {toast('Nothing to paste.'); return}
    const ps = (player === 'common') ? ['black', 'white'] : [player]
    ps.forEach(p => set_auto_play_weaken_for_bw(p, mp))
}
function swap_auto_play_weaken_for_bw() {
    const ps = ['black', 'white'], vs = ps.map(get_auto_play_weaken_for_bw)
    const swapped = [[ps[0], vs[1]], [ps[1], vs[0]]]
    swapped.map(a => set_auto_play_weaken_for_bw(...a))
}

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
    const redo_p = force || (the_auto_redo_progress > 1 - epsilon)
    redo_p ? (let_me_think_play(redo), (the_auto_redo_progress = 0), update_all()) :
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

function play_best(n, weaken) {
    start_auto_play('play'); increment_auto_play_count(n)
    try_play_weak(weaken)
}
function play_pass_maybe() {play_best(null, ['pass_maybe'])}
function try_play_weak(weaken, given_state) {
    // (ex)
    // try_play_weak()
    // try_play_weak(['pass_maybe'])
    // try_play_weak(['random_candidate', 30])
    // try_play_weak(['random_leelaz', 30])
    // try_play_weak(['lose_score', 0.1])
    const [weaken_method, ...weaken_args] = weaken || []
    weaken_method === 'random_leelaz' && AI.switch_to_random_leelaz(...weaken_args)
    const suggest = P.orig_suggest(); if (empty(suggest)) {return}
    const get_my_score = dmc => {
        const mc = game.move_count + dmc, sign = is_bturn() ? 1 : -1
        return (mc >= game.init_len) &&
            (game.ref(mc).score_without_komi - game.get_komi()) * sign
    }
    const cur = game.ref_current()
    const state = {
        orig_suggest: suggest,
        is_bturn: is_bturn(),
        movenum: game.movenum(),
        last_move: cur.move,
        stones: R.stones,
        orig_winrate: winrate_after(game.move_count),
        orig_score_without_komi: cur.score_without_komi,
        default_policy: cur.default_policy,
        my_current_score: get_my_score(0),
        my_previous_score: get_my_score(-2),
        random_opening: option.random_opening,
        generate_persona_param,
        katago_p: AI.katago_p(),
        is_moves_ownership_supported: AI.is_moves_ownership_supported(),
        preset_label_text: AI.current_preset_label(),
        cont: selected => play_selected_weak_move(selected, weaken),
        ...(given_state || {}),
    }
    select_weak_move(state, weaken_method, weaken_args)
}

function play_selected_weak_move(selected, weaken) {
    const [weaken_method, ..._] = weaken || []
    const {move, comment, new_weaken_args, new_sanity} = selected
    // clean me: side effect!
    new_weaken_args && weaken.splice(0, Infinity, weaken_method, ...new_weaken_args)
    new_sanity && adjust_sanity_p && !auto_play_weaken_for_current_bw()
        && set_stored('sanity', new_sanity)
    const play_com = (m, c) => {
        R.in_match && !pondering_in_match && !auto_playing() && pause()
        play(m, 'never_redo', null, c)
        is_pass(m) && toast('Pass')
    }
    const pass_maybe_p = (weaken_method === 'pass_maybe')
    const pass_maybe =
          () => AI.peek_value(pass_command, value => {
              const threshold = 0.9, pass_p = (value < threshold)
              const com = `If I play pass, your winrate will be ${value.toFixed(2)}` +
                    ` (${pass_p ? "<" : ">="} threshold ${threshold}).` +
                    ` So I play ${pass_p ? "pass" : "normally"}.`
              play_com(pass_p ? pass_command : move, com); update_all()
          }) || toast('Not supported')
    const play_it = () => {
        decrement_auto_play_count()
        pass_maybe_p ? pass_maybe() : play_com(move, comment)
    }
    // need to avoid update_all in do_as_auto_play for pass_maybe
    // because set_board in update_all may call clear_board,
    // that cancels peek_value
    const pass = is_pass(move); pass && apply_move_effect(pass)
    do_as_auto_play(!pass, play_it, pass_maybe_p)
}
function winrate_after(move_count) {
    return move_count < 0 ? NaN :
        move_count === 0 ? P.get_initial_b_winrate() :
        true_or(game.ref(move_count).b_winrate, NaN)
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
    update_all()
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
function debug_increase_komi(k) {game.komi += k}
function ask_choice(message, values, proc) {
    const buttons = [...values.map(to_s), 'cancel']
    const action = z => {
        const v = values[z.response]; truep(v) && proc(v); update_all()
    }
    dialog.showMessageBox(null, {type: "question", message, buttons}).then(action)
}

// sound
function play_move_sound(pass_p) {
    const {sound_file} = option; if (!R.sound || !sound_file) {return}
    const c = game.ref_current()
    // ugly! (set ko_state as side effect in current_stones())
    c.ko_state || game.current_stones()
    pass_p === undefined && (pass_p = is_pass(c.move))
    const move_type = pass_p ? 'pass' :
          c.ko_state.captured ? 'capture' : 'stone'
    const path = option_expand_path(random_choice(sound_file[move_type]))
    path && renderer('play_sound', path)
}

// SGF from board image
let the_settings_for_sgf_from_image = null
function memorize_settings_for_sgf_from_image(settings) {
    the_settings_for_sgf_from_image = settings
}
function recall_settings_for_sgf_from_image(win, silent) {
    if (silent && !the_settings_for_sgf_from_image) {return}
    win.webContents.send('restore_settings', the_settings_for_sgf_from_image)
}
function archive_sgf_from_image(h) {
    const dir = option.sgf_from_image_archive_dir
    if (!dir) {return}
    const ti = (new Date()).toJSON().replace(/:/g, '') // cannot use ":" in Windows
    const path = PATH.join(dir, ti), fname = s => `${path}_${s}`
    const {images} = h; delete h.images
    fs.writeFile(fname('data.json'), JSON.stringify(h, null, ' '), do_nothing)
    each_key_value(images, (key, url) =>
        renderer('save_dataURL', url, fname(key.replace(/_url$/, '') + '.png')))
}
function open_clipboard_image() {
    // window
    const size = get_windows()[0].getSize()
    const opt = {webPreferences, width: size[0], height: size[1]}
    const file_name = 'sgf_from_image/sgf_from_image.html?sgf_size=19'
    const win = get_new_window(file_name, opt)
    // menu
    const usage = {label: 'Usage', click: open_demo_image}
    const usage2 = {label: 'Another usage', click: open_demo_image2}
    const tips = {label: 'Tips', click: () => win.webContents.send('highlight_tips')}
    const rgb_diff = enhance => ({
        label: `RGB diff x${enhance}`,
        click: () => win.webContents.send('debug_show_rgb_diff', enhance)
    })
    const recall = {
        label: 'Apply previous settings', accelerator: 'CmdOrCtrl+Y',
        click: () => recall_settings_for_sgf_from_image(win),
    }
    const debug = {label: 'Debug', submenu: [
        recall,
        ...[1, 3, 10].map(rgb_diff),
        {role: 'toggleDevTools'}
    ]}
    const menu = [
        {label: 'File', submenu: [
            {label: 'Close', accelerator: 'CmdOrCtrl+W',
             click: () => close_or_hide_sgf_from_image_window(win)},
        ]},
        {label: 'View',
         submenu: [{role: 'zoomIn'}, {role: 'zoomOut'}, {role: 'resetZoom'}]},
        {label: 'Tool', submenu: [recall]},
        {label: 'Help', submenu: [usage, usage2, tips]},
        ...(app.isPackaged ? [] : [debug]),
    ]
    // init
    win.setMenu(Menu.buildFromTemplate(menu))
    return win
}
function open_demo_image() {open_image_url('demo_auto.png')}
function open_demo_image2() {open_image_url('demo_hand.png')}
function read_sgf_from_image(win, sgf) {
    win.hide(); read_sgf(sgf) && (game.sgf_from_image_window = win)
}
function with_sgf_from_image_window(func, failed_value) {
    const win = game.sgf_from_image_window, valid = win && !win.isDestroyed()
    return valid ? func(win) : failed_value
}
function hidden_sgf_from_image_window_p() {
    // never return "undefined", that confuses menu entries
    return with_sgf_from_image_window(win => !win.isVisible(), false)
}
function reveal_sgf_from_image_window() {with_sgf_from_image_window(win => win.show())}
function keep_sgf_from_image_p(win, excepted_game) {
    const pred = gm => gm.sgf_from_image_window === win && game !== excepted_game
    return sequence.some(pred)
}
function close_or_hide_sgf_from_image_window(win) {
    const close_p = !keep_sgf_from_image_p(win)
    close_p ? win.close() : win.hide()
    return close_p
}
function expire_sgf_from_image_window() {
    const win = with_sgf_from_image_window(identity)
    win && !keep_sgf_from_image_p(win, game) && (game.sgf_from_image_window = null)
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
function open_preference() {
    const menu = [
        {label: 'File', submenu: [{role: 'close'}]},
        {label: 'View',
         submenu: [{role: 'zoomIn'}, {role: 'zoomOut'}, {role: 'resetZoom'}]},
        !app.isPackaged && {label: 'Debug', submenu: [{role: 'toggleDevTools'}]},
    ].filter(truep)
    const w = get_new_window('preference_window.html', {webPreferences})
    w.setMenu(Menu.buildFromTemplate(menu))
}
function set_persona_code(code) {set_stored('persona_code', code)}
function set_adjust_sanity_p(bool) {adjust_sanity_p = bool}
function set_sanity_from_renderer(sanity) {set_stored('sanity', sanity)}
function set_humansl_profile_in_match(profile) {
    set_stored('humansl_profile_in_match', profile)
}
function get_humansl_profile_in_match(pasted_p) {
    // Note [2024-08-26]
    // There are two possible approaches:
    // 1. Read the current humansl_profile_in_match every time.
    // 2. Record humansl_profile_in_match in advance into auto_play_weaken.
    // When "match" is set to true in the preset,
    // the humansl_profile_in_match_slider only appears after the engine loads.
    // Therefore, we usually use approach 1.
    // However, approach 2 is necessary for paste_to_auto_play_weaken_for_bw.
    const valid = R.in_match || (pasted_p && auto_play_weaken_for_current_bw())
    if (!valid) {return false}
    const features = ['main_model_humanSL', 'sub_model_humanSL']
    const [main_p, sub_p] = features.map(key => AI.is_supported(key))
    const [weaken_method, ...weaken_args] = get_auto_play_weaken()
    const valid_weaken_sub = [
        'plain', 'plain_diverse', 'genmove', 'genmove_analyze',
        'rankcheck', 'center', 'edge', 'hum_persona',
    ]
    const sub_ok = !weaken_method || valid_weaken_sub.includes(weaken_method)
    const ok = main_p || (sub_p && sub_ok); if (!ok) {return false}
    const recorded_prof = weaken_args[0]  // fragile assumption! (see below)
    return true_or(recorded_prof, get_stored('humansl_profile_in_match'))
}
function get_current_match_param() {
    const weaken = auto_play_weaken.slice()
    const profile = get_humansl_profile_in_match()
    truep(profile) && (weaken[1] = profile)  // fragile assumption! (see above)
    return weaken
}

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
    const {handicaps} = game
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
function swap_stone_colors() {
    // use SGF to clear recorded analysis
    read_sgf(game.swap_stone_colors().to_sgf(), null, true)
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
    const last_move_p = move === game.ref_current().move && game.movenum() > 0
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

// screen capture

let the_screenshot_region = null
function set_screenshot_region() {
    exec_command(option.screenshot_region_command, s => {
        the_screenshot_region = s
        capture_screenshot()
    })
}
function capture_screenshot() {
    if (!the_screenshot_region) {toast("No region is specified."); return}
    const com = option.screenshot_capture_command
    const cont = () => {
        const win = open_clipboard_image()
        win.once('ready-to-show',
                 () => recall_settings_for_sgf_from_image(win, true))
    }
    exec_command(com.replace(/%s/, the_screenshot_region))
    // cont does not work as callback in exec_command. why?
    setTimeout(cont, 500)
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
    !!is_black0 === !!bturn && do_play(pass_command, !bturn)
    game.init_len = game.move_count
    synchronize_analysis_region(analysis_region)
}

/////////////////////////////////////////////////
// utils for actions

let long_busy = false
const [set_long_busy_later, cancel_long_busy] =
      deferred_procs([() => {long_busy = true}, 1000], [() => {long_busy = false}, 0])
function is_long_busy() {return long_busy}
function unset_long_busy() {long_busy = false; cancel_long_busy()}

function undoable() {return game.movenum() > 0}
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
function update_ponder_surely() {
    // force updating via double toggle
    toggle_pause(); update_ponder(); toggle_pause(); update_ponder(); update_all()
}
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
    const {handicaps, init_len} = game
    const ownership_p = R.show_endstate ||
          weak_move_prop('force_ownership_p', auto_play_weaken)
    const stored_keys = ['humansl_stronger_profile', 'humansl_weaker_profile']
    const stored = aa2hash(stored_keys.map(key => [key, get_stored(key)]))
    const aux = {
        bturn: is_bturn(), komi: game.get_komi(), gorule: get_gorule(),
        handicaps, init_len,
        ownership_p,
        analysis_after_raw_nn_p: !auto_analyzing(),
        tmp_humansl_profile: get_humansl_profile_in_match(true),
        avoid_resign_p: exercise_match_p,
        ...stored,
    }
    AI.set_board(hist, aux)
    AI.switch_leelaz(); update_let_me_think(true)
}
function set_AI_board_size_maybe(bsize) {
    bsize !== board_size() && AI.restart(leelaz_start_args_for_board_size(bsize))
}

function synchronize_analysis_region(region) {
    update_analysis_region(region)
    renderer('update_analysis_region', region)
}
function update_analysis_region(region) {
    AI.update_analysis_region(game.analysis_region = region)
}

function update_engine_log_conf() {
    engine_log_conf.line_length = option.engine_log_line_length
    engine_log_conf.snip_similar_lines = get_stored('engine_log_snip_similar_lines')
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

function let_me_think_play(proc) {
    // explicitly reset board type in advance to avoid flicker
    let_me_think_p(true) && let_me_think_set_board_type_for('first_half')
    proc()
}

function let_me_think_next(board_type) {
    const stay = (board_type === let_me_think_board_type.first_half)
    let_me_think_set_board_type_for(stay ? 'latter_half' : 'first_half')
    stay || (redoable() ? redo() : play_best())
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
    expire_sgf_from_image_window()
    game.is_empty() || push_deleted_sequence(game); delete_sequence()
    update_menu()
}
function uncut_sequence() {uncut_this_sequence()}
function uncut_this_sequence(pgame) {
    const insert_before = (cut_first_p && sequence_cursor === 0)
    exist_deleted_sequence() &&
        backup_and_replace_game(pop_deleted_sequence(pgame), insert_before)
    update_menu()
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
    // fixme: redundant update_all() for overlay canvases
    update_all(); nextp ? next_sequence_effect() : previous_sequence_effect()
    autosave_later()
}
function delete_sequence_internal() {sequence.splice(sequence_cursor, 1)}

function insert_sequence(new_game, before) {
    if (!new_game) {return}
    const n = sequence_cursor + (before ? 0 : 1)
    sequence.splice(n, 0, new_game); switch_to_nth_sequence(n)
    // fixme: redundant update_all() for overlay canvases
    update_all(); next_sequence_effect()
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
    synchronize_analysis_region(game.analysis_region)
}
function next_sequence_effect() {renderer('slide_in', 'next')}
function previous_sequence_effect() {renderer('slide_in', 'previous')}

function sequence_prop_of(given_game) {
    const pick_tag = h => {
        const h_copy = P.append_implicit_tags_maybe(h); return h_copy.tag || ''
    }
    const tags = exclude_implicit_tags(given_game.map(pick_tag).join(''))
    const keys = [
        'player_black', 'player_white', 'handicaps',
        'init_len', 'move_count', 'trial',
    ]
    return {...pick_keys(given_game, ...keys), len: given_game.len(), tags}
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
function pop_deleted_sequence(pgame) {
    const remove = (x, ary) => {const k = ary.indexOf(x); k >= 0 && ary.splice(k, 1)}
    pgame ? remove(pgame, deleted_sequences) : (pgame = deleted_sequences.pop())
    return game_from_pgame(pgame, R.use_cached_suggest_p)
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
    const shorter = (stored.sgfgz.length < too_large) ? stored :
          stored_from_game(game_from_stored(stored, true, true))
    return make_pgame(stored, shorter)
}

// internal
function game_from_stored(stored, cache_suggestions_p, internal_p) {
    const f = internal_p ? create_games_from_sgf_internal : create_games_from_sgf
    return f(uncompress(stored.sgfgz), cache_suggestions_p)[0]
}
function stored_from_game(game, cache_suggestions_p) {
    return {
        sgfgz: compress(game.to_sgf(cache_suggestions_p, true)),
        desc: game_description(game, true)
    }
}
function game_description(game, stored_p) {
    const g = game, {len, tags} = sequence_prop_of(game), missing = '???'
    const stored = stored_p && '-'
    const trial = g.trial && ' '
    const players = `${g.player_black || missing}/${g.player_white || missing}`
    const length = stored_p ? `(${len})` : `(${g.move_count}/${len})`
    const size = g.board_size !== 19 && `[${g.board_size}x${g.board_size}]`
    const prop = !stored_p && tags
    return [stored, trial, players, length, size, prop].filter(truep).join(' ')
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
    stored_session.set('sequences_gz_b64_v2', stored)
    debug_log('store_session done')
}
function restore_session() {verbose_safely(restore_session_unsafe)}
function restore_session_unsafe() {
    debug_log('restore_session start')
    upgrade_stored_session_for_compatibility()
    deleted_sequences.push(...stored_session.get('sequences_gz_b64_v2', []).map((stored, k, all) => {
        toast(`restoring autosaved games (${k + 1}/${all.length})...`)
        return pgame_from_stored(stored)
    }))
    debug_log('restore_session done')
}
function upgrade_stored_session_for_compatibility() {
    const old_key = 'sequences_gz_b64', new_key = 'sequences_gz_b64_v2'
    const old_val = stored_session.get(old_key, null); if (!old_val) {return}
    const convert = sgfgz => ({sgfgz, desc: '(no info)'})
    const new_val = [...stored_session.get(new_key, []), ...old_val.map(convert)]
    stored_session.set(new_key, new_val); stored_session.delete(old_key)
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
    const mc = showing_until_p ? su : game.move_count
    const cur = game.ref(mc)
    const prev_su = showing_until_p && game.ref(su - 1)
    const subboard_stones_suggest = prev_su && prev_su.suggest && {
        ...subboard_stones_suggest_for(su, prev_su), gain: cur.gain,
    }
    const in_pair_match = pair_match_info()
    const persona_code = get_stored('persona_code')
    const more = cur.suggest ? {background_visits: null, ...cur} :
          keep_suggest_p ? {} : {suggest: []}
    const {face_image_rule, pv_trail_max_suggestions, endstate_blur} = option
    update_exercise_metadata()
    P.set_and_render(!keep_suggest_p, {
        history_length, sequence_cursor, sequence_length, attached,
        player_black, player_white, trial, sequence_ids, sequence_props, history_tags,
        image_paths, face_image_rule, exercise_metadata,
        subboard_stones_suggest,
        in_pair_match,
        persona_code,
        pv_trail_max_suggestions,
        endstate_blur,
    }, more)
}
function subboard_stones_suggest_for(su, prev_su) {
    const bturn = !prev_su.is_black, suggest = (prev_su.suggest || [{}])[0]
    const stones = game.stones_at(su - 1)
    P.add_next_mark_to_stones(stones, game, su - 1)
    return {stones, suggest, bturn}
}
function pair_match_info() {
    const amm = get_auto_moves_in_match()
    return R.in_match && (amm !== 1) && (amm === 3 ? 'pair_match' : amm)
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
    const weaken_bw = ['black', 'white'].map(k => {
        const v = get_auto_play_weaken_for_bw(k)
        return v && `weak_${k}=${JSON.stringify(v)}`
    }).filter(truep).join(' ')
    const title0 = `LizGoban ${names} ${tag_text} ${R.weight_info || ''} ${weaken_bw}`
    const title = hack_title(title0)
    title_change_detector.is_changed(title) &&
        get_windows().forEach(win => win.setTitle(title))
}
let hack_title_count = 0, hack_title_timer = null
function hack_title(title) {
    const start_hacking = () => {
        const inc = () => {hack_title_count++; update_title()}
        hack_title_count = 0; hack_title_timer = setInterval(inc, 1000)
    }
    const stop_hacking = () => {
        clearTimeout(hack_title_timer); hack_title_timer = null
    }
    const hacked_title = () => hack_title_count > 0 ?
          `${title} (${hack_title_count})` : title
    return title.includes(P.weight_info_waiting_text) ?
        (!hack_title_timer && start_hacking(), hacked_title()) :
        (hack_title_timer && stop_hacking(), title)
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
        bturn: is_bturn(),
        wturn: !is_bturn(),
        auto_analyze: !game.is_empty(),
        start_auto_analyze: !auto_p,
        stop_auto: auto_p,
        trial: game.trial,
        moves_ownership: AI.is_moves_ownership_supported(),
        sub_model_humanSL: AI.is_sub_model_humanSL_supported(),
        match_ai_conf: weak_move_prop('has_option_p', auto_play_weaken),
        match_sanity: weak_move_prop('sanity_p', auto_play_weaken),
        humansl_profile_in_match: get_humansl_profile_in_match(),
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
    // *.bin for TamaGo [2023-12-22]
    const filter = {name: 'Weight Files (.gz, .bin)', extensions: ['gz', 'bin']}
    return select_files('Select weight file for engine', dir, filter)[0]
}
function select_files(title, dir, filter) {
    return dialog.showOpenDialogSync(null, {
        properties: ['openFile'], title: title,
        defaultPath: dir,
        filters: [filter, {name: 'All Files', extensions: ['*']}],
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
    const buttons = ["RESTORE", "retry", "load weights", "default preset", "(ignore)"]
    const actions = [AI.restore, restart, load_weight, apply_first_preset, do_nothing]
    const do_action =
          z => {actions[z.response](); asking_recovery = false; update_all()}
    const recover = () => {
        asking_recovery = true  // avoid duplicated dialogs
        dialog.showMessageBox(null, {type: "error", message, buttons,}).then(do_action)
    };
    (Date.now() - last_restart_time >= option.minimum_auto_restart_millisec) ?
        (restart(), last_restart_time = Date.now()) : (asking_recovery || recover())
}

function apply_first_preset() {
    apply_preset(option.preset[0], get_windows()[0])
}

// util
function leelaz_start_args(leelaz_command, given_leelaz_args, label, wait_for_startup) {
    const {working_dir} = option
    const leelaz_args = given_leelaz_args.slice()
    const preset_label = {label: label || ''}
    const h = {leelaz_command, leelaz_args, preset_label, wait_for_startup, working_dir, illegal_handler,
               // weight_file is set for consistency with set_engine_for_white()
               // so that cached engines are reused correctly
               // (cf. start_args_equal())
               tuning_handler: make_tuning_handler(), weight_file: null,
               engine_log_snip_similar_lines: get_stored('engine_log_snip_similar_lines'),
               restart_handler: auto_restart, ready_handler: on_ready}
    const opts = ['analyze_interval_centisec',
                  'minimum_suggested_moves']
    opts.forEach(key => h[key] = option[key])
    return {...h, ...leelaz_start_args_for_board_size(board_size())}
}
function leelaz_start_args_for_board_size(default_board_size) {
    return {default_board_size}
}
let tuning_message, tuning_start_time
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
        n === 0 && (pause(), toast(warning, toast_sec * 1000), (tuning_start_time = Date.now()))
        tuning_message = `Tuning KataGo (step ${++n}) [${m[1].slice(0, 20)}]`
        update_all()
    }
}
function tuning_is_done() {
    const seconds = to_i((Date.now() - tuning_start_time) / 1000)
    const message = `Finished initial tuning. (${seconds} sec)`
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
    // clipboard.read is experimental in Electron v28 [2024-02-02]
    const mac_url = clipboard.read('public.file-url')  // for Cmd-C on Finder (Mac)
    if (mac_url) {open_url(mac_url); return}
    if (!clipboard.readImage().isEmpty()) {open_clipboard_image(); return}
    const s = clipboard.readText(); s.match('^(file|https?)://') ? open_url(s) : read_sgf(s)
}

function open_sgf_etc() {open_sgf_etc_in(option_path('sgf_dir'))}
function open_sgf_etc_in(dir, proc) {
    const extensions = ['sgf', 'gib', 'ngf', 'ugf', 'ugi']
    const filter = {name: 'Game Records', extensions}
    select_files('Select SGF etc.', dir, filter).forEach(proc || load_sgf_etc)
}
function load_sgf_etc(filename) {
    const content = read_file_with_iconv(filename)
    const res = sgf_str => {read_sgf(sgf_str, filename); update_all()}
    const rej = () => res(content)
    XYZ2SGF.xyz2sgf(content, XYZ2SGF.getExtension(filename)).then(res, rej)
    const recent = new Set([filename, ...store.get('recent_files', [])])
    store.set('recent_files', [...recent].slice(0, option.max_recent_files))
}
function load_sgf_internally(filename) {
    read_sgf(read_file_with_iconv(filename), filename, true)
}
function read_file_with_iconv(filename, given_encoding) {
    return read_buffer_with_iconv(fs.readFileSync(filename), given_encoding)
}
function read_buffer_with_iconv(buffer, given_encoding) {
    const encoding = given_encoding || fixed_encoding(jschardet.detect(buffer))
    return iconv.decode(buffer, encoding)
}
function fixed_encoding(detected_by_jschardet) {
    // not sure whether these fixes are necessary
    const {encoding, confidence} = detected_by_jschardet
    // cf. Sabaki (ugf.js)
    if (confidence <= 0.2) {return 'utf8'}
    // cf. KaTrain (sgf_parser.py)
    const fix = {
        'windows-1252': 'gbk',
        gb2312: 'gbk',
    }
    return fix[encoding.toLowerCase()] || encoding
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
        dialog.showErrorBox("Failed to read SGF", snip(sgf_str, 200)); return false
    }
    const trunk = new_games[0]
    const common_props = {sgf_file: filename || "", brothers: new_games}
    const auto_p = store.get('auto_overview')
    new_games.forEach(g => merge(g, common_props, {trial: g !== trunk}))
    trunk.merge_common_header(game); backup_and_replace_game(trunk)
    if (internally) {return true}
    auto_p ? (!AI.leelaz_for_white_p() && start_quick_overview()) : undo_to_start()
    return true
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
        // cf. https://github.com/ashtuchkin/iconv-lite/wiki/Use-Buffers-when-decoding
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
            const buf = Buffer.concat(chunks), str = read_buffer_with_iconv(buf)
            read_sgf(str); update_all()
        })
    }
    switch (u.protocol) {
    case 'https:': https.get(url, on_get); break;
    case 'http:': http.get(url, on_get); break;
    case 'file:': load_sgf_etc(decodeURIComponent(u.pathname)); break;
    default: toast(`Unsupported protocol: ${url}`); break;
    }
}
function open_image_url(url) {clipboard.writeText(url); open_clipboard_image()}

// personal exercise book

function store_as_exercise() {
    const path = PATH.join(exercise_dir(), exercise_filename(game))
    save_sgf_to(path, null, true, true)
    const counts = exercise_files().length
    toast(`stored as exercise (${counts})`)
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
    const files = exercise_files(true)
    const retry = () => {seen_exercises = []; load_exercise(selector, win, random_flip_p)}
    if (empty(files)) {empty(seen_exercises) ? wink() : retry(); return}
    const fn = selector(files, metadata); seen_exercises.push(fn)
    load_as_exercise(expand_exercise_filename(fn), win)
    random_flip_p && game.random_flip_rotate()
    game.set_last_loaded_element(); tag_or_untag()
    update_exercise_metadata({seen_at: (new Date()).toJSON()})
}
function load_as_exercise(file, win) {
    start_match(win, 'reset_param')
    exercise_match_p = true
    load_sgf_internally(file); goto_move_count(exercise_move_count(file)); game.trial = true
}
function open_exercise_dir(win) {open_sgf_etc_in(exercise_dir(), file => load_as_exercise(file, win))}
function delete_exercise() {
    const dir = exercise_dir(), file = game.sgf_file, name = PATH.basename(file)
    if (!is_exercise_file(file)) {wink(); return}
    const new_file = PATH.join(dir, `_${name}`)
    const done = () => {
        game.sgf_file = new_file; toast('deleted from exercise')
    }
    fs.rename(file, new_file, done)
}
function exercise_files(unseen_only) {
    const valid = name =>
          is_exercise_filename(name) &&
          !(unseen_only && seen_exercises.indexOf(name) >= 0) &&
          exercise_board_size(name) === board_size()
    const files = fs.readdirSync(exercise_dir()) || []
    return files.filter(valid)
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
        electron, P, AI,
        // official
        mimic, app,
    }
    repl = require('repl').start('LizGoban> ')
    repl.on('exit', () => {repl = null; console.log('REPL is closed.'); update_all()})
    merge(repl.context, repl_context)
}
function repl_update_game() {repl_p() && merge(repl.context, {game})}
