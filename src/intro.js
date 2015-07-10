(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['d3'], function (d3) {
      return (root.nv = factory(d3));
    });
  } else {
    // Browser globals
    root.nv = factory(d3);
  }
}(this, function (d3) {