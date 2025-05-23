// ai.js: abstraction of engines

const PATH = require('path')
const original_create_leelaz = require('./engine.js').create_leelaz

// See "engine cache" section for leelaz objects in this file.
function create_leelaz() {return create_leelaz_proxy()}

/////////////////////////////////////////////////
// initialize

// leelaz
let leelaz = create_leelaz(), leelaz_for_black = leelaz
let leelaz_for_white = null

// from powered_goban.js
let suggest_handler
function set_handlers(h) {({suggest_handler} = h)}

/////////////////////////////////////////////////
// leelaz

function start_leelaz(start_args) {
    leelaz.start(with_handlers(start_args))
}
function update_leelaz() {leelaz.update()}
function restart(h, new_weight_p) {
    if (!h && !new_weight_p) {leelaz.force_restart(); return}
    const cooked = h && with_handlers(h)
    const error_handler =
          (leelaz === leelaz_for_white) ? invalid_weight_for_white : do_nothing
    leelaz.restart(new_weight_p ? {...cooked, error_handler} : cooked)
}
function set_board(hist, aux) {
    // see set_board in engine.js for "aux".
    const set_it = z => z.set_board(hist, aux)
    each_leelaz(set_it)
}
function genmove(sec, callback) {leelaz.genmove(sec, callback)}
function genmove_analyze(sec, callback) {leelaz.genmove_analyze(sec, callback)}
function cancel_past_requests() {each_leelaz(z => z.clear_leelaz_board())}
function kill_all_leelaz() {each_leelaz(z => z.kill())}
function set_pondering(pausing, busy) {
    const pondering = !pausing && !busy
    const b = (leelaz === leelaz_for_black)
    leelaz_for_black.set_pondering(pondering && b)
    leelaz_for_white && leelaz_for_white.set_pondering(pondering && !b)
}
function all_start_args() {
    const f = lz => lz && lz.start_args()
    return {black: f(leelaz_for_black), white: f(leelaz_for_white)}
}
function restore_all_start_args({black, white}) {
    unload_leelaz_for_white(); leelaz.kill()  // white must be first
    leelaz.start(black); white && start_engine_for_white(white)
}
function leelaz_weight_file(white_p) {
    const lz = (white_p && leelaz_for_white) || leelaz_for_black
    return lz && lz.get_weight_file()
}

function each_leelaz(f) {
    [leelaz_for_black, leelaz_for_white,
    ].forEach(z => z && f(z))
}
function with_handlers(h) {
    const more = h.ready_handler ?
          {ready_handler: (...a) => {backup(); h.ready_handler(...a)}} : {}
    return {suggest_handler, command_failure_handler, ...h, ...more}
}

function katago_p() {return leelaz_for_this_turn().is_katago()}
function is_gorule_supported() {
    return leelaz_for_this_turn().is_supported('kata-set-rules')
}
function is_moves_ownership_supported() {
    return leelaz_for_this_turn().is_supported('movesOwnership')
}
function is_sub_model_humanSL_supported() {
    return leelaz_for_this_turn().is_supported('sub_model_humanSL')
}

let analysis_region = null
function update_analysis_region(region) {
    analysis_region = region; each_leelaz(apply_current_analysis_region)
}
function apply_current_analysis_region(lz) {lz.update_analysis_region(analysis_region)}

function set_instant_analysis(instant_p) {each_leelaz(lz => lz.set_instant_analysis(instant_p))}

/////////////////////////////////////////////////
// another leelaz for white

function leelaz_for_white_p() {return !!leelaz_for_white}
function swap_leelaz_for_black_and_white() {
    if (!leelaz_for_white) {return}
    [leelaz_for_black, leelaz_for_white] = [leelaz_for_white, leelaz_for_black]
    backup(); switch_leelaz()
}
function switch_to_random_leelaz(percent) {
    switch_leelaz(xor(is_bturn(), Math.random() < percent / 100))
}
function set_engine_for_white(command_args, preset_label, wait_for_startup) {
    const [leelaz_command, ...leelaz_args] = command_args
    const start_args = {...leelaz_for_black.start_args(), weight_file: null,
                        leelaz_command, leelaz_args, preset_label, wait_for_startup}
    start_engine_for_white(start_args)
}
function start_engine_for_white(start_args) {
    unload_leelaz_for_white()
    leelaz_for_white = create_leelaz()
    leelaz_for_white.start(start_args)
    switch_leelaz()
}
function unload_leelaz_for_white() {
    switch_to_another_leelaz(leelaz_for_black)
    leelaz_for_white && leelaz_for_white.kill(); leelaz_for_white = null
}
function switch_leelaz(bturn) {
    return switch_to_another_leelaz(leelaz_for_this_turn(bturn))
}
// We need to use "leelaz_for_this_turn()" instead of "leelaz"
// between P.set_board() and AI.switch_leelaz() in set_board() in main.js.
function leelaz_for_this_turn(bturn) {
    return (bturn === undefined ? is_bturn() : bturn) ?
        leelaz_for_black : (leelaz_for_white || leelaz)
}
function load_weight_file(weight_file, white_p) {
    set_pondering(false)
    const lz = white_p ? (leelaz_for_white || (leelaz_for_white = create_leelaz()))
          : leelaz_for_black
    const sa = lz.start_args() || leelaz_for_black.start_args()
    const {label} = sa.preset_label, preset_label = {label, modified_p: true}
    lz.restart({...sa, preset_label, weight_file})
    switch_leelaz()
}

// internal

function switch_to_another_leelaz(next_leelaz) {
    return next_leelaz && next_leelaz !== leelaz && (leelaz = next_leelaz)
}

/////////////////////////////////////////////////
// misc.

function engine_info() {
    // fixme: duplication with all_start_args()
    const f = lz => {
        if (!lz || !lz.start_args()) {return null}
        const {leelaz_command, leelaz_args, preset_label} = lz.start_args()
        const weight_file = lz.get_weight_file()
        const {label, modified_p} = preset_label || {}
        const preset_label_text = `${label || ''}` +
              (modified_p ?
               `{${snip_text(PATH.basename(weight_file || ''), 20, 5, '..')}}` : '')
        return {leelaz_command, leelaz_args, is_ready: lz.is_ready(), preset_label_text,
                humansl_profile: lz.humansl_profile(),
                weight_file, network_size: lz.network_size()}
    }
    const cur_lz = leelaz_for_this_turn(), cur_lz_komi = cur_lz.get_komi()
    return {engine_komi: valid_numberp(cur_lz_komi) ? cur_lz_komi : '?',
            leelaz_for_white_p: leelaz_for_white_p(), current: f(cur_lz),
            really_current: f(leelaz),  // for switch_to_random_leelaz
            black: f(leelaz_for_black), white: f(leelaz_for_white)}
}

function current_preset_label() {
    const info = engine_info().really_current, {humansl_profile} = info
    return info.preset_label_text + (humansl_profile ? `[${humansl_profile}]` : '')
}

function startup_log() {return leelaz_for_this_turn().startup_log()}

function different_komi_for_black_and_white() {
    return leelaz_for_white &&
        (leelaz_for_black.get_komi() !== leelaz_for_white.get_komi())
}

function humansl_profile_gen(lz, profile) {
    return !!lz &&
        (profile === undefined ?
         !!lz.is_supported('humanSLProfile') && lz.humansl_profile() :
         lz.humansl_request_profile(profile, humansl_profile_request_callback))
}
function humansl_profile(profile) {
    return humansl_profile_gen(leelaz, profile)
}
function humansl_profile_for_black(profile) {
    return humansl_profile_gen(leelaz_for_black, profile)
}
function humansl_profile_for_white(profile) {
    return humansl_profile_gen(leelaz_for_white, profile)
}

/////////////////////////////////////////////////
// engine cache

// note:
// When we use Leela Zero and KataGo alternately,
// leelaz.kill() pushes KataGo to cache before leelaz.start() pulls LZ from cache.
// Hence we postpone calling truncate_cached_engines() until start()
// so that max_cached_engines = 1 works in this situation.
// (Otherwise, we need max_cached_engines = 2 wastefully.)

function create_leelaz_proxy() {
    let lz; const proxy = {}
    const renew_lz = new_lz => {
        lz && cache_disused_engine(lz)
        lz = new_lz || original_create_leelaz()
        merge(proxy, {...lz, start, restart, kill, force_restart, instance_eq})
    }
    const start_gen = (h, command) => {
        const c = pull_cached_engine(h)
        truncate_cached_engines(); renew_lz(c); c || lz[command](h)
        apply_current_analysis_region(lz)
    }
    // override original methods
    const start = h => start_gen(h, 'start')
    const restart = h => start_gen({...lz.start_args(), ...(h || {})}, 'restart')
    const kill = () => renew_lz()
    // add more methods
    const force_restart = () => lz.restart()
    const instance_eq = (z) => (z === lz)
    renew_lz(); return proxy
}

let cached_engines = []
function pull_cached_engine(h) {
    const k = cached_engines.findIndex(lz => lz.start_args_equal(h))
    const ret = (k >= 0) && cached_engines.splice(k, 1)[0]
    return ret
}
function cache_disused_engine(lz) {
    if (!lz.start_args() || !lz.is_ready()) {lz.kill(); return}
    pull_cached_engine(lz.start_args())  // avoid duplication
    lz.set_pondering(false)
    cached_engines.unshift(lz)
}
function truncate_cached_engines() {
    truncate(cached_engines, max_cached_engines, lz => lz.kill())
}

function remember(element, array, max_length, destroy) {
    array.unshift(element); truncate(array, max_length, destroy)
}
function truncate(array, max_length, destroy) {
    array.splice(max_length, Infinity).forEach(destroy || do_nothing)
}

/////////////////////////////////////////////////
// restore

const max_recorded_start_args = 12
let recorded_start_args = [], initial_start_args
function all_ready_p() {
    return leelaz_for_black.is_ready() &&
        (!leelaz_for_white || leelaz_for_white.is_ready())
}
function backup() {
    if (!all_ready_p()) {return}
    const args = all_start_args(), info = engine_info()
    const spec = z => z && [z.leelaz_command, z.leelaz_args]
    const s = a => JSON.stringify([spec(a.black), spec(a.white)])
    const s_args = s(args), different = h => s(h.args) !== s_args
    initial_start_args || (initial_start_args = args)
    recorded_start_args = recorded_start_args.filter(different)
    remember({args, info}, recorded_start_args, max_recorded_start_args)
}
function restore_initial_start_args() {restore_all_start_args(initial_start_args)}
function restore(nth) {
    const rsa = recorded_start_args
    const n = nth || 0, h = rsa[n], a = h ? h.args : initial_start_args
    h && (rsa.splice(n, 1), rsa.unshift(h))
    a && restore_all_start_args(a)
}
function info_for_restore() {return recorded_start_args.map(h => h.info)}

/////////////////////////////////////////////////
// exports

function engine_ids() {
    const engines = [leelaz_for_black, leelaz_for_white]
    return engines.map(lz => lz && lz.engine_id()).filter(truep)
}

const exported_from_leelaz = [
    'send_to_leelaz',
    'peek_value', 'peek_kata_raw_nn', 'peek_kata_raw_human_nn',
    'get_komi', 'is_supported', 'clear_cache', 'analyze_move',
]

module.exports = {
    // main.js only
    set_board, genmove, genmove_analyze, cancel_past_requests,
    start_leelaz, update_leelaz, kill_all_leelaz, set_pondering, all_start_args,
    leelaz_for_white_p, swap_leelaz_for_black_and_white, switch_leelaz,
    switch_to_random_leelaz, load_weight_file,
    unload_leelaz_for_white, leelaz_weight_file, restart,
    set_engine_for_white, restore, info_for_restore, backup,
    different_komi_for_black_and_white, startup_log,
    update_analysis_region, set_instant_analysis,
    is_moves_ownership_supported,
    is_sub_model_humanSL_supported,
    humansl_profile, humansl_profile_for_black, humansl_profile_for_white,
    ...aa2hash(exported_from_leelaz.map(key =>
                                        [key, (...args) => leelaz[key](...args)])),
    // powered_goban.js only
    set_handlers, engine_ids,
    // both
    katago_p, support_endstate_p: katago_p, engine_info, is_gorule_supported,
    // others
    current_preset_label,
}
