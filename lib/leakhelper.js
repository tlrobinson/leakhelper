(function(LeakHelper) {

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
        // if no ignore console was provided use default
        if (options.silent) {
            options.console = nullConsole;
        } else if (typeof options.console === "undefined") {
            options.console = LeakHelper.console;
        }

        try {
            var context = new Context(options);

            options.console.log(Array(41).join("-"));
            options.console.log("LeakHelper START");

            var startTime = new Date();
            context.traverse(options.root, options.path);
            var endTime = new Date();

            options.console.log("LeakHelper DONE: finished in " + (endTime - startTime) + " ms")
            options.console.log(options.set.stats());
        } catch (e) {
            options.console.error(e);
        }
        options.console.log(Array(41).join("-"));

        return {
            matches : context.matches,
            paths : context.paths,/*
            set: context.set//*/
        }
    }

    function Context(options) {
        for (var name in options) {
            if (options.hasOwnProperty(name)) {
                this[name] = options[name];
            }
        }

        if (!this.console)
            this.console = LeakHelper.console;

        this.matches = [];
        this.paths = {};
    }

    LeakHelper.nonEnumerables = [
        "prototype",
        "constructor",
        "__proto__"
    ];

    Context.prototype.traverse = function traverse(object, path) {
        var queue = [{ object: object, path : path }];
        var secondQueue = [];

        var dequeueMethod = this.dfs ? "pop" : "shift";

        while (queue.length > 0 || secondQueue.length > 0) {
            var item = queue.length > 0 ? queue[dequeueMethod]() : secondQueue[dequeueMethod]();

            var object = item.object;
            var path = item.path;

            // check to see if we should ignore this object/path
            if (this.ignores && this.ignores(object, path)) {
                continue;
            }

            // record each path visited
            if (this.debug) {
                var pathKey = pathArrayToHash(path);
                // not necessary to check if we're careful about not visiting child paths multiple times
                if (this.paths.hasOwnProperty(pathKey)) {
                    this.console.warn(pathKey)
                    continue;
                }
                this.paths[pathKey] = path;
            }

            var visited = this.set.contains(object, path);

            // first run the checker function, otherwise we won't find multiple references
            if ((this.traverseMultiple || !visited) && this.checker(object, path, visited)) {
                this.console.log("LeakHelper FOUND: " + pathArrayToString(path));
                this.matches.push({ path : path.slice(), object : object });
            }

            // fatal error if we get very deep
            if (path.length > 100) {
                throw new Error("LeakHelper WARNING: too deep: " + pathArrayToString(path));
            }

            // check if the object has been visited
            if (visited) {
                continue;
            }
            this.set.add(object, path);

            var type = typeof object;
            if ((type === "object" || type === "function") && object) {
                var properties = {};

                // enumerate object's properties
                for (var property in object) { properties[property] = true; }

                // other well-known properties that aren't usually enumerable
                LeakHelper.nonEnumerables.forEach(function(property) { properties[property] = true; });

                Object.keys(properties).forEach(function(property) {
                    if (Object.prototype.hasOwnProperty.call(object, property)) {
                        queue.push({ object: object[property], path : path.concat(property) });
                    } else if (this.traversePrototypes) {
                        secondQueue.push({ object: object[property], path : path.concat(property) });
                    }
                }, this);
            }
        }
    }

    // formats a path array as a string of valid JavaScript property lookups
    // e.x. ["foo", "bar", "1", "baz", "bu zz"] becomes foo.bar[1].baz["bu zz"]
    function pathArrayToString(path) {
        return path[0] + path.slice(1).map(function(p) {
            if (/^-?\d+$/.test(p))
                return "["+JSON.stringify(parseInt(p, 10))+"]";
            else if (/\W/.test(p))
                return "["+JSON.stringify(p)+"]";
            return "." + p;
        }).join("");
    }
    // creates an unambiguous (and reversible) string we can use as a hash key
    function pathArrayToHash(path) {
        return path.map(encodeURIComponent).join("/");
    }
    // reverse
    function pathHashToArray(hash) {
        return hash.split("/").map(decodeURIComponent);
    }

    // Set Implementations:
    // These sets currently only implement "contains" and "add".
    //
    // Ordered from fastest to slowest (for large sets, several thousand objects or more):
    // * CanarySet: adds a "canary" property to each object, fallback to BucketSet.
    // * UIDSet:    adds a UID to each object, fallback to BucketSet.
    // * BucketSet: "hashes" object to buckets using toString(), then stores in list.
    // * SimpleSet: array-based, O(n) set membership (too slow).

    // Canary Set: adds a "canary" property to each object, fallback to BucketSet.
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
    CanarySet.prototype.stats = function() {
        return "CanarySet STATS: unique objects=" + this.count + " fallback=" + this.fallback.count;
    }

    // UID Set: adds a UID to each object, fallback to BucketSet.
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
    UIDSet.prototype.stats = function() {
        return "UIDSet STATS: unique objects=" + this.count + " fallback=" + this.fallback.count;
    }

    // Bucket Set: "hashes" object to buckets using toString(), then stores in list.
    function BucketSet() {
        this.buckets = {};
        this.count = 0;
        this.objects = [];
    }
    BucketSet.prototype.contains = function contains(object) {
        try {
            var hash = String(object);
            if (hash === "__proto__")
                throw new Error();
        } catch (e) {
            var hash = "[UNKNOWN]";
        }
        if (!Object.prototype.hasOwnProperty.call(this.buckets, hash))
            return false;
        return this.buckets[hash].indexOf(object) >= 0;
    }
    BucketSet.prototype.add = function(object) {
        try {
            var hash = String(object);
            if (hash === "__proto__")
                throw new Error();
        } catch (e) {
            var hash = "[UNKNOWN]";
        }
        if (!Object.prototype.hasOwnProperty.call(this.buckets, hash))
            this.buckets[hash] = [];
        if (this.buckets[hash].indexOf(object) < 0) {
            this.buckets[hash].push(object);
            this.count++;
            this.objects.push(object);
        }
    }
    BucketSet.prototype.stats = function() {
        return "BucketSet STATS: unique objects=" + this.count + " buckets=" + Object.keys(this.buckets).length;
    }

    // Simple Set: array-based, O(n) set membership (too slow).
    function SimpleSet() {
        this.bucket = [];
    }
    SimpleSet.prototype.contains = function(object) {
        return this.bucket.indexOf(object) >= 0;
    }
    SimpleSet.prototype.add = function(object) {
        if (!this.contains(object)) {
            this.bucket.push(object);
        }
    }
    SimpleSet.prototype.stats = function() {
        return "SimpleSet STATS: unique objects=" + this.bucket.length;
    }

    // setOwnProperty/getOwnProperty helpers used by CanarySet and UIDSet

    // sets an object's property if possible, returns true if successful, false otherwise
    function setOwnProperty(object, name, value, options) {
        // default to using defineProperty, and fallback to simple assignment if it fails.
        options = options || { nonEnumerable : true, enumerableFallback : true };
        try {
            if (object != null) {
                if (options.nonEnumerable && typeof object === "object" && typeof Object.defineProperty === "function") {
                    try {
                        Object.defineProperty(object, name, { value : value, enumerable : false });
                    } catch (e) {
                        // DOM objects don't support defineProperty
                        if (options.enumerableFallback && e.name === "TypeError") {
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


    // Ignore decorator: checks if each object matches the ignore cases
    // Necessary special cases to avoid weird infinite depth object graphs
    function IgnoreChecker(ignores) {
        ignores = ignores || IgnoreChecker.defaults;
        return function ignore(object, path) {
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
        // Canary / UID filter
        // FIXME: canaries/uids are marked non-enumerable but this doesn't work on DOM objects
        function(_, path) {
            if (/^__\$\$.*\$\$__$/.test(path[path.length-1])) {
                return true;
            }
        },
        // Console (profiles cause problems)
        function(o) {
            return (o && o.log && o.warn && o.error && o.profile && o.profileEnd && o.profiles);
        }
    ];

    var nullConsole = {};
    nullConsole.log = nullConsole.warn = nullConsole.error = function() {};

    if (typeof console !== "undefined") {
        LeakHelper.console = console;
    } else {
        LeakHelper.console = nullConsole;
    }

    LeakHelper.pathArrayToString = pathArrayToString;
    LeakHelper.pathArrayToHash = pathArrayToHash;
    LeakHelper.pathHashToArray = pathHashToArray;

    LeakHelper.CanarySet = CanarySet;
    LeakHelper.UIDSet    = UIDSet;
    LeakHelper.BucketSet = BucketSet;
    LeakHelper.SimpleSet = SimpleSet;

    LeakHelper.IgnoreChecker = IgnoreChecker;

})(typeof exports !== "undefined" ? exports : (LeakHelper = {}));
