// globally.js: make exported items usable in global namespace

// Example:
//
// (foo.js)
// function bar(x) {return x + 1}
// function baz(x) {return x * 2}
// require('./globally.js').export_globally(module, {bar, baz})
//
// $ node
// > require('./foo.js').use()
// undefined
// > bar(3)
// 4

module.exports = {
    export_globally: (m, h) => (m.exports = Object.assign({}, h, {
        use: () => {Object.assign(global, h)}
    }))
}
