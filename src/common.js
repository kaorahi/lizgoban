function to(target) {
    Object.assign(target, require('./util.js'), require('./coord.js'))
}
module.exports = {to}
