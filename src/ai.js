// ai.js: abstraction of engines

require('./util.js').use(); require('./coord.js').use()

// leelaz
const {create_leelaz} = require('./engine.js')
let leelaz = create_leelaz(), leelaz_for_black = leelaz
let leelaz_for_white = null, leelaz_for_endstate = null

// from main.js
let is_bturn, invalid_weight_for_white
function initialize(h) {  // fixme: ugly
    [{is_bturn, invalid_weight_for_white}] = [h]
}

// from powered_goban.js
let suggest_handler, endstate_handler
function set_handlers(h) {  // fixme: ugly
    [{suggest_handler, endstate_handler}] = [h]
}

/////////////////////////////////////////////////
// leelaz

function start_leelaz(leelaz_start_args, endstate_option) {
    leelaz.start(with_handlers(leelaz_start_args()))
    endstate_option && start_endstate(leelaz_start_args, endstate_option)
}
function update_leelaz() {leelaz.update()}
function restart(h, new_weight_p) {
    const cooked = h && with_handlers(h)
    const error_handler =
          (leelaz === leelaz_for_white) ? invalid_weight_for_white : do_nothing
    leelaz.restart(new_weight_p ? {...cooked, error_handler} : cooked)
}
function set_board(hist) {each_leelaz(z => z.set_board(hist), katago_p())}
function kill_all_leelaz() {each_leelaz(z => z.kill())}
function set_pondering(pausing, busy) {
    const pondering = !pausing && !busy
    const b = (leelaz === leelaz_for_black)
    leelaz_for_black.set_pondering(pondering && b)
    leelaz_for_white && leelaz_for_white.set_pondering(pondering && !b)
}
function all_start_args() {
    const f = lz => lz && lz.start_args()
    return {black: f(leelaz_for_black), white: f(leelaz_for_white), both: f(leelaz)}
}
function leelaz_weight_file(leelaz_for_black_or_white) {
    return (leelaz_for_black_or_white || leelaz).get_weight_file()
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
    leelaz_for_endstate.start(start_args)
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
function load_leelaz_for_black(load_weight) {
    with_temporary_leelaz(leelaz_for_black, load_weight)
}
function load_leelaz_for_white(load_weight) {
    const proc = () => {
        load_weight() || (leelaz_for_white.kill(), (leelaz_for_white = null))
    }
    with_temporary_leelaz(leelaz_for_white = create_leelaz(), proc)
}
function set_engine_for_white(command_args) {
    unload_leelaz_for_white()
    const [leelaz_command, ...leelaz_args] = command_args
    const start_args = {...leelaz_for_black.start_args(), leelaz_command, leelaz_args}
    const proc = () => leelaz_for_white.start(start_args)
    with_temporary_leelaz(leelaz_for_white = create_leelaz(), proc)
}
function unload_leelaz_for_white() {
    switch_to_another_leelaz(leelaz_for_black)
    leelaz_for_white && leelaz_for_white.kill(); leelaz_for_white = null
}
function switch_leelaz(bturn) {
    return switch_to_another_leelaz((bturn === undefined ? is_bturn() : bturn) ?
                                    leelaz_for_black : leelaz_for_white)
}

// internal

function with_temporary_leelaz(leelaz_for_black_or_white, proc) {
    leelaz = leelaz_for_black_or_white; proc()
    leelaz = leelaz_for_black; switch_leelaz()
}
function switch_to_another_leelaz(next_leelaz) {
    return next_leelaz && next_leelaz !== leelaz && (leelaz = next_leelaz)
}

/////////////////////////////////////////////////
// komi

const leelaz_komi = 7.5
let engine_komi = leelaz_komi
function support_komi_p() {return katago_p()}
function get_engine_komi() {return support_komi_p() ? engine_komi : leelaz_komi}
function set_engine_komi(komi) {engine_komi = komi; restart({komi})}

/////////////////////////////////////////////////
// misc.

function another_leelaz_for_endstate_p() {return !!leelaz_for_endstate}

function engine_info() {
    const f = lz => lz &&
          {weight_file: lz.get_weight_file(), network_size: lz.network_size()}
    return {engine_komi: get_engine_komi(), leelaz_komi,
            leelaz_for_white_p: leelaz_for_white_p(),
            black: f(leelaz_for_black), white: f(leelaz_for_white), both: f(leelaz)}
}

/////////////////////////////////////////////////
// exports

const exported_from_leelaz = ['send_to_leelaz', 'peek_value']
module.exports = {
    // main.js only
    initialize,
    start_leelaz, update_leelaz, kill_all_leelaz, set_pondering, all_start_args,
    leelaz_for_white_p, swap_leelaz_for_black_and_white, switch_leelaz,
    switch_to_random_leelaz, load_leelaz_for_black, load_leelaz_for_white,
    unload_leelaz_for_white, leelaz_weight_file, restart,
    set_engine_for_white, support_komi_p, set_engine_komi, get_engine_komi,
    ...aa2hash(exported_from_leelaz.map(key =>
                                        [key, (...args) => leelaz[key](...args)])),
    // powered_goban.js only
    set_handlers, set_board, engine_info, another_leelaz_for_endstate_p,
    // both
    katago_p, support_endstate_p,
}
