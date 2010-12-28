LeakHelper
==========

What does it do?
----------------

This simple tool assists you in tracking down *logical* memory leaks in JavaScript applications by traversing the object graph looking for reachable objects that should not be referenced, as determined by a function you write. It is NOT an automatic memory leak finder.

More generally, it essentially walks the entire JavaScript object graph of your application, executing a function you supply, which should return "true" for any object you want to match (i.e. an object you don't expect to be referenced anywhere). When it finds such an object it logs the path from the root to the object using console.log(), as well as adding it to the "matches" array. Here is a trivial example:

    window.foo = {
        bar : {
            baz : 1234
        }
    }
    
    LeakHelper.find(function(o) {
        return (o === 1234);
    });

    // LeakHelper FOUND: window.foo.bar.baz

LeakHelper has been tested on two browsers (Safari 5 and Chrome 8), and two CommonJS platforms (Node.js and Narwhal).  Currently the only APIs used that might prevent compatibility are Array.prototype.forEach/map, Object.keys, console.log/warn/error, and possibly a few others. Patches are gladly accepted for compatibility with other environments. 

What doesn't it do?
-------------------

It does not automagically find all memory leaks for you. You must be able to write a function which determines whether an object is incorrectly referenced by your application or framework.

There are several limitations:

* Most importantly, it can only find references in objects reachable via property access (transitively) from the root object (defaults to the global object). For example, if an object is only referenced by a local variable captured in a closure it will not be seen.
* This means it may not find references in applications that make extensive use of closures, or file/module-scoped variables (for example, file-local "var" variables within Objective-J modules or CommonJS modules)
* It will not necessarily find leaks caused by JavaScript/browser engine bugs.

Example of reference through a closure:

    function x(y) {
        return function() {
            return y;
        }
    }

    var w = x({ z : 2345 });
    
    LeakHelper.find(function(o) {
        return (o === 2345);
    });
    
Nothing will be found even though the object containing z has not been garbage collected. This is a limitation of JavaScript, since we aren't able to introspect scopes, etc.

Instructions
------------

LeakHelper is especially useful in conjunction with the Heap Snapshot tool in Chrome's Web Inspector. Here's a suggested workflow for using LeakHelper and Chrome to find leaks:

1. Add the leakhelper.js script tag to your application's index.html
2. Load your application

If you already know which objects are leaking, skip to step 8.

3. Bring the application to a "baseline" state that you can later return to, for example no documents open.
4. Take a Heap Snapshop in Chrome's Web Inspector.
5. Perform some actions which you suspect may cause a noticeable memory leak, then return to the previous state.
6. Take another Heap Snapshot.
7. Compare the two snapshots, looking for excessive objects of the type you expect may be leaking.
8. Write your function which distinguishes between objects that you expect to be live (return "false") and objects you expect to not be referenced (return "true"). For example, if all documents have been closed then perhaps no objects of a certain type should be referenced anywhere in your application.
9. Execute LeakHelper.find(func) with that function.

Documentation:
--------------

There are two APIs (TODO):

    LeakHelper.find(Function checker) -> Context

    LeakHelper.find({
        Function checker
        Object root
        String|Array path
        Set set
        Function ignores
    }) -> Context

LeakHelper comes with several set implementations, two of which are recommended:

* CanarySet: This is the fastest set implementation (at least ~5X faster than BucketSet in a typical application), but may cause problems since it adds a property to each object (however the property name is obscure and it is marked as non-enumerable in engines that support it).
* BucketSet (default): Slower than CanarySet but "safer". Much faster than an array-based set (assuming there is a good distribution of "hashes"). It coerces each object to a string that is used as a hash to find it's "bucket" (an array), which is then linearly searched (much like a hash table).

Tips and Tricks
---------------

You can also use LeakHelper to simply walk the entire object graph, always returning false or undefined. Here's an example where we use the first run to record every property in a hash, modify a few things, and then use the previously populated hash to look for new properties.

    var before = {};
    LeakHelper.find(function(object, path) {
        var hash = LeakHelper.pathArrayToHash(path);
        before[hash] = object;
    });

    blah = 1234;
    foo.bar.baz = 2345;

    LeakHelper.find(function(object, path) {
        var hash = LeakHelper.pathArrayToHash(path);
        return before.hasOwnProperty(hash));
    });

Note that we could have checked that the properties were identical to find changes, however in the browser DOM objects often fail equality tests even if nothing has changed. Filtering these special properties would be necessary to get useful results.

TODO
----

* TODOs
