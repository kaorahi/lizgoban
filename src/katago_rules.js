'use strict'

// ref.
// https://github.com/lightvector/KataGo/blob/master/docs/GTP_Extensions.md
// https://www.red-bean.com/sgf/properties.html#RU

const name_table = [
    // [katago_name, preferred_SGF_name, another_SGF_name, yet_another_SGF_name, ...]
    ['tromp-taylor'],
    ['chinese', 'Chinese'],
    ['chinese-ogs'],
    ['chinese-kgs'],
    ['japanese', 'Japanese', 'jp'],
    ['korean', 'Korean'],
    ['stone-scoring'],
    ['aga', 'AGA'],
    ['bga', 'BGA'],
    ['new-zealand', 'NZ'],
    ['aga-button'],
]

const katago_supported_rules = name_table.map(a => a[0])

const guessed_rule_from_komi = {6.5: 'japanese', 7.5: 'chinese'}

function katago_rule_from_sgf_rule(sgf_rule, komi) {
    if (!sgf_rule) {return guessed_rule_from_komi[komi]}
    const normalize = s => s.toLowerCase().replace(/[-_ ]/g, '')  // for robustness
    const target = normalize(sgf_rule)
    const hit = name_table.find(a => a.map(normalize).includes(target))
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
