require('./common.js').to(global)
const {stones_from_history} = require('./rule.js')
const TRANSFORM = require('./random_flip.js')
const SGF = require('@sabaki/sgf')

/////////////////////////////////////////////////
// game

// example of history:
// [{move: "D16", is_black: true, move_count: 1, b_winrate: 42.19, ...},
//  {move: "Q4", is_black: false, move_count: 2, tag: "b", ...},
//  {move: "Q16", is_black: false, move_count: 3, comment: "chance!" , ...},
//  {move: "pass", is_black: true, move_count: 4, ...}]
// 
// Black played pass for the third move and the last move in this example.
// * move_count = 1 for the first stone, that is history[0]
//   ("first move", "first stone color (= black)", "winrate *after* first move")
// * See endstate_handler() and suggest_handler() for "...".
// * See also do_play() for passes.

// game.current_stones() =
//   [[stone, ..., stone], ..., [stone, ..., stone]] (19x19, see coord.js)
// stone = {stone: true, black: true} etc. or {} for empty position

let next_game_id = 0
function new_game_id() {return next_game_id++}

function create_game(init_history, init_prop) {
    const self = {}, history = init_history || []  // private
    const prop = init_prop || {  // public
        move_count: 0, player_black: "", player_white: "", komi: 7.5, board_size: 19,
        sgf_file: "", sgf_str: "", id: new_game_id(), move0: {},
        trial: false, last_loaded_element: null
    }
    const update_move_count_after = f => (...args) => {
        const ret = f(...args); self.move_count = self.len(); return ret
    }
    const methods = {
        // mc = move_count (0: empty board, 1: first move, ...)
        len: () => history.length,
        is_empty: () => empty(history),
        ref: mc => history[mc - 1] || self.move0,
        ref_current: () => self.ref(self.move_count),
        current_stones: () => self.stones_at(self.move_count),
        stones_at: mc => stones_from_history(self.array_until(mc)),
        array_until: mc => history.slice(0, mc),
        delete_future: () => history.splice(self.move_count),
        last_move: () => (last(history) || {}).move,
        get_komi: () => self.komi || leelaz_komi,
        set_last_loaded_element: () => self.last_loaded_element = last(history),
        shallow_copy: () => create_game(history.slice(), merge({}, self, {
            id: new_game_id(), last_loaded_element: null
        })),
        set_with_reuse: new_history => {
            const com = common_header_length(history, new_history)
            // keep old history for keeping winrate
            history.splice(com, Infinity, ...new_history.slice(com))
        },
        random_flip_rotate: () => {self.transform('random_flip_rotation')},
        transform: command => {
            history.splice(0, Infinity, ...TRANSFORM[command](history))
        },
        to_sgf: () => game_to_sgf(self),
        load_sabaki_gametree: (gametree, index) =>
            load_sabaki_gametree_to_game(gametree, index, self),
        new_tag_maybe: (new_sequence_p, move_count) =>
            new_tag_maybe_for_game(self, new_sequence_p, move_count),
        add_or_remove_tag: () => add_or_remove_tag_on_game(self),
        push: update_move_count_after(z => history.push(z)),
        pop: update_move_count_after(() => history.pop()),
    }
    const array_methods =
          aa2hash(['map', 'forEach', 'slice']
                  .map(meth => [meth, (...args) => history[meth](...args)]))
    return merge(self, prop, methods, array_methods)
}

/////////////////////////////////////////////////
// SGF

function game_to_sgf(game) {
    const f = (t, p) => p ? `${t}[${SGF.escapeString(p)}]` : ''
    // header
    const km = truep(game.komi) ? `KM[${game.komi}]` : ''
    const com0 = f('C', game.move0.comment)
    const sz = `SZ[${game.board_size}]`
    const header =
          `;${sz}${km}${f('PW', game.player_white)}${f('PB', game.player_black)}${com0}`
    // body
    const move2sgf = ({move, is_black, comment}) =>
          `;${is_black ? 'B' : 'W'}[${move2sgfpos(move)}]${f('C', comment)}`
    const body = game.map(move2sgf).join('')
    // all
    return `(${header}${body})`
}

function create_game_from_sgf(sgf_str) {
    // For robust parsing...
    // (1) drop junk before SGF by searching "(;" (ad hoc!)
    // (2) drop tails repeatedly until we get a valid SGF (brute force!)
    const clipped = clip_sgf(sgf_str); if (!clipped) {return false}
    try {return create_game_from_sgf_unsafe(clipped)} catch (e) {
        return create_game_from_sgf(clipped.slice(0, -1))
    }
}
function create_game_from_sgf_unsafe(clipped_sgf) {
    const gametree = parse_sgf(clipped_sgf)[0]
    const game = create_game()
    game.load_sabaki_gametree(gametree); game.sgf_str = clipped_sgf
    return game
}

function parse_sgf(sgf_str) {
    return convert_to_sabaki_sgf_v131_maybe(SGF.parse(sgf_str))
}

// pick "(; ... ... ])...)"
function clip_sgf(sgf_str) {
    const m = sgf_str.match(/\(\s*;[^]*\][\s\)]*\)/); return m && m[0]
}

function convert_to_sabaki_sgf_v131_maybe(parsed) {
    // convert v3.0.0-style to v1.3.1-style for the result of parse() of @sabaki/sgf
    // (ref.) incompatible change in @sabaki/sgf v3.0.0
    // https://github.com/SabakiHQ/sgf/commit/a57dfe36634190ca995755bd83f677375d543b80
    const first = parsed[0]; if (!first) {return null}
    const is_v131 = first.nodes; if (is_v131) {return parsed}
    let nodes = []
    const recur = n => n && (nodes.push(n.data), recur(n.children[0]))
    recur(first)
    const parent = null, minimum_v131_gametree = {nodes, parent}
    return [minimum_v131_gametree]
}

/////////////////////////////////////////////////
// Sabaki gameTree

function load_sabaki_gametree_to_game(gametree, index, game) {
    if (!gametree || !gametree.nodes) {return false}
    const parent_nodes = nodes_from_sabaki_gametree(gametree.parent)
    const nodes = parent_nodes.concat(gametree.nodes)
    const idx = (!index && index !== 0) ? Infinity : index
    const nodes_until_index = parent_nodes.concat(gametree.nodes.slice(0, idx + 1))
    const first_node = nodes_until_index[0]
    set_board_size(to_i((first_node["SZ"] || [19])[0])) // before generating history
    const new_hist = history_from_sabaki_nodes(nodes)
    game.set_with_reuse(new_hist)
    game.set_last_loaded_element()
    game.move_count = history_from_sabaki_nodes(nodes_until_index).length
    const player_name = bw => (first_node[bw] || [""])[0]
    const handicap_p = nodes.find(h => h.AB && !empty(h.AB))
    const km = (first_node["KM"] || [false])[0]
    const komi = truep(km) ? to_f(km) : handicap_p ? handicap_komi : null
    merge(game, {player_black: player_name("PB"), player_white: player_name("PW"),
                 komi, board_size: board_size(), trial: false})
    const comment = (first_node["C"] || [])[0]
    merge(game.ref(0), comment ? {comment} : {})
    return true
}

function history_from_sabaki_nodes(nodes) {
    const new_history = []; let move_count = 0
    const f = (h, key, is_black) => {
        (h[key] || []).forEach((pos, k) => {
            const move = sgfpos2move(pos), comment = k === 0 && (h.C || [])[0]
            move && ++move_count &&
                new_history.push({move, is_black, move_count, comment})
        })
    }
    nodes.forEach(h => {f(h, 'AB', true); f(h, 'B', true); f(h, 'W', false)})
    return new_history
}

function nodes_from_sabaki_gametree(gametree) {
    return (gametree === null) ? [] :
        nodes_from_sabaki_gametree(gametree.parent).concat(gametree.nodes)
}

/////////////////////////////////////////////////
// tag letter

let next_tag_count = 0
function new_tag_maybe_for_game(game, new_sequence_p, move_count) {
    return new_sequence_p ? new_tag_for_game(game) :
           game.ref(move_count) === game.last_loaded_element ?
           last_loaded_element_tag_letter : false
}
function new_tag_for_game(game) {
    const used = game.map(h => h.tag || '').join('')
    const first_unused_index = normal_tag_letters.repeat(2).slice(next_tag_count)
          .split('').findIndex(c => used.indexOf(c) < 0)
    const tag_count = (next_tag_count + Math.max(first_unused_index, 0))
          % normal_tag_letters.length
    next_tag_count = tag_count + 1
    return normal_tag_letters[tag_count]
}
function add_or_remove_tag_on_game(game) {
    const h = game.ref_current(); if (!h) {return}
    const t = h.tag; h.tag = (t ? t.slice(0, -1) : new_tag_for_game(game))
}

/////////////////////////////////////////////////
// exports

module.exports = {create_game, create_game_from_sgf}
