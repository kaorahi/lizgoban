require('./util.js').use(); require('./coord.js').use()

// util
function shallow_copy_array(a) {return a.slice()}
function shallow_copy_hash(b) {return Object.assign({}, b)}
function NOP() {}

function create_leelaz () {

    /////////////////////////////////////////////////
    // setup

    const pondering_delay_millisec = 0  // disabled (obsolete)

    let leelaz_process, the_start_args, the_analyze_interval_centisec
    let the_minimum_suggested_moves, the_engine_log_line_length
    let the_board_handler, the_suggest_handler
    let command_queue, last_command_id, last_response_id, pondering = true
    let on_response_for_id = {}
    let network_size_text = '', suggest_only = false

    // game state
    let b_prison = 0, w_prison = 0, last_passes = 0, bturn = true

    // util
    const log = (header, s, show_queue_p) => {
        const format = x => (to_s(x).match(/.{0,4}[.].{2}/) || [''])[0]
        const ti = format(Date.now() / 1000 + 0.0001)
        debug_log(`${ti} [${(leelaz_process || {}).pid}] ${header} ${s}` +
                  (show_queue_p ? ` [${command_queue}]` : ''),
                  the_engine_log_line_length)
    }

    /////////////////////////////////////////////////
    // leelaz action

    // process
    const start = h => {
        const {leelaz_command, leelaz_args, analyze_interval_centisec,
               minimum_suggested_moves, engine_log_line_length,
               board_handler, suggest_handler, restart_handler}
              = the_start_args = h
        log('start leela zero:', JSON.stringify([leelaz_command, ...leelaz_args]))
        leelaz_process = require('child_process').spawn(leelaz_command, leelaz_args)
        leelaz_process.stdout.on('data', each_line(stdout_reader))
        leelaz_process.stderr.on('data', each_line(reader))
        set_error_handler(leelaz_process, restart_handler)
        the_board_handler = board_handler; the_suggest_handler = suggest_handler
        the_analyze_interval_centisec = analyze_interval_centisec
        the_minimum_suggested_moves = minimum_suggested_moves
        the_engine_log_line_length = engine_log_line_length
        command_queue = []; block_commands_until_ready()
        clear_leelaz_board() // for restart
    }
    const restart = h => {kill(); network_size_text = ''; start(h || the_start_args)}
    const kill = () => {
        if (!leelaz_process) {return}
        ['stdin', 'stdout', 'stderr']
            .forEach(k => leelaz_process[k].removeAllListeners())
        leelaz_process.removeAllListeners()
        set_error_handler(leelaz_process, e => {})
        leelaz_process.kill('SIGKILL')
    }

    const start_analysis = () => {
        const command = is_supported('minmoves') ?
              `lz-analyze interval ${the_analyze_interval_centisec} minmoves ${the_minimum_suggested_moves}` :
              `lz-analyze ${the_analyze_interval_centisec}`
        pondering && leelaz(command)
    }
    const stop_analysis = () => {leelaz('name')}
    const set_pondering = bool => {
        bool !== pondering && ((pondering = bool) ? start_analysis() : stop_analysis())
    }
    const showboard = () => {!suggest_only && leelaz('showboard')}

    // fixme: unclear
    // up_to_date_response() is turned to be true indirectly
    // by send_to_leelaz as a side effect in check_supported.
    const block_commands_until_ready = () => {
        last_command_id = -1; last_response_id = -2
    }
    const on_ready = () => {
        check_supported('minmoves', 'lz-analyze interval 1 minmoves 30')
        check_supported('endstate', 'endstate_map')
    }

    // stateless wrapper of leelaz
    let leelaz_previous_history = []
    const set_board = (history) => {
        if (empty(history)) {clear_leelaz_board(); bturn = true; return}
        const beg = common_header_length(history, leelaz_previous_history)
        const back = leelaz_previous_history.length - beg
        const rest = history.slice(beg)
        do_ntimes(back, undo1); rest.forEach(play1)
        bturn = !(last(history) || {}).is_black
        if (back > 0 || !empty(rest)) {update()}
        leelaz_previous_history = shallow_copy_array(history)
    }
    const play1 = ({move, is_black}) => {leelaz('play ' + (is_black ? 'b ' : 'w ') + move)}
    const undo1 = () => {leelaz('undo')}

    // util
    const leelaz = (s) => {log('queue>', s, true); send_to_queue(s)}
    const update = () => {showboard(); start_analysis()}
    const clear_leelaz_board = () => {leelaz("clear_board"); leelaz_previous_history = []; update()}
    const start_args = () => the_start_args
    const network_size = () => network_size_text
    const activate = bool => (suggest_only = !bool)
    const peek_value = (move, cont) => {
        the_nn_eval_reader = value => {the_nn_eval_reader = NOP; cont(value); update()}
        leelaz(join_commands('lz-setoption name visits value 1',
                             `play ${bturn ? 'b' : 'w'} ${move}`,
                             'lz-analyze interval 0',
                             'lz-setoption name visits value 0', 'undo'))
    }

    /////////////////////////////////////////////////
    // command queue

    const send_to_queue = (s) => {
        const remove = f => {command_queue = command_queue.filter(x => !f(x))}
        // useless lz-analyze that will be canceled immediately
        remove(pondering_command_p)
        // duplicated showboard
        showboard_command_p(s) && remove(showboard_command_p)
        // obsolete showboard / peek
        changer_command_p(s) && [showboard_command_p, peek_command_p].map(remove)
        command_queue.push(s); try_send_from_queue()
    }

    const try_send_from_queue = () => {
        pondering_command_p(command_queue[0] || '') ?
            send_from_queue_later() : send_from_queue()
    }

    const send_from_queue = () => {
        if (empty(command_queue) || !up_to_date_response()) {return}
        split_commands(command_queue.shift()).map(send_to_leelaz)
    }

    const [send_from_queue_later] =
          deferred_procs([send_from_queue, pondering_delay_millisec])

    const send_to_leelaz = cmd => {try_send_to_leelaz(cmd)}
    const try_send_to_leelaz = (cmd, on_response) => {
        // see stdout_reader for optional arg "on_response"
        const cmd_with_id = `${++last_command_id} ${cmd}`
        on_response && (on_response_for_id[last_command_id] = on_response)
        log('leelaz> ', cmd_with_id, true); leelaz_process.stdin.write(cmd_with_id + "\n")
        cmd === 'showboard' && is_supported('endstate') && send_to_leelaz('endstate_map')
    }

    const join_commands = (...a) => a.join(';')
    const split_commands = s => s.split(';')
    const up_to_date_response = () => {return last_response_id >= last_command_id}

    const command_matcher = re => (command => command.match(re))
    const pondering_command_p = command_matcher(/^lz-analyze/)
    const showboard_command_p = command_matcher(/^showboard/)
    const peek_command_p = command_matcher(/play.*undo/)
    const changer_command_p = command_matcher(/play|undo|clear_board/)

    /////////////////////////////////////////////////
    // stdout reader

    // suggest = [suggestion_data, ..., suggestion_data]
    // suggestion_data =
    //   {move: "Q16", visits: 17, winrate: 52.99, order: 4, winrate_order: 3, pv: v} etc.
    // v = ["Q16", "D4", "Q3", ..., "R17"] etc.

    const stdout_reader = (s) => {
        log('stdout|', s)
        const m = s.match(/^([=?])(\d+)/)
        if (m) {
            const ok = (m[1] === '='), id = last_response_id = to_i(m[2])
            const on_response = on_response_for_id[id]
            on_response && (on_response(ok), delete on_response_for_id[id])
        }
        up_to_date_response() && s.match(/^info /) && suggest_reader(s)
        try_send_from_queue()
    }

    const suggest_reader = (s) => {
        const suggest = s.split(/info/).slice(1).map(suggest_parser).filter(truep)
              .sort((a, b) => (a.order - b.order))
        const [wsum, visits] = suggest.map(h => [h.winrate, h.visits])
              .reduce(([ws, vs], [w, v]) => [ws + w * v, vs + v], [0, 0])
        const winrate = wsum / visits, b_winrate = bturn ? winrate : 100 - winrate
        const wrs = suggest.map(h => h.winrate)
        const add_order = (sort_key, order_key) => {
            suggest.slice().sort((a, b) => (b[sort_key] - a[sort_key]))
                .forEach((h, i) => (h[order_key] = i))
        }
        // winrate is NaN if suggest = []
        add_order('visits', 'visits_order')
        add_order('winrate', 'winrate_order')
        the_suggest_handler({suggest, visits, b_winrate})
    }

    // (sample of leelaz output for "lz-analyze 10")
    // info move D16 visits 23 winrate 4668 prior 2171 order 0 pv D16 Q16 D4 Q3 R5 R4 Q5 O3 info move D4 visits 22 winrate 4670 prior 2198 order 1 pv D4 Q4 D16 Q17 R15 R16 Q15 O17 info move Q16 visits 21 winrate 4663 prior 2147 order 2 pv Q16 D16 Q4 D3 C5 C4 D5 F3
    // (sample with "pass")
    // info move pass visits 65 winrate 0 prior 340 order 0 pv pass H4 pass H5 pass G3 pass G1 pass
    // (sample of LCB)
    // info move D4 visits 171 winrate 4445 prior 1890 lcb 4425 order 0 pv D4 Q16 Q4 D16

    const suggest_parser = (s) => {
        const [a, b] = s.split(/pv/); if (!b) {return false}
        const h = array2hash(a.trim().split(/\s+/))
        h.pv = b.trim().split(/\s+/); h.lcb = to_f(h.lcb || h.winrate) / 100
        h.visits = to_i(h.visits); h.order = to_i(h.order); h.winrate = to_f(h.winrate) / 100
        h.prior = to_f(h.prior) / 10000
        return h
    }

    /////////////////////////////////////////////////
    // stderr reader

    let current_reader, the_nn_eval_reader = NOP

    const reader = (s) => {log('stderr|', s); current_reader(s)}

    const main_reader = (s) => {
        let m, c;
        (m = s.match(/Detecting residual layers.*?([0-9]+) channels.*?([0-9]+) blocks/)) &&
            (network_size_text = `${m[1]}x${m[2]}`);
        (m = s.match(/Setting max tree size/) && on_ready());
        (m = s.match(/NN eval=([0-9.]+)/)) && the_nn_eval_reader(to_f(m[1]));
        (m = s.match(/Passes: *([0-9]+)/)) && (last_passes = to_i(m[1]));
        (m = s.match(/\((.)\) to move/)) && (bturn = m[1] === 'X');
        (m = s.match(/\((.)\) Prisoners: *([0-9]+)/)) &&
            (c = to_i(m[2]), m[1] === 'X' ? b_prison = c : w_prison = c)
        s.match(/a b c d e f g h j k l m n o p q r s t/) && (current_reader = board_reader)
        s.match(/endstate:/) && (current_reader = endstate_reader)
    }

    current_reader = main_reader

    /////////////////////////////////////////////////
    // reader helper

    const multiline_reader = (parser, finisher) => {
        let buf = []
        return s => {
            const p = parser(s)
            p ? buf.push(p) : (finisher(buf), buf = [], current_reader = main_reader)
        }
    }

    /////////////////////////////////////////////////
    // board reader

    // stones = [[stone, ..., stone], ..., [stone, ..., stone]] (19x19, see coord.js)
    // stone = {stone: true, black: true} etc. or {} for empty position

    // history = [move_data, ..., move_data]
    // move_data = {move: "G16", is_black: false, b_winrate: 42.19} etc.
    // history[0] is "first move", "first stone color (= black)", "winrate *after* first move"

    const finish_board_reader = (stones) => {
        const move_count = b_prison + w_prison + last_passes +
              flatten(stones).filter(x => x.stone).length
        the_board_handler({bturn, move_count, stones})
    }

    const char2stone = {
        X: {stone: true, black: true}, x: {stone: true, black: true, last: true},
        O: {stone: true, white: true}, o: {stone: true, white: true, last: true},
    }

    const parse_board_line = (line) => {
        // (.) or (+) means suicide.
        const m = line.replace(/\(X\)/g, ' x ').replace(/\(O\)/g, ' o ').replace(/\([.+]\)/g, ' . ')
              .replace(/\+/g, '.').replace(/\s/g, '').match(/[0-9]+([XxOo.]+)/)
        if (!m) {return false}
        return m[1].split('').map(c => shallow_copy_hash(char2stone[c] || {}))
    }

    const board_reader = multiline_reader(parse_board_line, finish_board_reader)

    /////////////////////////////////////////////////
    // endstate reader

    const finish_endstate_reader = (endstate) => {
        the_board_handler({endstate})
    }

    const parse_endstate_line = (line) => {
        const b_endstate = s => to_i(s) / 1000
        return !line.match(/endstate sum/) && line.trim().split(/\s+/).map(b_endstate)
    }

    const endstate_reader = multiline_reader(parse_endstate_line, finish_endstate_reader)

    /////////////////////////////////////////////////
    // feature checker

    let supported = {}
    const check_supported = (feature, cmd) => {
        try_send_to_leelaz(cmd, ok => {supported[feature] = ok; start_analysis()})
        send_to_leelaz('name')  // relax (stop analysis)
    }
    const is_supported = feature => supported[feature]

    /////////////////////////////////////////////////
    // exported methods

    return {
        start, restart, kill, set_board, update, set_pondering,
        start_args, activate, network_size, peek_value,
        // for debug
        send_to_leelaz,
    }

}  // end create_leelaz

/////////////////////////////////////////////////
// exports

module.exports = {create_leelaz}
