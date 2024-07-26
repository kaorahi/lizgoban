const {get_stones_and_set_ko_state} = require('./rule.js')

const engine_log_conf = {}
const assuming_broken_GTP = true

function create_leelaz () {

    /////////////////////////////////////////////////
    // setup

    const endstate_delay_millisec = 20
    const speedo_interval_sec = 3, speedo_premature_sec = 0.5
    const speedometer = make_speedometer(speedo_interval_sec, speedo_premature_sec)
    const queue_log_header = 'queue>'

    let leelaz_process, arg, base_engine_id, is_ready = false, ownership_p = false
    let aggressive = ''  // '', 'b', 'w'
    let command_queue = [], last_command_id, last_response_id, pondering = true
    let on_response_for_id = {}
    let network_size_text = '', komi = leelaz_komi, gorule = default_gorule
    let startup_log = [], is_in_startup = true
    let analysis_region = null, instant_analysis_p = false
    let analysis_after_raw_nn_p = true
    let obtained_pda_policy = null
    let known_name_p = false
    let humansl_profile = ''
    let humansl_stronger_profile = '', humansl_weaker_profile = ''

    // game state
    // bturn: for parsing engine output (updated when engine sync is finished)
    // js_bturn: for sending analysis command (updated immediately in set_board)
    let move_count = 0, bturn = true, js_bturn = true
    let handicaps = 0, init_len = 0

    // util
    const log = (header, s, show_queue_p, category) => {
        const t2s = task => (task.protect_p ? '!' : '') +
              (with_response_p(task) ? '*' : '') + task.command
        const message = `[${(leelaz_process || {}).pid}] ${header} ${s}`
        is_in_startup && (header !== queue_log_header) &&
            startup_log.push(snip(message, 300))
        debug_log(message +
                  (show_queue_p ? ` [${command_queue.map(t2s)}]` : ''),
                  engine_log_conf.line_length || 500,
                  engine_log_conf.snip_similar_lines && category)
    }

    /////////////////////////////////////////////////
    // leelaz action

    // process
    const start = h => {
        arg = cook_arg(h); base_engine_id = hash(JSON.stringify(arg))
        const {leelaz_command, leelaz_args, analyze_interval_centisec, wait_for_startup,
               weight_file, working_dir, default_board_size,
               minimum_suggested_moves, ready_handler,
               endstate_handler, suggest_handler, restart_handler, error_handler,
               illegal_handler, tuning_handler, command_failure_handler}
              = arg || {}
        const opt = {cwd: working_dir}
        is_ready = false; is_in_startup = true; startup_log = []; network_size_text = ''
        log('start engine:', JSON.stringify(arg && [leelaz_command, ...leelaz_args]))
        leelaz_process = require('child_process').spawn(leelaz_command, leelaz_args, opt)
        leelaz_process.stdout.on('data', each_line(stdout_reader))
        leelaz_process.stderr.on('data', each_line(reader))
        set_error_handler(leelaz_process, () => restart_handler(startup_log))
        command_queue = []; last_command_id = last_response_id = -1
        wait_for_startup || on_ready()
    }
    const restart = h => {kill(); start(h ? {...arg, ...h} : arg)}
    const kill = () => {
        if (!leelaz_process) {return}
        ['stdin', 'stdout', 'stderr']
            .forEach(k => leelaz_process[k].removeAllListeners())
        leelaz_process.removeAllListeners()
        set_error_handler(leelaz_process, e => {})
        leelaz_process.kill('SIGKILL')
    }

    const set_instant_analysis = instant_p =>
          // need to start kata-analyze again if instant_p is turned off
          (instant_analysis_p = instant_p) || (is_ready && pondering && start_analysis())
    const start_analysis = () => {
        obtained_pda_policy = null;
        (instant_analysis_p && kata_raw_nn()) ||
            (analysis_after_raw_nn_p && start_analysis_after_raw_nn()) ||
            start_analysis_actually()
    }
    const pda_for_checking_policy_aggressiveness = 2.0
    const start_analysis_after_raw_nn = () => {
        const too_slow = (speedometer.latest() < 20)
        if (too_slow) {return false}
        const nn_with_pda_sign = (receiver, sign) =>
              kata_raw_nn(receiver, pda_for_checking_policy_aggressiveness * sign)
        const humansl_args = [
            ['humansl_stronger_policy', kata_raw_human_nn, humansl_stronger_profile],
            ['humansl_weaker_policy', kata_raw_human_nn, humansl_weaker_profile],
        ]
        const pda_args = [
            // ['aggressive_policy', nn_with_pda_sign, +1],
            ['default_policy', nn_with_pda_sign, 0],
            // ['defensive_policy', nn_with_pda_sign, -1],
        ]
        const args = is_supported('sub_model_humanSL') ? humansl_args :
              kata_pda_supported() ? pda_args : []
        const call_nn = ([key, f, ...as], cont) => {
            const receiver = h => {
                const policy = h?.policy; if (!policy) {return}
                obtained_pda_policy || (obtained_pda_policy = {})
                obtained_pda_policy[key] = policy
                cont()
            }
            f(receiver, ...as)
        }
        const call = ([first, ...rest], proc, post_proc) =>
              first ? proc(first, () => call(rest, proc, post_proc)) : post_proc()
        call(args, call_nn, start_analysis_actually)
        return true
    }
    const start_analysis_actually = on_response => {
        const allow = is_supported('allow') && analysis_region_string()
        // for a bug in KataGo v1.10.0:
        // https://github.com/lightvector/KataGo/issues/602
        // https://github.com/lightvector/KataGo/commit/78d811a6ed03e0e00a86232dff74131851a09717
        // "allow" seems ignored in the first call of "kata-analyze B ..."
        // just after "play B ...". It works in the second call.
        // So we put a dummy kata-analyze before the actual one.
        // (fixme) this "version check" may be incorrect someday
        const is_katago_until_1_10_0 = is_katago() && !is_supported('pvEdgeVisits')
        const workaround_for_katago_bug = allow && is_katago_until_1_10_0 &&
              `kata-analyze ${bw_for(js_bturn)} interval 999999;`
        const profile = is_supported('humanSLProfile') &&
              `${humansl_profile_restorer()};`
        const maybe = key => is_supported(key) && `${key} true`
        const o_maybe = key => ownership_p && maybe(key)
        leelaz([
            // preparations
            profile,
            workaround_for_katago_bug,
            // command
            is_katago() ? 'kata-analyze' : 'lz-analyze',
            // args
            bw_for(js_bturn),
            analyze_command_interval_arg(),
            is_katago() && ownership_p && 'ownership true',
            o_maybe('ownershipStdev'),
            is_supported('minmoves') && `minmoves ${arg.minimum_suggested_moves}`,
            maybe('pvVisits'),
            maybe('pvEdgeVisits'),
            o_maybe('movesOwnership'),
            maybe('rootInfo'),
            allow,
        ].filter(truep).join(' '), on_response || on_analysis_response)
    }
    const analyze_command_interval_arg = () =>
          `interval ${arg.analyze_interval_centisec}`
    const humansl_profile_setter = profile => `kata-set-param humanSLProfile ${profile}`
    const humansl_profile_restorer = (forcep) => {
        // if -human-model is given, profile should be applied
        // only for kata-raw-human-nn and genmove etc.
        const profile_for_sub_model = forcep ? humansl_profile : ''
        const p = is_supported('main_model_humanSL') ? humansl_profile :
              is_supported('sub_model_humanSL') ? profile_for_sub_model : null
        return truep(p) ? humansl_profile_setter(p) : 'name'
    }
    const humansl_profile_updater = () => {
        const command = 'kata-get-param humanSLProfile'
        const on_response = (ok, res) => ok && (humansl_profile = (res || '').trim())
        return [command, on_response]
    }
    const humansl_request_profile = (profile, callback) => {
        const setter = humansl_profile_setter(profile)
        const [getter, on_response] = humansl_profile_updater()
        // callback for immediate updating of title bar
        const f = (...a) => {const ret = on_response(...a); callback(); return ret}
        leelaz(`${setter};${getter}`, f)
    }
    const stop_analysis = () => {leelaz('name')}
    const set_pondering = bool => {
        bool !== pondering && ((pondering = bool) ? start_analysis() : stop_analysis())
    }
    const endstate = () => {
        arg.endstate_handler && is_supported('endstate') && leelaz('endstate_map')
    }

    const kata_raw_nn_default_receiver = h => {
        if (!h) {return}
        const {
            whiteWin, whiteLead, whiteOwnership, policy, policyPass,
        } = h
        const conv_gen = base =>
              a => a.map(z => to_s(bturn ? base - z : z)).join(' ')
        const [conv0, conv1] = [0, 1].map(conv_gen)
        const [winrate, scoreLead] = [whiteWin, whiteLead].map(conv1)
        const ownership = conv0(whiteOwnership)
        const bsize = board_size(), extended_policy = [...policy, policyPass]
        const k = argmin_by(extended_policy, p => isNaN(p) ? Infinity : - p)
        const move = serial2move(k) || pass_command
        const prior = to_s(extended_policy[k]), pv = move
        const fake_suggest = `info order 0 visits 1 move ${move} prior ${prior} winrate ${winrate} scoreMean ${scoreLead} scoreLead ${scoreLead} pv ${pv} ownership ${ownership}`
        suggest_reader_maybe(fake_suggest)
    }
    const kata_raw_nn = (given_receiver, pda) => {
        if (!is_supported('kata-raw-nn')) {return false}
        const receiver = given_receiver || kata_raw_nn_default_receiver
        // CAUTION:
        // - use not 'kata-set-param' but update_kata_pda for change detection
        // - use dummy command 'lizgoban_*' to avoid automatic update_kata_pda
        // - use command name '*_kata-raw-nn' for remove(pondering_command_p)
        const proc = () => {
            const on_response =
                  on_multiline_response_at_once(on_kata_raw_nn_response(receiver))
            update_kata_pda(pda)
            send_task_to_leelaz_sub({command: 'kata-raw-nn 0', on_response})
        }
        leelaz(`lizgoban_kata-raw-nn PDA=${pda}`, proc)
        return true
    }
    const kata_raw_human_nn = (receiver, profile) => {
        if (!is_supported('sub_model_humanSL')) {return}
        const proc = () => {
            const on_response =
                  on_multiline_response_at_once(on_kata_raw_nn_response(receiver))
            send_to_leelaz(humansl_profile_setter(profile))
            send_task_to_leelaz_sub({command: 'kata-raw-human-nn 0', on_response})
        }
        leelaz(`lizgoban_kata-raw-human-nn PROFILE=${profile}`, proc)
    }

    const genmove = (sec, callback) => {
        const cancellable = is_supported('kata-search_cancellable')
        const com = cancellable ? 'kata-search_cancellable' : 'genmove'
        const command_for_color = color => `${com} ${color}`
        const on_response = on_genmove_responsor(callback, cancellable)
        return genmove_gen(sec, command_for_color, on_response)
    }
    const genmove_gen = (sec, command_for_color, on_response) => {
        const color = bw_for(js_bturn)
        const command = `time_settings 0 ${sec} 1;${humansl_profile_restorer(true)};${command_for_color(color)}`
        leelaz(command, on_response)
    }
    const on_genmove_responsor = (callback, cancellable) => {
        const bturn0 = js_bturn
        return (ok, res) => {
            if (ok && !cancellable) {
                const move = res; push_to_history(move, bturn0)
                bturn = js_bturn = !bturn0
            }
            res !== 'cancelled' && callback(ok, res)
        }
    }

    const genmove_analyze = (sec, callback) => {
        const cancellable = is_supported('kata-search_cancellable')
        const com = cancellable ? 'kata-search_analyze_cancellable' :
              is_katago() ? 'kata-genmove_analyze' : 'lz-genmove_analyze'
        const interval = analyze_command_interval_arg()
        const command_for_color = color => `${com} ${color} ${interval}`
        const on_response = on_genmove_analyze_responsor(callback, cancellable)
        return genmove_gen(sec, command_for_color, on_response)
    }
    const on_genmove_analyze_responsor = (callback, cancellable) => {
        const on_move = on_genmove_responsor(callback, cancellable)
        return (ok, res) => {
            const move = ok && res.match(/^play\s+(.*)/)?.[1]
            return move ? on_move(ok, move) : on_analysis_response(ok, res)
        }
    }

    let on_ready = () => {
        if (is_ready) {return}; is_ready = true
        leelaz('name', on_name_response)
        const checks = [
            ['lz-setoption', 'lz-setoption name visits value 0'],
            ['kata-analyze', 'kata-analyze interval 1'],
            ['kata-set-rules', `kata-set-rules ${gorule}`],
            ['kata-get-param', 'kata-get-param playoutDoublingAdvantage'],
            ['set_free_handicap', 'set_free_handicap A1'],
            ['set_position', 'set_position'],  // = clear_board
        ]
        const checks_without_startup_log = [  // avoid too long log
            ['minmoves', 'lz-analyze interval 1 minmoves 30'],
            ['endstate', 'endstate_map'],
            ['kata-raw-nn', 'kata-raw-nn 0'],
            ['pvVisits', 'kata-analyze 1 pvVisits true'],
            ['pvEdgeVisits', 'kata-analyze 1 pvEdgeVisits true'],
            ['ownershipStdev', 'kata-analyze 1 ownershipStdev true'],
            ['movesOwnership', 'kata-analyze 1 movesOwnership true'],
            ['rootInfo', 'kata-analyze 1 rootInfo true'],
            ['allow', 'lz-analyze 1 allow B D4 1'],
            // use kata-search_analyze_cancellable for immediate cancel
            ['kata-search_cancellable', 'kata-search_analyze_cancellable B'],
            // query and record some parameters as side effects here
            // so that they are surely recorded before "after_all_checks"
            [null, ...humansl_profile_updater()],
            [null, ...humansl_feature_checker()],
        ]
        const do_check = table => table.forEach(a => check_supported(...a))
        do_check(checks)
        leelaz('lizgoban_stop_startup_log', () => {is_in_startup = false})
        do_check(checks_without_startup_log)
        // clear_leelaz_board for restart
        // komi may be changed tentatively in set_board before check of engine type
        const after_all_checks = () => {
            clear_leelaz_board(); is_katago() || (komi = leelaz_komi)
            // KataGo's default komi can be 6.5 etc. depending on "rules" in gtp.cfg.
            leelaz(`komi ${komi}`)  // force KataGo to use our komi
            arg.ready_handler()
        }
        leelaz('lizgoban_after_all_checks', after_all_checks)
    }
    const on_error = () =>
          (arg.error_handler || arg.restart_handler)(startup_log)

    // stateless wrapper of leelaz
    let leelaz_previous_history = []
    const push_to_history = (move, is_black) =>
          leelaz_previous_history.push({move, is_black})
    const get_aux = () => ({
        bturn: js_bturn,
        komi, gorule, handicaps, init_len, ownership_p, aggressive,
        humansl_stronger_profile, humansl_weaker_profile,
        analysis_after_raw_nn_p,
    })
    const set_board = (history, aux) => {
        // aux = {bturn, komi, gorule, handicaps, init_len, ownership_p, aggressive, humansl_stronger_profile, humansl_weaker_profile, analysis_after_raw_nn_p}
        if (is_in_startup) {return}
        js_bturn = aux.bturn
        analysis_after_raw_nn_p = aux.analysis_after_raw_nn_p
        change_board_size(board_size())
        let update_kata_p = false
        const update_kata = (val, new_val, command, setter) => {
            const valid_p = truep(new_val) || !command
            const update_p = is_katago(true) && valid_p && new_val !== val
            if (!update_p) {return val}
            command && leelaz(`${command} ${new_val}`,
                              setter && (ok => setter(ok ? new_val : val)))
            setter && setter(new_val)  // tentatively
            update_kata_p = true; return new_val
        }
        update_kata(komi, aux.komi, 'komi', z => {komi = z})
        update_kata(gorule, aux.gorule, 'kata-set-rules', z => {gorule = z})
        ownership_p = update_kata(ownership_p, aux.ownership_p)
        aggressive = update_kata(aggressive, kata_pda_supported() ? aux.aggressive : '')
        humansl_stronger_profile = aux.humansl_stronger_profile
        humansl_weaker_profile = aux.humansl_weaker_profile
        if (empty(history)) {!empty(leelaz_previous_history) && clear_leelaz_board(); update_move_count([], true); return}
        const beg = common_header_length(history, leelaz_previous_history)
        const beg_valid_p = aux.handicaps === handicaps && aux.init_len === init_len &&
              beg >= init_len
        handicaps = aux.handicaps; init_len = aux.init_len
        const updated_p = beg_valid_p ? update_board_by_undo(history, beg) :
              update_board_by_clear(history, handicaps, init_len)
        const update_mc_p = updated_p || update_kata_p
        update_mc_p && update_move_count(history, aux.bturn)
        leelaz_previous_history = history.slice()
    }
    const update_board_by_undo = (history, beg) => {
        const back = leelaz_previous_history.length - beg
        const rest = history.slice(beg)
        do_ntimes(back, undo1); rest.forEach(play1)
        return back > 0 || !empty(rest)
    }
    const update_board_by_clear = (history, handicaps, init_len) => {
        clear_leelaz_board(true)
        // katago does not accept pass in set_position
        init_len > 0 && history[init_len - 1]?.move === pass_command && init_len--
        let init = history.slice(0, init_len), rest = history.slice(init_len)
        const set_handicap = () =>
              is_supported('set_free_handicap') ?
              leelaz(`set_free_handicap ${init.map(h => h.move).join(' ')}`) :
              leelaz(init.map(h => `play b ${h.move}`).join(';'))
        const set_position = () => {
            const {stones} = get_stones_and_set_ko_state(init)
            const f = (s, i, j) => s.stone ? [bw_for(s.black), idx2move(i, j)] : []
            const moves = aa_map(stones, f).flat().flat().join(' ')
            leelaz(`set_position ${moves}`)
        }
        init_len === 0 ? do_nothing() :
            init_len === handicaps ? set_handicap() :
            is_supported('set_position') ? set_position() : (rest = history)
        rest.forEach(play1)
        return true
    }
    const play1_gen = (h, cont) => {
        const {move, is_black} = h
        const f = ok => {!ok && !h.illegal && ((h.illegal = true), arg.illegal_handler(h)); cont(ok)}
        leelaz('play ' + bw_for(is_black) + ' ' + move, f)
    }
    const play1 = h => play1_gen(h, do_nothing)
    const bw_for = bool => (bool ? 'b' : 'w')
    const undo1 = () => {leelaz('undo')}
    let old_board_size
    const change_board_size = bsize => {
        if (bsize === old_board_size) {return}
        const command = 'boardsize'
        const ng = () => {
            const info = `Unsupported board size by this engine.`
            arg.command_failure_handler(command, info); old_board_size = null
        }
        const f = ok => {is_ready = true; ok || ng(); arg.ready_handler(true)}
        is_ready = false; leelaz(`${command} ${bsize}`, f); old_board_size = bsize
    }

    // util
    const leelaz = (command, on_response, protect_p) => {
        log(queue_log_header, command, true); send_to_queue({command, on_response, protect_p})
    }
    const update_now = () => arg && (endstate(), pondering && start_analysis())
    const [update_later] = deferred_procs([update_now, endstate_delay_millisec])
    // avoid flicker of endstate
    const update = () => is_supported('endstate') ? update_later() : update_now()
    const clear_leelaz_board = silent => {leelaz("clear_board"); leelaz_previous_history = []; silent || update()}
    const start_args = () => arg
    const network_size = () => network_size_text
    const get_komi = () => known_name_p ? komi : NaN
    const get_engine_id = () =>
          `${base_engine_id}-${gorule}-${komi}${aggressive}${analysis_region}${humansl_profile}`
    const peek_value = (move, cont) =>
          is_supported('lz-setoption') ? (peek_value_lz(move, cont), true) :
          is_supported('kata-raw-nn') ? (peek_value_kata(move, cont), true) :
          false
    const peek_value_lz = (move, cont) => {
        const do1 = () =>
              leelaz(join_commands('lz-setoption name visits value 1',
                                   `play ${bw_for(js_bturn)} ${move}`,
                                   'lz-analyze interval 0'), do2)
        const do2 = () => {
            the_nn_eval_reader =
                value => {the_nn_eval_reader = do_nothing; cont(value); update()}
            leelaz(join_commands('lz-setoption name visits value 0', 'undo'))
        }
        do1()
    }
    const peek_value_kata = (move, cont) => {
        const flip = w => js_bturn ? w : 1 - w // js_bturn is not updated!
        peek_kata_raw_nn(move, h => cont(flip(to_f(h.whiteWin[0]))))
    }
    const peek_kata_raw_nn = (move, cont) => {
        if (!is_supported('kata-raw-nn')) {return false}
        const receiver = h => {leelaz('undo'); h && cont(h)}
        const on_response = (ok, _) => ok && kata_raw_nn(receiver)
        leelaz(humansl_profile_restorer())
        leelaz(`play ${bw_for(js_bturn)} ${move}`, on_response)
        return true
    }

    // aggressive
    const kata_pda_param = 'playoutDoublingAdvantage'
    const kata_pda_checker = change_detector(0.0)
    const kata_pda_command_maybe = given_pda => {
        const pda = kata_pda_supported() && true_or(given_pda, kata_pda_for_this_turn())
        return truep(pda) && kata_pda_checker.is_changed(pda) &&
            `kata-set-param ${kata_pda_param} ${pda}`
    }
    const kata_pda_for_this_turn = () => {
        const abs_pda = 2.0
        const sign = !aggressive ? 0 : xor(aggressive === 'b', bturn) ? -1 : 1
        return sign * abs_pda
    }
    const kata_pda_supported = () => {
        const is_pda_set_explicitly = arg.leelaz_args.join('').match(kata_pda_param)
        return is_supported('kata-get-param') && !is_pda_set_explicitly
    }

    // allow
    const update_analysis_region = region => {
        analysis_region = region; is_ready && update()
    }
    const analysis_region_string = () => {
        if (!analysis_region) {return null}
        const [is, js] = analysis_region.map(range => seq_from_to(...range))
        const vertices = is.flatMap(i => js.map(j => idx2move(i, j))).join(',')
        const untildepth = 1
        const for_color = player => `allow ${player} ${vertices} ${untildepth}`
        return ['B', 'W'].map(for_color).join(' ')
    }

    // analyze specified move temporarily
    let state_of_analyze_move = null
    const analyze_move = (move, is_black, sec, then) => {
        with_temp_move(move, is_black, recover => {
            state_of_analyze_move = {recover}
            let parsed = null
            const call_then = () => {recover_from_analyze_move(); then(parsed)}
            const on_response = with_temp_handler(z => parsed = z, on_analysis_response)
            pondering = true
            start_analysis_actually(on_response)
            state_of_analyze_move.timer = setTimeout(call_then, sec * 1000)
        })
    }
    const recover_from_analyze_move = () => {
        if (!state_of_analyze_move) {return}
        const {recover, timer} = state_of_analyze_move
        truep(timer) && (clearTimeout(timer), stop_analysis())
        recover()
        state_of_analyze_move = null
    }
    const with_temp_move = (move, is_black, proc) => {
        const history = leelaz_previous_history, aux = get_aux()
        const recover = () => set_board(history, aux)
        set_board([...history, {move, is_black}], {...aux, bturn: !is_black})
        proc(recover)  // recover() can be called asyncronously
    }
    const with_temp_handler = (handler, func) => {
        return (...a) => {
            const {suggest_handler} = arg
            arg.suggest_handler = handler
            const ret = func(...a)
            arg.suggest_handler = suggest_handler
            return ret
        }
    }

    /////////////////////////////////////////////////
    // weights file

    const cook_arg = h => {
        if (!h) {return h}
        // weight file
        const leelaz_args = leelaz_args_with_replaced_weight_file(h)
        // board size (KataGo)
        const bsize_pattern = /defaultBoardSize=[0-9]+/
        const bsize_replaced = `defaultBoardSize=${h.default_board_size}`
        const bsize_pos = leelaz_args.findIndex(v => v.match(bsize_pattern))
        h.default_board_size && bsize_pos >= 0 &&
            (leelaz_args[bsize_pos] =
             leelaz_args[bsize_pos].replace(bsize_pattern, bsize_replaced))
        return {...h, leelaz_args}
    }
    const start_args_equal = h => {
        const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
        // const eq = (a, b) => a === b ||
        //       (is_a(a, 'object') && is_a(b, 'object') &&
        //        Object.keys({...a, ...b}).every(k => eq(a[k], b[k])))
        return eq(arg, cook_arg(h))
    }
    const get_weight_file = () => {
        const pos = arg && weight_option_pos_in_leelaz_args(arg)
        return pos && arg.leelaz_args[pos]
    }
    const leelaz_args_with_replaced_weight_file = h => {
        const leelaz_args = h.leelaz_args.slice(), {weight_file} = h
        const pos = weight_file && weight_option_pos_in_leelaz_args(h)
        truep(pos) && (leelaz_args[pos] = weight_file)
        !truep(pos) && weight_file && h.leelaz_command.match(/katago/i) &&  // ad hoc!
            leelaz_args.push('-model', weight_file)
        return leelaz_args
    }
    const weight_option_pos_in_leelaz_args = h => {
        const weight_options = [
            '-w', '--weights',  // Leela Zero
            '-model',  // KataGo
            '--model',  // TamaGo
        ]
        const idx = h.leelaz_args.findIndex(z => weight_options.includes(z))
        return (idx >= 0) && (idx + 1)
    }

    /////////////////////////////////////////////////
    // command queue

    // task = {command: "play b D4", on_response: ok => {...}, protect_p: false}

    const send_to_queue = task => {
        const remove = f => {
            command_queue = command_queue.filter(x => !f(x) || x.protect_p)
        }
        // useless lz-analyze etc. that will be canceled immediately
        remove(cancellable_command_p)
        // duplicated endstate
        endstate_command_p(task) && remove(endstate_command_p)
        // obsolete endstate / peek
        changer_command_p(task) && [raw_nn_command_p, endstate_command_p].forEach(remove)
        command_queue.push(task); send_from_queue()
    }

    const send_from_queue = () => {
        if (empty(command_queue) || !up_to_date_response()) {return}
        split_task(command_queue.shift()).forEach(send_task_to_leelaz)
    }

    const send_task_to_leelaz = task => {
        pondering_command_p(task) && update_kata_pda()
        send_task_to_leelaz_sub(task)
    }
    const update_kata_pda = given_pda => {
        const command = kata_pda_command_maybe(given_pda)
        command && send_task_to_leelaz_sub({command})
    }
    const send_task_to_leelaz_sub = task => {
        // see stdout_reader for optional "on_response"
        const {command, on_response} = task
        const cmd = dummy_command_p(task) ? 'name' : command
        const cmd_with_id = `${++last_command_id} ${cmd}`
        with_response_p(task) && (on_response_for_id[last_command_id] = on_response)
        pondering_command_p(task) && speedometer.reset()
        log('engine>', cmd_with_id, true); leelaz_process.stdin.write(cmd_with_id + "\n")
    }
    // ignore unintentional wrong on_response by a.forEach(send_to_leelaz)
    const with_response_p = task => functionp(task.on_response)
    const send_to_leelaz = (command, on_response) =>
          send_task_to_leelaz({command, on_response})

    const update_move_count = (history, new_bturn) => {
        const new_state =
              {move_count: history.length, bturn: new_bturn}
        const dummy_command = `lizgoban_set ${JSON.stringify(new_state)}`
        const on_response = () => ({move_count, bturn} = new_state)
        leelaz(dummy_command, on_response); update()
    }

    const join_commands = (...a) => a.join(';')
    const split_command = command => command.split(';').map(c => c.trim())
    const split_task = task => {
        const ts = split_command(task.command).map(command => ({command}))
        last(ts).on_response = task.on_response
        return ts
    }
    const up_to_date_response = () => {return last_response_id >= last_command_id}

    const command_matcher = re => (task => task.command.match(re))
    const pondering_command_p = command_matcher(/(lz|kata)-(genmove_)?analyze|kata-search_analyze/)
    const cancellable_command_p = command_matcher(/(lz|kata)-analyze/)
    const raw_nn_command_p = command_matcher(/kata-raw(-human)?-nn/)
    const endstate_command_p = command_matcher(/^endstate_map/)
    const changer_command_p = command_matcher(/play|undo|clear_board|set_position|set_free_handicap/)
    const dummy_command_p = command_matcher(/lizgoban/)

    /////////////////////////////////////////////////
    // stdout reader

    // suggest = [suggestion_data, ..., suggestion_data]
    // suggestion_data =
    //   {move: "Q16", visits: 17, winrate: 52.99, order: 4, winrate_order: 3, pv: v} etc.
    // v = ["Q16", "D4", "Q3", ..., "R17"] etc.

    let current_stdout_reader
    const expecting_multiline_response = unique_identifier()

    const stdout_reader = (s) => {
        const category = (current_stdout_reader !== stdout_main_reader) &&
              current_stdout_reader
        log('stdout|', s, false, category); current_stdout_reader(s); send_from_queue()
    }

    const stdout_main_reader = (s, strict) => {
        const m = s.match(/^([=?])(\d+)(\s+)?(.*)/)
        if (!m) {assuming_broken_GTP && !strict && suggest_reader_maybe(s); return false}
        const ok = (m[1] === '='), id = last_response_id = to_i(m[2]), result = m[4]
        const on_response = on_response_for_id[id]; delete on_response_for_id[id]
        const multiline_p = on_response &&
              on_response(ok, result) === expecting_multiline_response
        const on_continued = (ok && multiline_p) ? on_response : do_nothing
        current_stdout_reader = make_rest_reader(on_continued)
        return true
    }

    current_stdout_reader = stdout_main_reader

    const make_rest_reader = on_response => s =>
          assuming_broken_GTP && stdout_main_reader(s, true) ? null :
          s ? on_response('continued', s) :  // '' is falsy
          (on_response('finished', s), (current_stdout_reader = stdout_main_reader))

    const on_multiline_response_at_once = on_response => {
        const buf = []
        return (ok, result) => {
            !ok ? on_response(ok, [result]) :
                ok === 'finished' ? on_response(ok, buf) : buf.push(result)
            return expecting_multiline_response
        }
    }

    const on_analysis_response = (ok, result) =>
          ((ok && result && suggest_reader_maybe(result)), expecting_multiline_response)

    const suggest_reader_maybe = (s) =>
          up_to_date_response() && s.match(/^info /) && suggest_reader(s)

    const suggest_reader = (s) => {
        const f = arg.suggest_handler; if (!f) {return}
        const h = parse_analyze(s, bturn, komi, is_katago())
        const engine_id = get_engine_id()
        const policy_keys = [
            'default_policy',
            'humansl_stronger_policy', 'humansl_weaker_policy',
        ]
        const policies = pick_keys(obtained_pda_policy || {}, ...policy_keys)
        merge(h, {
            engine_id, gorule, visits_per_sec: speedometer.per_sec(h.visits),
            ...policies,
        })
        f(h)
    }

    const on_kata_raw_nn_response = receiver => (ok, results) => {
        if (!ok || empty(results) || !up_to_date_response()) {receiver(null); return}
        const tokens = results.join(' ').split(/\s+/).filter(identity)
        const h = {}, numeric = /^([-.0-9]+|NAN)$/
        let key
        const append = v => (h[key] || (h[key] = [])).push(v)
        tokens.forEach(t => t.match(numeric) ? append(to_f(t)) : (key = t))
        receiver(h)
    }

    const on_name_response = (ok, result) => {
        const known_names = ['Leela Zero', 'KataGo']
        known_name_p = known_names.includes(result)
    }

    /////////////////////////////////////////////////
    // stderr reader

    let current_reader, the_nn_eval_reader = do_nothing

    const reader = (s) => {log('stderr|', s); current_reader(s)}

    const main_reader = (s) => {
        let m, c;
        (arg.tuning_handler || do_nothing)(s);
        (m = s.match(/Detecting residual layers.*?([0-9]+) channels.*?([0-9]+) blocks/)) &&
            (network_size_text = `${m[1]}x${m[2]}`);
        // for KataGo (ex.) g170e-b20c256x2-s5303129600-d1228401921
        // (ex.) b18c384nbt-3659M-lr05
        (m = s.match(/Model name: (?:[a-z0-9]+-)?b([0-9]+)c([0-9]+).*?(?:-s[0-9]+-d.[0-9]+)?/)) &&
            (network_size_text = `${m[2]}x${m[1]}`);
        // "GTP ready" for KataGo, "feature weights loaded" for Leela 0.11.0
        s.match(/(Setting max tree size)|(GTP ready)|(feature weights loaded)/) &&
            on_ready();
        s.match(/Weights file is the wrong version/) && on_error();
        (m = s.match(/NN eval=([0-9.]+)/)) && the_nn_eval_reader(to_f(m[1]));
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
    // endstate reader

    const finish_endstate_reader = (endstate) => {
        const f = arg.endstate_handler
        f && f({endstate, endstate_move_count: move_count})
    }

    const parse_endstate_line = (line) => {
        const b_endstate = s => to_i(s) / 1000
        return !line.match(/endstate sum/) && trim_split(line, /\s+/).map(b_endstate)
    }

    const endstate_reader = multiline_reader(parse_endstate_line, finish_endstate_reader)

    /////////////////////////////////////////////////
    // feature checker

    let supported = {}
    const check_supported =
          (feature, cmd, on_response) => leelaz(cmd, (ok, res) => {set_supported(feature, ok); return on_response && on_response(ok, res)}, true)
    const set_supported = (feature, val) => feature && (supported[feature] = val)
    const is_supported = feature => supported[feature]
    const is_katago = maybe => is_supported('kata-analyze') || (is_in_startup && maybe)

    const humansl_feature_checker = () => {
        const command = 'kata-get-models'
        const check = ms => {
            const feature_name = ['main_model_humanSL', 'sub_model_humanSL']
            const rs = ms?.map(m => m?.usesHumanSLProfile) || []
            rs.forEach((r, k) => set_supported(feature_name[k], r))
            set_supported('humanSLProfile', rs.some(truep))
        }
        const on_response = (ok, res) => ok && check(safely(JSON.parse, res))
        return [command, on_response]
    }

    /////////////////////////////////////////////////
    // exported methods

    const exported = {
        start, restart, kill, set_board, update, set_pondering, get_weight_file,
        start_args, start_args_equal, get_komi, network_size, peek_value, is_katago,
        update_analysis_region, set_instant_analysis,
        is_supported, clear_leelaz_board,
        endstate, is_ready: () => is_ready, engine_id: get_engine_id,
        startup_log: () => startup_log, aggressive: () => aggressive,
        humansl_profile: () => humansl_profile, humansl_request_profile,
        analyze_move, genmove, genmove_analyze,
        // for debug
        send_to_leelaz,
    }
    const wrapped_method = f => (...a) => (recover_from_analyze_move(), f(...a))
    each_key_value(exported, (key, func) => exported[key] = wrapped_method(func))

    return exported

}  // end create_leelaz

function unique_identifier() {return new Object}
function hash(str) {
    return sha256sum(str).slice(0, 8)
}
function trim_split(str, reg) {return str.trim().split(reg)}

/////////////////////////////////////////////////
// parser for {lz,kata}-analyze

const top_suggestions = 5

function parse_analyze(s, bturn, komi, katago_p) {
    const split_pattern = /\b(?=^dummy_header|ownership|ownershipStdev|rootInfo)\b/
    const splitted = `dummy_header ${s}`.split(split_pattern)
    const part = aa2hash(splitted.map(str => trim_split(str, /(?<=^\S+)\s+/)))
    const {
        dummy_header: i_str,
        ownership: o_str,
        ownershipStdev: o_stdev_str,
        rootInfo: r_str,
    } = part
    const ownership = ownership_parser(o_str, bturn)
    const ownership_stdev = ownership_parser(o_stdev_str, true)
    const root_info = r_str ? array2hash(trim_split(r_str, /\s+/)) : {}
    cook_analyze(root_info, bturn, katago_p)
    const prefixed_root_info =
          aa2hash(map_key_value(root_info, (k, v) => [`root_${k}`, v]))
    const parser = (z, k) => suggest_parser(z, k, bturn, komi, katago_p)
    const unsorted_suggest =
          i_str.split(/info/).slice(1).map(parser).filter(truep)
    const suggest = sort_by_key(unsorted_suggest, 'order')
    const best_suggest = suggest[0] || {}
    const top_suggest = suggest.slice(0, top_suggestions)
    const visits = sum(suggest.map(h => h.visits))
    const [wsum, top_visits, scsum] =
          top_suggest.map(h => [h.winrate, h.visits, h.score_without_komi || 0])
          .reduce(([ws, vs, scs], [w, v, sc]) => [ws + w * v, vs + v, scs + sc * v],
                  [0, 0, 0])
    const winrate = wsum / top_visits, b_winrate = bturn ? winrate : 100 - winrate
    const score_without_komi = truep(best_suggest.score_without_komi)
          && (scsum / top_visits)
    const add_order = (sort_key, order_key) => sort_by_key(suggest, sort_key)
          .reverse().forEach((h, i) => (h[order_key] = i))
    // winrate is NaN if suggest = []
    add_order('visits', 'visits_order')
    add_order('winrate', 'winrate_order')
    const engine_bturn = bturn
    return {
        ...prefixed_root_info,
        suggest, engine_bturn, visits, b_winrate, score_without_komi,
        ownership, ownership_stdev, komi,
    }
}

// (sample of leelaz output for "lz-analyze 10")
// info move D16 visits 23 winrate 4668 prior 2171 order 0 pv D16 Q16 D4 Q3 R5 R4 Q5 O3 info move D4 visits 22 winrate 4670 prior 2198 order 1 pv D4 Q4 D16 Q17 R15 R16 Q15 O17 info move Q16 visits 21 winrate 4663 prior 2147 order 2 pv Q16 D16 Q4 D3 C5 C4 D5 F3
// (sample with "pass")
// info move pass visits 65 winrate 0 prior 340 order 0 pv pass H4 pass H5 pass G3 pass G1 pass
// (sample of LCB)
// info move D4 visits 171 winrate 4445 prior 1890 lcb 4425 order 0 pv D4 Q16 Q4 D16
// (sample "kata-analyze interval 10 ownership true")
// info move D17 visits 2 utility 0.0280885 winrate 0.487871 scoreMean -0.773097 scoreStdev 32.7263 prior 0.105269 order 0 pv D17 C4 ... pv D17 R16 ownership -0.0261067 -0.0661169 ... 0.203051
function suggest_parser(s, fake_order, bturn, komi, katago_p) {
    // (ex)
    // s = 'move D17 order 0 pv D17 C4 pvVisits 20 14'
    // aa = [['move', 'D17', 'order', '0' ], ['pv', ['D17', 'C4']], ['pvVisits', ['20', '14']]]
    // orig h = {move: 'D17', order: '0', pv: ['D17', 'C4'], pvVisits: ['20', '14']}
    // cooked h = {move: 'D17', order: 0, pv: ['D17', 'C4'], pvVisits: [20, 14]}
    const pat = /\s*(?=(?:pv|pvVisits|pvEdgeVisits|movesOwnership)\b)/  // keys for variable-length fields
    const to_key_value = a => a[0].match(pat) ? [a[0], a.slice(1)] : a
    const aa = trim_split(s, pat).map(z => z.split(/\s+/)).map(to_key_value)
    const h = array2hash([].concat(...aa))
    const if_missing = ([key, val]) => !truep(h[key]) && (h[key] = val)
    const missing_rule = [
        ['order', fake_order],
        ['prior', 1000],
        ['lcb', h.winrate],
    ]
    missing_rule.forEach(if_missing)
    cook_analyze(h, bturn, katago_p)
    h.prior = h.prior / 100
    const turn_sign = bturn ? 1 : -1
    truep(h.scoreMean) &&
        (h.score_without_komi = h.scoreMean * turn_sign + komi)
    return h
}
function cook_analyze(h, bturn, katago_p) {
    const to_percent = str => to_f(str) * (katago_p ? 100 : 1/100)
    const turn_sign = bturn ? 1 : -1
    const cook1 = (f, key) => {
        const z = h[key], val = truep(z) && f(z)
        truep(val) && (h[key] = val)
    }
    const cook = ([f, ...keys]) => keys.forEach(k => cook1(f, k))
    const to_ary = f => a => Array.isArray(a) && a.map(f)
    const to_f_by_turn = z => to_f(z) * turn_sign
    const cooking_rule = [
        [to_i, 'visits', 'order'],
        [to_percent, 'winrate', 'prior', 'lcb'],
        [to_f,
         'scoreMean', 'scoreLead', 'scoreStdev',
         'rawStWrError', 'rawStScoreError', 'rawVarTimeLeft',
        ],
        [to_ary(to_i), 'pvVisits', 'pvEdgeVisits'],
        [to_ary(to_f_by_turn), 'movesOwnership'],
    ]
    cooking_rule.forEach(cook)
}
function ownership_parser(s, bturn) {
    return s && trim_split(s, /\s+/).map(z => to_f(z) * (bturn ? 1 : -1))
}

/////////////////////////////////////////////////
// exports

module.exports = {create_leelaz, parse_analyze, engine_log_conf}
