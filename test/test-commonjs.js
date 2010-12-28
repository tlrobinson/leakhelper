var LeakHelper = require("./leakhelper");

// FIXME: remove narwhal special case
if (typeof system === "object") {
    var con = {};
    con.log = con.warn = con.error = function() { print(Array.prototype.join.call(arguments, " ")); }
} else {
    var con = console;
}

var root = {
    foo : {
        bar : {
            baz : 1234
        }
    }
};

LeakHelper.find({
    root : root,
    checker : function(o) { return o === 1234; },
    console : con
});
