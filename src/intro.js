(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['d3'], function (d3) {
            // Also create a global in case some scripts
            // that are loaded still are looking for
            // a global even when an AMD loader is in use.
            return (root.nv = factory(d3));
        });
    } else {
        // Browser globals
        root.nv = factory(d3);
    }
}(this, function (d3) {