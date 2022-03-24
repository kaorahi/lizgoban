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
const hex_code_len = total_cases * elt_bits / 4  // must be int

///////////////////////////////////////
// public

function generate_persona_param(code) {
    let param
    if ((code !== undefined) && !stringp(code)) {return null}
    code ? set_code(code) : randomize()

    function get() {return param}
    function set(z) {param = z}
    function get_code() {return code_for_param(get())}
    function set_code(code) {set(param_for_code(code))}
    function randomize() {set(random_param())}

    return {
        get, set,
        get_code, set_code,
        randomize,
    }
}  // persona_param()

function persona_random_code() {return code_for_param(random_param())}

function persona_html_for_code(code) {
    const sym = {"-1": "-", 0: ".", 1: "+", 2: "!"}
    const board_labels = ["AI's stone", "your stone", "empty grid"]
    const ownership_labels = ["AI's ownership", "your ownership"]
    const param = param_for_code(code)
    const p_rows = aa_transpose(param)
    function tag(name, inner, ...attrs) {
        const a = attrs.map(([k, v]) => `${k}="${v}"`)
        return `<${[name, ...a].join(" ")}>${inner}</${name}>`
    }
    function td(elt) {const s = sym[elt]; return tag("td", s, ["data-sym", s])}
    function th(label) {return tag("th", label)}
    function tr(cols) {return tag("tr", cols.join(""))}
    const prof = '<code></code>'  // insert code later for avoiding HTML injection
    const header = tr([prof, ...board_labels].map(th))
    const rows = p_rows.map((r, k) => tr([th(ownership_labels[k]), ...r.map(td)]))
    const table = tag("table", header + rows.join(""))
    return `
<div>${table}</div>
<div>
<ul>
<li><span data-sym="!">!</span> care much</li>
<li><span data-sym="+">+</span> care</li>
<li><span data-sym=".">.</span> ignore</li>
<li><span data-sym="-">-</span> invert (= prefer to lose score)</li>
</ul>
</div>
`
}

///////////////////////////////////////
// private

function persona_code_valid(code) {
    return stringp(code) && code_for_param(param_for_strict_code(code)) === code
}
function code_for_param(param) {
    const k = raws_from_param(param).reduce((a, z) => (a << elt_bits) + z)
    return to_code(k)
}
function param_for_code(code) {
    if (persona_code_valid(code)) {return param_for_strict_code(code)}
    const k = parseInt(sha256sum(code).slice(0, hex_code_len), 16)
    return param_for_strict_code(to_code(k))
}
function param_for_strict_code(code) {
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
