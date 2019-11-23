// give_and_take.js: write bidirectional dependencies shortly

// Example:
//
// (foo.js)
// const GT = require('./give_and_take.js')
// function bar(x) {return x + GT.received.qux}
// function baz(x) {return x * GT.received.quux}
// GT.offer(module, {bar, baz})
//
// $ node
// > const FOO = require('./foo.js').pay({qux: 4, quux: 5})
// undefined
// > FOO.bar(3)
// 7

// Example of another style:
//
// (foo.js)
// const RECEIVED = {}
// function bar(x) {return x + RECEIVED.qux}
// function baz(x) {return x * RECEIVED.quux}
// require('./give_and_take.js').offer(module, {bar, baz}, RECEIVED)
//
// $ node
// > require('./foo.js').pay({qux: 4, quux: 5}, global)
// { bar: [Function: bar], baz: [Function: baz] }
// > bar(3)
// 7

const received = {}

function offer(the_module, exported, receive_to, on_paid) {
    const pay = (paid, merge_to) => {
        Object.assign(received, paid)
        receive_to && Object.assign(receive_to, paid)
        on_paid && on_paid(paid)
        merge_to && Object.assign(merge_to, exported)
        return exported
    }
    the_module.exports = {pay}
}

module.exports = {offer, received}
