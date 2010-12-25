(function(LeakHelper) {

    var nonEnumerables = [
        "prototype",
        "constructor",
        "__proto__"
    ];

    function Context(options) {
        this.set = options.set;
        this.checker = options.checker;
        this.ignores = options.ignores;

        this.paths = {};
    }

    Context.prototype.traverse = function(object, path) {

        // Not necessary if we're careful about which
        // var pathKey = path.map(encodeURIComponent).join("/");
        // if (this.paths.hasOwnProperty(pathKey)) {
        //     // console.warn(pathKey)
        //     return;
        // }
        // this.paths[pathKey] = path;

        // first run the checker function, otherwise we won't get multiple references
        if (this.checker(object)) {
            LeakHelper.console.log("LeakHelper FOUND: " + pathArrayToString(path));
        }

        if (this.ignores && this.ignores(object, path)) {
            return;
        }

        // fatal error if we get very deep
        if (path.length > 100) {
            throw new Error("LeakHelper WARNING: too deep: " + pathArrayToString(path));
        }

        // check if this path has been seen
        // FIXME: this is very slow
        // var pathKey = path.map(encodeURIComponent).join("/");
        // if (this.paths.hasOwnProperty(pathKey)) {
        //     return;
        // }
        // this.paths[pathKey] = path;

        // check if the object has been visited
        if (this.set.contains(object, path)) {
            return;
        }
        this.set.add(object, path);

        // check each object property
        if (typeof object === "object" && object) {
            var keys = Object.keys(object);

            nonEnumerables.forEach(function(property) {
                if (keys.indexOf(property) < 0 && typeof object[property] !== "undefined") {
                    keys.push(property);
                }
            });

            keys.forEach(function(property) {
                path.push(property);
                this.traverse(object[property], path);
                path.pop();
            }, this);
        }
    }

    function pathArrayToString(arr) {
        return arr[0] + arr.slice(1).map(function(p) {
            if (/^-?\d+$/.test(p))
                return "["+JSON.stringify(parseInt(p, 10))+"]";
            else if (/\W/.test(p))
                return "["+JSON.stringify(p)+"]";
            return "." + p;
        }).join("");
    }

    // sets an object's property if possible, returns true if successful, false otherwise
    function setOwnProperty(object, name, value) {
        try {
            if (object != null) {
                if (typeof Object.defineProperty === "function" && typeof object === "object") {
                    try {
                        Object.defineProperty(object, name, { value : value });
                    } catch (e) {
                        // DOM objects don't support defineProperty
                        if (e.name === "TypeError") {
                            object[name] = value;
                        }
                    }
                } else {
                    object[name] = value;
                }
                if (Object.prototype.hasOwnProperty.call(object, name) && object[name] === value) {
                    return true;
                }
            }
        } catch (e) {
            LeakHelper.console.warn("setOwnProperty error: " + e);
        }
        return false;
    }

    // gets an object's property if set on the object itself (not in the proto chain)
    function getOwnProperty(object, name) {
        try {
            if (object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, name)) {
                return object[name];
            }
        } catch (e) {
            LeakHelper.console.warn("getOwnProperty error: " + e);
        }
        return undefined;
    }

    // Canary Set: adds a canary property to every visited object.
    // This works as long as we don't need to enumerate the set.
    function CanarySet(canaryName) {
        this.canary = {};
        this.canaryName = canaryName || "__$$CANARY"+(CanarySet.count++)+"$$__";
        this.fallback = new BucketSet();
        this.count = 0;
        this.objects = [];
    }
    CanarySet.count = 0;
    CanarySet.prototype.contains = function(object) {
        return (
            getOwnProperty(object, this.canaryName) === this.canary ||
            this.fallback.contains(object)
        );
    }
    CanarySet.prototype.add = function(object) {
        if (!this.contains(object)) {
            if (!setOwnProperty(object, this.canaryName, this.canary)) {
                // LeakHelper.console.log("CanarySet falling back");
                this.fallback.add(object);
            }
            this.count++;
            this.objects.push(object);
        }
    }
    CanarySet.prototype.logStats = function() {
        LeakHelper.console.log("LeakHelper STATS: unique objects=" + this.count + " fallback=" + this.fallback.count);
    }

    // UID Set: adds a UID to each object added to the set and uses it as the key.
    // Fallback for objects that can't be modified
    function UIDSet() {
        this.set = {};
        this.fallback = new BucketSet();
        this.count = 0;
        this.objects = [];
    }

    UIDSet.uidName = "__$$UID$$__";
    UIDSet.uidNext = 0;

    UIDSet.prototype.contains = function(object) {
        var uid = getOwnProperty(object, UIDSet.uidName);
        if (typeof uid === "number") {
            return this.set[uid] === object;
        } else {
            return this.fallback.contains(object);
        }
    }
    UIDSet.prototype.add = function(object) {
        if (!this.contains(object)) {
            if (setOwnProperty(object, UIDSet.uidName, UIDSet.uidNext)) {
                this.set[UIDSet.uidNext] = object;
                UIDSet.uidNext++;
            } else {
                // LeakHelper.console.log("UIDSet falling back");
                this.fallback.add(object);
            }
            this.count++;
            this.objects.push(object);
        }
    }
    UIDSet.prototype.logStats = function() {
        LeakHelper.console.log("LeakHelper STATS: unique objects=" + this.count + " fallback=" + this.fallback.count);
    }

    // BucketSet: uses toString as a bucket hash key, stores objects in bucket's list
    function BucketSet() {
        this.buckets = {};
        this.count = 0;
        this.objects = [];
    }
    BucketSet.prototype.contains = function(object) {
        try {
            var hash = String(object);
        } catch (e) {
            var hash = "[UNKNOWN]";
        }
        var bucket = this.buckets[hash];
        return (bucket && bucket.indexOf(object) >= 0) || false;
    }
    BucketSet.prototype.add = function(object) {
        try {
            var hash = String(object);
        } catch (e) {
            var hash = "[UNKNOWN]";
        }
        var bucket = this.buckets[hash] = this.buckets[hash] || [];
        if (bucket.indexOf(object) < 0) {
            bucket.push(object);
            this.count++;
            this.objects.push(object);
        }
    }
    BucketSet.prototype.logStats = function() {
        LeakHelper.console.log("LeakHelper STATS: unique objects=" + this.count + " buckets=" + Object.keys(this.buckets).length);
    }

    // Simple Set: stores objects in a "set". Currently O(n)
    // FIXME: this is too slow for any significant application
    function SimpleSet() {
        this.bucket = [];
    }
    SimpleSet.prototype.contains = function(object) {
        return this.bucket.indexOf(object) >= 0;
    }
    SimpleSet.prototype.add = function(object) {
        if (this.bucket.indexOf(object) < 0) {
            this.bucket.push(object);
        }
    }
    SimpleSet.prototype.logStats = function() {
        LeakHelper.console.log("LeakHelper STATS: unique objects=" + this.bucket.length);
    }

    // Ignore decorator: checks if each object matches the ignore cases
    // Necessary special cases to avoid weird infinite depth object graphs
    function IgnoreChecker(ignores) {
        ignores = ignores || IgnoreChecker.defaults;
        return function(object, path) {
            for (var i = 0; i < ignores.length; i++) {
                if (ignores[i](object, path)) {
                    // LeakHelper.console.log("IGNORING: " + pathArrayToString(path));
                    return true;
                }
            }
            return false;
        }
    }
    IgnoreChecker.defaults = [
        // DOMMimeType / DOMPlugin
        function(o) {
            // must duck type check because instanceof doesn't work cross-frame
            return (o && o.description && o.enabledPlugin && o.suffixes && o.type) ||
                   (o && o.description && o.filename && o.name && o.item && o.namedItem);
        },
        // Canary / UID
        // FIXME: canaries/uids are marked non-enumerable but this doesn't work on window
        function(_, path) {
            if (/^__\$\$.*\$\$__$/.test(path[path.length-1])) {
                // console.error(path.join("."))
                return true;
            }
        }//*/
    ];

    LeakHelper.console = console;

    LeakHelper.CanarySet = CanarySet;
    LeakHelper.UIDSet    = UIDSet;
    LeakHelper.BucketSet = BucketSet;
    LeakHelper.SimpleSet = SimpleSet;

    LeakHelper.IgnoreChecker = IgnoreChecker;

    LeakHelper.find = function(arg) {
        var global = (function() { return this; })();

        var options = (typeof arg === "function") ? { checker : arg } : arg;
        // if no root is provided use the global object
        if (typeof options.root === "undefined") {
            options.root = global;
        }
        // if no path is provided try to determine if it's "window" or something else
        if (typeof options.path === "undefined") {
            if (options.root === global) {
                if (typeof window !== "undefined" && window === global)
                    options.path = "window";
                else
                    options.path = "GLOBAL";
            }
            else
                options.path = "UNKNOWN";
        }
        // if the path is a string, replace it with an array
        if (typeof options.path === "string") {
            options.path = [options.path];
        }
        // if no set implementation was provided create a default one
        if (typeof options.set === "undefined") {
             options.set = new LeakHelper.BucketSet();
        }
        // if no ignore checker was provided create a default
        if (typeof options.ignores === "undefined") {
            options.ignores = IgnoreChecker();
        }

        // try {

            var context = new Context(options);

            LeakHelper.console.log(Array(41).join("-"));
            LeakHelper.console.log("LeakHelper START");

            var startTime = new Date();

            context.traverse(options.root, options.path);

            var endTime = new Date();

            LeakHelper.console.log("LeakHelper DONE: finished in " + (endTime - startTime) + " ms")
            options.set.logStats();
        // } catch (e) {
        //     LeakHelper.console.error(e);
        // }

        return context;
    }

    var setNames = [
        "CanarySet",
        "UIDSet",
        "BucketSet"/*,
        "SimpleSet"//*/
    ];

    LeakHelper.runTestsBrowser = function(checker) {
        var data = window.location.hash.substring(1);
        if (data) {
            var options = JSON.parse(decodeURIComponent(data));
        } else {
            var options = { test : 0, log : "" };
        }

        LeakHelper.console = {
            log   : function() { log("log:   ", arguments); },
            warn  : function() { log("warn:  ", arguments); },
            error : function() { log("error: ", arguments); }
        };

        document.body.innerHTML = "";
        document.body.style = "font-family: monospace; white-space: pre;";

        function log(level, args) {
            options.log += level + Array.prototype.join.call(args, " ") + "\n";
            document.body.innerText = options.log;
        }

        LeakHelper.find({
            "checker" : checker,
            "set" : new LeakHelper[setNames[options.test]]()
        });

        options.test++;

        if (options.test < setNames.length) {
            window.location.hash = "#" + encodeURIComponent(JSON.stringify(options));
            window.location.reload();
        }
    }


    LeakHelper.runTestsBrowser = function(checker) {
        var sets = [
            new LeakHelper.UIDSet(),
            new LeakHelper.CanarySet(),
            new LeakHelper.BucketSet()
        ];

        var results = sets.map(function(set) {
            return LeakHelper.find({
                "checker" : checker,
                "set" : set
            });
        });

        // diff(sets[1], sets[2])
        var d = diff({
            before  : results[0].paths,
            after   : results[1].paths,
            added   : {},
            removed : {}
        });
        console.log(d.added, d.removed);
    }

    // function diff(setA, setB) {
    //     var a = 0, b = 0;
    //     setA.objects.forEach(function(object) {
    //         if (!setB.contains(object) && setB.objects.indexOf(object) < 0) {
    //             a++;
    //             // console.log("A contains: ", object, typeof object);
    //         }
    //     });
    //     setB.objects.forEach(function(object) {
    //         if (!setA.contains(object) && setA.objects.indexOf(object) < 0) {
    //             b++;
    //             // console.log("B contains: ", object, typeof object);
    //         }
    //     });
    //     console.log("a="+a+" b="+b);
    // }

    function diff(o) {
        for (var i in o.after)
            if (o.added && !(o.ignore && o.ignore[i]) && typeof o.before[i] == "undefined")
                o.added[i] = true;
        for (var i in o.after)
            if (o.changed && !(o.ignore && o.ignore[i]) && typeof o.before[i] != "undefined" && typeof o.after[i] != "undefined" && o.before[i] !== o.after[i])
                o.changed[i] = true;
        for (var i in o.before)
            if (o.deleted && !(o.ignore && o.ignore[i]) && typeof o.after[i] == "undefined")
                o.deleted[i] = true;
        return o;
    }
})(typeof exports !== "undefined" ? exports : (LeakHelper = {}));
