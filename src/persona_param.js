'use strict'

///////////////////////////////////////
// constants

const stone_cases = 3, ownership_cases = 2
const elt_bits = 2, elt_min = -1
const code_radix_bits = 4  // multiple of elt_bits

const total_cases = stone_cases * ownership_cases
const elt_variations = pow(elt_bits), raw_max = elt_variations - 1
const elt_max = elt_from_raw(raw_max)
const code_radix = pow(code_radix_bits)
const code_len = total_cases * elt_bits / code_radix_bits  // must be int

///////////////////////////////////////
// public

function generate_persona_param(code) {
    let param, explicitly_given_code
    if ((code !== undefined) && !stringp(code)) {return null}
    code ? set_code(code) : randomize()

    function get() {return param}
    function set(z) {param = z; explicitly_given_code = null}
    function get_code() {return true_or(explicitly_given_code, code_for_param(get()))}
    function set_code(code) {set(param_for_code(code)); explicitly_given_code = code}
    function randomize() {set(random_param())}

    return {
        get, set,
        get_code, set_code,
        randomize,
    }
}  // persona_param()

function persona_random_code() {return code_for_param(random_param())}

function persona_html_for_code(code) {
    const board_labels = ["AI's stone", "your stone", "empty grid"]
    const ownership_labels = ["AI's ownership", "your ownership"]
    const param = param_for_code(code)
    const p_rows = aa_transpose(param)
    const format = z => Math.round(z * 5)
    // const format = z => z.toFixed(1)
    function color_for(elt) {
        const rgb = elt >= 0 ? '0,0,255' : '255,0,0'
        const alpha = elt >= 0 ? elt / elt_max : elt / elt_min
        return `rgba(${rgb},${alpha})`
    }
    function tag(name, inner, ...attrs) {
        const a = attrs.map(([k, v]) => `${k}="${v}"`)
        return `<${[name, ...a].join(" ")}>${inner}</${name}>`
    }
    function td(elt) {
        const s = format(elt)
        const style = `background: ${color_for(elt)};`
        return tag("td", s, ["style", style])
    }
    function th(label) {return tag("th", label)}
    function tr(cols) {return tag("tr", cols.join(""))}
    const prof = '<code></code>'  // insert code later for avoiding HTML injection
    const header = tr([prof, ...board_labels].map(th))
    const rows = p_rows.map((r, k) => tr([th(ownership_labels[k]), ...r.map(td)]))
    const table = tag("table", header + rows.join(""))
    const sample_for = elt =>
          `<span style="display: inline-block; width: 1em; background: ${color_for(elt)};">&nbsp;</span>`
    return `
<div>${table}</div>
<div>
${sample_for(elt_max)} care
&nbsp;
${sample_for(elt_min)} invert (= prefer to lose score)
</div>
`
}

///////////////////////////////////////
// private

function persona_code_valid(code) {
    return stringp(code) && code_for_param(param_for_direct_code(code)) === code
}
function code_for_param(param) {
    const k = raws_from_param(param).reduce((a, z) => (a << elt_bits) + z)
    return to_code(k)
}
function param_for_code(code) {
    if (persona_code_valid(code)) {return param_for_direct_code(code)}
    const hexes = sha256sum(code).slice(0, total_cases).split('')
    const raws = hexes.map(hex => raw_max * parseInt(hex, 16) / 15)
    return param_from_raws(raws)
}
function param_for_direct_code(code) {
    const elt_radix = elt_variations
    const raw_str = to_str(parseInt(code, code_radix), elt_radix, total_cases)
    const raws = raw_str.split('').map(c => parseInt(c, elt_radix))
    return param_from_raws(raws)
}
function random_param() {
    function rand_raw() {return Math.floor(Math.random() * elt_variations)}
    const raws = seq(total_cases).map(rand_raw)
    return param_from_raws(raws)
}

// util
function pow(k) {return 1 << k}
function to_str(k, radix, len) {return k.toString(radix).padStart(len, "0")}
function to_code(k) {return to_str(k, code_radix, code_len)}
function elt_from_raw(z) {return z + elt_min}  // raw = 0, 1, 2, ...
function raw_from_elt(z) {return z - elt_min}
function param_from_raws(raws) {
    const elts = raws.map(elt_from_raw)
    function head_of_row(k) {return k * ownership_cases}
    function row(k) {return elts.slice(head_of_row(k), head_of_row(k + 1))}
    return seq(stone_cases).map(row)
}
function raws_from_param(param) {return param.flat().map(raw_from_elt)}

///////////////////////////////////////
// example

// (() => {
//     const p = generate_persona_param()

//     // [ [ 2, 1 ], [ 0, 2 ], [ 0, -1 ] ] e74  (for example)
//     console.log(p.get(), p.get_code())
//     p.set_code(p.get_code()); console.log(p.get(), p.get_code())

//     // [ [ -1, -1 ], [ -1, -1 ], [ -1, -1 ] ]
//     p.set_code("000"); console.log(p.get())

//     // [ [ 2, 2 ], [ 2, 2 ], [ 2, 2 ] ]
//     p.set_code("fff"); console.log(p.get())

//     // [ [ -1, 0 ], [ -1, 1 ], [ -1, 2 ] ]
//     p.set_code("123"); console.log(p.get())
// })()

///////////////////////////////////////
// exports

module.exports = {
    generate_persona_param,
    persona_random_code,
    persona_html_for_code,
}
