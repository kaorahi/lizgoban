'use strict'

const {
    humansl_rank_profiles,
    humansl_preaz_profiles,
    humansl_proyear_profiles,
} = require('./util.js')

const electron = require('electron')
const {send, sendSync} = electron.ipcRenderer
const preferences = sendSync('get_preferences')
const humansl_comparison = sendSync('get_humansl_comparison')

function Q(x) {return document.querySelector(x)}
function setq(x, val) {Q(x).textContent = val}
function create(x) {return document.createElement(x)}
function id_for(key) {return `checkbox_id_for_${key}`}

const to_i = x => (x | 0)  // to_i(true) is 1!
const to_f = x => (x - 0)  // to_f(true) is 1!

const shortcut_action = {}

window.onload = () => {
    const pref = Q('#preferences')
    preferences.forEach(([key, val, label_text, shortcut_key]) => {
        const id = id_for(key)
        // label
        const label = create('label')
        label.textContent = ` ${label_text}`
        label.setAttribute('for', id)
        // checkbox
        const checkbox = create('input')
        const on_change = () => send('set_preference', key, checkbox.checked)
        const toggle = () => {checkbox.checked = !checkbox.checked; on_change()}
        checkbox.type = 'checkbox'
        checkbox.id = id
        checkbox.checked = val
        checkbox.addEventListener('change', on_change)
        // shortcut
        const shortcut = create('code')
        shortcut.textContent = `[${shortcut_key}] `
        shortcut.classList.add('shortcut')
        shortcut_action[shortcut_key] = toggle
        // div
        const div = create('div')
        div.classList.add('item')
        div.addEventListener('click', e => (e.target === div) && toggle())
        div.append(shortcut, checkbox, label)
        pref.appendChild(div)
    })
    // Q('#debug').textContent = JSON.stringify(preferences)
    initialize_humansl_comparison()
}

document.onkeydown = e => {
    if (e.key === "Escape" || e.ctrlKey && ["[", ","].includes(e.key)) {window.close(); return}
    if (e.ctrlKey || e.altKey || e.metaKey) {return}
    const action = shortcut_action[e.key]
    action && (e.preventDefault(), action())
}

/////////////////////////////////////////////
// humanSL comparison

const humansl_profile_lists = [
    humansl_rank_profiles.toReversed(),
    humansl_preaz_profiles.toReversed(),
    humansl_proyear_profiles,
    [null],  // KataGo's original policy
]
function cum_len(aa) {
    const las = a => a.length - 1
    const f = (r, ps) => [...r, r[las(r)] + ps.length]
    return aa.slice(0, las(aa)).reduce(f, [0])
}
const humansl_profile_options = [].concat(...humansl_profile_lists)
const humansl_profile_markers = cum_len(humansl_profile_lists)

function initialize_humansl_comparison() {
    const h = humansl_comparison, hpo = humansl_profile_options
    if (!h) {Q('#humansl_comparison_box').style.visibility = 'hidden'; return}
    const stronger_slider = Q('#humansl_stronger_profile')
    const weaker_slider = Q('#humansl_weaker_profile')
    stronger_slider.max = weaker_slider.max = humansl_profile_options.length - 1
    stronger_slider.value = hpo.indexOf(h.humansl_stronger_profile)
    weaker_slider.value = hpo.indexOf(h.humansl_weaker_profile)
    Q('#humansl_color_enhance').value = h.humansl_color_enhance
    const markers = Q('#humansl_profile_markers')
    humansl_profile_markers.forEach(m => {
        const option = create('option')
        option.value = m
        markers.appendChild(option)
    })
    update_humansl_comparison(true)
}

function update_humansl_comparison(text_only_p) {
    const p = z => humansl_profile_options[to_i(Q(z).value)]
    const humansl_stronger_profile = p('#humansl_stronger_profile')
    const humansl_weaker_profile = p('#humansl_weaker_profile')
    const humansl_color_enhance = to_f(Q('#humansl_color_enhance').value)
    const no_profile = '(katago)'
    setq('#humansl_stronger_profile_label', humansl_stronger_profile || no_profile)
    setq('#humansl_weaker_profile_label', humansl_weaker_profile || no_profile)
    setq('#humansl_color_enhance_label', `color enhance ${humansl_color_enhance}`)
    if (text_only_p) {return}
    send('set_humansl_comparison', {
        humansl_stronger_profile,
        humansl_weaker_profile,
        humansl_color_enhance,
    })
}
