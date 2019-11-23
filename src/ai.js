require('./util.js').use(); require('./coord.js').use()

let M, suggest_handler, endstate_handler, clear_endstate, is_bturn
function initialize(...args) {  // fixme: ugly
    [M, {suggest_handler, endstate_handler, clear_endstate, is_bturn}] = args
}

// leelaz
const {create_leelaz} = require('./engine.js')
let leelaz = create_leelaz(), leelaz_for_black = leelaz
let leelaz_for_white = null, leelaz_for_endstate = null

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
function kill_all_leelaz() {each_leelaz(z => z.kill())}
function set_pondering(pausing, busy) {
    const pondering = !pausing && !busy
    const b = (leelaz === leelaz_for_black)
    pausing && clear_endstate()
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
function invalid_weight_for_white() {
    M.error_from_powered_goban('Invalid weights file (for white)')
    unload_leelaz_for_white()
}

module.exports = {
    initialize,
    start_leelaz, update_leelaz, restart, kill_all_leelaz, set_pondering,
    all_start_args, leelaz_weight_file, each_leelaz, with_handlers, katago_p,
    start_endstate,
    leelaz_for_white_p, swap_leelaz_for_black_and_white, switch_to_random_leelaz,
    load_leelaz_for_black, load_leelaz_for_white, set_engine_for_white,
    unload_leelaz_for_white, switch_leelaz,
    leelaz: () => leelaz,
    leelaz_for_black: () => leelaz_for_black,
    leelaz_for_white: () => leelaz_for_white,
    leelaz_for_endstate: () => leelaz_for_endstate,
}
