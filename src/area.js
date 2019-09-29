// clustering & counting of areas

// fix me: inefficient...

require('./util.js').use(); require('./coord.js').use()

const minor_ownership = 0.1
const too_large_cluster_size = 40
const narrow_corridor_radius = 3
const too_small_corridor_cluster_size = 10
const too_small_core_cluster_size = 15

const category_spec = [
    {color: 'black', type: 'major', ownership_range: [minor_ownership, Infinity]},
    {color: 'white', type: 'major', ownership_range: [- Infinity, - minor_ownership]},
    {color: 'black', type: 'minor', ownership_range: [0, minor_ownership]},
    {color: 'white', type: 'minor', ownership_range: [- minor_ownership, 0]},
]

//////////////////////////////////////
// main

function endstate_clusters_for(endstate) {
    initialize()
    const grid_for = z => ({ownership: z, id: null})
    const grid = aa_map(endstate, grid_for)
    return flatten(category_spec.map((_, cat) => clusters_in_category(cat, grid)))
}

function clusters_in_category(category, grid) {
    const {type} = category_spec[category]
    const region = region_for_category(category, grid)
    const clusters = clusters_in_region(region, grid, category)
    const divide_maybe = c => divide_large_cluster(c, grid, category)
    const ret = (type === 'minor') ? clusters : flatten(clusters.map(divide_maybe))
    return ret.map(c => finalize_cluster(c, grid))
}

function region_for_category(category, grid) {
    const region = [], ok = g => !truep(g.id) && in_category(category, g.ownership)
    aa_each(grid, (g, i, j) => ok(g) && region.push([i, j]))
    return region
}

function in_category(category, ownership) {
    const {ownership_range: [a, b]} = category_spec[category]
    return a <= ownership && ownership < b
}

function divide_large_cluster(cluster, grid, category) {
    if (cluster.ijs.length < too_large_cluster_size) {return [cluster]}
    const region = cluster.ijs
    cancel_cluster(cluster, grid)
    const core = core_in_region(region, narrow_corridor_radius, in_board_checker(grid))
    // determine corridor_clusters first because
    // we will cancel too small clusters there
    // and let them be parts of core_clusters.
    const corridor_clusters =
          corridor_clusters_in(region, core, grid, category, narrow_corridor_radius)
    const core_clusters = core_clusters_in(region, core, grid, category)
    const rest_clusters = clusters_in_region(region, grid, category)
    return [...core_clusters, ...corridor_clusters, ...rest_clusters]
}

function in_board_checker(grid) {return ([i, j]) => !!aa_ref(grid, i, j)}

let last_category_id = 0
function initialize() {last_category_id = 0}
function new_cluster_id() {return ++last_category_id}

//////////////////////////////////////
// clustering

function clusters_in_region(region, grid, category) {
    return region.map(ij => cluster_from(ij, region, grid, category)).filter(truep)
}

function cluster_from([i, j], region, grid, category) {
    if (truep(grid[i][j].id)) {return null}
    const {color, type} = category_spec[category], id = new_cluster_id()
    const state = {ijs: [], newcomers: [], region, id}
    add_newcomer_maybe([i, j], state, grid)
    while (!empty(state.newcomers)) {search_around(state.newcomers.pop(), state, grid)}
    const {ijs} = state
    return make_cluster(id, color, type, ijs)
}

function add_newcomer_maybe(ij, state, grid) {
    const g = aa_ref(grid, ...ij)
    if (!g || truep(g.id) || !is_member(ij, state.region)) {return}
    state.ijs.push(ij); state.newcomers.push(ij); g.id = state.id
}

function search_around(ij, state, grid) {
    around_idx(ij).forEach(idx => add_newcomer_maybe(idx, state, grid))
}

function make_cluster(id, color, type, ijs) {
    return {id, color, type, ijs}
}

function finalize_cluster(cluster, grid) {
    const {id, ijs} = cluster, c = {...cluster}; delete c.ijs // for efficiency
    return {...c, ...cluster_characteristics(id, ijs, grid)}
}

function cluster_characteristics(id, ijs, grid) {
    const sum = (v, w) => v.map((_, k) => v[k] + w[k]), zero = [0, 0, 0]
    const f = ([i, j]) => {const ow = grid[i][j].ownership; return [ow, i * ow, j * ow]}
    const [ownership_sum, i_sum, j_sum] = ijs.map(f).reduce(sum, zero)
    const center_idx = [i_sum, j_sum].map(z => z / ownership_sum)
    const boundary = boundary_of(id, ijs, grid)
    return {ownership_sum, center_idx, boundary}
}

function boundary_of(id, ijs, grid) {
    const same_cluster_p = idx => (aa_ref(grid, ...idx) || {}).id === id
    const checker_for = ij =>
          (idx, direction) => same_cluster_p(idx) ? null : [ij, direction]
    const boundary_around = ij => around_idx(ij).map(checker_for(ij)).filter(truep)
    return flatten(ijs.map(boundary_around))
}

function cancel_cluster(cluster, grid) {
    cluster.ijs.forEach(([i, j]) => (grid[i][j].id = null))
}

//////////////////////////////////////
// separate corridors for "natural" clustering

function core_in_region(region, radius, in_board) {
    let core = region
    do_ntimes(radius, () => (core = erosion(core, in_board)))
    return core
}

function corridor_clusters_in(region, core, grid, category, corridor_radius) {
    if (corridor_radius <=0) {return []}
    const corridors = corridors_in(region, core, grid, corridor_radius)
    const clusters = clusters_in_region(corridors, grid, category)
    return cancel_small_clusters(clusters, grid, too_small_corridor_cluster_size)
}

function cancel_small_clusters(clusters, grid, small_cluster_size) {
    const acceptable = c => c.ijs.length > small_cluster_size
    const inacceptable = c => !acceptable(c)
    const acceptable_clusters = clusters.filter(acceptable)
    const inacceptable_clusters = clusters.filter(inacceptable)
    const cancel = c => cancel_cluster(c, grid)
    inacceptable_clusters.forEach(cancel)
    return acceptable_clusters
}

function corridors_in(region, core, grid, corridor_radius) {
    let dilated_core = core
    const dilate = () => (dilated_core = dilation(dilated_core, region))
    // "* 2" for recovering corners of rectangles
    do_ntimes(corridor_radius * 2, dilate)
    return region.filter(ij => !is_member(ij, dilated_core))
}

function erosion(region, in_board) {
    const is_not_member = idx => in_board(idx) && !is_member(idx, region)
    const is_inside = ij => !find_around(ij, is_not_member)
    return region.filter(is_inside)
}

function dilation(region, limit_region) {
    const is_in_region = idx => is_member(idx, region)
    const is_in_closure = ij => is_in_region(ij) || find_around(ij, is_in_region)
    return limit_region.filter(is_in_closure)
}

function find_around(idx, pred) {return around_idx(idx).find(pred)}

function is_member(idx, region) {
    const eq = ([i1, j1], [i2, j2]) => (i1 === i2 && j1 === j2)
    return region.find(ij => eq(idx, ij))
}

//////////////////////////////////////
// divide large areas by bottlenecks

function core_clusters_in(region, core, grid, category) {
    const rest = region.filter(ij => !truep(aa_ref(grid, ...ij).id))
    const core_clusters = clusters_in_region(core, grid, category)
    inflate_clusters(core_clusters, rest, grid)
    const survived_clusters =
          cancel_small_clusters(core_clusters, grid, too_small_core_cluster_size)
    inflate_clusters(survived_clusters, rest, grid)
    return survived_clusters
}

function inflate_clusters(clusters, region, grid) {
    const cluster_for = aa2hash(clusters.map(c => [c.id, c]))
    const id_at = ij => (aa_ref(grid, ...ij) || {}).id
    const fresh = ij => !truep(id_at(ij))
    const labeled = ij => !fresh(ij) && is_member(ij, region)
    const penetrate = r => {
        // pool is needed for breadth-first search
        const ret = r.filter(fresh), pool = []
        const pool_maybe = (ij, touched) => touched && pool.push([ij, id_at(touched)])
        const check = ij => pool_maybe(ij, find_around(ij, labeled))
        ret.forEach(check)
        if (empty(pool)) {return []}
        pool.forEach(([ij, id]) => {
            aa_ref(grid, ...ij).id = id; cluster_for[id].ijs.push(ij)
        })
        return ret
    }
    let rest = region
    while (!empty(rest)) {rest = penetrate(rest)}
}

//////////////////////////////////////
// exports

module.exports = {
    endstate_clusters_for,
}
