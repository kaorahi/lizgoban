// ai.js: abstraction of engines

require('./common.js').to(global)
const original_create_leelaz = require('./engine.js').create_leelaz

// See "engine cache" section for leelaz objects in this file.
function create_leelaz() {return create_leelaz_proxy()}

/////////////////////////////////////////////////
// initialize

// leelaz
let leelaz = create_leelaz(), leelaz_for_black = leelaz
let leelaz_for_white = null, leelaz_for_endstate = null

// from powered_goban.js
let suggest_handler, endstate_handler
function set_handlers(h) {({suggest_handler, endstate_handler} = h)}

/////////////////////////////////////////////////
// leelaz

function start_leelaz(leelaz_start_args, endstate_option) {
    leelaz.start(with_handlers(leelaz_start_args()))
    endstate_option && start_endstate(leelaz_start_args, endstate_option)
}
function update_leelaz() {leelaz.update()}
function restart(h, new_weight_p) {
    if (!h && !new_weight_p) {leelaz.force_restart(); return}
    const cooked = h && with_handlers(h)
    const error_handler =
          (leelaz === leelaz_for_white) ? invalid_weight_for_white : do_nothing
    leelaz.restart(new_weight_p ? {...cooked, error_handler} : cooked)
}
function set_board(hist, komi) {each_leelaz(z => z.set_board(hist, komi), katago_p())}
function kill_all_leelaz() {each_leelaz(z => z.kill())}
let prev_pondering
function set_pondering(pausing, busy) {
    const pondering = !pausing && !busy
    const b = (leelaz === leelaz_for_black)
    leelaz_for_black.set_pondering(pondering && b)
    leelaz_for_white && leelaz_for_white.set_pondering(pondering && !b)
    leelaz_for_endstate && pondering && !prev_pondering && leelaz_for_endstate.endstate()
    prev_pondering = pondering
}
function all_start_args() {
    const f = lz => lz && lz.start_args()
    return {black: f(leelaz_for_black), white: f(leelaz_for_white)}
}
function leelaz_weight_file(white_p) {
    const lz = white_p ? leelaz_for_white : leelaz_for_black
    return lz && lz.get_weight_file()
}

function each_leelaz(f, for_black_and_white_only) {
    [leelaz_for_black, leelaz_for_white,
     !for_black_and_white_only && leelaz_for_endstate].forEach(z => z && f(z))
}
function with_handlers(h) {return merge({suggest_handler}, h)}

function katago_p() {return leelaz.is_katago()}

/////////////////////////////////////////////////
// leelaz for endstate

function start_endstate(leelaz_start_args, endstate_option) {
    const [lz_command, x] = endstate_option, x_type = typeof x
    const weight = (x_type === 'string') && x
    const more = (x_type === 'object') ? {leelaz_args: x} : {}
    const start_args = {...leelaz_start_args(weight), endstate_handler,
                        leelaz_command: lz_command, ...more}
    leelaz_for_endstate = create_leelaz()
    leelaz_for_endstate.start({...start_args, ready_handler: do_nothing})
    leelaz_for_endstate.set_pondering(false)
}
function support_endstate_p() {return katago_p() || !!leelaz_for_endstate}

/////////////////////////////////////////////////
// another leelaz for white

function leelaz_for_white_p() {return !!leelaz_for_white}
function swap_leelaz_for_black_and_white() {
    if (!leelaz_for_white) {return}
    const old_black = leelaz_for_black
    leelaz_for_black = leelaz_for_white; leelaz_for_white = old_black
    switch_leelaz()
}
function switch_to_random_leelaz(percent) {
    switch_leelaz(xor(is_bturn(), Math.random() < percent / 100))
}
function set_engine_for_white(command_args) {
    const [leelaz_command, ...leelaz_args] = command_args
    const start_args = {...leelaz_for_black.start_args(), weight_file: null,
                        leelaz_command, leelaz_args}
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
    return switch_to_another_leelaz((bturn === undefined ? is_bturn() : bturn) ?
                                    leelaz_for_black : leelaz_for_white)
}
function load_weight_file(weight_file, white_p) {
    set_pondering(false)
    const lz = white_p ? (leelaz_for_white || (leelaz_for_white = create_leelaz()))
          : leelaz_for_black
    const sa = lz.start_args() || leelaz_for_black.start_args()
    lz.restart({...sa, weight_file})
    switch_leelaz()
}

// internal

function switch_to_another_leelaz(next_leelaz) {
    return next_leelaz && next_leelaz !== leelaz && (leelaz = next_leelaz)
}

/////////////////////////////////////////////////
// misc.

function another_leelaz_for_endstate_p() {return !!leelaz_for_endstate}

function engine_info() {
    // fixme: duplication with all_start_args()
    const f = lz => {
        if (!lz || !lz.start_args()) {return null}
        const {leelaz_command, leelaz_args} = lz.start_args()
        return {leelaz_command, leelaz_args, is_ready: lz.is_ready(),
                weight_file: lz.get_weight_file(), network_size: lz.network_size()}
    }
    return {engine_komi: leelaz.get_komi(),
            leelaz_for_white_p: leelaz_for_white_p(),
            black: f(leelaz_for_black), white: f(leelaz_for_white)}
}

/////////////////////////////////////////////////
// engine cache

// note:
// We need max_cached_engines = 2 if we want to use Leela Zero and KataGo
// alternately because leelaz.kill() is called before leelaz.start().
// kill() pushes KataGo to cache before start() pulls LZ from cache.

function create_leelaz_proxy() {
    let lz; const proxy = {}
    const renew_lz = new_lz => {
        lz && cache_disused_engine(lz)
        lz = new_lz || original_create_leelaz()
        merge(proxy, {...lz, start, restart, kill, force_restart, instance_eq})
    }
    const start_gen = (h, command) => {
        const c = pull_cached_engine(h); renew_lz(c); c || lz[command](h)
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
    lz.set_pondering(false); cached_engines.push(lz); shrink_cache()
}
function shrink_cache() {
    const killed = cached_engines.splice(0, cached_engines.length - max_cached_engines)
    killed.forEach(lz => lz.kill())
}

/////////////////////////////////////////////////
// exports

const exported_from_leelaz = ['send_to_leelaz', 'peek_value', 'get_komi']

require('./give_and_take.js').offer(module, {
    // main.js only
    set_board,
    start_leelaz, update_leelaz, kill_all_leelaz, set_pondering, all_start_args,
    leelaz_for_white_p, swap_leelaz_for_black_and_white, switch_leelaz,
    switch_to_random_leelaz, load_weight_file,
    unload_leelaz_for_white, leelaz_weight_file, restart,
    set_engine_for_white,
    ...aa2hash(exported_from_leelaz.map(key =>
                                        [key, (...args) => leelaz[key](...args)])),
    // powered_goban.js only
    set_handlers, another_leelaz_for_endstate_p,
    // both
    katago_p, support_endstate_p, engine_info,
}, global)
