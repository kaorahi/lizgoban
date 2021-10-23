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
    endstate_leelaz: null,
    working_dir: process.env.PORTABLE_EXECUTABLE_DIR || default_path_for('.'),
    weight_dir: undefined,
    sgf_dir: undefined,
    exercise_dir: 'exercise',
    max_cached_engines: 3,
    face_image_rule: null,
    preset: [{label: "leelaz", engine: ["leelaz", "-g", "-w", "network.gz"]}],
    record_note_to_SGF: false,
    repl: false,
    pv_trail_max_suggestions: 0,
    random_opening: {
        prior_until_movenum: 6,
        random_until_movenum: 40,
        max_order: 10,
        relative_visits: 0.02,
        winrate_loss: 1.0,
        score_loss: 1.0,
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
                {label, label_for_white: label,
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

function expand_preset(preset) {
    const expand_ary = ([a, b]) => a === 'built-in' ? default_path_for(b) : b
    const expand = z => stringp(z) ? z : expand_ary(z)
    preset.forEach(rule => {
        // merge rule.option for backward compatibility to 1a88dd40
        merge(rule, rule.option || {})
        const {engine} = rule; if (!engine) {return}
        const [command, ...leelaz_args] = engine.map(expand)
        const leelaz_command = resolve_engine_path(command)
        merge(rule, {leelaz_command, leelaz_args})
    })
}

function resolve_engine_path(given_leelaz_command) {
    return PATH.resolve(option.working_dir, given_leelaz_command)
}

// images
const face_image_paths =
      (option.face_image_rule || []).flatMap(([ , b, w]) => [[b, b], [w, w]])
const image_paths = [
    ['black_stone', 'black.png', true],
    ['white_stone', 'white.png', true],
    ['board', 'board.png', true],
    ...face_image_paths,
].map(([key, name, working_dir_p]) => [key, working_dir_p ? PATH.resolve(option.working_dir, name) : default_path_for(name)]).filter(([key, path]) => fs.existsSync(path))

// renderer state
const default_for_stored_key = {
    lizzie_style: true, expand_winrate_bar: false, score_bar: true,
    always_show_coordinates: false,
    let_me_think: false, show_endstate: true, gorule: default_gorule,
    stone_image_p: true, board_image_p: true, stone_style: '3D',
    use_cached_suggest_p: true,
    random_opening_p: false,
    auto_overview: true,
    komi_for_new_game: leelaz_komi, komi_for_new_handicap_game: handicap_komi,
}
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
    image_paths,
    white_preset,
    default_for_stored_key,
    stored_keys_for_renderer,
    keep_backward_compatibility_of_stone_style,
}
