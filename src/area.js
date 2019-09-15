// clustering & counting of areas

// fix me: inefficient...

require('./util.js').use(); require('./coord.js').use()

const minor_ownership = 0.1
const narrow_corridor_radius = 3
const too_small_corridor_cluster_size = 3

const category_spec = [
    {color: 'black', type: 'major', ownership_range: [minor_ownership, Infinity],
     corridor_radius: narrow_corridor_radius},
    {color: 'white', type: 'major', ownership_range: [- Infinity, - minor_ownership],
     corridor_radius: narrow_corridor_radius},
    {color: 'black', type: 'minor', ownership_range: [0, Infinity],
     corridor_radius: 0},
    {color: 'white', type: 'minor', ownership_range: [- Infinity, 0],
     corridor_radius: 0},
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
    const {corridor_radius} = category_spec[category]
    const region = region_for_category(category, grid)
    // (1) exclude corridor parts first (by setting id on grid)
    const corridor_clusters =
          corridor_clusters_in(region, grid, category, corridor_radius)
    // (2) get clusters in rest parts
    const normal_clusters = clusters_in_region(region, grid, category)
    return [...normal_clusters, ...corridor_clusters]
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

let last_category_id = 0
function initialize() {last_category_id = 0}
function new_cluster_id() {return ++last_category_id}

//////////////////////////////////////
// clustering

function clusters_in_region(region, grid, category) {
    return cleanup_clusters(clusters_with_ijs_in_region(region, grid, category))
}

function cleanup_clusters(clusters) {
    // for efficiency
    const cleanup = c => {delete c.ijs; return c}; return clusters.map(cleanup)
}

function clusters_with_ijs_in_region(region, grid, category) {
    return region.map(ij => cluster_from(ij, region, grid, category)).filter(truep)
}

function cluster_from([i, j], region, grid, category) {
    if (truep(grid[i][j].id)) {return null}
    const {color, type} = category_spec[category], id = new_cluster_id()
    const state = {ijs: [], newcomers: [], region, id}
    add_newcomer_maybe([i, j], state, grid)
    while (!empty(state.newcomers)) {search_around(state.newcomers.pop(), state, grid)}
    const {ijs} = state
    return {color, type, ijs, ...cluster_characteristics(id, ijs, grid)}
}

function add_newcomer_maybe(ij, state, grid) {
    const g = aa_ref(grid, ...ij)
    if (!g || truep(g.id) || !is_member(ij, state.region)) {return}
    state.ijs.push(ij); state.newcomers.push(ij); g.id = state.id
}

function search_around(ij, state, grid) {
    around_idx(ij).forEach(idx => add_newcomer_maybe(idx, state, grid))
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

//////////////////////////////////////
// separate corridors for "natural" clustering

function corridor_clusters_in(region, grid, category, corridor_radius) {
    if (corridor_radius <=0) {return []}
    const corridors = corridors_in(region, grid, corridor_radius)
    const clusters = clusters_with_ijs_in_region(corridors, grid, category)
    // cancel annoying small clusters
    const acceptable = c => c.ijs.length > too_small_corridor_cluster_size
    const inacceptable = c => !acceptable(c)
    const acceptable_clusters = clusters.filter(acceptable)
    const inacceptable_clusters = clusters.filter(inacceptable)
    const cancel = c => c.ijs.forEach(([i, j]) => (grid[i][j].id = null))
    inacceptable_clusters.forEach(cancel)
    return cleanup_clusters(acceptable_clusters)
}

function corridors_in(region, grid, corridor_radius) {
    const in_board = ([i, j]) => !!aa_ref(grid, i, j)
    let core = region
    do_ntimes(corridor_radius, () => (core = erosion(core, in_board)))
    // "* 2" for recovering corners of rectangles
    do_ntimes(corridor_radius * 2, () => (core = dilation(core, region)))
    return region.filter(ij => !is_member(ij, core))
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
// exports

module.exports = {
    endstate_clusters_for,
}
