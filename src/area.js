// clustering & counting of areas

require('./util.js').use(); require('./coord.js').use()

const minor_ownership = 0.1
const category_spec = [
    {color: 'white', type: 'major', ownership_range: [- Infinity, - minor_ownership]},
    {color: 'white', type: 'minor', ownership_range: [- minor_ownership, 0]},
    {color: 'black', type: 'minor', ownership_range: [0, minor_ownership]},
    {color: 'black', type: 'major', ownership_range: [minor_ownership, Infinity]},
]

function endstate_clusters_for(endstate) {
    const grid_for = z => ({ownership: z, category: category_for(z), done: false})
    const grid = aa_map(endstate, grid_for), result = []
    aa_each(grid, (g, i, j) => g.done || result.push(cluster_from(g, i, j, grid)))
    return result
}

function category_for(ownership) {
    const f = ({ownership_range: [a, b]}) => (a <= ownership && ownership < b)
    return category_spec.findIndex(f)
}

function cluster_from(g, i, j, grid) {
    const {category} = g, {color, type} = category_spec[category]
    const state = {ownership_sum: 0.0, i_sum: 0.0, j_sum: 0.0, newcomers: [], category}
    add_newcomer_maybe([i, j], state, grid)
    while (!empty(state.newcomers)) {search_around(state.newcomers.pop(), state, grid)}
    const {ownership_sum} = state, center_idx = center_idx_for(state)
    return {color, type, ownership_sum, center_idx}
}

function add_newcomer_maybe(ij, state, grid) {
    const g = aa_ref(grid, ...ij), ok = g && !g.done && (g.category === state.category)
    if (!ok) {return}
    const s = state, [i, j] = ij, {ownership} = g
    s.newcomers.push(ij); g.done = true
    s.ownership_sum += ownership; s.i_sum += i * ownership; s.j_sum += j * ownership
}

function search_around(ij, state, grid) {
    around_idx(ij).forEach(idx => add_newcomer_maybe(idx, state, grid))
}

function center_idx_for(state) {
    const {ownership_sum, i_sum, j_sum} = state
    return [i_sum, j_sum].map(z => z / ownership_sum)
}

module.exports = {
    endstate_clusters_for,
}
