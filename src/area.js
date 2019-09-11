// clustering & counting of areas

require('./util.js').use(); require('./coord.js').use()

const ignorable_ownership = 0.01

function endstate_clusters(endstate) {
    const grid = aa_map(endstate, z => ({ownership: z, done: is_ignorable(z)}))
    const result = []
    aa_each(grid, (h, i, j) => h.done || result.push(cluster_from(i, j, grid)))
    return result
}

function is_ignorable(ownership) {return Math.abs(ownership) < ignorable_ownership}

function cluster_from(i, j, grid) {
    const cluster = {ownership_sum: 0.0, i_sum: 0.0, j_sum: 0.0, newcomers: []}
    add_newcomer_maybe([i, j], cluster, grid)
    while (!empty(cluster.newcomers)) {
        search_around(cluster.newcomers.pop(), cluster, grid)
    }
    const {ownership_sum} = cluster, center_idx = center_idx_of(cluster)
    return {ownership_sum, center_idx}
}

function add_newcomer_maybe(ij, cluster, grid) {
    const g = aa_ref(grid, ...ij), c = cluster
    if (!g || g.done || g.ownership * c.ownership_sum < 0) {return}
    const [i, j] = ij, weight = Math.abs(g.ownership)
    c.newcomers.push(ij); g.done = true
    c.ownership_sum += g.ownership; c.i_sum += i * weight; c.j_sum += j * weight
}

function search_around(ij, cluster, grid) {
    around_idx(ij).forEach(idx => add_newcomer_maybe(idx, cluster, grid))
}

function center_idx_of(cluster) {
    const {ownership_sum, i_sum, j_sum} = cluster, weight_sum = Math.abs(ownership_sum)
    return [i_sum, j_sum].map(z => z / weight_sum)
}

module.exports = {
    endstate_clusters,
}
