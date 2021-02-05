'use strict'

//////////////////////////////////////
// exports

let electron, store, set_stored

module.exports = (...a) => {
    [electron, store, set_stored] = a
    return {
        window_prop,
        window_for_id,
        get_windows,
        get_new_window,
        webPreferences,
        new_window,
        renderer,
        renderer_with_window_prop,
    }
}

//////////////////////////////////////
// window

let windows = [], last_window_id = -1

function window_prop(win) {  // fixme: adding private data impolitely
    const private_key = 'lizgoban_window_prop'
    return win[private_key] || (win[private_key] = {
        window_id: -1, board_type: '', previous_board_type: ''
    })
}

function window_for_id(window_id) {
    return get_windows().find(win => window_prop(win).window_id === window_id)
}

function get_windows() {
    return windows = windows.filter(win => !win.isDestroyed())
}

function get_new_window(file_name, opt) {
    const win = new electron.BrowserWindow(opt)
    win.loadURL('file://' + __dirname + '/' + file_name)
    return win
}

const webPreferences = {
    nodeIntegration: true, enableRemoteModule: true,
    worldSafeExecuteJavaScript: true, contextIsolation: false,
}
function new_window(default_board_type) {
    const window_id = ++last_window_id, conf_key = 'window.id' + window_id
    const ss = electron.screen.getPrimaryDisplay().size
    const {board_type, previous_board_type, position, size, maximized}
          = store.get(conf_key) || {}
    const [x, y] = position || [0, 0]
    const [width, height] = size || [ss.height, ss.height * 0.6]
    const win = get_new_window('index.html',
                               {x, y, width, height, webPreferences, show: false})
    const prop = window_prop(win)
    merge(prop, {
        window_id, board_type: board_type || default_board_type, previous_board_type
    })
    windows.push(win)
    maximized && win.maximize()
    win.on('close', () => set_stored(conf_key, {
        board_type: prop.board_type, previous_board_type: prop.previous_board_type,
        position: win.getPosition(), size: win.getSize(), maximized: win.isMaximized(),
    }))
    win.once('ready-to-show', () => win.show())
    return win
}

//////////////////////////////////////
// renderer

function renderer(channel, ...args) {renderer_gen(channel, false, ...args)}
function renderer_with_window_prop(channel, ...args) {
    renderer_gen(channel, true, ...args)
}
function renderer_gen(channel, win_prop_p, ...args) {
    // Caution [2018-08-08] [2019-06-20]
    // (1) JSON.stringify(NaN) is 'null' and JSON.stringify({foo: undefined}) is '{}'.
    // (2) IPC converts {foo: NaN} and {bar: undefined} to {}.
    // example:
    // [main.js] renderer('foo', {bar: NaN, baz: null, qux: 3, quux: undefined})
    // [renderer.js] ipc.on('foo', (e, x) => (tmp = x))
    // [result] tmp is {baz: null, qux: 3}
    get_windows().forEach(win => win.webContents
                          .send(channel, ...(win_prop_p ? [window_prop(win)] : []),
                                ...args))
}
