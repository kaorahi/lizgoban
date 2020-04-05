// illegal moves are not checked (ko, suicide, occupied place, ...)

///////////////////////////////////////
// main

function get_stones_and_set_ko_state(history) {
    // set "ko_state" of each element in history as side effect
    const stones = aa_new(board_size(), board_size(), () => ({}))
    const hama = {true: 0, false: 0}, ko_pool = []
    history.forEach((h, k) => put(h, stones, hama, ko_pool, k === history.length - 1))
    return {stones, black_hama: hama[true], white_hama: hama[false]}
}

function put(h, stones, hama, ko_pool, lastp) {
    const {move, is_black} = h
    const [i, j] = move2idx(move), pass = (i < 0); if (pass) {return}
    aa_set(stones, i, j, {stone: true, black: is_black, ...(lastp ? {last: true} : {})})
    const ko_state = capture_stones_and_check_ko([i, j], is_black, stones, hama, ko_pool)
    merge(h, {ko_state})  // side effect!
}

function capture_stones_and_check_ko(ij, is_black, stones, hama, ko_pool) {
    const surrounded = is_surrounded_by_opponent(ij, is_black, stones)
    const captured_opponents = capture(ij, is_black, stones, hama)
    return check_ko(ij, is_black, surrounded, captured_opponents, stones, ko_pool)
}

///////////////////////////////////////
// capture

function capture(ij, is_black, stones, hama) {
    let captured_opponents = []
    around_idx(ij).forEach(idx => {
        const r = remove_dead(idx, !is_black, stones); captured_opponents.push(...r)
        hama[!is_black] += r.length
    })
    hama[!!is_black] += remove_dead(ij, is_black, stones).length
    return captured_opponents
}

function remove_dead(ij, is_black, stones) {
    const state = {hope: [], dead_pool: [], dead_map: [[]], is_black, stones}
    check_if_liberty(ij, state)
    while (!empty(state.hope)) {
        if (search_for_liberty(state)) {return []}
    }
    state.dead_pool.forEach(idx => aa_set(stones, ...idx, {}))
    return state.dead_pool
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

///////////////////////////////////////
// ko fight

// ko_pool = [ko_item, ko_item, ...]
// ko_item = {move_idx: [5, 3], is_black: true, captured_idx: [5, 4]}

function check_ko(ij, is_black, surrounded, captured_opponents, stones, ko_pool) {
    remove_obsolete_ko(stones, ko_pool)
    const ko_captured =
          check_ko_captured(ij, is_black, surrounded, captured_opponents, ko_pool)
    const resolved_by_connection = check_resolved_by_connection(ij, ko_pool)
    // For two-stage ko,
    // check_resolved_by_capture() is necessary anyway even if ko_captured is true.
    const resolved_by_capture =
          check_resolved_by_capture(stones, ko_pool) && !ko_captured
    return {ko_captured, resolved_by_connection, resolved_by_capture}
}

function remove_obsolete_ko(stones, ko_pool) {
    filter_ko_pool(ko_pool, ({move_idx, is_black}) => {
        const s = aa_ref(stones, ...move_idx)
        return s.stone && (!!is_black === !!s.black)
    })
}

function check_ko_captured(move_idx, is_black, surrounded, captured_opponents, ko_pool) {
    const ko_captured = surrounded && (captured_opponents.length === 1)
    ko_captured &&
        ko_pool.push({move_idx, is_black, captured_idx: captured_opponents[0]})
    return ko_captured
}

function check_resolved_by_connection(ij, ko_pool) {
    return filter_ko_pool(ko_pool, ({captured_idx}) => !idx_equal(captured_idx, ij))
}

function check_resolved_by_capture(stones, ko_pool) {
    return filter_ko_pool(ko_pool, ({move_idx}) => around_idx(move_idx).filter(ij => {
        const s = aa_ref(stones, ...ij)
        return s && !s.stone
    }).length <= 1)
}

function filter_ko_pool(ko_pool, pred) {
    new_ko_pool = ko_pool.filter(pred)
    const filtered_p = new_ko_pool.length < ko_pool.length
    copy_array(new_ko_pool, ko_pool)
    return filtered_p
}

function is_surrounded_by_opponent(ij, is_black, stones) {
    const blocked = s => !s || (s.stone && xor(is_black, s.black))
    return around_idx(ij).every(idx => blocked(aa_ref(stones, ...idx)))
}

function idx_equal([i1, j1], [i2, j2]) {return i1 === i2 && j1 === j2}

function copy_array(from, to) {to.splice(0, Infinity, ...from)}

///////////////////////////////////////
// exports

module.exports = {
    get_stones_and_set_ko_state,
}
