require('./common.js').to(global)
const {get_stones_and_set_ko_fight} = require('./rule.js')
const TRANSFORM = require('./random_flip.js')
const SGF = require('@sabaki/sgf')

/////////////////////////////////////////////////
// game

// example of history:
// [{move: "D16", is_black: true, move_count: 1, b_winrate: 42.19, gain: -1.3, ...},
//  {move: "Q4", is_black: false, move_count: 2, tag: "b", ko_fight: false, ...},
//  {move: "Q16", is_black: false, move_count: 3, comment: "chance!" , ...},
//  {move: "pass", is_black: true, move_count: 4, unsafe_stones: {black: 5.3, white: 8.9}, ambiguity: 9.2, ...}]
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
        handicaps: 0, sgf_gorule: "", gorule: null,
        sgf_file: "", sgf_str: "", id: new_game_id(), move0: {},
        trial: false, last_loaded_element: null, engines: {},
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
        stones_at: mc => get_stones_and_set_ko_fight(self.array_until(mc)),
        array_until: mc => history.slice(0, mc),
        delete_future: () => history.splice(self.move_count),
        last_move: () => (last(history) || {}).move,
        get_komi: () => truep(self.komi) ? self.komi : leelaz_komi,
        set_last_loaded_element: () => self.last_loaded_element = last(history),
        shallow_copy: () => create_game(history.slice(), merge({}, self, {
            id: new_game_id(), last_loaded_element: null
        })),
        set_with_reuse: new_history => {
            const com = common_header_length(history, new_history)
            // keep old history for keeping winrate
            history.splice(com, Infinity, ...new_history.slice(com))
        },
        copy_with_reuse_to: another_game => {
            Object.keys(prop).forEach(k => k !== 'id' && (another_game[k] = self[k]))
            another_game.set_with_reuse(history)
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
    return with_board_size(game.board_size, game_to_sgf_sub, game)
}
function game_to_sgf_sub(game) {
    // util
    const f = (t, p) => p ? `${t}[${SGF.escapeString(p)}]` : ''
    const m2s = move => `[${move2sgfpos(move)}]`
    // header
    const km = truep(game.komi) ? `KM[${game.komi}]` : ''
    const ru = f('RU', game.sgf_gorule)
    const com0 = f('C', game.move0.comment)
    const sz = `SZ[${game.board_size}]`
    const {handicaps} = game
    const handicap_stones = is_black => {
        const hits = game.slice(0, handicaps).filter(h => !xor(h.is_black, is_black))
        return empty(hits) ? '' :
            `${is_black ? 'AB' : 'AW'}${hits.map(h => m2s(h.move)).join('')}`
    }
    const header =
          `;${sz}${km}${ru}${f('PW', game.player_white)}${f('PB', game.player_black)}${com0}`
          + handicap_stones(true) + handicap_stones(false)
    // body
    const move2sgf = ({move, is_black, comment}) =>
          `;${is_black ? 'B' : 'W'}${m2s(move)}${f('C', comment)}`
    const body = game.slice(handicaps).map(move2sgf).join('')
    // all
    return `(${header}${body})`
}

function create_games_from_sgf(sgf_str) {
    // For robust parsing...
    // (1) drop junk before SGF by searching "(;" (ad hoc!)
    // (2) drop tails repeatedly until we get a valid SGF (brute force!)
    const clipped = clip_sgf(sgf_str)
    return clipped ? (safely(create_games_from_sgf_unsafe, clipped) ||
                      create_games_from_sgf(clipped.slice(0, -1)))
        : []
}
function create_games_from_sgf_unsafe(clipped_sgf) {
    return unify_common_headers(parse_sgf(clipped_sgf).map(gametree => {
        const game = create_game()
        game.load_sabaki_gametree(gametree); game.sgf_str = clipped_sgf
        return game
    }))
}

function unify_common_headers(gs) {
    let game = gs[0]
    return gs.map(new_game => {
        game = game.shallow_copy(); new_game.copy_with_reuse_to(game); return game
    })
}

function parse_sgf(sgf_str) {
    return convert_to_sabaki_sgf_v131_maybe(SGF.parse(sgf_str))
}

// pick "(; ... ... ])...)"
// [2020-02-14] allow "...;)" for old (199X) SGF by IGS, NNGS, WING, xigc, etc.
function clip_sgf(sgf_str) {
    const m = sgf_str.match(/\(\s*;[^]*\][;\s\)]*\)/); return m && m[0]
}

function convert_to_sabaki_sgf_v131_maybe(parsed) {
    // convert v3.0.0-style to v1.3.1-style for the result of parse() of @sabaki/sgf
    // (ref.) incompatible change in @sabaki/sgf v3.0.0
    // https://github.com/SabakiHQ/sgf/commit/a57dfe36634190ca995755bd83f677375d543b80
    return flatten(parsed.map(item => {
        const is_v131 = item.nodes; if (is_v131) {return [item]}
        const minimum_v131_gametree = nodes => ({nodes, parent: null})
        const recur = (nodes, {data, children}) => {
            const k = children.length
            nodes.push({...data, branching_tag: k > 1 && unused_tag()})
            return k === 0 ? [minimum_v131_gametree(nodes)] :
            k === 1 ? recur(nodes, children[0]) :
            flatten(children.map(c => recur(nodes.slice(), c)))
        }
        return recur([], item)
    }))
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
    const first_node_ref = (key, missing) => (first_node[key] || [missing])[0]
    set_board_size(to_i(first_node_ref("SZ", 19))) // before generating history
    const new_hist = history_from_sabaki_nodes(nodes)
    game.set_with_reuse(new_hist)
    game.set_last_loaded_element()
    game.handicaps = handicaps_from_sabaki_nodes(nodes)
    game.move_count = history_from_sabaki_nodes(nodes_until_index).length
    const player_name = bw => first_node_ref(bw)
    const handicap_p = nodes.find(h => h.AB && !empty(h.AB))
    const km = first_node_ref("KM")
    const komi = truep(km) ? to_f(km) : handicap_p ? handicap_komi : null
    const sgf_gorule = first_node_ref("RU") || ''
    merge(game, {player_black: player_name("PB"), player_white: player_name("PW"),
                 komi, sgf_gorule, board_size: board_size(), trial: false})
    const comment = first_node_ref("C")
    merge(game.ref(0), comment ? {comment} : {})
    return true
}

function history_from_sabaki_nodes(nodes) {
    const new_history = []; let move_count = 0
    const f = (h, key, is_black) => {
        (h[key] || []).forEach((pos, k) => {
            const move = sgfpos2move(pos), comment = k === 0 && (h.C || [])[0]
            const tag = h.branching_tag
            move && ++move_count &&
                new_history.push({move, is_black, move_count, comment, tag})
        })
    }
    nodes.forEach(h => {
        f(h, 'AB', true); f(h, 'AW', false); f(h, 'B', true); f(h, 'W', false)
    })
    return new_history
}

function handicaps_from_sabaki_nodes(nodes) {
    const len = (h, key) => (h[key] || []).length
    return sum(nodes.map(h => len(h, 'AB') + len(h, 'AW')))
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
function new_tag_for_game(game) {return unused_tag(game.map(h => h.tag || '').join(''))}
function unused_tag(used_tags) {
    const used = used_tags || ''
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

module.exports = {create_game, create_games_from_sgf}
