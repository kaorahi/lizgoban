// clustering & counting of areas

require('./util.js').use(); require('./coord.js').use()

const scan_rules = [{type: 'major', threshold: 0.1},
                    {type: 'minor', threshold: 0.5 / 361}]

function endstate_clusters(endstate) {
    const grid = aa_map(endstate, z => ({ownership: z, done: false}))
    const result = []
    scan_rules.forEach(rule => scan(grid, result, rule))
    return result
}

function scan(grid, result, rule) {
    aa_each(grid, (g, i, j) =>
            ignorable(g, rule) || result.push(cluster_from(i, j, grid, rule)))
}

function ignorable(g, rule) {return g.done || Math.abs(g.ownership) < rule.threshold}

function cluster_from(i, j, grid, rule) {
    const state = {ownership_sum: 0.0, i_sum: 0.0, j_sum: 0.0,
                   newcomers: [], rule}
    add_newcomer_maybe([i, j], state, grid)
    while (!empty(state.newcomers)) {
        search_around(state.newcomers.pop(), state, grid)
    }
    const {ownership_sum} = state, {type} = rule, center_idx = center_idx_for(state)
    return {type, ownership_sum, center_idx}
}

function add_newcomer_maybe(ij, state, grid) {
    const g = aa_ref(grid, ...ij), s = state
    const skip = !g || ignorable(g, state.rule) ||
          g.ownership * s.ownership_sum < 0
    if (skip) {return}
    const [i, j] = ij, weight = Math.abs(g.ownership)
    s.newcomers.push(ij); g.done = true
    s.ownership_sum += g.ownership; s.i_sum += i * weight; s.j_sum += j * weight
}

function search_around(ij, state, grid) {
    around_idx(ij).forEach(idx => add_newcomer_maybe(idx, state, grid))
}

function center_idx_for(state) {
    const {ownership_sum, i_sum, j_sum} = state, weight_sum = Math.abs(ownership_sum)
    return [i_sum, j_sum].map(z => z / weight_sum)
}

module.exports = {
    endstate_clusters,
}
