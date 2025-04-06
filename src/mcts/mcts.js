'use strict'

/////////////////////////////////////////////////
// tree

function make_mcts(peek_kata_raw_nn, future_moves) {
    // neural network
    const max_nn_wait_count = 1
    let nn_promises = []
    const call_nn = moves => {
        const cont = res => nn_output => {
            const k = nn_promises.indexOf(p); k >= 0 && nn_promises.splice(k, 1)
            return res(nn_output)
        }
        const p = new Promise((res, rej) => self.peek_kata_raw_nn(moves, cont(res)))
        nn_promises.push(p); return p
    }
    const wait_for_all_nn_calls = async () => {
        let c = 0
        while (!empty(nn_promises)) {
            if (too_long(c++)) {const msg = 'FAILED: wait_for_all_nn_calls'; console.log(msg); throw msg}
            await Promise.all(nn_promises)
        }
    }
    // playout
    const repeat_playout = () => {
        repeat_playout_using_backup(self.on_playout)
        while (should_continue()) {playout()}
        is_finished() && self.on_finish(self)
    }
    const should_continue = () =>
          self.root.visits + nn_promises.length < self.max_visits &&
          nn_promises.length < max_nn_wait_count &&
          !is_waiting(self.root)
    const is_finished = () => (self.root.visits >= self.max_visits)
    const get_moves_ancestors = node => {
        let moves = [], ancestors = []
        while (node.parent) {
            if (too_long(ancestors.length)) {const msg = 'FAILED: get_moves_ancestors'; console.log(msg); throw msg}
            moves.unshift(node.move); ancestors.unshift(node = node.parent)
        }
        return {moves, ancestors}
    }
    const repeat_playout_using_backup = on_playout => {
        while (self.is_using_backup() && should_continue()) {
            const leaf = self.node_at_step[self.root.visits]
            const {moves, ancestors} = get_moves_ancestors(leaf)
            merge(leaf, {visits: 1, original_visits: 0, winrate: leaf.nn_winrate, score: leaf.nn_score})
            merge(leaf, {square_winrate: leaf.winrate**2})
            update_original_visits(ancestors, leaf, self.future_moves, self.params)
            update_ancestors(ancestors)
            on_playout({leaf, moves, ancestors}, self)
        }
    }
    const playout = async () => {
        const choice = playout_down(), {leaf, moves, ancestors} = choice
        const nn_output = await call_nn(moves)
        playout_up({leaf, ancestors, nn_output})
        await self.on_playout(choice, self)
        repeat_playout()
    }
    const playout_down = () => {
        const choice = select_leaf(self.root, self.future_moves, self.params); if (!choice) {return}
        const {leaf, moves, ancestors} = choice
        const step = self.root.visits
        leaf.step = step; self.node_at_step[step] = leaf
        update_original_visits(ancestors, leaf, self.future_moves, self.params)
        set_waiting(leaf)
        return choice
    }
    const playout_up = ({leaf, ancestors, nn_output}) => {
        expand_leaf(leaf, nn_output)
        update_ancestors(ancestors)
        unset_waiting(leaf)
    }
    const default_on_playout = async ({leaf, moves, ancestors}, self) => {
        const message =
              `(v=${self.root.visits}) Searching [${moves}]: w=${leaf.winrate}`
        console.log(message)
    }
    const root = make_mcts_node(null, null)
    // cached SVG
    let cached_svg, cached_svg_visits, cached_svg_max_nodes
    const set_cached_svg = (svg, max_nodes) => {
        cached_svg = svg; cached_svg_visits = self.root.visits
        cached_svg_max_nodes = max_nodes
    }
    const get_cached_svg = max_nodes =>
          (cached_svg_visits === self.root.visits) &&
          (cached_svg_max_nodes === max_nodes) && cached_svg
    // object
    const self = {
        root,
        params: {
            force_actual: 0.0,
            c_puct: 1.0,
            value_of_unevaluated_node: 0.0,
        },
        future_moves: [...future_moves],  // shallow copy
        max_visits: 0,
        node_at_step: [],
        on_playout: default_on_playout,
        on_finish: do_nothing,
        search: (visits, {on_playout, on_finish}) => {
            if (!visits) {return}
            self.max_visits += visits
            on_playout && (self.on_playout = on_playout)
            on_finish && (self.on_finish = on_finish)
            repeat_playout()
        },
        stop: () => {self.max_visits = self.root.visits},
        is_running: () => !is_finished(),
        svg: async (last_move, board_size, bturn, max_nodes) => await svg_from_mcts(self, last_move, board_size, bturn, self.future_moves, max_nodes),
        rewind: () => {self.max_visits = self.root.visits = self.root.original_visits = 0},
        // is_using_backup: () => false,
        is_using_backup: () => self.root.visits < self.node_at_step.length,
        wait_for_all_nn_calls,
        copy_subtree_async: async moves => {
            self.stop(); await wait_for_all_nn_calls()
            return copy_subtree(self, moves)
        },
        pv: () => pv_from(self.root, self.root.visits),
        candidate_moves: () => sort_by(visible_child_nodes(self.root, self.root.visits),
                                       c => c.step).map(c => c.move),
        get_cached_svg,
        set_cached_svg,
        lcb,
        peek_kata_raw_nn,
    }
    return self
}

/////////////////////////////////////////////////
// rewind

function imitate_peek_kata_raw_nn(node) {
    const bsize = board_size()
    const whiteLoss = [node.nn_winrate]
    const whiteWin = [1.0 - whiteLoss[0]]
    const noResult = [0.0]
    const whiteLead = [- node.nn_score]
    const all_moves = seq(bsize).flatMap(i => seq(bsize).map(j => idx2move(i, j)))
    const policy = all_moves.map(move => node.policy[move] || NaN)
    const policyPass = [node.policy[pass_command]]
    const nn_output = {
        whiteWin, whiteLoss, noResult, whiteLead, policy, policyPass,
    }
    return nn_output
}

/////////////////////////////////////////////////
// tree reuse

function copy_subtree(mcts, moves) {
    const {root} = mcts
    const node = moves.reduce((n, move) => n.children[move], root)
    const clone = clone_except_keys_and_functions(mcts, 'root')
    const new_mcts = merge(make_mcts(mcts.peek_kata_raw_nn, []), clone)
    new_mcts.root = clone_except_keys_and_functions(node, 'parent', 'move', 'order')
    new_mcts.rewind()
    adjust_steps(new_mcts)
    // can't happen if "await wait_for_all_nn_calls()" is called in advance.
    const failed = flatten_tree(root).find(n => !is_expanded(n))
    if (failed) {return null}
    return new_mcts
}

function adjust_steps(mcts) {
    const node_at_step = sort_by(flatten_tree(mcts.root), node => node.step)
    node_at_step.forEach((node, step) => merge(node, {step}))
    merge(mcts, {node_at_step})
}

function flatten_tree(root) {
    const nodes = []
    const iter = node => {
        nodes.push(node)
        const {children} = node
        children && Object.values(children).forEach(iter)
    }
    iter(root)
    return nodes
}

function clone_except_keys_and_functions(orig, ...keys) {
    const func_keys = Object.keys(orig).filter(key => functionp(orig[key]))
    const skipped_keys = [...keys, ...func_keys]
    const saved = pick_keys(orig, ...skipped_keys)
    skipped_keys.forEach(key => delete orig[key])
    const clone = structuredClone(orig)
    merge(orig, saved)
    return clone
}

/////////////////////////////////////////////////
// node

function make_mcts_node(parent, move) {
    const self = {
        visits: 0,
        original_visits: 0,
        parent,
        move,
        // children: {}, // undefined = "unexpanded", false = "waiting for expansion"
        // policy: {},
        // winrate: 0.5,
        // square_winrate: 0.25,
        // score: 0.0,
        // step: 0,
        // order: 0,
        // is_dummy: false,
    }
    return self
}

function get_child(node, move) {
    return get_or_make(node.children, move, () => make_mcts_node(node, move))
}

// expansion state
function is_expanded(node) {return !!node.children}
function is_waiting(node) {return node.children === false}
function set_waiting(node) {node.children = false}
function unset_waiting(node) {}  // do nothing

// exclude future nodes
function is_visible(node, visits) {return node.step < visits}
function visible_child_nodes(node, visits) {
    const {children} = node; if (!children) {return []}
    const child_nodes = Object.values(children)
    return child_nodes.filter(c => is_visible(c, visits))
}

function lcb(node) {
    // (cf.) leela-zero's UCTNode::get_eval_lcb in UCTNode.cpp
    const {winrate, square_winrate, original_visits} = node, ok = (original_visits > 1)
    if (!ok) {return true_or(original_visits, 0) - 1e6}
    const std = Math.sqrt(square_winrate - winrate**2)
    return winrate - std / Math.sqrt(original_visits - 1)  // rough version
}

/////////////////////////////////////////////////
// playout

function select_leaf(root, future_moves, params) {
    let node = root, bturn = is_bturn(), moves = [], ancestors = []
    future_moves = [...future_moves]  // shallow copy
    while (is_expanded(node)) {
        if (too_long(ancestors.length)) {const msg = 'FAILED: select_leaf'; console.log(msg); throw msg}
        const actual_move = future_moves.shift()
        const [move, original_p] = select_move(node, bturn, actual_move, params)
        if (!move) {return null}
        moves.push(move); ancestors.push(node)
        node = get_child(node, move); bturn = !bturn
        move !== actual_move && (future_moves = [])
    }
    return {leaf: node, moves, ancestors}
}

// This is also used in repeat_playout_using_backup.
function update_original_visits(ancestors, leaf, future_moves, params) {
    //const descendant = [...ancestors, leaf].slice(1)
    const descendant = [...ancestors, leaf]
    const root = descendant.shift()
    root.original_visits = root.visits  // highlight root node in marked_node_str
    let maybe = true
    descendant.forEach((child, k) => {
        const {move} = child
        maybe &&= (move === future_moves[k])
        const forced = maybe &&
              force_actual_move_p(child.parent, move, params, root.visits)
        !forced && child.original_visits++
    })
}

function force_actual_move_p(node, actual_move, params, root_visits) {
    if (!actual_move) {return false}
    const margin = 2
    const required_visits = (node.visits - margin) * params.force_actual
    const child = node.children[actual_move]
    const child_visits = true_or(child && is_visible(child, root_visits) && child.visits, 0)
    return child_visits < required_visits
}

function select_move(node, bturn, actual_move, params) {
    // child
    const dummy_child = {visits: 0, original_visits: 0, is_dummy: true}
    const child_for = move => node.children[move] || dummy_child
    // candidates
    const moves = Object.keys(node.policy)
    const selectable = move => !is_waiting(child_for(move))
    const selectable_moves = moves.filter(selectable)
    if (empty(selectable_moves)) {return [null, null]}
    // force actual move
    if (force_actual_move_p(node, actual_move, params, Infinity)) {
        return [actual_move, false]
    }
    // priority
    const total_original_visits = sum(moves.map(m => node.children[m]?.original_visits || 0))
    const c = params.c_puct * Math.sqrt(total_original_visits + 1)
    const priority = (policy, value, visits) => value + c * policy / (1 + visits)
    // criterion
    const for_current_player = winrate => bturn ? winrate : 1 - winrate
    const negative_priority = move => {
        const {original_visits, winrate, is_dummy} = child_for(move)
        const value = is_dummy ? params.value_of_unevaluated_node : for_current_player(winrate)
        const policy = node.policy[move]
        const ret = - priority(policy, value, original_visits)
        return ret
    }
    // select
    const selected_move = min_by(selectable_moves, negative_priority)
    return [selected_move, true]
}

function expand_leaf(node, nn_output) {
    const {whiteWin, whiteLoss, noResult, whiteLead, policyPass} = nn_output
    // policy
    const move_policy_pair = (p, k) => !isNaN(p) && [to_move(k), p]
    const policy = aa2hash(nn_output.policy.map(move_policy_pair).filter(truep))
    policy[pass_command] = policyPass[0]
    // winrate & score (for black)
    const nn_winrate = whiteLoss[0] + 0.5 * noResult[0], nn_score = - whiteLead[0]
    const winrate = nn_winrate, square_winrate = winrate**2, score = nn_score
    // expand
    merge(node, {policy, nn_winrate, nn_score, winrate, square_winrate, score, children: {}})
    node.visits++
}

// (sample of nn_output)
// LizGoban> AI.peek_kata_raw_nn(["C4", "D5"], console.log)
// 
//   whiteWin: [ 0.531553 ],
//   whiteLoss: [ 0.468289 ],
//   noResult: [ 0.000159 ],
//   whiteLead: [ 0.568 ],
//   policy: [
//     0.000009, 0.000008, 0.000011, 0.000008, 0.000011, 0.000009,
//     ...
//          NaN, 0.000264, 0.000129, 0.000096, 0.000079, 0.000085,
//     ...
//   ],
//   policyPass: [ 0 ],

function update_ancestors(ancestors) {
    if (empty(ancestors)) {return}
    const root_visits = ancestors[0].visits + 1
    const keys = ['winrate', 'square_winrate', 'score']
    const update = node => {
        const cs = visible_child_nodes(node, root_visits)
        const total_visits = 1 + sum(cs.map(child => child.original_visits))  // +1 for self
        node.visits++
        const extended_node = {...node, nn_square_winrate: node.nn_winrate**2}
        keys.forEach(key => {
            const s = sum(cs.map(child => child[key] * child.original_visits))
            node[key] = (extended_node[`nn_${key}`] + s) / total_visits
        })
    }
    ancestors.toReversed().forEach(update)
}

/////////////////////////////////////////////////
// util

function get_or_make(h, key, f, ...args) {return h[key] || (h[key] = f(...args))}

function to_move(k) {
    const bsize = board_size()
    return idx2move(Math.floor(k / bsize), k % bsize)
}

function too_long(val) {return val > 3 * board_size()**2}

/////////////////////////////////////////////////
// rendering

let previous_dot_visits = 1

function is_major_node(node, visits_threshold) {
    return !(node.visits < visits_threshold)  // visits can be undefined
}

function dot_from_mcts(mcts, last_move, board_size, given_bturn, future_moves, max_nodes) {
    const {root} = mcts, root_visits = root.visits
    const new_visits = Math.abs(root_visits - previous_dot_visits)
    const mark_fresh_p = new_visits <= root_visits * 0.5
    previous_dot_visits = root_visits
    const fresh = node => mark_fresh_p && (node.step >= root_visits - new_visits)
    const visible = node => is_visible(node, root_visits)
    const flat_nodes = flatten_tree(root).filter(visible)
    const visits_threshold = max_nodes < flat_nodes.length ?
          // -1 for root
          - num_sort(flat_nodes.map(n => - n.visits))[max_nodes - 1] : 0
    const is_major = node => is_major_node(node, visits_threshold)
    const header = 'graph {', footer = '}'
    let body = [], id = 0
    const iter = (node, move, bturn, policy, move_history, order_history, onward_moves) => {
        const node_id = `node${id++}`
        if (!is_major(node)) {return null}
        if (!is_expanded(node)) {return node_id}
        const actual_move = onward_moves[0]
        const is_actual = move === actual_move || node === root
        const next_onward_moves = is_actual ? onward_moves.slice(1) : []
        const node_prop = dot_node_prop(node, move, bturn, policy, move_history, root_visits, visits_threshold)
        const node_str = `${node_id} [${node_prop}];`
        body.push(marked_node_str(node, node_id, node_str, fresh(node), is_actual))
        const criterion = f => ([next_move, child]) => f(child)
        const by_step = child => child.step
        const by_visits = child => - child.original_visits
        const move_child_pairs =
              visible_child_nodes(node, root_visits).map(c => [c.move, c])
        const pairs_by_step = sort_by(move_child_pairs, criterion(by_step))
        const pairs_by_visits = sort_by(move_child_pairs, criterion(by_visits))
        pairs_by_visits.forEach(([_, child], k) => {child.order = k})
        const sign = bturn ? +1 : -1
        const values = pairs_by_visits.map(([_, child]) => sign * child.winrate)
        const policies = pairs_by_visits.map(([move, _]) => node.policy[move])
        const regret = a => Math.max(...a) - a[0]
        const [value_regret, policy_regret] = [values, policies].map(regret)
        pairs_by_step.forEach(([next_move, child]) => {
            const child_move_history = [...move_history, next_move]
            const child_order_history = [...order_history, child.order]
            const is_child_pv = child_order_history.every(ord => ord === 0)
            const child_id = iter(child, next_move, !bturn, node.policy[next_move], child_move_history, child_order_history, next_onward_moves)
            if (!truep(child_id)) {return}
            const edge_prop = dot_edge_prop({node, next_move, child, is_child_pv, root_visits, value_regret, policy_regret})
            body.push(`${node_id} -- ${child_id} [${edge_prop}];`)
            const grandchildren = visible_child_nodes(child, root_visits)
            const pv_end_p = is_child_pv && empty(grandchildren.filter(is_major))
            if (pv_end_p) {
                const mag = (root_visits < 10) ? 0.3 :
                      (root_visits < 100) ? 0.7 : 1.0
                const w = 3 * mag, h = 1.5 * mag
                body.push(`PV [label="",height=${h},width=${w},shape=triangle,style=filled,fillcolor=black,tooltip="PV: ${child_move_history}"]`)
                body.push(`${child_id} -- PV [style=invisible]`)
            }
        })
        return node_id
    }
    iter(root, last_move, given_bturn, null, [], [],
         [null, ...future_moves])
    return [header, ...body, footer].join(' ')
}

function marked_node_str(node, node_id, node_str, is_fresh, is_actual) {
    const is_root = !node.parent
    const ov = true_or(node.original_visits, 0), v = true_or(node.visits, 0)
    const r = is_root ? 1 : clip(((ov + 1) / (v + 1)), 0, 1)
    const c0 = 0.6, c1 = 0.3, c = Math.round(((1 - r) * c0 + r * c1) * 255)
    const color = to_hex([c, c, 0])
    const props = 'style=solid; color=black; penwidth=5; label="";'
    const props_for_actual = `style=filled; color="${color}"; penwidth=30; label="";`
    const subgraph = p => `subgraph cluster_${node_id} {${p} ${node_str}}`
    return is_actual ? subgraph(props_for_actual) :
        is_fresh ? subgraph(props) : node_str
}

function dot_edge_prop({node, next_move, child, is_child_pv, root_visits, value_regret, policy_regret}) {
    const {policy} = node, {step, order} = child, p = policy[next_move]
    const is_v_regret = order === 0 && value_regret > 0.01
    const is_p_regret = order === 0 && policy_regret > 0.01
    const v_str = is_v_regret ? `\\n-${Math.round(value_regret * 100)}pt` : ''
    const p_str = is_p_regret ? `\\np=${p.toFixed(2)}` : ''
    const penwidth = Math.max(0.5, p * 10)
    const label_space = penwidth > 3 ? '  ' : ' '
    const label = `"${label_space}${step}${p_str}${v_str}"`
    const fontsize = is_child_pv ? 24 : 12
    const fontcolor = (is_child_pv || is_v_regret || is_p_regret) ? 'black' : '"#cccccc"'
    const oldness = step / root_visits
    const whiteness = 0.9
    const c = Math.round((1 - oldness * whiteness) * 255).toString(16).padStart(2, '0')
    const color = is_child_pv ? `"#ff0000${c}"` : `"#000000${c}"`
    // const c = Math.round(oldness * whiteness * 255).toString(16).padStart(2, '0')
    // const color = order === 0 ? `"#$ff{c}{c}"` : `"#${c}${c}${c}"`
    const tooltip = `"${next_move}\\nstep=${step}\\npolicy=${p.toFixed(4)}${p_str}${v_str}"`
    return dot_prop({
        label, penwidth, fontsize, fontcolor, color, tooltip,
    })
}

function dot_node_prop(node, move, bturn, policy, move_history, root_visits, visits_threshold) {
    // move must not be the empty string. [2025-02-24]
    // If it is '', the following error occurs when max_visits >= 24.
    // I don't understand the reason.
    // RuntimeError: table index is out of bounds
    //     at wasm://wasm/003d8c82:wasm-function[1942]:0xa503a
    //     at wasm://wasm/003d8c82:wasm-function[188]:0xa32c
    //     at wasm://wasm/003d8c82:wasm-function[1287]:0x6b7b6
    //     at wasm://wasm/003d8c82:wasm-function[1294]:0x6c83f
    //     at wasm://wasm/003d8c82:wasm-function[2364]:0xbd985
    //     at A.G.ccall (file:///PATH/TO/lizgoban/node_modules/@viz-js/viz/lib/viz-standalone.mjs:8:37777)
    //     at Q (file:///PATH/TO/lizgoban/node_modules/@viz-js/viz/lib/viz-standalone.mjs:8:41483)
    //     at i.render (file:///PATH/TO/lizgoban/node_modules/@viz-js/viz/lib/viz-standalone.mjs:8:44191)
    //     at i.renderString (file:///PATH/TO/lizgoban/node_modules/@viz-js/viz/lib/viz-standalone.mjs:8:44378)
    const is_root = empty(move_history)
    const turn = !move ? '' : bturn ? 'White ' : 'Black '
    !move && (move = 'Start')
    const {visits, original_visits, winrate, nn_winrate, score, nn_score, step, order} = node
    const min_visits = clip(visits_threshold - 1, 1)
    const dv = visits / min_visits
    const [wr, nn_wr] = [winrate, nn_winrate].map(w => `${Math.round(w * 100)}%`)
    const format_score = s => (s > 0 ? '+' : '') + s.toFixed(1)
    const [sc, nn_sc] = [score, nn_score].map(format_score)
    const full_label = `"${move}\\n${wr} (NN ${nn_wr})\\n${visits} visits"`
    const label = dv < 10 ? `"${move}\\n${wr}"` : full_label
    const except = (flag, str) => flag ? '' : `\\n${str}`
    const except_root = str => except(is_root, str)
    const policy_str = except_root(`policy: ${policy?.toFixed(4)}`)
    const order_str = except_root(`order: ${order + 1}`)
    const history_str = except_root(`sequence: ${move_history}`)
    const is_major = node => is_major_node(node, visits_threshold)
    const visible_children = visible_child_nodes(node, root_visits)
    const major_next_moves = visible_children.filter(is_major).map(c => c.move)
    const minor_next_moves =
          sort_by(visible_children.filter(c => !is_major(c)),
                  c => c.order).map(c => c.move)
    const next_moves =
          [major_next_moves, minor_next_moves].filter(a => !empty(a)).join(' + ')
    const [no_major, no_minor] = [major_next_moves, minor_next_moves].map(empty)
    const no_next = no_major && no_minor
    const children_str = except(no_next, `children: ${next_moves}`)
    const pv_str = except(no_next, `PV: ${pv_from(node, root_visits)}`)
    // tooltip should be human-readable since this appears in the saved SVG.
    const tooltip = `"${turn}[${move}]\\nwinrate: ${wr} (NN ${nn_wr})\\nscore: ${sc} (NN ${nn_sc})${policy_str}\\nvisits: ${visits}\\noriginal visits: ${original_visits}${order_str}\\nstep: ${step}${history_str}${children_str}${pv_str}"`
    const shape = bturn ? 'circle' : 'square'
    const fontsize = 12
    const height = dot_node_size(dv, shape, fontsize)
    const fixedsize = 'true'
    const style = 'filled'
    const color = `"${get_color(nn_winrate)}"`
    const fillcolor = `"${get_color(winrate)}"`
    const fontcolor = Math.abs(winrate - 0.5) < 0.3 ? 'black' : 'white'
    const penwidth = 5.0
    return dot_prop({
        label, shape,
        fontsize,
        height, fixedsize,
        style, color, fillcolor, fontcolor, penwidth,
        tooltip,
    })
}

function pv_from(node, root_visits) {
    const pv = []
    const iter = n => {
        const cs = visible_child_nodes(n, root_visits); if (empty(cs)) {return}
        const best_child = min_by(cs, c => - c.original_visits)
        pv.push(best_child.move); iter(best_child)
    }
    iter(node); return pv
}

function dot_prop(prop) {
    return map_key_value(prop, (key, val) => `${key}=${val}`).join(',')
}

function dot_node_size(visits, shape, fontsize) {
    const default_fontsize = 14
    const font_coef = fontsize / default_fontsize
    const shape_coef = {square: 1.0, circle: 2 / (Math.PI ** 0.5)}[shape]
    const log10 = p => Math.log(p) / Math.log(10)
    const size = 0.5 + log10(visits)
    return (font_coef * shape_coef * size).toFixed(2)
}

async function svg_from_mcts(mcts, last_move, board_size, bturn, future_moves, max_nodes) {
    const cached = mcts.get_cached_svg(max_nodes); if (cached) {return cached}
    const {instance} = await import('@viz-js/viz')
    const viz = await instance()
    const svg = viz.renderString(dot_from_mcts(mcts, last_move, board_size, bturn, future_moves, max_nodes), {format: 'svg'})
    mcts.set_cached_svg(svg, max_nodes)
    return svg
}

/////////////////////////////////////////////////
// color

function get_color(winrate) {
    const color_emphasis = 1.2
    const t = 0.5 + (winrate - 0.5) * color_emphasis
    return color_for(t)
}

// ColorBrewer: Color Advice for Maps
// https://colorbrewer2.org/?type=diverging&scheme=Spectral&n=11
const hex_colors = [
    '#9e0142', '#d53e4f', '#f46d43', '#fdae61',
    '#fee08b', '#ffffbf', '#e6f598',
    '#abdda4', '#66c2a5', '#3288bd', '#5e4fa2',
]
const vec_colors = hex_colors.map(to_vec)  // [[r, g, b], ...]

function color_for(t) {
    t = clip(t, 0, 1 - 1e-8)
    // piecewise linear interpolation
    const p = t * (vec_colors.length - 1), k = Math.floor(p), r = p - k
    const pairs = aa_transpose(vec_colors.slice(k, k + 2))  // [[r0, r1], ...]
    const interpolate = ([a, b]) => Math.round((1 - r) * a + r * b)
    return to_hex(pairs.map(interpolate))
}

function to_vec(hex) {
    return hex.match(/#(..)(..)(..)/)?.slice(1).map(k => parseInt(k, 16)) || []
}

function to_hex(vec) {
    return '#' + vec.map(z => z.toString(16).padStart(2, '0')).join('')
}

/////////////////////////////////////////////////
// exports

module.exports = {make_mcts}
