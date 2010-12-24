LeakHelper
==========

This is alpha quality software. Not ready for wide distribution.

What does it do?
----------------

This simple tool assists in tracking down logical memory leaks in JavaScript applications by inspecting the object graph for accessible objects that should not be referenced, as determined by you. It is NOT an automatic memory leak finder. It has been tested on Safari 5 and Chrome 8.

It essentially walks the entire JavaScript object graph of your application, executing a function you supply which should return "true" if you expected the supplied object to no longer be referenced by your application. When it finds such an object it logs the path from the root to the object using console.log(). Here is a trivial example:

    window.foo = {
        bar : {
            baz : 1234
        }
    }
    
    LeakHelper.find(function(o) {
        return (o === 1234);
    });

    // LeakHelper FOUND: window.foo.bar.baz

What doesn't it do?
-------------------

It does not automagically find all memory leaks for you. You must be able to write a function which determines whether an object is incorrectly referenced by your application or framework.

There are several limitations:

* It can only find references in objects accessible via property access (transitively) from the root object (defaults to the global object). For example, if an object is only referenced by a local variable captured in a closure it will not be seen.
* This means it may not find references in applications that make extensive use of closures, or file/module-scoped variables (for example, file-local "var" variables within Objective-J modules or CommonJS modules)
* It will not necessarily find leaks caused by JavaScript/browser engine bugs.
* Currently it marks objects as traversed by adding a "canary" property, which may cause problems with the application, thus the application should be reloaded after each call to LeakHelper.find().

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
    
    // Nothing even though the object containing z has not been garbage collected.

Instructions
------------

LeakHelper is especially useful in conjunction with the Heap Snapshot tool in Chrome's Web Inspector. Here's a suggested workflow for using LeakHelper and Chrome to find leaks:


1. Add the leakhelper.js script tag to your application's index.html
2. Load your application

If you already know which objects are leaking, skip to step 8.

3. Bring the application to a "baseline" state, for example no documents open.
4. Take a Heap Snapshop in Chrome's Web Inspector.
5. Perform some actions which you suspect may cause a memory leak, then return to the previous state.
6. Take another Heap Snapshot.
7. Compare the two snapshots, looking for excessive objects of the type you expect may be leaking.
8. Write your function which distinguishes between objects that you expect to be live (return "false") and objects you expect to not be referenced (return "true"). For example, if all documents have been closed then perhaps no objects of a certain class should be present.
9. Execute LeakHelper.find(func) with that function.

TODO
----

* TODOs
