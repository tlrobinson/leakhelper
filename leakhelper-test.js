(function(LeakHelperTest) {

    LeakHelperTest.tests = [
        { Set : LeakHelper.CanarySet },///*
        { Set : LeakHelper.UIDSet },///*
        { Set : LeakHelper.BucketSet },/*,
        { Set : LeakHelper.SimpleSet }//*/
    ];

    function runLeakHelperTest(checker) {
        var result = LeakHelper.find({
            "checker" : checker,
            "set" : new this.Set(),
            "debug" : false,
            "console": this.console
        });
        return result.paths;
    }

    // Main test, runs each set type
    LeakHelperTest.runTestsBrowser = function(checker) {
        runTests({
            "test" : runLeakHelperTest,
            "args" : arguments,
            "contexts" : LeakHelperTest.tests,
            "reload" : false,

            // Uncomment to diff visited paths. debug must be enabled in runLeakHelperTest
            // "callback" : function(results) {
            //     for (var i = 0; i < results.length - 1; i++) {
            //         var d = diff(results[i], results[i+1]);
            //         console.log(i+" => "+(i+1)+": ADDED=", Object.keys(d.added), "REMOVED=", Object.keys(d.removed));
            //     }
            // }
        });
    }

    // an over-architected generic multi test runner with reloading and non-reloading modes.
    function runTests(options) {
        options.args        = options.args || [];
        options.contexts    = options.contexts || [null];
        options.console     = options.console || window.console;

        // no reload mode
        if (!options.reload) {
            var results = options.contexts.map(function(context) {
                context.console = options.console;
                return options.test.apply(context, options.args);
            });
            if (options.callback) {
                options.callback(results);
            } else {
                return results;
            }
        }
        // reload mode (saves test state and refreshes page between each test)
        else {
            var state = getState();

            // init state if it hasn't been or testNumber is greater than the number of tests
            if (!state || state.testNumber >= options.contexts.length) {
                state = { testNumber : 0, log : [] };
            }

            // only save the results if the callback is provided
            if (options.callback && !state.testResults) {
                state.testResults = [];
            }

            // setup logging shims
            function outputLog(line) {
                options.console[line[0]].apply(options.console, line[1]);
            }
            function log(level, args) {
                var line = [level, Array.prototype.slice.call(args)];
                state.log.push(line);
                outputLog(line);
            }
            options.contexts[state.testNumber].console = {
                log   : function() { log("log", arguments); },
                warn  : function() { log("warn", arguments); },
                error : function() { log("error", arguments); }
            };

            // replay console
            state.log.forEach(outputLog);

            // run the test
            var result = options.test.apply(options.contexts[state.testNumber], options.args);

            // save the results if
            if (state.testResults) {
                state.testResults[state.testNumber] = result;
            }

            state.testNumber++;
            setState(state);

            // reload for the next test, or execute callback if completed
            if (state.testNumber < options.contexts.length) {
                window.location.reload();
            } else if (options.callback) {
                options.callback(state.testResults);
            }
        }
    }

    var stateKey = "LeakHelperTest.runTestsBrowser.state";
    function getState() {
        var json;
        if (window.sessionStorage) {
            json = window.sessionStorage[stateKey];
        } else {
            json = decodeURIComponent(window.location.hash.substring(1));
        }
        return json ? JSON.parse(json) : null;
    }
    function setState(state) {
        var json = JSON.stringify(state);
        if (window.sessionStorage) {
            window.sessionStorage[stateKey] = json;
        } else {
            window.location.hash = "#" + encodeURIComponent(json);
        }
    }

    function diff(a, b, o) {
        var HOP = Object.prototype.hasOwnProperty;
        o = o || { added : {}, changed : {}, removed : {} };

        for (var p in b)
            if (o.added && HOP.call(b, p) && !HOP.call(a, p))
                o.added[p] = true;
        for (var p in a)
            if (o.removed && HOP.call(a, p) && !HOP.call(b, p))
                o.removed[p] = true;
        for (var p in a)
            if (o.modified && HOP.call(a, p) && HOP.call(b, p) && a[p] !== b[p])
                o.modified[p] = true;
        return o;
    }
})(typeof exports !== "undefined" ? exports : (LeakHelperTest = {}));
