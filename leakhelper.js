LeakHelper = (function() {
    function traverse(object, checker, recorder, path) {

        // first run the checker function, otherwise we won't get multiple references
        if (checker(object)) {
            console.log("LeakHelper FOUND: " + pathArrayToString(path));
        }

        // check if the object has been visited
        if (recorder.hasVisited(object, path)) {
            return;
        }
        else {
            // return since we have no way of knowing whether this will lead to a loop
            if (recorder.recordVisit(object, path)) {
                // console.warn("LeakHelper WARNING: couldn't record path: " + pathArrayToString(path));
                return;
            }
        }

        // fatal error if we get very deep
        if (path.length > 100) {
            console.warn("LeakHelper WARNING: too deep: " + pathArrayToString(path));
            throw new Error();
        }

        // check each object property
        if (typeof object === "object") {
            for (var property in object) {
                if (Object.prototype.hasOwnProperty.call(object, property)) {
                    path.push(property);
                    traverse(object[property], checker, recorder, path);
                    path.pop();
                }
            }
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

    // Canary Recorder: adds a canary property to every visited object. O(1)
    function CanaryRecorder(canaryName) {
        this.canaryName = canaryName || "__$$CANARY"+(CanaryRecorder.count++)+"$$__";
    }
    CanaryRecorder.prototype.hasVisited = function(object, path) {
        if (path[path.length-1] === this.canaryName)
            return true;
        return Object.prototype.hasOwnProperty.call(object, this.canaryName)
    }
    CanaryRecorder.prototype.recordVisit = function(object, path) {
        try {
            object[this.canaryName] = true;
        } catch (e) {
            return true;
        }
    }
    CanaryRecorder.count = 0;

    // Set Recorder: stores objects in a "set". Currently O(n)
    // FIXME: this is too slow for any significant application
    // function SetRecorder() {
    //     this.seen = [];
    // }
    // SetRecorder.prototype.hasVisited = function(object, path) {
    //     for (var i = 0; i < this.seen.length; i++)
    //         if (this.seen[i] === object)
    //             return true;
    //     return false;
    // }
    // SetRecorder.prototype.recordVisit = function(object, path) {
    //     this.seen.push(object);
    // }

    // Ignore decorator: checks if each object matches the ignore cases
    // Necessary special cases to avoid weird infinite depth object graphs
    function IgnoreDecorator(recorder, ignores) {
        this.recorder = recorder;
        this.ignores = ignores || IgnoreDecorator.defaults;
    }
    IgnoreDecorator.prototype.hasVisited = function(object, path) {
        for (var i = 0; i < this.ignores.length; i++) {
            if (this.ignores[i](object, path)) {
                // console.log("IGNORING: " + pathArrayToString(path));
                return true;
            }
        }
        return this.recorder.hasVisited.apply(this.recorder, arguments);
    }
    IgnoreDecorator.prototype.recordVisit = function(object, path) {
        return this.recorder.recordVisit.apply(this.recorder, arguments);
    }
    IgnoreDecorator.defaults = [
        function(o) {
            // DOMMimeType
            // must duck type check because instanceof doesn't work cross-frame
            return (o && o.description && o.enabledPlugin && o.suffixes && o.type);
        },
        function(o) {
            // DOMPlugin
            // must duck type check because instanceof doesn't work cross-frame
            return (o && o.description && o.filename && o.name && o.item && o.namedItem);
        }
    ];

    function DefaultRecorder() {
        return new IgnoreDecorator(new CanaryRecorder());
    }

    return {
        find : function(/* [object[, name],] checker*/) {
            var global = (function() { return this; })();
            var args = Array.prototype.slice.call(arguments);
            if (args.length < 3)
                args.unshift(undefined);
            if (args.length < 3)
                args.unshift(global);
            if (args[1] == undefined) {
                if (args[0] === global) {
                    if (typeof window !== "undefined")
                        args[1] = "window";
                    else
                        args[1] = "GLOBAL";
                }
                else
                    args[1] = "UNKNOWN";
            }

            console.log("LeakHelper START");

            var startTime = new Date();
            traverse(args[0], args[2], new DefaultRecorder(), [args[1]]);
            var endTime = new Date();

            console.log("LeakHelper DONE: " + (endTime - startTime) + " ms")
        }
    }
})();
