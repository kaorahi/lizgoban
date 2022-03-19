'use strict'

const electron = require('electron')
const {send, sendSync} = electron.ipcRenderer
const preferences = sendSync('get_preferences')

function Q(x) {return document.querySelector(x)}
function create(x) {return document.createElement(x)}
function id_for(key) {return `checkbox_id_for_${key}`}

window.onload = () => {
    const pref = Q('#preferences')
    preferences.forEach(([key, val, label_text]) => {
        const id = id_for(key)
        // label
        const label = create('label')
        label.textContent = label_text
        label.setAttribute('for', id)
        // checkbox
        const checkbox = create('input')
        const on_change = () => send('set_preference', key, checkbox.checked)
        const toggle = () => {checkbox.checked = !checkbox.checked; on_change()}
        checkbox.type = 'checkbox'
        checkbox.id = id
        checkbox.checked = val
        checkbox.addEventListener('change', on_change)
        // div
        const div = create('div')
        div.classList.add('item')
        div.addEventListener('click', e => (e.target === div) && toggle())
        div.append(checkbox, label)
        pref.appendChild(div)
    })
    // Q('#debug').textContent = JSON.stringify(preferences)
}

document.onkeydown = e => {
    if (e.key === "Escape" || e.ctrlKey && e.key === "[") {window.close()}
}
