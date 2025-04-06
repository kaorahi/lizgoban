'use strict'

const {make_mcts} = require('./mcts.js')

const M = {}  // to call main functions

/////////////////////////////////////////////////
// exports

module.exports = functions_in_main => {
    merge(M, functions_in_main)
    return {
        set_mcts_window_conf,
        resume_mcts, rewind_mcts, stop_mcts, toggle_mcts_run, play_from_mcts,
        set_mcts_max_nodes, plot_mcts_force_actual,
        play_by_mcts,
    }
}

/////////////////////////////////////////////////
// exported actions

function set_mcts_window_conf(id, conf) {
    const state = mcts_state[id]
    state && (state.window_conf = conf)
}

function resume_mcts(visits, id, hide_playout_p) {
    // get max_visits before stopped by switch_to_mcts.
    const max_visits = mcts_state[id]?.mcts.max_visits
    const {mcts} = switch_to_mcts(id) || {}; if (!mcts) {return}
    const to = truep(visits) ? max_visits + visits : mcts.node_at_step.length
    plot_mcts(to - mcts.root.visits, id, hide_playout_p)
}

function rewind_mcts(rewind_visits, id) {
    stop_mcts()
    // need to update board_size()
    const state = switch_to_mcts(id); if (!state) {return}
    const old_visits = state.mcts.root.visits
    const visits = rewind_visits ? old_visits - rewind_visits : 1
    const on_playout = choice => on_playout_common(choice, id)
    const hide_playout_p = (rewind_visits > 1) && 'pv'
    update_running(id, true)
    state.mcts.rewind()
    show_mcts(clip(visits, 1), on_playout, id, hide_playout_p)
}

function stop_mcts() {
    Object.values(mcts_state).forEach(s => s.mcts?.stop())
}

function toggle_mcts_run(visits, id) {
    const running = mcts_state[id]?.mcts?.is_running()
    running ? stop_mcts() : resume_mcts(visits, id)
}

async function play_from_mcts(moves, id) {
    const state = switch_to_mcts(id); if (!state) {return}
    const new_mcts = await state.mcts.copy_subtree_async(moves)
    // can't happen
    if (!new_mcts) {
        toast(null, 'Failed to copy subtree!')
        stop_mcts(); delete mcts_state[new_id]
        return
    }
    if (!switch_to_mcts(id)) {return}  // for safety after await
    // Need "mimic" here! (not just "play()")
    // because "play" doesn't update R.stones, that is used for checking
    // illegal moves on existing stones in "play".
    moves.forEach((move, count) => M.mimic('play', move))
    const max_visits = state.mcts.max_visits
    const new_id = make_mcts_state()
    const new_state = mcts_state[new_id]
    new_state.mcts = merge(new_mcts, {future_moves: R.future_moves})
    resume_mcts(null, new_id, 'candidates')
    resume_to_previous_visits(new_id)
}

function plot_mcts_force_actual(val, max_visits) {
    const id = make_mcts_state()
    const state = mcts_state[id]
    initialize_mcts(state)
    state.mcts.params.force_actual = val
    switch_to_mcts(id)
    plot_mcts(max_visits, id)
    return id
}

function play_by_mcts(auto_play_sec, play_func) {
    const id = without_auto_focus(() => plot_mcts_force_actual(0.0, 99999))
    const play_found = async () => {
        if (!M.auto_playing()) {return}
        const state = switch_to_mcts(id) || {}, {mcts} = state; if (!mcts) {return}
        stop_mcts()
        await state.mcts.wait_for_all_nn_calls()
        const cs = Object.values(mcts.root.children), {lcb} = mcts
        const best_child = min_by(Object.values(mcts.root.children), c => - lcb(c))
        const {move, winrate, score, visits} = best_child
        const comment = `by MCTS (winrate=${winrate.toFixed(2)}, score=${score.toFixed(2)}, visits=${visits})`
        close_other_mcts_plots(id)
        play_func(move, comment)
        M.auto_playing() && M.resume(); M.update_all()
    }
    setTimeout(play_found, auto_play_sec * 1000)
}

/////////////////////////////////////////////////
// MCTS state objects

let mcts_next_id = 1
let mcts_state = {}, closed_mcts = [], current_mcts_id = null
const max_closed_mcts = 10

function make_mcts_state() {
    const id = to_s(mcts_next_id++), game = M.get_game()
    mcts_state[id] = {
        id,  // redundant item for conveniene
        game_id: game.id,
        move_count: game.move_count,
        movenum: game.movenum(),
        last_move: game.movenum() > 0 && game.ref_current().move,
        board_size: game.board_size,
        bturn: game.is_bturn(),
        last_playout: [],
        max_displayed_nodes: M.get_stored('mcts_max_displayed_nodes'),
        // mcts,
        // svg,
        // window_conf,
    }
    return id
}

function initialize_mcts(state) {
    !state.mcts && (state.mcts = make_mcts(AI.peek_kata_raw_nn, R.future_moves))
}

function mcts_total_trees() {return Object.keys(mcts_state).length}

/////////////////////////////////////////////////
// MCTS trees

// switch

function switch_to_mcts(id) {
    const state = mcts_state[id]
    const {mcts, game_id, move_count} = state || {}
    if (!mcts) {toast(null, 'No MCTS'); return null}
    current_mcts_id = id
    stop_mcts()
    M.switch_to_game_id(game_id)
    if (M.get_game().id !== game_id) {toast(null, 'No game'); return null}
    M.goto_move_count(move_count)
    M.update_all()
    return state
}

function next_mcts_plot(id, delta) {switch_mcts_plot(next_mcts_id(id, delta))}
function switch_mcts_plot(id) {switch_to_mcts(id); update_mcts_plot(id)}

function next_mcts_id(id, delta) {
    const ids = sort_by_tail_number(Object.keys(mcts_state))
    const k = ids.indexOf(id), n = ids.length
    return ids[(k + delta + n) % n]
}

// close

function close_mcts_plot(id) {
    const new_id = next_mcts_id(id, -1), all_closed_p = (new_id === id)
    close_mcts_plot_internal(id)
    all_closed_p ? close_all_mcts_plot() : switch_mcts_plot(new_id)
}

function close_all_mcts_plot() {
    mcts_window && (mcts_window.close(), current_mcts_id = null)
}

function close_other_mcts_plots(id) {
    const ids = Object.keys(mcts_state).filter(k => k !== id)
    close_mcts_plot_internal(...ids)
    update_mcts_menu(id)
}

function close_mcts_plot_internal(...ids) {
    stop_mcts()
    const close = k => {
        const s = mcts_state[k]; delete mcts_state[k]; return [k, s]
    }
    closed_mcts.unshift(...ids.map(close).reverse())
    // never delete the latest ids immediately
    closed_mcts.splice(Math.max(max_closed_mcts, ids.length))
}

function unclose_mcts_plot(id_state) {
    if (empty(closed_mcts)) {toast(null, 'No record.'); return}
    const [id, state] = id_state || closed_mcts.shift()
    closed_mcts = closed_mcts.filter(([i, _]) => i !== id)
    mcts_state[id] = state
    switch_mcts_plot(id)
}

// window

let mcts_window, mcts_window_last_id

function get_mcts_window(id) {
    const changed = (id !== mcts_window_last_id)
    mcts_window_last_id = id
    mcts_window || (mcts_window = create_mcts_window(), mcts_window.focus())
    changed && update_mcts_menu(id)
    return mcts_window
}

function create_mcts_window() {
    const file_name = 'mcts/mcts_diagram.html', relative_size = 0.9
    const {width, height} = M.electron.screen.getPrimaryDisplay().workAreaSize
    const opt = {
        width: width * relative_size,
        height: height * relative_size,
        webPreferences: M.get_webPreferences(),
    }
    const win = M.get_new_window(file_name, opt)
    win.on('closed', e => {
        mcts_window = null; mcts_window_last_id = null
        stop_mcts(); mcts_state = {}
    })
    return win
}

// misc

function mcts_tree_menu_label(id, state) {
    return `Tree${id}: move ${state.movenum} (${state.last_move || 'init'}) ${state.mcts.root.visits} visits`
}

/////////////////////////////////////////////////
// plot MCTS tree

// focus control

let auto_focus_p = true
function without_auto_focus(proc, ...args) {
    auto_focus_p = false; const ret = proc(...args); auto_focus_p = true; return ret
}

// plot

function plot_mcts(max_visits, id, hide_playout_p) {
    M.pause()
    !truep(id) && (id = make_mcts_state())
    const state = mcts_state[id]
    const update_coef = 1.05
    let last_updated = 0
    const on_playout = async (choice, self) => {
        on_playout_common(choice, id)
        if (self.is_using_backup()) {return}
        const {visits} = self.root
        const max_interval =
              Math.sqrt(visits * state.max_displayed_nodes) * (update_coef - 1)
        const next_update =
              Math.min(last_updated * update_coef, last_updated + max_interval)
        if (visits >= next_update) {
            last_updated = visits
            await update_mcts_plot(id, {moves: mcts_state[id]?.last_playout})
        }
    }
    auto_focus_p && mcts_window?.focus()
    show_mcts(true_or(max_visits, previous_mcts_max_visits), on_playout, id, hide_playout_p)
}

function show_mcts(visits, on_playout, id, hide_playout_p) {
    const state = mcts_state[id]
    const on_finish = mcts => {
        const pv_p = (hide_playout_p === 'pv') ||
              (hide_playout_p === undefined && visits > 1)
        // caution: "moves" must be array or null.
        // Otherwise, error occurs in seq?.forEach.
        const moves = pv_p ? mcts.pv() :
              hide_playout_p ? null : state.last_playout
        const children = (hide_playout_p === 'candidates') ?
              mcts.candidate_moves() : null
        const board_info = {moves, children, pv_p}
        update_mcts_plot(id, board_info)
    }
    stop_mcts()
    initialize_mcts(state)
    state.mcts.search(visits, {on_playout, on_finish})
    update_mcts_menu(id)
}

// util

function on_playout_common(choice, id) {
    const state = mcts_state[id]
    state && (state.last_playout = choice.moves)
}

function resume_to_previous_visits(id) {
    const state = switch_to_mcts(id); if (!state) {return}
    const {visits} = state.mcts.root
    const delta = previous_mcts_max_visits - visits
    delta > 0 && resume_mcts(delta, id, 'candidates')
}

function update_running(id, is_running) {
    const {mcts} = mcts_state[id]; if (!mcts) {return}
    const {max_visits} = mcts, {visits} = mcts.root
    const running = (is_running !== undefined) ? is_running : visits < max_visits
    get_mcts_window(id).webContents.send('running', running)
}

// max displayed nodes

function set_mcts_max_nodes(id, val) {
    const state = mcts_state[id]
    if (!state) {toast(null, 'No MCTS plot'); return}
    state.max_displayed_nodes = val
    M.set_stored('mcts_max_displayed_nodes', val)
    update_mcts_plot(id)
    toast(id, `Max: ${val} nodes`)
}

function multiply_mcts_max_nodes(id, mag) {
    const min = 25, max = 12800
    const state = mcts_state[id]
    if (!state) {toast(null, 'No MCTS plot'); return}
    const {max_displayed_nodes} = state
    const new_max = clip(Math.round(max_displayed_nodes * mag), min, max)
    set_mcts_max_nodes(id, new_max)
}

/////////////////////////////////////////////////
// low level communication with renderer

let previous_mcts_max_visits = 5000

async function update_mcts_plot(id, board_info) {
    current_mcts_id === null && (current_mcts_id = id)
    if (id !== current_mcts_id) {return}  // obsolete request
    const state = mcts_state[id]; if (!state) {return}
    const {mcts, last_move, board_size, bturn} = state
    state.svg = await mcts.svg(last_move, board_size, bturn, state.max_displayed_nodes)
    !state.board_image_dataURL &&
        (state.board_image_dataURL = await M.generate_board_image_dataURL(0.4))
    const win = get_mcts_window(id)
    if (id !== current_mcts_id) {return}  // obsolete request
    win.webContents.send('diagram_params', mcts_diagram_params(id, board_info || {}))
    update_mcts_menu(id)
    previous_mcts_max_visits = mcts.max_visits
}

function mcts_diagram_params(id, board_info) {
    const state = mcts_state[id]
    const {mcts, svg, board_image_dataURL, movenum, last_move, window_conf, max_displayed_nodes, board_size, bturn} = state
    const ready = mcts && svg; if (!ready) {return {}}
    const {max_visits} = mcts, {visits} = mcts.root
    const max_or_cached_visits = Math.max(max_visits, mcts.node_at_step.length)
    const to_uri = (data, type) =>
          `data:${type};charset=utf-8,` + encodeURIComponent(data)
    const running = visits < max_visits
    const mvisits = visits < max_or_cached_visits ? `/${max_or_cached_visits}` : ''
    const nnodes = (max_displayed_nodes < visits) ? `${max_displayed_nodes} nodes, ` : ''
    const title = `Search Tree (${nnodes}${visits}${mvisits} visits) from move ${movenum} = ${last_move || 'Start'} [Press "i"/"o" to zoom, "p" to reset.]`
    const download_filename =
          `move${movenum}_${last_move || 'init'}_${visits}visits`
    const download_uri = to_uri(svg, 'image/svg+xml')
    const sgf_uri = to_uri(M.get_game().to_sgf(), 'text/plain')
    const default_note = get_default_mcts_note(id)
    const bsize = board_size
    return {id, running, title, svg_string: svg, download_filename, download_uri, sgf_uri, board_image_dataURL, default_note, bsize, bturn, board_info, window_conf, max_displayed_nodes}
}

function get_default_mcts_note(id) {
    const state = mcts_state[id], {force_actual} = state.mcts.params
    const common_str = "Generated by naive MCTS + KataGo's neural network."
    const force_str = (force_actual > 0 && !empty(R.future_moves)) ?
          ` ${Math.round(force_actual * 100)}% of visits are allocated to moves that were actually played in the game being analyzed.` : ''
    const names = `B: ${R.player_black || '???'}, W: ${R.player_white || '???'}`
    const game = M.get_game(), moves = `moves: ${game.movenum()} (${game.len() - game.init_len})`
    return `${names}, ${moves}\n${R.weight_info || ''}\n(${common_str}${force_str})\n`
}

/////////////////////////////////////////////////
// menu

function update_mcts_menu(id) {
    const state = mcts_state[id]; if (!state) {return}
    const {mcts} = state, win = mcts_window; if (!win) {return}
    const pause_label = (mcts && mcts.is_running()) ? '■' : '▶'
    const save_page = async () => {
        // sample: 250123T012345
        const dtime = (new Date()).toJSON().replace(/(^20)|[-:]|([.].*)/g, '')
        const {filePath} = await M.dialog.showSaveDialog(win, {
            title: 'Save page',
            defaultPath: `search_diagram_${dtime}.html`,
            filters: [{name: 'HTML', extensions: ['html']}]
        })
        if (!filePath) {return}
        const wc = win.webContents
        await wc.executeJavaScript('setup_before_save_page()')
        await wc.savePage(filePath, 'HTMLComplete')
        await wc.executeJavaScript(`restore_after_save_page()`)
    }
    const resume_item = (arg, verbose) => {
        const [visits, accelerator] = Array.isArray(arg) ? arg : [arg, null]
        const click = () => resume_mcts(visits, id)
        const label = `+${visits}` + (verbose ? ` visits` : '')
        return {label, accelerator, click}
    }
    const menu = [
        {label: 'File', submenu: [
            {label: 'Save', click: save_page},
            {label: 'Close', accelerator: 'CmdOrCtrl+W',
             click: () => close_mcts_plot(id)},
            {label: 'Reopen', accelerator: 'CmdOrCtrl+Z',
             click: () => unclose_mcts_plot()},
            {type: 'separator'},
            {label: 'Close all', accelerator: 'CmdOrCtrl+Shift+W',
             click: () => close_all_mcts_plot()},
        ]},
        {label: 'View', submenu: [
            {label: 'More nodes', accelerator: '9',
             click: () => multiply_mcts_max_nodes(id, 2)},
            {label: 'Less nodes', accelerator: '8',
             click: () => multiply_mcts_max_nodes(id, 1/2)},
            {label: 'Reset max nodes', accelerator: '0',
             click: () => set_mcts_max_nodes(id, 200)},
        ]},
        {label: '|<', click: () => rewind_mcts(null, id)},
        {label: '<<<', click: () => rewind_mcts(1000, id)},
        {label: ' <<', click: () => rewind_mcts(100, id)},
        {label: ' <', click: () => rewind_mcts(10, id)},
        {label: '-', click: () => rewind_mcts(1, id)},
        {label: `${pause_label}`, click: () => toggle_mcts_run(5000, id)},
        {label: '+', click: () => resume_mcts(1, id)},
        {label: '> ', click: () => resume_mcts(10, id)},
        {label: '>> ', click: () => resume_mcts(100, id)},
        {label: '>>>', click: () => resume_mcts(1000, id)},
        {label: '>|', click: () => resume_mcts(null, id)},
        {label: `[Tree${id}]/${mcts_total_trees()}`,
         submenu: [
            {label: `Previous tree`, accelerator: '[',
             click: () => next_mcts_plot(id, -1)},
            {label: 'Next tree', accelerator: ']',
             click: () => next_mcts_plot(id, +1)},
            {type: 'separator'},
            {label: `Close others (${mcts_total_trees() - 1})`,
             submenu: [{label: 'Close!', click: () => close_other_mcts_plots(id)}]},
            {type: 'separator'},
            ...sort_by_tail_number(Object.keys(mcts_state)).map(new_id => {
                const s = mcts_state[new_id]
                return {
                    label: `Tree${new_id}: move ${s.movenum} (${s.last_move || 'init'}) ${s.mcts.root.visits} visits`,
                    enabled: id !== new_id,
                    click: () => switch_mcts_plot(new_id),
                }
            }),
            {type: 'separator'},
            {label: `Closed (${closed_mcts.length})`,
             submenu: closed_mcts.map(id_state =>
                 ({label: mcts_tree_menu_label(...id_state),
                   click: () => unclose_mcts_plot(id_state)}))},
        ]},
        {label: 'Help', submenu: [
            {label: 'More Shortcut Keys', click: () => M.electron.dialog.showMessageBox(win, {
                type: 'info', title: 'Help', buttons: ["OK"],
                message: '".>)" = +n visits\n",<(" = -n visits\nSPC = Run/Stop\n"^" = Rewind\n"$" = Last visit (also TAB)',
            })},
        ]},
        M.get_debug_menu_p() && {label: 'Debug', submenu: [
            {role: 'zoomIn'}, {role: 'zoomOut'}, {role: 'resetZoom'},
            {type: 'separator'},
            {role: 'toggleDevTools'},
        ]},
    ].filter(truep)
    win.setMenu(M.electron.Menu.buildFromTemplate(menu))
}

function sort_by_tail_number(ary) {
    return sort_by(ary, s => to_i(s.match(/[0-9]+$/)[0]))
}

/////////////////////////////////////////////////
// util

function toast(id, message, millisec) {
    const win = truep(id) ? get_mcts_window(id) : mcts_window
    if (truep(id) && (id !== current_mcts_id)) {return}  // obsolete request
    win.webContents.send('toast', message, millisec)
}
