require('./util.js').use(); require('./coord.js').use()

// illegal moves are not checked (ko, suicide, occupied place, ...)

function stones_from_history(history) {
    const stones = aa_new(19, 19, () => ({}))
    history.forEach((h, k) => put(h, stones, k === history.length - 1))
    return stones
}

function put({move, is_black}, stones, last) {
    const [i, j] = move2idx(move), pass = (i < 0); if (pass) {return}
    aa_set(stones, i, j, {stone: true, black: is_black, ...(last ? {last} : {})})
    remove_dead_by([i, j], is_black, stones)
}

function remove_dead_by(ij, is_black, stones) {
    around_idx(ij).forEach(idx => remove_dead(idx, !is_black, stones))
    remove_dead(ij, is_black, stones)
}

function remove_dead(ij, is_black, stones) {
    const state = {hope: [], dead_pool: [], dead_map: [[]], is_black, stones}
    check_if_liberty(ij, state)
    while (!empty(state.hope)) {
        if (search_for_liberty(state)) {return}
    }
    state.dead_pool.forEach(idx => aa_set(stones, ...idx, {}))
}

function search_for_liberty(state) {
    return around_idx(state.hope.shift()).find(idx => check_if_liberty(idx, state))
}

function check_if_liberty(ij, state) {
    const s = aa_ref(state.stones, ...ij)
    return !s ? false : !s.stone ? true : (push_hope(ij, s, state), false)
}

function push_hope(ij, s, state) {
    if (xor(s.black, state.is_black) || aa_ref(state.dead_map, ...ij)) {return}
    state.hope.push(ij)
    state.dead_pool.push(ij); aa_set(state.dead_map, ...ij, true)
}

module.exports = {
    stones_from_history,
}
