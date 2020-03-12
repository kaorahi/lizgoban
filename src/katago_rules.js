// ref.
// https://github.com/lightvector/KataGo/blob/master/docs/GTP_Extensions.md
// https://www.red-bean.com/sgf/properties.html#RU

const name_table = [
    // [katago_name, preferred_SGF_name, another_SGF_name, yet_another_SGF_name, ...]
    ['tromp-taylor'],
    ['chinese', 'Chinese'],
    ['chinese-ogs'],
    ['chinese-kgs'],
    ['japanese', 'Japanese'],
    ['korean', 'Korean'],
    ['stone-scoring'],
    ['aga', 'AGA'],
    ['bga', 'BGA'],
    ['new-zealand', 'NZ'],
    ['aga-button'],
]

const katago_supported_rules = name_table.map(a => a[0])

function katago_rule_from_sgf_rule(sgf_rule) {
    if (!sgf_rule) {return null}
    const target = sgf_rule.toLowerCase()  // for robustness
    const hit = name_table.find(a => a.map(s => s.toLowerCase()).includes(target))
    return hit && hit[0]
}

function sgf_rule_from_katago_rule(katago_rule) {
    if (!katago_rule) {return null}
    const hit = name_table.find(a => a[0] === katago_rule)
    return hit && (hit[1] || hit[0])
}

module.exports = {
    katago_supported_rules, katago_rule_from_sgf_rule, sgf_rule_from_katago_rule
}
