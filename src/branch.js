// private

let branch_structure
function clear_branch() {branch_structure = []}
clear_branch()

function get_branch_at(move_count) {
    const a = branch_structure[move_count]
    return a || (branch_structure[move_count] = [])
}
function add_branch(move_count, another_game) {
    const a = get_branch_at(move_count), ref = gm => gm.ref(move_count + 1)
    !a.map(ref).includes(ref(another_game)) && a.push(another_game)
}

// public

function branch_at(move_count) {return branch_structure[move_count]}
function update_branch_for(game, all_games) {
    const hist = game.array_until(Infinity), {init_len, brothers} = game
    const add = gm => {
        const c = gm.strictly_common_header_length(hist)
        const branch_p = (c > init_len) || brothers.includes(gm)
        branch_p && add_branch(c, gm)
    }
    clear_branch(); all_games.forEach(gm => (gm === game) || add(gm))
}

///////////////////////////////////////
// exports

module.exports = {
    branch_at,
    update_branch_for,
}
