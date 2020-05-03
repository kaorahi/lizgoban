const {get_stones_and_set_ko_state} = require('./rule.js')
const {parse_analyze} = require('./engine.js')
const TRANSFORM = require('./random_flip.js')
const SGF = require('@sabaki/sgf')

/////////////////////////////////////////////////
// game

// example of history:
// [{move: "D16", is_black: true, move_count: 1, b_winrate: 42.19, gain: -1.3, ...},
//  {move: "Q4", is_black: false, move_count: 2, tag: "b", ko_state: {ko_captured: true, resolved_by_connection: false, resolved_by_capture: false}, ...},
//  {move: "Q16", is_black: false, move_count: 3, comment: "chance!" , ...},
//  {move: "pass", is_black: true, move_count: 4, unsafe_stones: {black: 5.3, white: 8.9}, ambiguity: 9.2, ...}]
// {move: "Q16", is_black: false, move_count: 5, illegal: true}
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
        trial: false, last_loaded_element: null, engines: {}, current_engine: null,
        trial_from: null,
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
        stones_at: mc => {const {stones} = self.stones_and_hama_at(mc); return stones},
        stones_and_hama_at: mc =>
            get_stones_and_set_ko_state(self.array_until(mc).filter(h => !h.illegal)),
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
            return com
        },
        copy_with_reuse_to: another_game => {
            Object.keys(prop).forEach(k => k !== 'id' && (another_game[k] = self[k]))
            const com = another_game.set_with_reuse(history)
            another_game.move_count = com
        },
        merge_common_header: another_game => {
            const another_history = another_game.array_until(Infinity)
            const com = common_header_length(history, another_history)
            seq(com).forEach(n => {
                const me = history[n], you = another_history[n], me_copy = {...me}
                // merge all your items that I don't have (except for "comment")
                merge(me, you, {comment: null}, me_copy)
            })
        },
        random_flip_rotate: () => {self.transform('random_flip_rotation')},
        transform: command => {
            history.splice(0, Infinity, ...TRANSFORM[command](history))
        },
        to_sgf: cache_suggestions_p => game_to_sgf(self, cache_suggestions_p),
        load_sabaki_gametree: (gametree, index, cache_suggestions_p) =>
            load_sabaki_gametree_to_game(gametree, index, self, cache_suggestions_p),
        new_tag_maybe: (new_sequence_p, move_count) =>
            new_tag_maybe_for_game(self, new_sequence_p, move_count),
        add_or_remove_tag: () => add_or_remove_tag_on_game(self),
        remove_all_tags: () => history.forEach(h => {delete h.tag}),
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

function game_to_sgf(game, cache_suggestions_p) {
    return with_board_size(game.board_size, game_to_sgf_sub, game, cache_suggestions_p)
}
function game_to_sgf_sub(game, cache_suggestions_p) {
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
    const lizzie072_cache_for = h => {
        const {is_black, endstate, by} = h, {current_engine} = game
        const by_current = current_engine && (by || {})[current_engine] || {}
        // current_engine is not set until the first call of suggest_handler.
        // So we use h here in this case to avoid the bug
        // "cached suggestions were not copied by C-c after C-z during pausing".
        // But simple "by_current || h" is wrong because
        // it causes annoying oscillation of winrates in AI vs. AI.
        // We need to use only by_current as long as current_engine is given.
        const {suggest, b_winrate, visits} = current_engine ? by_current : h
        if (!suggest) {return ''}
        const num = z => truep(z) ? z : 0
        const s1 = `0.7.2 ${num(is_black ? b_winrate : 100 - b_winrate).toFixed(1)} ${kilo_str(num(visits))}`
        const scoremean_maybe = z => truep(z.scoreMean) ? `scoreMean ${to_s(z.scoreMean)} ` : ''
        const s2 = sort_by(suggest, z => z.order).map(z => z.order >= 0 && `move ${z.move} visits ${z.visits} winrate ${to_i(z.winrate * 100)} ` + scoremean_maybe(z) + `pv ${z.pv.join(' ')}`).filter(truep).join(' info ')
        const analysis_for_black = !is_black
        const s3 = endstate ? ` ownership ${flatten(endstate).map(o => analysis_for_black ? o : -o).join(' ')}` : ''
        return `LZ[${s1}\n${s2}${s3} info ]`
    }
    const move2sgf = h => {
        const {move, is_black, comment, note} = h
        const note_maybe =
              f(note_property, use_note_property_p() && note && JSON.stringify({note}))
        return `;${is_black ? 'B' : 'W'}${m2s(move)}${f('C', comment)}${note_maybe}`
            + (cache_suggestions_p ? lizzie072_cache_for(h) : '')
    }
    const body = game.slice(handicaps).map(move2sgf).join('')
    // all
    return `(${header}${body})`
}

function create_games_from_sgf(sgf_str, cache_suggestions_p) {
    // For robust parsing...
    // (1) drop junk before SGF by searching "(;" (ad hoc!)
    // (2) drop tails repeatedly until we get a valid SGF (brute force!)
    const clipped = clip_sgf(sgf_str)
    // const safely = (f, ...a) => f(...a)  // for debug
    return clipped ? (safely(create_games_from_sgf_unsafe, clipped, cache_suggestions_p) ||
                      create_games_from_sgf(clipped.slice(0, -1)))
        : []
}
function create_games_from_sgf_unsafe(clipped_sgf, cache_suggestions_p) {
    const to_game = gametree => {
        const game = create_game()
        game.load_sabaki_gametree(gametree, undefined, cache_suggestions_p)
        game.sgf_str = clipped_sgf
        return game
    }
    return parse_sgf(clipped_sgf, to_game)
}

function parse_sgf(sgf_str, to_game) {
    return games_from_parsed_sgf(SGF.parse(sgf_str), to_game)
}

// pick "(; ... ... ])...)"
// [2020-02-14] allow "...;)" for old (199X) SGF by IGS, NNGS, WING, xigc, etc.
function clip_sgf(sgf_str) {
    const m = sgf_str.match(/\(\s*;[^]*\][;\s\)]*\)/); return m && m[0]
}

function games_from_parsed_sgf(parsed, to_game) {
    // convert v3.0.0-style to v1.3.1-style for the result of parse() of @sabaki/sgf
    // (ref.) incompatible change in @sabaki/sgf v3.0.0
    // https://github.com/SabakiHQ/sgf/commit/a57dfe36634190ca995755bd83f677375d543b80
    const is_v131 = item => !!item.nodes
    const minimum_v131_gametree = nodes => ({nodes, parent: null})
    // sort variations so that they are convenietly readable
    // [[[game0, game1], game2], game3] ==> [game0, game3, game2, game1]
    // game0: A B C D
    // game1: A B C D'
    // game2: A B C'
    // game3: A B'
    // sample
    // (;B[aa](;W[ba](;B[ca](;W[da])(;W[cb]))(;B[bb]))(;W[ab](;B[bb])(;B[ac])))
    const readably_flatten = ([[main, ...rest], ...variations]) =>
          [main, ...flatten(variations), ...rest]
    // unify common headers
    let game
    const to_game_with_reuse = gametree => {
        const new_game = to_game(gametree); if (!game) {return (game = new_game)}
        game = game.shallow_copy(); new_game.copy_with_reuse_to(game); return game
    }
    // for v3.0.0-style
    const recur = (nodes, {data, children}) => {
        const k = children.length
        const branching_tag = k > 1 && (data.B || data.W) && unused_tag()
        nodes.push({...data, branching_tag})
        return k === 0 ? [to_game_with_reuse(minimum_v131_gametree(nodes))] :
            k === 1 ? recur(nodes, children[0]) :
            readably_flatten(children.map(c => recur(nodes.slice(), c)))
    }
    // main
    const conv = item => is_v131(item) ? [to_game_with_reuse(item)] : recur([], item)
    return flatten(parsed.map(conv))
}

/////////////////////////////////////////////////
// Sabaki gameTree

function load_sabaki_gametree_to_game(gametree, index, game, cache_suggestions_p) {
    if (!gametree || !gametree.nodes) {return false}
    const parent_nodes = nodes_from_sabaki_gametree(gametree.parent)
    const nodes = parent_nodes.concat(gametree.nodes)
    const idx = (!index && index !== 0) ? Infinity : index
    const nodes_until_index = parent_nodes.concat(gametree.nodes.slice(0, idx + 1))
    const first_node = nodes_until_index[0]
    const first_node_ref = (key, missing) => (first_node[key] || [missing])[0]
    const bsize = to_i(first_node_ref("SZ")) || 19  // to_i('9:13') is 0
    // [header]
    const player_name = bw => first_node_ref(bw, '')
    const handicap_p = nodes.find(h => h.AB && !empty(h.AB))
    const km = first_node_ref("KM")
    const komi = truep(km) ? to_f(km) : handicap_p ? handicap_komi : null
    const sgf_gorule = first_node_ref("RU", '')
    merge(game, {player_black: player_name("PB"), player_white: player_name("PW"),
                 komi, sgf_gorule, board_size: bsize, trial: false})
    const comment = first_node_ref("C")
    merge(game.ref(0), comment ? {comment} : {})
    // [body]
    // need to set board size for history_from_sabaki_nodes
    // (and recover the old board size immediately so that its change
    // is correctly detected elsewhere for switching of engine processes)
    const to_history = nodes =>
          history_from_sabaki_nodes(nodes, truep(komi) ? komi : leelaz_komi,
                                    cache_suggestions_p)
    const history_for = given_nodes => with_board_size(bsize, to_history, given_nodes)
    const new_hist = history_for(nodes)
    game.set_with_reuse(new_hist)
    game.set_last_loaded_element()
    game.handicaps = handicaps_from_sabaki_nodes(nodes)
    game.move_count = history_for(nodes_until_index).length
    return true
}

function history_from_sabaki_nodes(nodes, komi, cache_suggestions_p) {
    const new_history = []; let move_count = 0
    const f = (h, key, is_black) => {
        (h[key] || []).forEach((pos, k) => {
            const move = sgfpos2move(pos)
            const get_com = key => k === 0 && (h[key] || [])[0]
            const comment = get_com('C')
            const private_prop_json = use_note_property_p() && get_com('LG')
            const note = private_prop_json && JSON.parse(private_prop_json).note
            const tag = h.branching_tag, analysis_for_black = !is_black
            const cached_suggest_maybe = (cache_suggestions_p && h.LZ) ?
                  parse_lizzie072_cache(h.LZ[0], analysis_for_black, komi) : {}
            move && ++move_count &&
                new_history.push({move, is_black, move_count, comment, note, tag,
                                  ...cached_suggest_maybe})
        })
    }
    nodes.forEach(h => {
        f(h, 'AB', true); f(h, 'AW', false); f(h, 'B', true); f(h, 'W', false)
    })
    return new_history
}

function parse_lizzie072_cache(lizzie_cache, bturn, komi) {
    const fail = {}
    const m = lizzie_cache.match(/\n(.*) *info */); if (!m) {return fail}
    const s = 'info ' + m[1]
    const ret = safely(parse_analyze, s, bturn, komi); if (!ret) {return fail}
    ret.ownership && (ret.endstate = endstate_from_ownership(ret.ownership))
    return ret
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
// privete note property for SGF

const note_property = 'LG'
let use_note_property_val = false
function use_note_property_p() {return use_note_property_val}
function use_note_property(bool) {use_note_property_val = !!bool}

/////////////////////////////////////////////////
// exports

module.exports = {create_game, create_games_from_sgf, use_note_property}
