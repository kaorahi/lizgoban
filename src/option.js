'use strict'

const PATH = require('path'), fs = require('fs'), {app} = require('electron')

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
    autosave_cached_suggestions: 3,
    autosave_sec: 300,
    wait_for_startup: true,
    use_bogoterritory: true,
    working_dir: process.env.PORTABLE_EXECUTABLE_DIR || default_path_for('.'),
    weight_dir: undefined,
    sgf_dir: undefined,
    exercise_dir: 'exercise',
    max_cached_engines: 3,
    max_recent_files: 10,
    max_recent_deleted: 20,
    face_image_rule: null,
    preset: [{label: "leelaz", engine: ["leelaz", "-g", "-w", "network.gz"]}],
    record_note_to_SGF: false,
    repl: false,
    pv_trail_max_suggestions: 0,
    amb_gain_recent: 25,  // 1 = instantaneous
    endstate_blur: 0.5,
    random_opening: {
        prior_until_movenum: 6,
        random_until_movenum: 40,
        max_order: 10,
        relative_visits: 0.02,
        winrate_loss: 1.0,
        score_loss: 1.0,
    },
    humansl_scan_profiles: ['rank_9d', 'rank_3d', 'rank_1k', 'rank_6k', 'rank_15k'],
    // humansl_scan_profiles: humansl_rank_profiles,
    screenshot_region_command: null,  // "slop"
    screenshot_capture_command: null,  // "maim -f png -g %s | xclip -t image/png -se c"
    sgf_from_image_archive_dir: null,
    sound_file: {
        stone: [
            "../sound/put02.mp3",
            "../sound/put03.mp3",
            "../sound/put04.mp3",
            "../sound/put05.mp3",
        ],
        capture: [
            "../sound/capture18.mp3",
            "../sound/capture20.mp3",
            "../sound/capture58.mp3",
        ],
        pass: ["../sound/jara62.mp3"],
    },
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
        ...default_config_paths.filter(truep).flatMap(prepended_args),
        ...process.argv,
    ]
    argv.forEach((x, i, a) => parse_option(x, a[i + 1]))
}
function parse_option(cur, succ) {
    const read_file = path => safely(fs.readFileSync, path) || '{}'
    const merge_json = str => verbose_safely(merge_json_unsafe, str)
    const merge_json_unsafe = str => merge_with_preset(JSON.parse(str))
    const merge_with_preset = orig => {
        // accept obsolete key "shortcut" for backward compatibility
        orig.shortcut && (orig.preset = [...(orig.preset || []), ...orig.shortcut])
        merge(option, orig); expand_preset(option.preset)
        update_white_preset(option.preset)
    }
    const update_white_preset = preset => {
        const new_white_preset = (preset || []).map(h => {
            const {label, leelaz_command, leelaz_args, engine_for_white} = h
            const wfs_for_white = 'wait_for_startup' in h ?
                  {wait_for_startup_for_white: h.wait_for_startup} : {}
            return (leelaz_command && leelaz_args && !engine_for_white) &&
                {label, label_for_white: label, ...wfs_for_white,
                 engine_for_white: [leelaz_command, ...leelaz_args]}
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

function option_expand_path(name) {
    const path1 = default_path_for(name)
    const path2 = PATH.resolve(option.working_dir, name)
    return [path1, path2].find(p => fs.existsSync(p))
}

function expand_preset(preset) {
    preset.forEach(rule => {
        // merge rule.option for backward compatibility to 1a88dd40
        merge(rule, rule.option || {})
        const {engine} = rule; if (!engine) {return}
        const [command, ...leelaz_args] = engine
        const leelaz_command = resolve_engine_path(command)
        const {wait_for_startup} = option
        merge(rule, {wait_for_startup, ...rule, leelaz_command, leelaz_args})
    })
}

function resolve_engine_path(given_leelaz_command) {
    return PATH.resolve(option.working_dir, given_leelaz_command)
}

// images
function cook_face_image_rule(endstate_rule, endstate_diff_rule) {
    if (!endstate_rule && !endstate_diff_rule) {return null}
    const h1 = endstate_rule ? {endstate_rule} : {}
    const h2 = endstate_diff_rule ? {endstate_diff_rule} : {}
    return {...h1, ...h2}
}
option.face_image_rule =  // clean me: ugly overwriting
    cook_face_image_rule(option.face_image_rule, option.face_image_diff_rule)
const face_image_paths = Object.values(option.face_image_rule || {}).flat()
      .flatMap(([ , b, w]) => [b && [b, b], w && [w, w]]).filter(truep)
const image_paths = [
    ['black_stone', 'black.png', true],
    ['white_stone', 'white.png', true],
    ['board', 'board.png', true],
    ...face_image_paths,
].map(([key, name, working_dir_p]) => [key, working_dir_p ? PATH.resolve(option.working_dir, name) : default_path_for(name)]).filter(([key, path]) => fs.existsSync(path))

// renderer state
const stored_keys_spec = [
    // [key, default value, preference label, preferene shortcut],
    ['always_show_coordinates', false, 'Coordinates', 'c'],
    ['expand_winrate_bar', false, 'Expanded winrate bar', 'B'],
    ['score_bar', true, 'Score bar (KataGo only)', 'C'],
    ['show_endstate', true, 'Ownerships (KataGo only)', 'E'],
    ['lizzie_style', true, 'Lizzie style', 'l'],
    ['let_me_think', false, 'Let me think first', 'M'],
    ['auto_overview', true, 'Auto overview', 'v'],
    ['random_opening_p', false, 'Random opening', 'r'],
    ['sound', true, 'Sound', 's'],
    ['gorule', default_gorule],
    ['stone_image_p', true],
    ['board_image_p', true],
    ['stone_style', '3D'],
    ['use_cached_suggest_p', true],
    ['komi_for_new_game', leelaz_komi],
    ['komi_for_new_handicap_game', handicap_komi],
    ['sanity', initial_sanity],
    ['persona_code', 'abc'],
    ['humansl_stronger_profile', 'rank_1d'],
    ['humansl_weaker_profile', 'rank_5k'],
    ['humansl_color_enhance', 0.5],
    ['humansl_profile_in_match', ''],
    ['mcts_max_displayed_nodes', 200],
]
const preference_spec =
      stored_keys_spec.map(([k, , label, shortcut]) => label && [k, label, shortcut]).filter(truep)
const default_for_stored_key = aa2hash(stored_keys_spec.map(([k, v, ]) => [k, v]))
const stored_keys_for_renderer = Object.keys(default_for_stored_key)
function keep_backward_compatibility_of_stone_style(get_stored, set_stored) {
    const rename = [['paint', '2D'], ['flat', '2.5D'], ['dome', '3D'], ['face', 'Face']]
    const key = 'stone_style', new_name = aa2hash(rename)[get_stored(key)]
    new_name && set_stored(key, new_name)
}

//////////////////////////////////////
// exports

module.exports = {
    option,
    option_path,
    option_expand_path,
    image_paths,
    white_preset,
    preference_spec,
    default_for_stored_key,
    stored_keys_for_renderer,
    keep_backward_compatibility_of_stone_style,
}
