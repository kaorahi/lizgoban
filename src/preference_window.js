'use strict'

const electron = require('electron')
const {send, sendSync} = electron.ipcRenderer
const preferences = sendSync('get_preferences')

function Q(x) {return document.querySelector(x)}
function create(x) {return document.createElement(x)}
function id_for(key) {return `checkbox_id_for_${key}`}

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
}

document.onkeydown = e => {
    if (e.key === "Escape" || e.ctrlKey && ["[", ","].includes(e.key)) {window.close(); return}
    if (e.ctrlKey || e.altKey || e.metaKey) {return}
    const action = shortcut_action[e.key]
    action && (e.preventDefault(), action())
}
