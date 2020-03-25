// illegal moves are not checked (ko, suicide, occupied place, ...)

function get_stones_and_set_ko_fight(history) {
    // set "ko_fight" of each element in history as side effect
    const stones = aa_new(board_size(), board_size(), () => ({}))
    history.forEach((h, k) => put(h, stones, k === history.length - 1))
    return stones
}

function put(h, stones, last) {
    const {move, is_black} = h
    const [i, j] = move2idx(move), pass = (i < 0); if (pass) {return}
    aa_set(stones, i, j, {stone: true, black: is_black, ...(last ? {last} : {})})
    const ko_fight = remove_dead_by([i, j], is_black, stones)
    merge(h, {ko_fight})  // side effect!
}

function remove_dead_by(ij, is_black, stones) {
    let captured = 0
    const surrounded = is_surrounded_by_opponent(ij, is_black, stones)
    around_idx(ij).forEach(idx => {captured += remove_dead(idx, !is_black, stones)})
    remove_dead(ij, is_black, stones)
    const ko_fight = surrounded && (captured === 1)
    return ko_fight
}

function is_surrounded_by_opponent(ij, is_black, stones) {
    const blocked = s => !s || (s.stone && xor(is_black, s.black))
    return around_idx(ij).every(idx => blocked(aa_ref(stones, ...idx)))
}

function remove_dead(ij, is_black, stones) {
    const state = {hope: [], dead_pool: [], dead_map: [[]], is_black, stones}
    check_if_liberty(ij, state)
    while (!empty(state.hope)) {
        if (search_for_liberty(state)) {return 0}
    }
    state.dead_pool.forEach(idx => aa_set(stones, ...idx, {}))
    return state.dead_pool.length
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
    get_stones_and_set_ko_fight,
}
