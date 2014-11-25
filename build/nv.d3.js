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
// set up main nv object on window
var nv = window.nv || {};
window.nv = nv;

// the major global objects under the nv namespace
nv.dev = true; //set false when in production
nv.tooltip = nv.tooltip || {}; // For the tooltip system
nv.utils = nv.utils || {}; // Utility subsystem
nv.models = nv.models || {}; //stores all the possible models/components
nv.charts = {}; //stores all the ready to use charts
nv.graphs = []; //stores all the graphs currently on the page
nv.logs = {}; //stores some statistics and potential error messages

nv.dispatch = d3.dispatch('render_start', 'render_end');

// Function bind polyfill
// Needed ONLY for phantomJS as it's missing until version 2.0 which is unreleased as of this comment
// https://github.com/ariya/phantomjs/issues/10522
// http://kangax.github.io/compat-table/es5/#Function.prototype.bind
// phantomJS is used for running the test suite
if (!Function.prototype.bind) {
    Function.prototype.bind = function (oThis) {
        if (typeof this !== "function") {
            // closest thing possible to the ECMAScript 5 internal IsCallable function
            throw new TypeError("Function.prototype.bind - what is trying to be bound is not callable");
        }

        var aArgs = Array.prototype.slice.call(arguments, 1),
            fToBind = this,
            fNOP = function () {},
            fBound = function () {
                return fToBind.apply(this instanceof fNOP && oThis
                        ? this
                        : oThis,
                    aArgs.concat(Array.prototype.slice.call(arguments)));
            };

        fNOP.prototype = this.prototype;
        fBound.prototype = new fNOP();
        return fBound;
    };
}

//  Development render timers - disabled if dev = false
if (nv.dev) {
    nv.dispatch.on('render_start', function(e) {
        nv.logs.startTime = +new Date();
    });

    nv.dispatch.on('render_end', function(e) {
        nv.logs.endTime = +new Date();
        nv.logs.totalTime = nv.logs.endTime - nv.logs.startTime;
        nv.log('total', nv.logs.totalTime); // used for development, to keep track of graph generation times
    });
}

// Logs all arguments, and returns the last so you can test things in place
// Note: in IE8 console.log is an object not a function, and if modernizr is used
// then calling Function.prototype.bind with with anything other than a function
// causes a TypeError to be thrown.
nv.log = function() {
    if (nv.dev && window.console && console.log && console.log.apply)
        console.log.apply(console, arguments);
    else if (nv.dev && window.console && typeof console.log == "function" && Function.prototype.bind) {
        var log = Function.prototype.bind.call(console.log, console);
        log.apply(console, arguments);
    }
    return arguments[arguments.length - 1];
};

// print console warning, should be used by deprecated functions
nv.deprecated = function(name) {
    if (nv.dev && console && console.warn) {
        console.warn('`' + name + '` has been deprecated.');
    }
};

// render function is used to queue up chart rendering
// in non-blocking timeout functions
nv.render = function render(step) {
    // number of graphs to generate in each timeout loop
    step = step || 1;

    nv.render.active = true;
    nv.dispatch.render_start();

    setTimeout(function() {
        var chart, graph;

        for (var i = 0; i < step && (graph = nv.render.queue[i]); i++) {
            chart = graph.generate();
            if (typeof graph.callback == typeof(Function)) graph.callback(chart);
            nv.graphs.push(chart);
        }

        nv.render.queue.splice(0, i);

        if (nv.render.queue.length) setTimeout(arguments.callee, 0);
        else {
            nv.dispatch.render_end();
            nv.render.active = false;
        }
    }, 0);
};

nv.render.active = false;
nv.render.queue = [];

// main function to use when adding a new graph, see examples
nv.addGraph = function(obj) {
    if (typeof arguments[0] === typeof(Function)) {
        obj = {generate: arguments[0], callback: arguments[1]};
    }

    nv.render.queue.push(obj);

    if (!nv.render.active) {
        nv.render();
    }
};/* Utility class to handle creation of an interactive layer.
 This places a rectangle on top of the chart. When you mouse move over it, it sends a dispatch
 containing the X-coordinate. It can also render a vertical line where the mouse is located.

 dispatch.elementMousemove is the important event to latch onto.  It is fired whenever the mouse moves over
 the rectangle. The dispatch is given one object which contains the mouseX/Y location.
 It also has 'pointXValue', which is the conversion of mouseX to the x-axis scale.
 */
nv.interactiveGuideline = function() {
    "use strict";

    var tooltip = nv.models.tooltip();

    //Public settings
    var width = null;
    var height = null;

    //Please pass in the bounding chart's top and left margins
    //This is important for calculating the correct mouseX/Y positions.
    var margin = {left: 0, top: 0}
        , xScale = d3.scale.linear()
        , yScale = d3.scale.linear()
        , dispatch = d3.dispatch('elementMousemove', 'elementMouseout', 'elementClick', 'elementDblclick')
        , showGuideLine = true;
    //Must pass in the bounding chart's <svg> container.
    //The mousemove event is attached to this container.
    var svgContainer = null;

    // check if IE by looking for activeX
    var isMSIE = "ActiveXObject" in window;


    function layer(selection) {
        selection.each(function(data) {
            var container = d3.select(this);
            var availableWidth = (width || 960), availableHeight = (height || 400);
            var wrap = container.selectAll("g.nv-wrap.nv-interactiveLineLayer")
                .data([data]);
            var wrapEnter = wrap.enter()
                .append("g").attr("class", " nv-wrap nv-interactiveLineLayer");
            wrapEnter.append("g").attr("class","nv-interactiveGuideLine");

            if (!svgContainer) {
                return;
            }

            function mouseHandler() {
                var d3mouse = d3.mouse(this);
                var mouseX = d3mouse[0];
                var mouseY = d3mouse[1];
                var subtractMargin = true;
                var mouseOutAnyReason = false;
                if (isMSIE) {
                    /*
                     D3.js (or maybe SVG.getScreenCTM) has a nasty bug in Internet Explorer 10.
                     d3.mouse() returns incorrect X,Y mouse coordinates when mouse moving
                     over a rect in IE 10.
                     However, d3.event.offsetX/Y also returns the mouse coordinates
                     relative to the triggering <rect>. So we use offsetX/Y on IE.
                     */
                    mouseX = d3.event.offsetX;
                    mouseY = d3.event.offsetY;

                    /*
                     On IE, if you attach a mouse event listener to the <svg> container,
                     it will actually trigger it for all the child elements (like <path>, <circle>, etc).
                     When this happens on IE, the offsetX/Y is set to where ever the child element
                     is located.
                     As a result, we do NOT need to subtract margins to figure out the mouse X/Y
                     position under this scenario. Removing the line below *will* cause
                     the interactive layer to not work right on IE.
                     */
                    if(d3.event.target.tagName !== "svg") {
                        subtractMargin = false;
                    }

                    if (d3.event.target.className.baseVal.match("nv-legend")) {
                        mouseOutAnyReason = true;
                    }

                }

                if(subtractMargin) {
                    mouseX -= margin.left;
                    mouseY -= margin.top;
                }

                /* If mouseX/Y is outside of the chart's bounds,
                 trigger a mouseOut event.
                 */
                if (mouseX < 0 || mouseY < 0
                    || mouseX > availableWidth || mouseY > availableHeight
                    || (d3.event.relatedTarget && d3.event.relatedTarget.ownerSVGElement === undefined)
                    || mouseOutAnyReason
                    ) {

                    if (isMSIE) {
                        if (d3.event.relatedTarget
                            && d3.event.relatedTarget.ownerSVGElement === undefined
                            && d3.event.relatedTarget.className.match(tooltip.nvPointerEventsClass)) {

                            return;
                        }
                    }
                    dispatch.elementMouseout({
                        mouseX: mouseX,
                        mouseY: mouseY
                    });
                    layer.renderGuideLine(null); //hide the guideline
                    return;
                }

                var pointXValue = xScale.invert(mouseX);
                dispatch.elementMousemove({
                    mouseX: mouseX,
                    mouseY: mouseY,
                    pointXValue: pointXValue
                });

                //If user double clicks the layer, fire a elementDblclick
                if (d3.event.type === "dblclick") {
                    dispatch.elementDblclick({
                        mouseX: mouseX,
                        mouseY: mouseY,
                        pointXValue: pointXValue
                    });
                }

                // if user single clicks the layer, fire elementClick
                if (d3.event.type === 'click') {
                    dispatch.elementClick({
                        mouseX: mouseX,
                        mouseY: mouseY,
                        pointXValue: pointXValue
                    });
                }
            }

            svgContainer
                .on("mousemove",mouseHandler, true)
                .on("mouseout" ,mouseHandler,true)
                .on("dblclick" ,mouseHandler)
                .on("click", mouseHandler)
            ;

            //Draws a vertical guideline at the given X postion.
            layer.renderGuideLine = function(x) {
                if (!showGuideLine) return;
                var line = wrap.select(".nv-interactiveGuideLine")
                    .selectAll("line")
                    .data((x != null) ? [nv.utils.NaNtoZero(x)] : [], String);

                line.enter()
                    .append("line")
                    .attr("class", "nv-guideline")
                    .attr("x1", function(d) { return d;})
                    .attr("x2", function(d) { return d;})
                    .attr("y1", availableHeight)
                    .attr("y2",0)
                ;
                line.exit().remove();

            }
        });
    }

    layer.dispatch = dispatch;
    layer.tooltip = tooltip;

    layer.margin = function(_) {
        if (!arguments.length) return margin;
        margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
        margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        return layer;
    };

    layer.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return layer;
    };

    layer.height = function(_) {
        if (!arguments.length) return height;
        height = _;
        return layer;
    };

    layer.xScale = function(_) {
        if (!arguments.length) return xScale;
        xScale = _;
        return layer;
    };

    layer.showGuideLine = function(_) {
        if (!arguments.length) return showGuideLine;
        showGuideLine = _;
        return layer;
    };

    layer.svgContainer = function(_) {
        if (!arguments.length) return svgContainer;
        svgContainer = _;
        return layer;
    };

    return layer;
};

/* Utility class that uses d3.bisect to find the index in a given array, where a search value can be inserted.
 This is different from normal bisectLeft; this function finds the nearest index to insert the search value.

 For instance, lets say your array is [1,2,3,5,10,30], and you search for 28.
 Normal d3.bisectLeft will return 4, because 28 is inserted after the number 10.  But interactiveBisect will return 5
 because 28 is closer to 30 than 10.

 Unit tests can be found in: interactiveBisectTest.html

 Has the following known issues:
 * Will not work if the data points move backwards (ie, 10,9,8,7, etc) or if the data points are in random order.
 * Won't work if there are duplicate x coordinate values.
 */
nv.interactiveBisect = function (values, searchVal, xAccessor) {
    "use strict";
    if (! (values instanceof Array)) {
        return null;
    }
    if (typeof xAccessor !== 'function') {
        xAccessor = function(d,i) {
            return d.x;
        }
    }

    var bisect = d3.bisector(xAccessor).left;
    var index = d3.max([0, bisect(values,searchVal) - 1]);
    var currentValue = xAccessor(values[index], index);

    if (typeof currentValue === 'undefined') {
        currentValue = index;
    }

    if (currentValue === searchVal) {
        return index; //found exact match
    }

    var nextIndex = d3.min([index+1, values.length - 1]);
    var nextValue = xAccessor(values[nextIndex], nextIndex);

    if (typeof nextValue === 'undefined') {
        nextValue = nextIndex;
    }

    if (Math.abs(nextValue - searchVal) >= Math.abs(currentValue - searchVal)) {
        return index;
    } else {
        return nextIndex
    }
};

/*
 Returns the index in the array "values" that is closest to searchVal.
 Only returns an index if searchVal is within some "threshold".
 Otherwise, returns null.
 */
nv.nearestValueIndex = function (values, searchVal, threshold) {
    "use strict";
    var yDistMax = Infinity, indexToHighlight = null;
    values.forEach(function(d,i) {
        var delta = Math.abs(searchVal - d);
        if ( delta <= yDistMax && delta < threshold) {
            yDistMax = delta;
            indexToHighlight = i;
        }
    });
    return indexToHighlight;
};
/* Tooltip rendering model for nvd3 charts.
 window.nv.models.tooltip is the updated,new way to render tooltips.

 window.nv.tooltip.show is the old tooltip code.
 window.nv.tooltip.* also has various helper methods.
 */
(function() {
    "use strict";
    window.nv.tooltip = {};

    /* Model which can be instantiated to handle tooltip rendering.
     Example usage:
     var tip = nv.models.tooltip().gravity('w').distance(23)
     .data(myDataObject);

     tip();    //just invoke the returned function to render tooltip.
     */
    window.nv.models.tooltip = function() {
        //HTML contents of the tooltip.  If null, the content is generated via the data variable.
        var content = null;

        /*
        Tooltip data. If data is given in the proper format, a consistent tooltip is generated.
        Example Format of data:
        {
            key: "Date",
            value: "August 2009",
            series: [
                {key: "Series 1", value: "Value 1", color: "#000"},
                {key: "Series 2", value: "Value 2", color: "#00f"}
            ]
        }
        */
        var data = null;

        var gravity = 'w'   //Can be 'n','s','e','w'. Determines how tooltip is positioned.
            ,distance = 50   //Distance to offset tooltip from the mouse location.
            ,snapDistance = 25   //Tolerance allowed before tooltip is moved from its current position (creates 'snapping' effect)
            ,   fixedTop = null //If not null, this fixes the top position of the tooltip.
            ,   classes = null  //Attaches additional CSS classes to the tooltip DIV that is created.
            ,   chartContainer = null   //Parent DIV, of the SVG Container that holds the chart.
            ,   tooltipElem = null  //actual DOM element representing the tooltip.
            ,   position = {left: null, top: null}      //Relative position of the tooltip inside chartContainer.
            ,   enabled = true;  //True -> tooltips are rendered. False -> don't render tooltips.

        //Generates a unique id when you create a new tooltip() object
        var id = "nvtooltip-" + Math.floor(Math.random() * 100000);

        //CSS class to specify whether element should not have mouse events.
        var  nvPointerEventsClass = "nv-pointer-events-none";

        //Format function for the tooltip values column
        var valueFormatter = function(d,i) {
            return d;
        };

        //Format function for the tooltip header value.
        var headerFormatter = function(d) {
            return d;
        };

        //By default, the tooltip model renders a beautiful table inside a DIV.
        //You can override this function if a custom tooltip is desired.
        var contentGenerator = function(d) {
            if (content != null) {
                return content;
            }

            if (d == null) {
                return '';
            }

            var table = d3.select(document.createElement("table"));
            var theadEnter = table.selectAll("thead")
                .data([d])
                .enter().append("thead");

            theadEnter.append("tr")
                .append("td")
                .attr("colspan",3)
                .append("strong")
                .classed("x-value",true)
                .html(headerFormatter(d.value));

            var tbodyEnter = table.selectAll("tbody")
                .data([d])
                .enter().append("tbody");

            var trowEnter = tbodyEnter.selectAll("tr")
                    .data(function(p) { return p.series})
                    .enter()
                    .append("tr")
                    .classed("highlight", function(p) { return p.highlight});

            trowEnter.append("td")
                .classed("legend-color-guide",true)
                .append("div")
                .style("background-color", function(p) { return p.color});

            trowEnter.append("td")
                .classed("key",true)
                .html(function(p) {return p.key});

            trowEnter.append("td")
                .classed("value",true)
                .html(function(p,i) { return valueFormatter(p.value,i) });


            trowEnter.selectAll("td").each(function(p) {
                if (p.highlight) {
                    var opacityScale = d3.scale.linear().domain([0,1]).range(["#fff",p.color]);
                    var opacity = 0.6;
                    d3.select(this)
                        .style("border-bottom-color", opacityScale(opacity))
                        .style("border-top-color", opacityScale(opacity))
                    ;
                }
            });

            var html = table.node().outerHTML;
            if (d.footer !== undefined)
                html += "<div class='footer'>" + d.footer + "</div>";
            return html;

        };

        var dataSeriesExists = function(d) {
            if (d && d.series && d.series.length > 0) {
                return true;
            }
            return false;
        };

        //In situations where the chart is in a 'viewBox', re-position the tooltip based on how far chart is zoomed.
        function convertViewBoxRatio() {
            if (chartContainer) {
                var svg = d3.select(chartContainer);
                if (svg.node().tagName !== "svg") {
                    svg = svg.select("svg");
                }
                var viewBox = (svg.node()) ? svg.attr('viewBox') : null;
                if (viewBox) {
                    viewBox = viewBox.split(' ');
                    var ratio = parseInt(svg.style('width')) / viewBox[2];

                    position.left = position.left * ratio;
                    position.top  = position.top * ratio;
                }
            }
        }

        //Creates new tooltip container, or uses existing one on DOM.
        function getTooltipContainer(newContent) {
            var body;
            if (chartContainer) {
                body = d3.select(chartContainer);
            } else {
                body = d3.select("body");
            }

            var container = body.select(".nvtooltip");
            if (container.node() === null) {
                //Create new tooltip div if it doesn't exist on DOM.
                container = body.append("div")
                    .attr("class", "nvtooltip " + (classes? classes: "xy-tooltip"))
                    .attr("id",id)
                ;
            }

            container.node().innerHTML = newContent;
            container.style("top",0).style("left",0).style("opacity",0);
            container.selectAll("div, table, td, tr").classed(nvPointerEventsClass,true)
            container.classed(nvPointerEventsClass,true);
            return container.node();
        }

        //Draw the tooltip onto the DOM.
        function nvtooltip() {
            if (!enabled) return;
            if (!dataSeriesExists(data)) return;

            convertViewBoxRatio();

            var left = position.left;
            var top = (fixedTop != null) ? fixedTop : position.top;
            var container = getTooltipContainer(contentGenerator(data));
            tooltipElem = container;
            if (chartContainer) {
                var svgComp = chartContainer.getElementsByTagName("svg")[0];
                var boundRect = (svgComp) ? svgComp.getBoundingClientRect() : chartContainer.getBoundingClientRect();
                var svgOffset = {left:0,top:0};
                if (svgComp) {
                    var svgBound = svgComp.getBoundingClientRect();
                    var chartBound = chartContainer.getBoundingClientRect();
                    var svgBoundTop = svgBound.top;

                    //Defensive code. Sometimes, svgBoundTop can be a really negative
                    //  number, like -134254. That's a bug.
                    //  If such a number is found, use zero instead. FireFox bug only
                    if (svgBoundTop < 0) {
                        var containerBound = chartContainer.getBoundingClientRect();
                        svgBoundTop = (Math.abs(svgBoundTop) > containerBound.height) ? 0 : svgBoundTop;
                    }
                    svgOffset.top = Math.abs(svgBoundTop - chartBound.top);
                    svgOffset.left = Math.abs(svgBound.left - chartBound.left);
                }
                //If the parent container is an overflow <div> with scrollbars, subtract the scroll offsets.
                //You need to also add any offset between the <svg> element and its containing <div>
                //Finally, add any offset of the containing <div> on the whole page.
                left += chartContainer.offsetLeft + svgOffset.left - 2*chartContainer.scrollLeft;
                top += chartContainer.offsetTop + svgOffset.top - 2*chartContainer.scrollTop;
            }

            if (snapDistance && snapDistance > 0) {
                top = Math.floor(top/snapDistance) * snapDistance;
            }

            nv.tooltip.calcTooltipPosition([left,top], gravity, distance, container);
            return nvtooltip;
        }

        nvtooltip.nvPointerEventsClass = nvPointerEventsClass;

        nvtooltip.content = function(_) {
            if (!arguments.length) return content;
            content = _;
            return nvtooltip;
        };

        //Returns tooltipElem...not able to set it.
        nvtooltip.tooltipElem = function() {
            return tooltipElem;
        };

        nvtooltip.contentGenerator = function(_) {
            if (!arguments.length) return contentGenerator;
            if (typeof _ === 'function') {
                contentGenerator = _;
            }
            return nvtooltip;
        };

        nvtooltip.data = function(_) {
            if (!arguments.length) return data;
            data = _;
            return nvtooltip;
        };

        nvtooltip.gravity = function(_) {
            if (!arguments.length) return gravity;
            gravity = _;
            return nvtooltip;
        };

        nvtooltip.distance = function(_) {
            if (!arguments.length) return distance;
            distance = _;
            return nvtooltip;
        };

        nvtooltip.snapDistance = function(_) {
            if (!arguments.length) return snapDistance;
            snapDistance = _;
            return nvtooltip;
        };

        nvtooltip.classes = function(_) {
            if (!arguments.length) return classes;
            classes = _;
            return nvtooltip;
        };

        nvtooltip.chartContainer = function(_) {
            if (!arguments.length) return chartContainer;
            chartContainer = _;
            return nvtooltip;
        };

        nvtooltip.position = function(_) {
            if (!arguments.length) return position;
            position.left = (typeof _.left !== 'undefined') ? _.left : position.left;
            position.top = (typeof _.top !== 'undefined') ? _.top : position.top;
            return nvtooltip;
        };

        nvtooltip.fixedTop = function(_) {
            if (!arguments.length) return fixedTop;
            fixedTop = _;
            return nvtooltip;
        };

        nvtooltip.enabled = function(_) {
            if (!arguments.length) return enabled;
            enabled = _;
            return nvtooltip;
        };

        nvtooltip.valueFormatter = function(_) {
            if (!arguments.length) return valueFormatter;
            if (typeof _ === 'function') {
                valueFormatter = _;
            }
            return nvtooltip;
        };

        nvtooltip.headerFormatter = function(_) {
            if (!arguments.length) return headerFormatter;
            if (typeof _ === 'function') {
                headerFormatter = _;
            }
            return nvtooltip;
        };

        //id() is a read-only function. You can't use it to set the id.
        nvtooltip.id = function() {
            return id;
        };

        return nvtooltip;
    };

    //Original tooltip.show function. Kept for backward compatibility.
    // pos = [left,top]
    nv.tooltip.show = function(pos, content, gravity, dist, parentContainer, classes) {

        //Create new tooltip div if it doesn't exist on DOM.
        var   container = document.createElement('div');
        container.className = 'nvtooltip ' + (classes ? classes : 'xy-tooltip');

        var body = parentContainer;
        if ( !parentContainer || parentContainer.tagName.match(/g|svg/i)) {
            //If the parent element is an SVG element, place tooltip in the <body> element.
            body = document.getElementsByTagName('body')[0];
        }

        container.style.left = 0;
        container.style.top = 0;
        container.style.opacity = 0;
        // Content can also be dom element
        if (typeof content !== 'string')
            container.appendChild(content);
        else
            container.innerHTML = content;
        body.appendChild(container);

        //If the parent container is an overflow <div> with scrollbars, subtract the scroll offsets.
        if (parentContainer) {
            pos[0] = pos[0] - parentContainer.scrollLeft;
            pos[1] = pos[1] - parentContainer.scrollTop;
        }
        nv.tooltip.calcTooltipPosition(pos, gravity, dist, container);
    };

    //Looks up the ancestry of a DOM element, and returns the first NON-svg node.
    nv.tooltip.findFirstNonSVGParent = function(Elem) {
        while(Elem.tagName.match(/^g|svg$/i) !== null) {
            Elem = Elem.parentNode;
        }
        return Elem;
    };

    //Finds the total offsetTop of a given DOM element.
    //Looks up the entire ancestry of an element, up to the first relatively positioned element.
    nv.tooltip.findTotalOffsetTop = function ( Elem, initialTop ) {
        var offsetTop = initialTop;

        do {
            if( !isNaN( Elem.offsetTop ) ) {
                offsetTop += (Elem.offsetTop);
            }
        } while( Elem = Elem.offsetParent );
        return offsetTop;
    };

    //Finds the total offsetLeft of a given DOM element.
    //Looks up the entire ancestry of an element, up to the first relatively positioned element.
    nv.tooltip.findTotalOffsetLeft = function ( Elem, initialLeft) {
        var offsetLeft = initialLeft;

        do {
            if( !isNaN( Elem.offsetLeft ) ) {
                offsetLeft += (Elem.offsetLeft);
            }
        } while( Elem = Elem.offsetParent );
        return offsetLeft;
    };

    //Global utility function to render a tooltip on the DOM.
    //pos = [left,top] coordinates of where to place the tooltip, relative to the SVG chart container.
    //gravity = how to orient the tooltip
    //dist = how far away from the mouse to place tooltip
    //container = tooltip DIV
    nv.tooltip.calcTooltipPosition = function(pos, gravity, dist, container) {

        var height = parseInt(container.offsetHeight),
            width = parseInt(container.offsetWidth),
            windowWidth = nv.utils.windowSize().width,
            windowHeight = nv.utils.windowSize().height,
            scrollTop = window.pageYOffset,
            scrollLeft = window.pageXOffset,
            left, top;

        windowHeight = window.innerWidth >= document.body.scrollWidth ? windowHeight : windowHeight - 16;
        windowWidth = window.innerHeight >= document.body.scrollHeight ? windowWidth : windowWidth - 16;

        gravity = gravity || 's';
        dist = dist || 20;

        var tooltipTop = function ( Elem ) {
            return nv.tooltip.findTotalOffsetTop(Elem, top);
        };

        var tooltipLeft = function ( Elem ) {
            return nv.tooltip.findTotalOffsetLeft(Elem,left);
        };

        switch (gravity) {
            case 'e':
                left = pos[0] - width - dist;
                top = pos[1] - (height / 2);
                var tLeft = tooltipLeft(container);
                var tTop = tooltipTop(container);
                if (tLeft < scrollLeft) left = pos[0] + dist > scrollLeft ? pos[0] + dist : scrollLeft - tLeft + left;
                if (tTop < scrollTop) top = scrollTop - tTop + top;
                if (tTop + height > scrollTop + windowHeight) top = scrollTop + windowHeight - tTop + top - height;
                break;
            case 'w':
                left = pos[0] + dist;
                top = pos[1] - (height / 2);
                var tLeft = tooltipLeft(container);
                var tTop = tooltipTop(container);
                if (tLeft + width > windowWidth) left = pos[0] - width - dist;
                if (tTop < scrollTop) top = scrollTop + 5;
                if (tTop + height > scrollTop + windowHeight) top = scrollTop + windowHeight - tTop + top - height;
                break;
            case 'n':
                left = pos[0] - (width / 2) - 5;
                top = pos[1] + dist;
                var tLeft = tooltipLeft(container);
                var tTop = tooltipTop(container);
                if (tLeft < scrollLeft) left = scrollLeft + 5;
                if (tLeft + width > windowWidth) left = left - width/2 + 5;
                if (tTop + height > scrollTop + windowHeight) top = scrollTop + windowHeight - tTop + top - height;
                break;
            case 's':
                left = pos[0] - (width / 2);
                top = pos[1] - height - dist;
                var tLeft = tooltipLeft(container);
                var tTop = tooltipTop(container);
                if (tLeft < scrollLeft) left = scrollLeft + 5;
                if (tLeft + width > windowWidth) left = left - width/2 + 5;
                if (scrollTop > tTop) top = scrollTop;
                break;
            case 'none':
                left = pos[0];
                top = pos[1] - dist;
                var tLeft = tooltipLeft(container);
                var tTop = tooltipTop(container);
                break;
        }

        container.style.left = left+'px';
        container.style.top = top+'px';
        container.style.opacity = 1;
        container.style.position = 'absolute';

        return container;
    };

    //Global utility function to remove tooltips from the DOM.
    nv.tooltip.cleanup = function() {

        // Find the tooltips, mark them for removal by this class (so others cleanups won't find it)
        var tooltips = document.getElementsByClassName('nvtooltip');
        var purging = [];
        while(tooltips.length) {
            purging.push(tooltips[0]);
            tooltips[0].style.transitionDelay = '0 !important';
            tooltips[0].style.opacity = 0;
            tooltips[0].className = 'nvtooltip-pending-removal';
        }

        setTimeout(function() {

            while (purging.length) {
                var removeMe = purging.pop();
                removeMe.parentNode.removeChild(removeMe);
            }
        }, 500);
    };

})();


/*
Gets the browser window size

Returns object with height and width properties
 */
nv.utils.windowSize = function() {
    // Sane defaults
    var size = {width: 640, height: 480};

    // Earlier IE uses Doc.body
    if (document.body && document.body.offsetWidth) {
        size.width = document.body.offsetWidth;
        size.height = document.body.offsetHeight;
    }

    // IE can use depending on mode it is in
    if (document.compatMode=='CSS1Compat' &&
        document.documentElement &&
        document.documentElement.offsetWidth ) {

        size.width = document.documentElement.offsetWidth;
        size.height = document.documentElement.offsetHeight;
    }

    // Most recent browsers use
    if (window.innerWidth && window.innerHeight) {
        size.width = window.innerWidth;
        size.height = window.innerHeight;
    }
    return (size);
};


/*
Binds callback function to run when window is resized
 */
nv.utils.windowResize = function(handler) {
    if (window.addEventListener) {
        window.addEventListener('resize', handler);
    } else {
        nv.log("ERROR: Failed to bind to window.resize with: ", handler);
    }
    // return object with clear function to remove the single added callback.
    return {
        callback: handler,
        clear: function() {
            window.removeEventListener('resize', handler);
        }
    }
};


/*
Backwards compatible way to implement more d3-like coloring of graphs.
If passed an array, wrap it in a function which implements the old behavior
*/
nv.utils.getColor = function(color) {
    //if you pass in nothing or not an array, get default colors back
    if (!arguments.length || !(color instanceof Array)) {
        return nv.utils.defaultColor();
    } else {
        return function (d, i) {
            return d.color || color[i % color.length];
        };
    }
};

nv.utils.getColor = function(color) {
    if (!arguments.length) return nv.utils.defaultColor(); //if you pass in nothing, get default colors back

    if( Object.prototype.toString.call( color ) === '[object Array]' )
        return function(d, i) { return d.color || color[i % color.length]; };
    else
        return color;
    //can't really help it if someone passes rubbish as color
}


/*
Default color chooser uses the index of an object as before.
 */
nv.utils.defaultColor = function() {
    var colors = d3.scale.category20().range();
    return function(d, i) {
        return d.color || colors[i % colors.length]
    };
};


/*
Returns a color function that takes the result of 'getKey' for each series and
looks for a corresponding color from the dictionary
*/
nv.utils.customTheme = function(dictionary, getKey, defaultColors) {
    // use default series.key if getKey is undefined
    getKey = getKey || function(series) { return series.key };
    defaultColors = defaultColors || d3.scale.category20().range();

    // start at end of default color list and walk back to index 0
    var defIndex = defaultColors.length;

    return function(series, index) {
        var key = getKey(series);
        if (typeof dictionary[key] === 'function') {
            return dictionary[key]();
        } else if (dictionary[key] !== undefined) {
            return dictionary[key];
        } else {
            // no match in dictionary, use a default color
            if (!defIndex) {
                // used all the default colors, start over
                defIndex = defaultColors.length;
            }
            defIndex = defIndex - 1;
            return defaultColors[defIndex];
        }
    };
};


/*
From the PJAX example on d3js.org, while this is not really directly needed
it's a very cool method for doing pjax, I may expand upon it a little bit,
open to suggestions on anything that may be useful
*/
nv.utils.pjax = function(links, content) {

    var load = function(href) {
        d3.html(href, function(fragment) {
            var target = d3.select(content).node();
            target.parentNode.replaceChild(
                d3.select(fragment).select(content).node(),
                target);
            nv.utils.pjax(links, content);
        });
    };

    d3.selectAll(links).on("click", function() {
        history.pushState(this.href, this.textContent, this.href);
        load(this.href);
        d3.event.preventDefault();
    });

    d3.select(window).on("popstate", function() {
        if (d3.event.state) {
            load(d3.event.state);
        }
    });
};


/*
For when we want to approximate the width in pixels for an SVG:text element.
Most common instance is when the element is in a display:none; container.
Forumla is : text.length * font-size * constant_factor
*/
nv.utils.calcApproxTextWidth = function (svgTextElem) {
    if (typeof svgTextElem.style === 'function'
        && typeof svgTextElem.text === 'function') {

        var fontSize = parseInt(svgTextElem.style("font-size").replace("px",""));
        var textLength = svgTextElem.text().length;
        return textLength * fontSize * 0.5;
    }
    return 0;
};


/*
Numbers that are undefined, null or NaN, convert them to zeros.
*/
nv.utils.NaNtoZero = function(n) {
    if (typeof n !== 'number'
        || isNaN(n)
        || n === null
        || n === Infinity
        || n === -Infinity) {

        return 0;
    }
    return n;
};

/*
Add a way to watch for d3 transition ends to d3
*/
d3.selection.prototype.watchTransition = function(renderWatch){
    var args = [this].concat([].slice.call(arguments, 1));
    return renderWatch.transition.apply(renderWatch, args);
};


/*
Helper object to watch when d3 has rendered something
*/
nv.utils.renderWatch = function(dispatch, duration) {
    if (!(this instanceof nv.utils.renderWatch)) {
        return new nv.utils.renderWatch(dispatch, duration);
    }

    var _duration = duration !== undefined ? duration : 250;
    var renderStack = [];
    var self = this;

    this.models = function(models) {
        models = [].slice.call(arguments, 0);
        models.forEach(function(model){
            model.__rendered = false;
            (function(m){
                m.dispatch.on('renderEnd', function(arg){
                    m.__rendered = true;
                    self.renderEnd('model');
                });
            })(model);

            if (renderStack.indexOf(model) < 0) {
                renderStack.push(model);
            }
        });
    return this;
    };

    this.reset = function(duration) {
        if (duration !== undefined) {
            _duration = duration;
        }
        renderStack = [];
    };

    this.transition = function(selection, args, duration) {
        args = arguments.length > 1 ? [].slice.call(arguments, 1) : [];

        if (args.length > 1) {
            duration = args.pop();
        } else {
            duration = _duration !== undefined ? _duration : 250;
        }
        selection.__rendered = false;

        if (renderStack.indexOf(selection) < 0) {
            renderStack.push(selection);
        }

        if (duration === 0) {
            selection.__rendered = true;
            selection.delay = function() { return this; };
            selection.duration = function() { return this; };
            return selection;
        } else {
            if (selection.length === 0) {
                selection.__rendered = true;
            } else if (selection.every( function(d){ return !d.length; } )) {
                selection.__rendered = true;
            } else {
                selection.__rendered = false;
            }

            var n = 0;
            return selection
                .transition()
                .duration(duration)
                .each(function(){ ++n; })
                .each('end', function(d, i) {
                    if (--n === 0) {
                        selection.__rendered = true;
                        self.renderEnd.apply(this, args);
                    }
                });
        }
    };

    this.renderEnd = function() {
        if (renderStack.every( function(d){ return d.__rendered; } )) {
            renderStack.forEach( function(d){ d.__rendered = false; });
            dispatch.renderEnd.apply(this, arguments);
        }
    }

};


/*
Takes multiple objects and combines them into the first one (dst)
example:  nv.utils.deepExtend({a: 1}, {a: 2, b: 3}, {c: 4});
gives:  {a: 2, b: 3, c: 4}
*/
nv.utils.deepExtend = function(dst){
    var sources = arguments.length > 1 ? [].slice.call(arguments, 1) : [];
    sources.forEach(function(source) {
        for (key in source) {
            var isArray = dst[key] instanceof Array;
            var isObject = typeof dst[key] === 'object';
            var srcObj = typeof source[key] === 'object';

            if (isObject && !isArray && srcObj) {
                nv.utils.deepExtend(dst[key], source[key]);
            } else {
                dst[key] = source[key];
            }
        }
    });
};


/*
state utility object, used to track d3 states in the models
*/
nv.utils.state = function(){
    if (!(this instanceof nv.utils.state)) {
        return new nv.utils.state();
    }
    var state = {};
    var _self = this;
    var _setState = function(){};
    var _getState = function(){ return {}; };
    var init = null;
    var changed = null;

    this.dispatch = d3.dispatch('change', 'set');

    this.dispatch.on('set', function(state){
        _setState(state, true);
    });

    this.getter = function(fn){
        _getState = fn;
        return this;
    };

    this.setter = function(fn, callback) {
        if (!callback) {
            callback = function(){};
        }
        _setState = function(state, update){
            fn(state);
            if (update) {
                callback();
            }
        };
        return this;
    };

    this.init = function(state){
        init = init || {};
        nv.utils.deepExtend(init, state);
    };

    var _set = function(){
        var settings = _getState();

        if (JSON.stringify(settings) === JSON.stringify(state)) {
            return false;
        }

        for (var key in settings) {
            if (state[key] === undefined) {
                state[key] = {};
            }
            state[key] = settings[key];
            changed = true;
        }
        return true;
    };

    this.update = function(){
        if (init) {
            _setState(init, false);
            init = null;
        }
        if (_set.call(this)) {
            this.dispatch.change(state);
        }
    };

};


/*
Snippet of code you can insert into each nv.models.* to give you the ability to
do things like:
chart.options({
  showXAxis: true,
  tooltips: true
});

To enable in the chart:
chart.options = nv.utils.optionsFunc.bind(chart);
*/
nv.utils.optionsFunc = function(args) {
    nv.deprecated('nv.utils.optionsFunc');
    if (args) {
        d3.map(args).forEach((function(key,value) {
            if (typeof this[key] === "function") {
                this[key](value);
            }
        }).bind(this));
    }
    return this;
};


/*
numTicks:  requested number of ticks
data:  the chart data

returns the number of ticks to actually use on X axis, based on chart data
to avoid duplicate ticks with the same value
*/
nv.utils.calcTicksX = function(numTicks, data) {
    // find max number of values from all data streams
    var numValues = 1;
    var i = 0;
    for (i; i < data.length; i += 1) {
        var stream_len = data[i] && data[i].values ? data[i].values.length : 0;
        numValues = stream_len > numValues ? stream_len : numValues;
    }
    nv.log("Requested number of ticks: ", numTicks);
    nv.log("Calculated max values to be: ", numValues);
    // make sure we don't have more ticks than values to avoid duplicates
    numTicks = numTicks > numValues ? numTicks = numValues - 1 : numTicks;
    // make sure we have at least one tick
    numTicks = numTicks < 1 ? 1 : numTicks;
    // make sure it's an integer
    numTicks = Math.floor(numTicks);
    nv.log("Calculating tick count as: ", numTicks);
    return numTicks;
};


/*
returns number of ticks to actually use on Y axis, based on chart data
*/
nv.utils.calcTicksY = function(numTicks, data) {
    // currently uses the same logic but we can adjust here if needed later
    return nv.utils.calcTicksX(numTicks, data);
};


/*
Add a particular option from an options object onto chart
Options exposed on a chart are a getter/setter function that returns chart
on set to mimic typical d3 option chaining, e.g. svg.option1('a').option2('b');

option objects should be generated via Object.create() to provide
the option of manipulating data via get/set functions.
*/
nv.utils.initOption = function(chart, name) {
    chart[name] = function (_) {
        if (!arguments.length) return chart._options[name];
        chart._options[name] = _;
        return chart;
    };
};


/*
Add all options in an options object to the chart
*/
nv.utils.initOptions = function(chart) {
    var ops = Object.getOwnPropertyNames(chart._options);
    for (var i in ops) {
        nv.utils.initOption(chart, ops[i]);
    }
};


/*
Inherit option getter/setter functions from source to target
d3.rebind makes calling the function on target actually call it on source
*/
nv.utils.inheritOptions = function(target, source) {
    var args = Object.getOwnPropertyNames(source._options);
    args.unshift(source);
    args.unshift(target);
    d3.rebind.apply(this, args);
};


/*
Runs common initialize code on the svg before the chart builds
*/
nv.utils.initSVG = function(svg) {
    svg.classed({'nvd3-svg':true});
};nv.models.axis = function() {
    "use strict";
    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var axis = d3.svg.axis();

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 75 //only used for tickLabel currently
        , height = 60 //only used for tickLabel currently
        , scale = d3.scale.linear()
        , axisLabelText = null
        , showMaxMin = true //TODO: showMaxMin should be disabled on all ordinal scaled axes
        , highlightZero = true
        , rotateLabels = 0
        , rotateYLabel = true
        , staggerLabels = false
        , isOrdinal = false
        , ticks = null
        , axisLabelDistance = 0
        , duration = 250
        , dispatch = d3.dispatch('renderEnd')
        , axisRendered = false
        , maxMinRendered = false
        ;
    axis
        .scale(scale)
        .orient('bottom')
        .tickFormat(function(d) { return d })
    ;

    //============================================================


    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var scale0
        , renderWatch = nv.utils.renderWatch(dispatch, duration)
        ;

    //============================================================

    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);

            //------------------------------------------------------------
            // Setup containers and skeleton of chart

            var wrap = container.selectAll('g.nv-wrap.nv-axis').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-axis');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g')

            //------------------------------------------------------------


            if (ticks !== null)
                axis.ticks(ticks);
            else if (axis.orient() == 'top' || axis.orient() == 'bottom')
                axis.ticks(Math.abs(scale.range()[1] - scale.range()[0]) / 100);


            //TODO: consider calculating width/height based on whether or not label is added, for reference in charts using this component
            g.watchTransition(renderWatch, 'axis').call(axis);

            scale0 = scale0 || axis.scale();

            var fmt = axis.tickFormat();
            if (fmt == null) {
                fmt = scale0.tickFormat();
            }

            var axisLabel = g.selectAll('text.nv-axislabel')
                .data([axisLabelText || null]);
            axisLabel.exit().remove();
            switch (axis.orient()) {
                case 'top':
                    axisLabel.enter().append('text').attr('class', 'nv-axislabel');
                    var w;
                    if (scale.range().length < 2) {
                        w = 0;
                    } else if (scale.range().length === 2) {
                        w = scale.range()[1];
                    } else {
                        w = scale.range()[scale.range().length-1]+(scale.range()[1]-scale.range()[0]);
                    }
                    axisLabel
                        .attr('text-anchor', 'middle')
                        .attr('y', 0)
                        .attr('x', w/2);
                    if (showMaxMin) {
                        var axisMaxMin = wrap.selectAll('g.nv-axisMaxMin')
                            .data(scale.domain());
                        axisMaxMin.enter().append('g').attr('class', 'nv-axisMaxMin').append('text');
                        axisMaxMin.exit().remove();
                        axisMaxMin
                            .attr('transform', function(d,i) {
                                return 'translate(' + scale(d) + ',0)'
                            })
                            .select('text')
                            .attr('dy', '-0.5em')
                            .attr('y', -axis.tickPadding())
                            .attr('text-anchor', 'middle')
                            .text(function(d,i) {
                                var v = fmt(d);
                                return ('' + v).match('NaN') ? '' : v;
                            });
                        axisMaxMin.watchTransition(renderWatch, 'min-max top')
                            .attr('transform', function(d,i) {
                                return 'translate(' + scale.range()[i] + ',0)'
                            });
                    }
                    break;
                case 'bottom':
                    var xLabelMargin = axisLabelDistance + 36;
                    var maxTextWidth = 30;
                    var xTicks = g.selectAll('g').select("text");
                    if (rotateLabels%360) {
                        //Calculate the longest xTick width
                        xTicks.each(function(d,i){
                            var width = this.getBoundingClientRect().width;
                            if(width > maxTextWidth) maxTextWidth = width;
                        });
                        //Convert to radians before calculating sin. Add 30 to margin for healthy padding.
                        var sin = Math.abs(Math.sin(rotateLabels*Math.PI/180));
                        var xLabelMargin = (sin ? sin*maxTextWidth : maxTextWidth)+30;
                        //Rotate all xTicks
                        xTicks
                            .attr('transform', function(d,i,j) { return 'rotate(' + rotateLabels + ' 0,0)' })
                            .style('text-anchor', rotateLabels%360 > 0 ? 'start' : 'end');
                    }
                    axisLabel.enter().append('text').attr('class', 'nv-axislabel');
                    var w;
                    if (scale.range().length < 2) {
                        w = 0;
                    } else if (scale.range().length === 2) {
                        w = scale.range()[1];
                    } else {
                        w = scale.range()[scale.range().length-1]+(scale.range()[1]-scale.range()[0]);
                    }
                    axisLabel
                        .attr('text-anchor', 'middle')
                        .attr('y', xLabelMargin)
                        .attr('x', w/2);
                    if (showMaxMin) {
                        //if (showMaxMin && !isOrdinal) {
                        var axisMaxMin = wrap.selectAll('g.nv-axisMaxMin')
                            //.data(scale.domain())
                            .data([scale.domain()[0], scale.domain()[scale.domain().length - 1]]);
                        axisMaxMin.enter().append('g').attr('class', 'nv-axisMaxMin').append('text');
                        axisMaxMin.exit().remove();
                        axisMaxMin
                            .attr('transform', function(d,i) {
                                return 'translate(' + (scale(d) + (isOrdinal ? scale.rangeBand() / 2 : 0)) + ',0)'
                            })
                            .select('text')
                            .attr('dy', '.71em')
                            .attr('y', axis.tickPadding())
                            .attr('transform', function(d,i,j) { return 'rotate(' + rotateLabels + ' 0,0)' })
                            .style('text-anchor', rotateLabels ? (rotateLabels%360 > 0 ? 'start' : 'end') : 'middle')
                            .text(function(d,i) {
                                var v = fmt(d);
                                return ('' + v).match('NaN') ? '' : v;
                            });
                        axisMaxMin.watchTransition(renderWatch, 'min-max bottom')
                            .attr('transform', function(d,i) {
                                return 'translate(' + (scale(d) + (isOrdinal ? scale.rangeBand() / 2 : 0)) + ',0)'
                            });
                    }
                    if (staggerLabels)
                        xTicks
                            .attr('transform', function(d,i) { return 'translate(0,' + (i % 2 == 0 ? '0' : '12') + ')' });

                    break;
                case 'right':
                    axisLabel.enter().append('text').attr('class', 'nv-axislabel');
                    axisLabel
                        .style('text-anchor', rotateYLabel ? 'middle' : 'begin')
                        .attr('transform', rotateYLabel ? 'rotate(90)' : '')
                        .attr('y', rotateYLabel ? (-Math.max(margin.right,width) + 12) : -10) //TODO: consider calculating this based on largest tick width... OR at least expose this on chart
                        .attr('x', rotateYLabel ? (scale.range()[0] / 2) : axis.tickPadding());
                    if (showMaxMin) {
                        var axisMaxMin = wrap.selectAll('g.nv-axisMaxMin')
                            .data(scale.domain());
                        axisMaxMin.enter().append('g').attr('class', 'nv-axisMaxMin').append('text')
                            .style('opacity', 0);
                        axisMaxMin.exit().remove();
                        axisMaxMin
                            .attr('transform', function(d,i) {
                                return 'translate(0,' + scale(d) + ')'
                            })
                            .select('text')
                            .attr('dy', '.32em')
                            .attr('y', 0)
                            .attr('x', axis.tickPadding())
                            .style('text-anchor', 'start')
                            .text(function(d,i) {
                                var v = fmt(d);
                                return ('' + v).match('NaN') ? '' : v;
                            });
                        axisMaxMin.watchTransition(renderWatch, 'min-max right')
                            .attr('transform', function(d,i) {
                                return 'translate(0,' + scale.range()[i] + ')'
                            })
                            .select('text')
                            .style('opacity', 1);
                    }
                    break;
                case 'left':
                    /*
                     //For dynamically placing the label. Can be used with dynamically-sized chart axis margins
                     var yTicks = g.selectAll('g').select("text");
                     yTicks.each(function(d,i){
                     var labelPadding = this.getBoundingClientRect().width + axis.tickPadding() + 16;
                     if(labelPadding > width) width = labelPadding;
                     });
                     */
                    axisLabel.enter().append('text').attr('class', 'nv-axislabel');
                    axisLabel
                        .style('text-anchor', rotateYLabel ? 'middle' : 'end')
                        .attr('transform', rotateYLabel ? 'rotate(-90)' : '')
                        .attr('y', rotateYLabel ? (-Math.max(margin.left,width) + 25 - (axisLabelDistance || 0)) : -10)
                        .attr('x', rotateYLabel ? (-scale.range()[0] / 2) : -axis.tickPadding());
                    if (showMaxMin) {
                        var axisMaxMin = wrap.selectAll('g.nv-axisMaxMin')
                            .data(scale.domain());
                        axisMaxMin.enter().append('g').attr('class', 'nv-axisMaxMin').append('text')
                            .style('opacity', 0);
                        axisMaxMin.exit().remove();
                        axisMaxMin
                            .attr('transform', function(d,i) {
                                return 'translate(0,' + scale0(d) + ')'
                            })
                            .select('text')
                            .attr('dy', '.32em')
                            .attr('y', 0)
                            .attr('x', -axis.tickPadding())
                            .attr('text-anchor', 'end')
                            .text(function(d,i) {
                                var v = fmt(d);
                                return ('' + v).match('NaN') ? '' : v;
                            });
                        axisMaxMin.watchTransition(renderWatch, 'min-max right')
                            .attr('transform', function(d,i) {
                                return 'translate(0,' + scale.range()[i] + ')'
                            })
                            .select('text')
                            .style('opacity', 1);
                    }
                    break;
            }
            axisLabel
                .text(function(d) { return d });


            if (showMaxMin && (axis.orient() === 'left' || axis.orient() === 'right')) {
                //check if max and min overlap other values, if so, hide the values that overlap
                g.selectAll('g') // the g's wrapping each tick
                    .each(function(d,i) {
                        d3.select(this).select('text').attr('opacity', 1);
                        if (scale(d) < scale.range()[1] + 10 || scale(d) > scale.range()[0] - 10) { // 10 is assuming text height is 16... if d is 0, leave it!
                            if (d > 1e-10 || d < -1e-10) // accounts for minor floating point errors... though could be problematic if the scale is EXTREMELY SMALL
                                d3.select(this).attr('opacity', 0);

                            d3.select(this).select('text').attr('opacity', 0); // Don't remove the ZERO line!!
                        }
                    });

                //if Max and Min = 0 only show min, Issue #281
                if (scale.domain()[0] == scale.domain()[1] && scale.domain()[0] == 0)
                    wrap.selectAll('g.nv-axisMaxMin')
                        .style('opacity', function(d,i) { return !i ? 1 : 0 });

            }

            if (showMaxMin && (axis.orient() === 'top' || axis.orient() === 'bottom')) {
                var maxMinRange = [];
                wrap.selectAll('g.nv-axisMaxMin')
                    .each(function(d,i) {
                        try {
                            if (i) // i== 1, max position
                                maxMinRange.push(scale(d) - this.getBoundingClientRect().width - 4)  //assuming the max and min labels are as wide as the next tick (with an extra 4 pixels just in case)
                            else // i==0, min position
                                maxMinRange.push(scale(d) + this.getBoundingClientRect().width + 4)
                        }catch (err) {
                            if (i) // i== 1, max position
                                maxMinRange.push(scale(d) - 4)  //assuming the max and min labels are as wide as the next tick (with an extra 4 pixels just in case)
                            else // i==0, min position
                                maxMinRange.push(scale(d) + 4)
                        }
                    });
                g.selectAll('g') // the g's wrapping each tick
                    .each(function(d,i) {
                        if (scale(d) < maxMinRange[0] || scale(d) > maxMinRange[1]) {
                            if (d > 1e-10 || d < -1e-10) // accounts for minor floating point errors... though could be problematic if the scale is EXTREMELY SMALL
                                d3.select(this).remove();
                            else
                                d3.select(this).select('text').remove(); // Don't remove the ZERO line!!
                        }
                    });
            }


            //highlight zero line ... Maybe should not be an option and should just be in CSS?
            if (highlightZero)
                g.selectAll('.tick')
                    .filter(function(d) { return !parseFloat(Math.round(this.__data__*100000)/1000000) && (this.__data__ !== undefined) }) //this is because sometimes the 0 tick is a very small fraction, TODO: think of cleaner technique
                    .classed('zero', true);

            //store old scales for use in transitions on update
            scale0 = scale.copy();

        });

        renderWatch.renderEnd('axis immediate');
        return chart;
    }


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.axis = axis;
    chart.dispatch = dispatch;

    d3.rebind(chart, axis, 'orient', 'tickValues', 'tickSubdivide', 'tickSize', 'tickPadding', 'tickFormat');
    d3.rebind(chart, scale, 'domain', 'range', 'rangeBand', 'rangeBands'); //these are also accessible by chart.scale(), but added common ones directly for ease of use

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart.margin = function(_) {
        if(!arguments.length) return margin;
        margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
        margin.right  = typeof _.right  != 'undefined' ? _.right  : margin.right;
        margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
        margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        return chart;
    }

    chart.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return chart;
    };

    chart.ticks = function(_) {
        if (!arguments.length) return ticks;
        ticks = _;
        return chart;
    };

    chart.height = function(_) {
        if (!arguments.length) return height;
        height = _;
        return chart;
    };

    chart.axisLabel = function(_) {
        if (!arguments.length) return axisLabelText;
        axisLabelText = _;
        return chart;
    }

    chart.showMaxMin = function(_) {
        if (!arguments.length) return showMaxMin;
        showMaxMin = _;
        return chart;
    }

    chart.highlightZero = function(_) {
        if (!arguments.length) return highlightZero;
        highlightZero = _;
        return chart;
    }

    chart.scale = function(_) {
        if (!arguments.length) return scale;
        scale = _;
        axis.scale(scale);
        isOrdinal = typeof scale.rangeBands === 'function';
        d3.rebind(chart, scale, 'domain', 'range', 'rangeBand', 'rangeBands');
        return chart;
    }

    chart.rotateYLabel = function(_) {
        if(!arguments.length) return rotateYLabel;
        rotateYLabel = _;
        return chart;
    }

    chart.rotateLabels = function(_) {
        if(!arguments.length) return rotateLabels;
        rotateLabels = _;
        return chart;
    };

    chart.staggerLabels = function(_) {
        if (!arguments.length) return staggerLabels;
        staggerLabels = _;
        return chart;
    };

    chart.axisLabelDistance = function(_) {
        if (!arguments.length) return axisLabelDistance;
        axisLabelDistance = _;
        return chart;
    };

    chart.duration = function(_) {
        if (!arguments.length) return duration;
        duration = _;
        renderWatch.reset(duration);
        return chart;
    };


    //============================================================


    return chart;
}
nv.models.pie = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 500
        , height = 500
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , color = nv.utils.defaultColor()
        , valueFormat = d3.format(',.2f')
        , labelFormat = d3.format('%')
        , showLabels = true
        , pieLabelsOutside = true
        , donutLabelsOutside = false
        , labelType = "key"
        , labelThreshold = .02 //if slice percentage is under this, don't show label
        , donut = false
        , title = false
        , growOnHover = true
        , titleOffset = 0
        , labelSunbeamLayout = false
        , startAngle = false
        , endAngle = false
        , donutRatio = 0.5
        , duration = 250
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'elementDblClick', 'elementMouseover', 'elementMouseout', 'renderEnd')
        ;


    //============================================================
    // chart function
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);

    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right
                ,availableHeight = height - margin.top - margin.bottom
                ,radius = Math.min(availableWidth, availableHeight) / 2
                ,arcRadius = radius-(radius / 5)
                ,container = d3.select(this)
                ;
            nv.utils.initSVG(container);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('.nv-wrap.nv-pie').data(data);
            var wrapEnter = wrap.enter().append('g').attr('class','nvd3 nv-wrap nv-pie nv-chart-' + id);
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');
            var g_pie = gEnter.append('g').attr('class', 'nv-pie');
            gEnter.append('g').attr('class', 'nv-pieLabels');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
            g.select('.nv-pie').attr('transform', 'translate(' + availableWidth / 2 + ',' + availableHeight / 2 + ')');
            g.select('.nv-pieLabels').attr('transform', 'translate(' + availableWidth / 2 + ',' + availableHeight / 2 + ')');

            //
            container.on('click', function(d,i) {
                dispatch.chartClick({
                    data: d,
                    index: i,
                    pos: d3.event,
                    id: id
                });
            });


            var arc = d3.svg.arc().outerRadius(arcRadius);
            var arcOver = d3.svg.arc().outerRadius(arcRadius + 5);

            if (startAngle) {
                arc.startAngle(startAngle);
                arcOver.startAngle(startAngle);
            }
            if (endAngle) {
                arc.endAngle(endAngle);
                arcOver.endAngle(endAngle);
            }
            if (donut) {
                arc.innerRadius(radius * donutRatio);
                arcOver.innerRadius(radius * donutRatio);
            }

            // Setup the Pie chart and choose the data element
            var pie = d3.layout.pie()
                .sort(null)
                .value(function(d) { return d.disabled ? 0 : getY(d) });

            // if title is specified and donut, put it in the middle
            if (donut && title) {
                var title_g = g_pie.append('g').attr('class', 'nv-pie');

                title_g.append("text")
                    .style("text-anchor", "middle")
                    .attr('class', 'nv-pie-title')
                    .text(function (d) {
                        return title;
                    })
                    .attr("dy", "0.35em") // trick to vertically center text
                    .attr('transform', function(d, i) {
                        return 'translate(0, '+ titleOffset + ')';
                    });
            }

            var slices = wrap.select('.nv-pie').selectAll('.nv-slice').data(pie);
            var pieLabels = wrap.select('.nv-pieLabels').selectAll('.nv-label').data(pie);

            slices.exit().remove();
            pieLabels.exit().remove();

            var ae = slices.enter().append('g')
            ae.attr('class', 'nv-slice')
            ae.on('mouseover', function(d,i){
                d3.select(this).classed('hover', true);
                if (growOnHover) {
                    d3.select(this).select("path").transition()
                        .duration(70)
                        .attr("d", arcOver);
                }
                dispatch.elementMouseover({
                    label: getX(d.data),
                    value: getY(d.data),
                    point: d.data,
                    pointIndex: i,
                    pos: [d3.event.pageX, d3.event.pageY],
                    id: id,
                    color: d3.select(this).style("fill")
                });
            });
            ae.on('mouseout', function(d,i){
                d3.select(this).classed('hover', false);
                if (growOnHover) {
                    d3.select(this).select("path").transition()
                        .duration(50)
                        .attr("d", arc);
                }
                dispatch.elementMouseout({
                    label: getX(d.data),
                    value: getY(d.data),
                    point: d.data,
                    index: i,
                    id: id
                });
            });
            ae.on('click', function(d,i) {
                dispatch.elementClick({
                    label: getX(d.data),
                    value: getY(d.data),
                    point: d.data,
                    index: i,
                    pos: d3.event,
                    id: id
                });
                d3.event.stopPropagation();
            });
            ae.on('dblclick', function(d,i) {
                dispatch.elementDblClick({
                    label: getX(d.data),
                    value: getY(d.data),
                    point: d.data,
                    index: i,
                    pos: d3.event,
                    id: id
                });
                d3.event.stopPropagation();
            });

            slices.attr('fill', function(d,i) { return color(d, i); })
            slices.attr('stroke', function(d,i) { return color(d, i); });

            var paths = ae.append('path').each(function(d) {
                this._current = d;
            });

            slices.select('path')
                .transition()
                .attr('d', arc)
                .attrTween('d', arcTween);

            if (showLabels) {
                // This does the normal label
                var labelsArc = d3.svg.arc().innerRadius(0);

                if (pieLabelsOutside){
                    var labelsArc = arc;
                }

                if (donutLabelsOutside) {
                    labelsArc = d3.svg.arc().outerRadius(arc.outerRadius());
                }

                pieLabels.enter().append("g").classed("nv-label",true).each(function(d,i) {
                    var group = d3.select(this);

                    group.attr('transform', function(d) {
                        if (labelSunbeamLayout) {
                            d.outerRadius = arcRadius + 10; // Set Outer Coordinate
                            d.innerRadius = arcRadius + 15; // Set Inner Coordinate
                            var rotateAngle = (d.startAngle + d.endAngle) / 2 * (180 / Math.PI);
                            if ((d.startAngle+d.endAngle)/2 < Math.PI) {
                                rotateAngle -= 90;
                            } else {
                                rotateAngle += 90;
                            }
                            return 'translate(' + labelsArc.centroid(d) + ') rotate(' + rotateAngle + ')';
                        } else {
                            d.outerRadius = radius + 10; // Set Outer Coordinate
                            d.innerRadius = radius + 15; // Set Inner Coordinate
                            return 'translate(' + labelsArc.centroid(d) + ')'
                        }
                    });

                    group.append('rect')
                        .style('stroke', '#fff')
                        .style('fill', '#fff')
                        .attr("rx", 3)
                        .attr("ry", 3);

                    group.append('text')
                        .style('text-anchor', labelSunbeamLayout ? ((d.startAngle + d.endAngle) / 2 < Math.PI ? 'start' : 'end') : 'middle') //center the text on it's origin or begin/end if orthogonal aligned
                        .style('fill', '#000')

                });

                var labelLocationHash = {};
                var avgHeight = 14;
                var avgWidth = 140;
                var createHashKey = function(coordinates) {
                    return Math.floor(coordinates[0]/avgWidth) * avgWidth + ',' + Math.floor(coordinates[1]/avgHeight) * avgHeight;
                };

                pieLabels.watchTransition(renderWatch,'pie labels').attr('transform', function(d) {
                    if (labelSunbeamLayout) {
                        d.outerRadius = arcRadius + 10; // Set Outer Coordinate
                        d.innerRadius = arcRadius + 15; // Set Inner Coordinate
                        var rotateAngle = (d.startAngle + d.endAngle) / 2 * (180 / Math.PI);
                        if ((d.startAngle+d.endAngle)/2 < Math.PI) {
                            rotateAngle -= 90;
                        } else {
                            rotateAngle += 90;
                        }
                        return 'translate(' + labelsArc.centroid(d) + ') rotate(' + rotateAngle + ')';
                    } else {
                        d.outerRadius = radius + 10; // Set Outer Coordinate
                        d.innerRadius = radius + 15; // Set Inner Coordinate

                        /*
                         Overlapping pie labels are not good. What this attempts to do is, prevent overlapping.
                         Each label location is hashed, and if a hash collision occurs, we assume an overlap.
                         Adjust the label's y-position to remove the overlap.
                         */
                        var center = labelsArc.centroid(d);
                        if(d.value){
                            var hashKey = createHashKey(center);
                            if (labelLocationHash[hashKey]) {
                                center[1] -= avgHeight;
                            }
                            labelLocationHash[createHashKey(center)] = true;
                        }
                        return 'translate(' + center + ')'
                    }
                });

                pieLabels.select(".nv-label text")
                    .style('text-anchor', labelSunbeamLayout ? ((d.startAngle + d.endAngle) / 2 < Math.PI ? 'start' : 'end') : 'middle') //center the text on it's origin or begin/end if orthogonal aligned
                    .text(function(d, i) {
                        var percent = (d.endAngle - d.startAngle) / (2 * Math.PI);
                        var labelTypes = {
                            "key" : getX(d.data),
                            "value": getY(d.data),
                            "percent": labelFormat(percent)
                        };
                        return (d.value && percent > labelThreshold) ? labelTypes[labelType] : '';
                    })
                ;
            }


            // Computes the angle of an arc, converting from radians to degrees.
            function angle(d) {
                var a = (d.startAngle + d.endAngle) * 90 / Math.PI - 90;
                return a > 90 ? a - 180 : a;
            }

            function arcTween(a) {
                a.endAngle = isNaN(a.endAngle) ? 0 : a.endAngle;
                a.startAngle = isNaN(a.startAngle) ? 0 : a.startAngle;
                if (!donut) a.innerRadius = 0;
                var i = d3.interpolate(this._current, a);
                this._current = i(0);
                return function(t) {
                    return arc(i(t));
                };
            }
        });

        renderWatch.renderEnd('pie immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        showLabels: {get: function(){return showLabels;}, set: function(_){showLabels=_;}},
        title:      {get: function(){return title;}, set: function(_){title=_;}},
        titleOffset:    {get: function(){return titleOffset;}, set: function(_){titleOffset=_;}},
        labelThreshold: {get: function(){return labelThreshold;}, set: function(_){labelThreshold=_;}},
        labelFormat:    {get: function(){return labelFormat;}, set: function(_){labelFormat=_;}},
        valueFormat:    {get: function(){return valueFormat;}, set: function(_){valueFormat=_;}},
        x:          {get: function(){return getX;}, set: function(_){getX=_;}},
        id:         {get: function(){return id;}, set: function(_){id=_;}},
        endAngle:   {get: function(){return endAngle;}, set: function(_){endAngle=_;}},
        startAngle: {get: function(){return startAngle;}, set: function(_){startAngle=_;}},
        donutRatio: {get: function(){return donutRatio;}, set: function(_){donutRatio=_;}},
        pieLabelsOutside:   {get: function(){return pieLabelsOutside;}, set: function(_){pieLabelsOutside=_;}},
        donutLabelsOutside: {get: function(){return donutLabelsOutside;}, set: function(_){donutLabelsOutside=_;}},
        labelSunbeamLayout: {get: function(){return labelSunbeamLayout;}, set: function(_){labelSunbeamLayout=_;}},
        donut:              {get: function(){return donut;}, set: function(_){donut=_;}},
        growOnHover:        {get: function(){return growOnHover;}, set: function(_){growOnHover=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
            margin.right  = typeof _.right  != 'undefined' ? _.right  : margin.right;
            margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
            margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        }},
        y: {get: function(){return getY;}, set: function(_){
            getY=d3.functor(_);
        }},
        color: {get: function(){return color;}, set: function(_){
            color=nv.utils.getColor(_);
        }},
        labelType:          {get: function(){return labelType;}, set: function(_){
            labelType= _ || 'key';
        }}
    });

    nv.utils.initOptions(chart);
    return chart;
};

nv.models.distribution = function() {
    "use strict";
    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 400 //technically width or height depending on x or y....
        , size = 8
        , axis = 'x' // 'x' or 'y'... horizontal or vertical
        , getData = function(d) { return d[axis] }  // defaults d.x or d.y
        , color = nv.utils.defaultColor()
        , scale = d3.scale.linear()
        , domain
        , duration = 250
        , dispatch = d3.dispatch('renderEnd')
        ;

    //============================================================


    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var scale0;
    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    //============================================================


    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var availableLength = width - (axis === 'x' ? margin.left + margin.right : margin.top + margin.bottom),
                naxis = axis == 'x' ? 'y' : 'x',
                container = d3.select(this);
            nv.utils.initSVG(container);

            //------------------------------------------------------------
            // Setup Scales

            scale0 = scale0 || scale;

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup containers and skeleton of chart

            var wrap = container.selectAll('g.nv-distribution').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-distribution');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')')

            //------------------------------------------------------------


            var distWrap = g.selectAll('g.nv-dist')
                .data(function(d) { return d }, function(d) { return d.key });

            distWrap.enter().append('g');
            distWrap
                .attr('class', function(d,i) { return 'nv-dist nv-series-' + i })
                .style('stroke', function(d,i) { return color(d, i) });

            var dist = distWrap.selectAll('line.nv-dist' + axis)
                .data(function(d) { return d.values })
            dist.enter().append('line')
                .attr(axis + '1', function(d,i) { return scale0(getData(d,i)) })
                .attr(axis + '2', function(d,i) { return scale0(getData(d,i)) })
            renderWatch.transition(distWrap.exit().selectAll('line.nv-dist' + axis), 'dist exit')
                // .transition()
                .attr(axis + '1', function(d,i) { return scale(getData(d,i)) })
                .attr(axis + '2', function(d,i) { return scale(getData(d,i)) })
                .style('stroke-opacity', 0)
                .remove();
            dist
                .attr('class', function(d,i) { return 'nv-dist' + axis + ' nv-dist' + axis + '-' + i })
                .attr(naxis + '1', 0)
                .attr(naxis + '2', size);
            renderWatch.transition(dist, 'dist')
                // .transition()
                .attr(axis + '1', function(d,i) { return scale(getData(d,i)) })
                .attr(axis + '2', function(d,i) { return scale(getData(d,i)) })


            scale0 = scale.copy();

        });
        renderWatch.renderEnd('distribution immediate');
        return chart;
    }


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------
    chart.options = nv.utils.optionsFunc.bind(chart);
    chart.dispatch = dispatch;

    chart.margin = function(_) {
        if (!arguments.length) return margin;
        margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
        margin.right  = typeof _.right  != 'undefined' ? _.right  : margin.right;
        margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
        margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        return chart;
    };

    chart.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return chart;
    };

    chart.axis = function(_) {
        if (!arguments.length) return axis;
        axis = _;
        return chart;
    };

    chart.size = function(_) {
        if (!arguments.length) return size;
        size = _;
        return chart;
    };

    chart.getData = function(_) {
        if (!arguments.length) return getData;
        getData = d3.functor(_);
        return chart;
    };

    chart.scale = function(_) {
        if (!arguments.length) return scale;
        scale = _;
        return chart;
    };

    chart.color = function(_) {
        if (!arguments.length) return color;
        color = nv.utils.getColor(_);
        return chart;
    };

    chart.duration = function(_) {
        if (!arguments.length) return duration;
        duration = _;
        renderWatch.reset(duration);
        return chart;
    };
    //============================================================


    return chart;
}
nv.models.legend = function () {
    "use strict";
    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 5, right: 0, bottom: 5, left: 0}
      , width = 400
      , height = 20
      , getKey = function (d) {
          return d.key
      }
      , getPlatform = function (d) {
          var symbol;

          if(d.platform === 'android'){
              symbol = 'G'
          }

          else if(d.platform === 'ios'){
              symbol = 'D'
          }

          if(d.platform === 'web'){
              symbol = 'b'
          }

          return symbol;
      }
      , color = nv.utils.defaultColor()
      , align = true
      , rightAlign = true
      , updateState = true   //If true, legend will update data.disabled and trigger a 'stateChange' dispatch.
      , radioButtonMode = false   //If true, clicking legend items will cause it to behave like a radio button. (only one can be selected at a time)
      , dispatch = d3.dispatch('legendClick', 'legendDblclick', 'legendMouseover', 'legendMouseout', 'stateChange')
      ;

    //============================================================


    function chart(selection) {
        selection.each(function (data) {
            var availableWidth = width - margin.left - margin.right,
              container = d3.select(this);


            //------------------------------------------------------------
            // Setup containers and skeleton of chart

            var wrap = container.selectAll('g.nv-legend').data([data]);

            wrap.enter().append('g').attr('class', 'nvd3 nv-legend').append('g');

            var g = wrap.select('g');


            //------------------------------------------------------------


            var series = g.selectAll('.nv-series')
              .data(function (d) {
                  return d
              });
            var seriesEnter = series.enter().append('g').attr('class', 'nv-series')
              .on('click', function (d, i) {
                  dispatch.legendClick(d, i);
                  if (updateState) {

                      d.disabled = !d.disabled;
                      if (data.every(function (series) {
                            return series.disabled
                        })) {
                          data.forEach(function (series) {
                              series.disabled = false
                          });
                      }
                  }
                  dispatch.stateChange({
                      disabled: data.map(function (d) {
                          return !!d.disabled
                      })
                  });
              })
              .on('dblclick', function (d, i) {
                  dispatch.legendDblclick(d, i);
                  if (updateState) {
                      //the default behavior of NVD3 legends, when double clicking one,
                      // is to set all other series' to false, and make the double clicked series enabled.
                      data.forEach(function (series) {
                          series.disabled = true;
                      });
                      d.disabled = false;
                      dispatch.stateChange({
                          disabled: data.map(function (d) {
                              return !!d.disabled
                          })
                      });
                  }
              });
            seriesEnter.append('circle')
              .style('stroke-width', 2)
              .attr('class', 'nv-legend-symbol')
              .attr('r', 5);

            seriesEnter.append('text')
              .attr('text-anchor', 'start')
              .attr('class', 'nv-legend-text')
              .attr('dy', '.32em')
              .attr('dx', function(d){
                  return d.platform ? 28 : 10;
              });

            seriesEnter.append('text')
              .attr('text-anchor', 'start')
              .attr('class', 'nv-legend-platform')
              .attr('dy', '6')
              .attr('dx', '10');

            seriesEnter.append("svg:path")
              .attr("d", "m13.44044,0c-4.57319,3.46106 -8.95912,8.09112 -8.95912,8.09112l-3.16094,-2.84112l-1.32037,1.34488c1.29894,1.22106 4.30894,4.44631 5.327,5.65512c2.86563,-4.78756 5.84456,-8.358 8.673,-11.62262l-0.55956,-0.62738")
              .attr("transform", "translate(-5, -8)")
              .attr("class", "nv-series-tick");

            series.classed('disabled', function (d) {
                return d.disabled
            });

            series.exit().remove();

            series
              .style('fill', function (d, i) {
                  return d.color || color(d, i)
              });

            series.select('circle')
              .style('stroke', function (d, i) {
                  return d.color || color(d, i)
              });

            series.select('.nv-legend-text').text(getKey);
            series.select('.nv-legend-platform').text(getPlatform);

            var ypos = 5,
              newxpos = 5,
              xpos;

            series
              .attr('transform', function (d, i) {
                  var padding = d.platform ? 60 : 40;
                  var length = d3.select(this).select('text').node().getComputedTextLength() + padding;
                  xpos = newxpos;

                  if (width - 30 < xpos + length) {
                      newxpos = xpos = 5;
                      ypos += 20;
                  }

                  newxpos += length;

                  return 'translate(' + xpos + ',' + ypos + ')';
              });

            height = margin.top + margin.bottom + ypos;

        });

        return chart;
    }


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart.margin = function (_) {
        if (!arguments.length) return margin;
        margin.top = typeof _.top != 'undefined' ? _.top : margin.top;
        margin.right = typeof _.right != 'undefined' ? _.right : margin.right;
        margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
        margin.left = typeof _.left != 'undefined' ? _.left : margin.left;
        return chart;
    };

    chart.width = function (_) {
        if (!arguments.length) return width;
        width = _;
        return chart;
    };

    chart.height = function (_) {
        if (!arguments.length) return height;
        height = _;
        return chart;
    };

    chart.key = function (_) {
        if (!arguments.length) return getKey;
        getKey = _;
        return chart;
    };

    chart.color = function (_) {
        if (!arguments.length) return color;
        color = nv.utils.getColor(_);
        return chart;
    };

    chart.align = function (_) {
        if (!arguments.length) return align;
        align = _;
        return chart;
    };

    chart.rightAlign = function (_) {
        if (!arguments.length) return rightAlign;
        rightAlign = _;
        return chart;
    };

    chart.updateState = function (_) {
        if (!arguments.length) return updateState;
        updateState = _;
        return chart;
    };

    chart.radioButtonMode = function (_) {
        if (!arguments.length) return radioButtonMode;
        radioButtonMode = _;
        return chart;
    };

    //============================================================


    return chart;
}
nv.models.line = function() {
    "use strict";
    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var  scatter = nv.models.scatter()
        ;

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 960
        , height = 500
        , color = nv.utils.defaultColor() // a function that returns a color
        , getX = function(d) { return d.x } // accessor to get the x value from a data point
        , getY = function(d) { return d.y } // accessor to get the y value from a data point
        , defined = function(d,i) { return !isNaN(getY(d,i)) && getY(d,i) !== null } // allows a line to be not continuous when it is not defined
        , isArea = function(d) { return d.area } // decides if a line is an area or just a line
        , clipEdge = false // if true, masks lines within x and y scale
        , x //can be accessed via chart.xScale()
        , y //can be accessed via chart.yScale()
        , interpolate = "linear" // controls the line interpolation
        , duration = 250
        , dispatch = d3.dispatch('elementClick', 'elementMouseover', 'elementMouseout', 'renderEnd')
        ;

    scatter
        .size(16) // default size
        .sizeDomain([16,256]) //set to speed up calculation, needs to be unset if there is a custom size accessor
    ;

    //============================================================


    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var x0, y0 //used to store previous scales
        , renderWatch = nv.utils.renderWatch(dispatch, duration)
        ;

    //============================================================


    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(scatter);
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right,
                availableHeight = height - margin.top - margin.bottom,
                container = d3.select(this);
            nv.utils.initSVG(container);
            //------------------------------------------------------------
            // Setup Scales

            x = scatter.xScale();
            y = scatter.yScale();

            x0 = x0 || x;
            y0 = y0 || y;

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup containers and skeleton of chart

            var wrap = container.selectAll('g.nv-wrap.nv-line').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-line');
            var defsEnter = wrapEnter.append('defs');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g')

            gEnter.append('g').attr('class', 'nv-groups');
            gEnter.append('g').attr('class', 'nv-scatterWrap');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            //------------------------------------------------------------




            scatter
                .width(availableWidth)
                .height(availableHeight)

            var scatterWrap = wrap.select('.nv-scatterWrap');
            //.datum(data); // Data automatically trickles down from the wrap

            scatterWrap.call(scatter);



            defsEnter.append('clipPath')
                .attr('id', 'nv-edge-clip-' + scatter.id())
                .append('rect');

            wrap.select('#nv-edge-clip-' + scatter.id() + ' rect')
                .attr('width', availableWidth)
                .attr('height', (availableHeight > 0) ? availableHeight : 0);

            g   .attr('clip-path', clipEdge ? 'url(#nv-edge-clip-' + scatter.id() + ')' : '');
            scatterWrap
                .attr('clip-path', clipEdge ? 'url(#nv-edge-clip-' + scatter.id() + ')' : '');



            var groups = wrap.select('.nv-groups').selectAll('.nv-group')
                .data(function(d) { return d }, function(d) { return d.key });
            groups.enter().append('g')
                .style('stroke-opacity', 1e-6)
                .style('fill-opacity', 1e-6);

            groups.exit().remove();

            groups
                .attr('class', function(d,i) { return 'nv-group nv-series-' + i })
                .classed('hover', function(d) { return d.hover })
                .style('fill', function(d,i){ return color(d, i) })
                .style('stroke', function(d,i){ return color(d, i)});
            groups.watchTransition(renderWatch, 'line: groups')
                .style('stroke-opacity', 1)
                .style('fill-opacity', .5);



            var areaPaths = groups.selectAll('path.nv-area')
                .data(function(d) { return isArea(d) ? [d] : [] }); // this is done differently than lines because I need to check if series is an area
            areaPaths.enter().append('path')
                .attr('class', 'nv-area')
                .attr('d', function(d) {
                    return d3.svg.area()
                        .interpolate(interpolate)
                        .defined(defined)
                        .x(function(d,i) { return nv.utils.NaNtoZero(x0(getX(d,i))) })
                        .y0(function(d,i) { return nv.utils.NaNtoZero(y0(getY(d,i))) })
                        .y1(function(d,i) { return y0( y.domain()[0] <= 0 ? y.domain()[1] >= 0 ? 0 : y.domain()[1] : y.domain()[0] ) })
                        //.y1(function(d,i) { return y0(0) }) //assuming 0 is within y domain.. may need to tweak this
                        .apply(this, [d.values])
                });
            groups.exit().selectAll('path.nv-area')
                .remove();

            areaPaths.watchTransition(renderWatch, 'line: areaPaths')
                .attr('d', function(d) {
                    return d3.svg.area()
                        .interpolate(interpolate)
                        .defined(defined)
                        .x(function(d,i) { return nv.utils.NaNtoZero(x(getX(d,i))) })
                        .y0(function(d,i) { return nv.utils.NaNtoZero(y(getY(d,i))) })
                        .y1(function(d,i) { return y( y.domain()[0] <= 0 ? y.domain()[1] >= 0 ? 0 : y.domain()[1] : y.domain()[0] ) })
                        //.y1(function(d,i) { return y0(0) }) //assuming 0 is within y domain.. may need to tweak this
                        .apply(this, [d.values])
                });



            var linePaths = groups.selectAll('path.nv-line')
                .data(function(d) { return [d.values] });
            linePaths.enter().append('path')
                .attr('class', 'nv-line')
                .attr('d',
                d3.svg.line()
                    .interpolate(interpolate)
                    .defined(defined)
                    .x(function(d,i) { return nv.utils.NaNtoZero(x0(getX(d,i))) })
                    .y(function(d,i) { return nv.utils.NaNtoZero(y0(getY(d,i))) })
            );

            linePaths.watchTransition(renderWatch, 'line: linePaths')
                .attr('d',
                d3.svg.line()
                    .interpolate(interpolate)
                    .defined(defined)
                    .x(function(d,i) { return nv.utils.NaNtoZero(x(getX(d,i))) })
                    .y(function(d,i) { return nv.utils.NaNtoZero(y(getY(d,i))) })
            );



            //store old scales for use in transitions on update
            x0 = x.copy();
            y0 = y.copy();

        });
        renderWatch.renderEnd('line immediate');
        return chart;
    }


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.scatter = scatter;
    // Pass through events
    scatter.dispatch.on('elementClick', function(){ dispatch.elementClick.apply(this, arguments); })
    scatter.dispatch.on('elementMouseover', function(){ dispatch.elementMouseover.apply(this, arguments); })
    scatter.dispatch.on('elementMouseout', function(){ dispatch.elementMouseout.apply(this, arguments); })

    d3.rebind(chart, scatter, 'id', 'interactive', 'size', 'xScale', 'yScale', 'zScale', 'xDomain', 'yDomain', 'xRange', 'yRange',
        'sizeDomain', 'forceX', 'forceY', 'forceSize', 'clipVoronoi', 'useVoronoi', 'clipRadius', 'padData','highlightPoint','clearHighlights');

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart.margin = function(_) {
        if (!arguments.length) return margin;
        margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
        margin.right  = typeof _.right  != 'undefined' ? _.right  : margin.right;
        margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
        margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        return chart;
    };

    chart.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return chart;
    };

    chart.height = function(_) {
        if (!arguments.length) return height;
        height = _;
        return chart;
    };

    chart.x = function(_) {
        if (!arguments.length) return getX;
        getX = _;
        scatter.x(_);
        return chart;
    };

    chart.y = function(_) {
        if (!arguments.length) return getY;
        getY = _;
        scatter.y(_);
        return chart;
    };

    chart.clipEdge = function(_) {
        if (!arguments.length) return clipEdge;
        clipEdge = _;
        return chart;
    };

    chart.color = function(_) {
        if (!arguments.length) return color;
        color = nv.utils.getColor(_);
        scatter.color(color);
        return chart;
    };

    chart.interpolate = function(_) {
        if (!arguments.length) return interpolate;
        interpolate = _;
        return chart;
    };

    chart.defined = function(_) {
        if (!arguments.length) return defined;
        defined = _;
        return chart;
    };

    chart.isArea = function(_) {
        if (!arguments.length) return isArea;
        isArea = d3.functor(_);
        return chart;
    };

    chart.duration = function(_) {
        if (!arguments.length) return duration;
        duration = _;
        renderWatch.reset(duration);
        scatter.duration(duration);
        return chart;
    };

    //============================================================


    return chart;
}

nv.models.scatter = function() {
    "use strict";
    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin       = {top: 0, right: 0, bottom: 0, left: 0}
        , width        = 960
        , height       = 500
        , color        = nv.utils.defaultColor() // chooses color
        , id           = Math.floor(Math.random() * 100000) //Create semi-unique ID incase user doesn't select one
        , x            = d3.scale.linear()
        , y            = d3.scale.linear()
        , z            = d3.scale.linear() //linear because d3.svg.shape.size is treated as area
        , getX         = function(d) { return d.x } // accessor to get the x value
        , getY         = function(d) { return d.y } // accessor to get the y value
        , getSize      = function(d) { return d.size || 1} // accessor to get the point size
        , getShape     = function(d) { return d.shape || 'circle' } // accessor to get point shape
        , onlyCircles  = true // Set to false to use shapes
        , forceX       = [] // List of numbers to Force into the X scale (ie. 0, or a max / min, etc.)
        , forceY       = [] // List of numbers to Force into the Y scale
        , forceSize    = [] // List of numbers to Force into the Size scale
        , interactive  = true // If true, plots a voronoi overlay for advanced point intersection
        , pointKey     = null
        , pointActive  = function(d) { return !d.notActive } // any points that return false will be filtered out
        , padData      = false // If true, adds half a data points width to front and back, for lining up a line chart with a bar chart
        , padDataOuter = .1 //outerPadding to imitate ordinal scale outer padding
        , clipEdge     = false // if true, masks points within x and y scale
        , clipVoronoi  = true // if true, masks each point with a circle... can turn off to slightly increase performance
        , clipRadius   = function() { return 25 } // function to get the radius for voronoi point clips
        , xDomain      = null // Override x domain (skips the calculation from data)
        , yDomain      = null // Override y domain
        , xRange       = null // Override x range
        , yRange       = null // Override y range
        , sizeDomain   = null // Override point size domain
        , sizeRange    = null
        , singlePoint  = false
        , dispatch     = d3.dispatch('elementClick', 'elementDblClick', 'elementMouseover', 'elementMouseout', 'renderEnd')
        , useVoronoi   = true
        , duration     = 250
        ;

    //============================================================


    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var x0, y0, z0 // used to store previous scales
        , timeoutID
        , needsUpdate = false // Flag for when the points are visually updating, but the interactive layer is behind, to disable tooltips
        , renderWatch = nv.utils.renderWatch(dispatch, duration)
        ;

    //============================================================


    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right,
                availableHeight = height - margin.top - margin.bottom,
                container = d3.select(this);
            nv.utils.initSVG(container);

            //add series index to each data point for reference
            data.forEach(function(series, i) {
                series.values.forEach(function(point) {
                    point.series = i;
                });
            });

            //------------------------------------------------------------
            // Setup Scales

            // remap and flatten the data for use in calculating the scales' domains
            var seriesData = (xDomain && yDomain && sizeDomain) ? [] : // if we know xDomain and yDomain and sizeDomain, no need to calculate.... if Size is constant remember to set sizeDomain to speed up performance
                d3.merge(
                    data.map(function(d) {
                        return d.values.map(function(d,i) {
                            return { x: getX(d,i), y: getY(d,i), size: getSize(d,i) }
                        })
                    })
                );

            x   .domain(xDomain || d3.extent(seriesData.map(function(d) { return d.x; }).concat(forceX)))

            if (padData && data[0])
                x.range(xRange || [(availableWidth * padDataOuter +  availableWidth) / (2 *data[0].values.length), availableWidth - availableWidth * (1 + padDataOuter) / (2 * data[0].values.length)  ]);
            //x.range([availableWidth * .5 / data[0].values.length, availableWidth * (data[0].values.length - .5)  / data[0].values.length ]);
            else
                x.range(xRange || [0, availableWidth]);

            y   .domain(yDomain || d3.extent(seriesData.map(function(d) { return d.y }).concat(forceY)))
                .range(yRange || [availableHeight, 0]);

            z   .domain(sizeDomain || d3.extent(seriesData.map(function(d) { return d.size }).concat(forceSize)))
                .range(sizeRange || [16, 256]);

            // If scale's domain don't have a range, slightly adjust to make one... so a chart can show a single data point
            if (x.domain()[0] === x.domain()[1] || y.domain()[0] === y.domain()[1]) singlePoint = true;
            if (x.domain()[0] === x.domain()[1])
                x.domain()[0] ?
                    x.domain([x.domain()[0] - x.domain()[0] * 0.01, x.domain()[1] + x.domain()[1] * 0.01])
                    : x.domain([-1,1]);

            if (y.domain()[0] === y.domain()[1])
                y.domain()[0] ?
                    y.domain([y.domain()[0] - y.domain()[0] * 0.01, y.domain()[1] + y.domain()[1] * 0.01])
                    : y.domain([-1,1]);

            if ( isNaN(x.domain()[0])) {
                x.domain([-1,1]);
            }

            if ( isNaN(y.domain()[0])) {
                y.domain([-1,1]);
            }


            x0 = x0 || x;
            y0 = y0 || y;
            z0 = z0 || z;

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup containers and skeleton of chart

            var wrap = container.selectAll('g.nv-wrap.nv-scatter').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-scatter nv-chart-' + id + (singlePoint ? ' nv-single-point' : ''));
            var defsEnter = wrapEnter.append('defs');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-groups');
            gEnter.append('g').attr('class', 'nv-point-paths');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            //------------------------------------------------------------


            defsEnter.append('clipPath')
                .attr('id', 'nv-edge-clip-' + id)
                .append('rect');

            wrap.select('#nv-edge-clip-' + id + ' rect')
                .attr('width', availableWidth)
                .attr('height', (availableHeight > 0) ? availableHeight : 0);

            g   .attr('clip-path', clipEdge ? 'url(#nv-edge-clip-' + id + ')' : '');


            function updateInteractiveLayer() {

                if (!interactive) return false;

                var eventElements;

                var vertices = d3.merge(data.map(function(group, groupIndex) {
                        return group.values
                            .map(function(point, pointIndex) {
                                // *Adding noise to make duplicates very unlikely
                                // *Injecting series and point index for reference
                                /* *Adding a 'jitter' to the points, because there's an issue in d3.geom.voronoi.
                                 */
                                var pX = getX(point,pointIndex);
                                var pY = getY(point,pointIndex);

                                return [x(pX)+ Math.random() * 1e-7,
                                        y(pY)+ Math.random() * 1e-7,
                                    groupIndex,
                                    pointIndex, point]; //temp hack to add noise untill I think of a better way so there are no duplicates
                            })
                            .filter(function(pointArray, pointIndex) {
                                return pointActive(pointArray[4], pointIndex); // Issue #237.. move filter to after map, so pointIndex is correct!
                            })
                    })
                );



                //inject series and point index for reference into voronoi
                if (useVoronoi === true) {

                    if (clipVoronoi) {
                        var pointClipsEnter = wrap.select('defs').selectAll('.nv-point-clips')
                            .data([id])
                            .enter();

                        pointClipsEnter.append('clipPath')
                            .attr('class', 'nv-point-clips')
                            .attr('id', 'nv-points-clip-' + id);

                        var pointClips = wrap.select('#nv-points-clip-' + id).selectAll('circle')
                            .data(vertices);
                        pointClips.enter().append('circle')
                            .attr('r', clipRadius);
                        pointClips.exit().remove();
                        pointClips
                            .attr('cx', function(d) { return d[0] })
                            .attr('cy', function(d) { return d[1] });

                        wrap.select('.nv-point-paths')
                            .attr('clip-path', 'url(#nv-points-clip-' + id + ')');
                    }


                    if(vertices.length) {
                        // Issue #283 - Adding 2 dummy points to the voronoi b/c voronoi requires min 3 points to work
                        vertices.push([x.range()[0] - 20, y.range()[0] - 20, null, null]);
                        vertices.push([x.range()[1] + 20, y.range()[1] + 20, null, null]);
                        vertices.push([x.range()[0] - 20, y.range()[0] + 20, null, null]);
                        vertices.push([x.range()[1] + 20, y.range()[1] - 20, null, null]);
                    }

                    var bounds = d3.geom.polygon([
                        [-10,-10],
                        [-10,height + 10],
                        [width + 10,height + 10],
                        [width + 10,-10]
                    ]);

                    var voronoi = d3.geom.voronoi(vertices).map(function(d, i) {
                        return {
                            'data': bounds.clip(d),
                            'series': vertices[i][2],
                            'point': vertices[i][3]
                        }
                    });


                    var pointPaths = wrap.select('.nv-point-paths').selectAll('path')
                        .data(voronoi);
                    pointPaths.enter().append('path')
                        .attr('class', function(d,i) { return 'nv-path-'+i; });
                    pointPaths.exit().remove();
                    pointPaths
                        .attr('d', function(d) {
                            if (!d || !d.data || d.data.length === 0)
                                return 'M 0 0'
                            else
                                return 'M' + d.data.join('L') + 'Z';
                        });

                    var mouseEventCallback = function(d,mDispatch) {
                        if (needsUpdate) return 0;
                        var series = data[d.series];
                        if (typeof series === 'undefined') return;

                        var point  = series.values[d.point];

                        mDispatch({
                            point: point,
                            series: series,
                            pos: [x(getX(point, d.point)) + margin.left, y(getY(point, d.point)) + margin.top],
                            seriesIndex: d.series,
                            pointIndex: d.point
                        });
                    };

                    pointPaths
                        .on('click', function(d) {
                            mouseEventCallback(d, dispatch.elementClick);
                        })
                        .on('dblclick', function(d) {
                            mouseEventCallback(d, dispatch.elementDblClick);
                        })
                        .on('mouseover', function(d) {
                            mouseEventCallback(d, dispatch.elementMouseover);
                        })
                        .on('mouseout', function(d, i) {
                            mouseEventCallback(d, dispatch.elementMouseout);
                        });


                } else {
                    /*
                     // bring data in form needed for click handlers
                     var dataWithPoints = vertices.map(function(d, i) {
                     return {
                     'data': d,
                     'series': vertices[i][2],
                     'point': vertices[i][3]
                     }
                     });
                     */

                    // add event handlers to points instead voronoi paths
                    wrap.select('.nv-groups').selectAll('.nv-group')
                        .selectAll('.nv-point')
                        //.data(dataWithPoints)
                        //.style('pointer-events', 'auto') // recativate events, disabled by css
                        .on('click', function(d,i) {
                            //nv.log('test', d, i);
                            if (needsUpdate || !data[d.series]) return 0; //check if this is a dummy point
                            var series = data[d.series],
                                point  = series.values[i];

                            dispatch.elementClick({
                                point: point,
                                series: series,
                                pos: [x(getX(point, i)) + margin.left, y(getY(point, i)) + margin.top],
                                seriesIndex: d.series,
                                pointIndex: i
                            });
                        })
                        .on('mouseover', function(d,i) {
                            if (needsUpdate || !data[d.series]) return 0; //check if this is a dummy point
                            var series = data[d.series],
                                point  = series.values[i];

                            dispatch.elementMouseover({
                                point: point,
                                series: series,
                                pos: [x(getX(point, i)) + margin.left, y(getY(point, i)) + margin.top],
                                seriesIndex: d.series,
                                pointIndex: i
                            });
                        })
                        .on('mouseout', function(d,i) {
                            if (needsUpdate || !data[d.series]) return 0; //check if this is a dummy point
                            var series = data[d.series],
                                point  = series.values[i];

                            dispatch.elementMouseout({
                                point: point,
                                series: series,
                                seriesIndex: d.series,
                                pointIndex: i
                            });
                        });
                }

                needsUpdate = false;
            }

            needsUpdate = true;
            var groups = wrap.select('.nv-groups').selectAll('.nv-group')
                .data(function(d) { return d }, function(d) { return d.key });
            groups.enter().append('g')
                .style('stroke-opacity', 1e-6)
                .style('fill-opacity', 1e-6);
            groups.exit()
                .remove();
            groups
                .attr('class', function(d,i) { return 'nv-group nv-series-' + i })
                .classed('hover', function(d) { return d.hover });
            groups.watchTransition(renderWatch, 'scatter: groups')
                .style('fill', function(d,i) { return color(d, i) })
                .style('stroke', function(d,i) { return color(d, i) })
                .style('stroke-opacity', 1)
                .style('fill-opacity', .5);


            if (onlyCircles) {
                var points = groups.selectAll('circle.nv-point')
                    .data(function(d) { return d.values }, pointKey);
                points.enter().append('circle')
                    .style('fill', function (d,i) { return d.color })
                    .style('stroke', function (d,i) { return d.color })
                    .attr('cx', function(d,i) { return nv.utils.NaNtoZero(x0(getX(d,i))) })
                    .attr('cy', function(d,i) { return nv.utils.NaNtoZero(y0(getY(d,i))) })
                    .attr('r', function(d,i) { return Math.sqrt(z(getSize(d,i))/Math.PI) });
                points.exit().remove();
                groups.exit().selectAll('path.nv-point')
                    .watchTransition(renderWatch, 'scatter exit')
                    .attr('cx', function(d,i) { return nv.utils.NaNtoZero(x(getX(d,i))) })
                    .attr('cy', function(d,i) { return nv.utils.NaNtoZero(y(getY(d,i))) })
                    .remove();
                points.each(function(d,i) {
                    d3.select(this)
                        .classed('nv-point', true)
                        .classed('nv-point-' + i, true)
                        .classed('hover',false)
                    ;
                });
                points
                    .watchTransition(renderWatch, 'scatter points')
                    .attr('cx', function(d,i) { return nv.utils.NaNtoZero(x(getX(d,i))) })
                    .attr('cy', function(d,i) { return nv.utils.NaNtoZero(y(getY(d,i))) })
                    .attr('r', function(d,i) { return Math.sqrt(z(getSize(d,i))/Math.PI) });

            } else {

                var points = groups.selectAll('path.nv-point')
                    .data(function(d) { return d.values });
                points.enter().append('path')
                    .style('fill', function (d,i) { return d.color })
                    .style('stroke', function (d,i) { return d.color })
                    .attr('transform', function(d,i) {
                        return 'translate(' + x0(getX(d,i)) + ',' + y0(getY(d,i)) + ')'
                    })
                    .attr('d',
                    d3.svg.symbol()
                        .type(getShape)
                        .size(function(d,i) { return z(getSize(d,i)) })
                );
                points.exit().remove();
                groups.exit().selectAll('path.nv-point')
                    .watchTransition(renderWatch, 'scatter exit')
                    .attr('transform', function(d,i) {
                        return 'translate(' + x(getX(d,i)) + ',' + y(getY(d,i)) + ')'
                    })
                    .remove();
                points.each(function(d,i) {
                    d3.select(this)
                        .classed('nv-point', true)
                        .classed('nv-point-' + i, true)
                        .classed('hover',false)
                    ;
                });
                points
                    .watchTransition(renderWatch, 'scatter points')
                    .attr('transform', function(d,i) {
                        //nv.log(d,i,getX(d,i), x(getX(d,i)));
                        return 'translate(' + x(getX(d,i)) + ',' + y(getY(d,i)) + ')'
                    })
                    .attr('d',
                    d3.svg.symbol()
                        .type(getShape)
                        .size(function(d,i) { return z(getSize(d,i)) })
                );
            }


            // Delay updating the invisible interactive layer for smoother animation
            clearTimeout(timeoutID); // stop repeat calls to updateInteractiveLayer
            timeoutID = setTimeout(updateInteractiveLayer, 300);
            //updateInteractiveLayer();

            //store old scales for use in transitions on update
            x0 = x.copy();
            y0 = y.copy();
            z0 = z.copy();

        });
        renderWatch.renderEnd('scatter immediate');
        return chart;
    }


    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------
    chart.clearHighlights = function() {
        //Remove the 'hover' class from all highlighted points.
        d3.selectAll(".nv-chart-" + id + " .nv-point.hover").classed("hover",false);
    };

    chart.highlightPoint = function(seriesIndex,pointIndex,isHoverOver) {
        d3.select(".nv-chart-" + id + " .nv-series-" + seriesIndex + " .nv-point-" + pointIndex)
            .classed("hover",isHoverOver);
    };


    dispatch.on('elementMouseover.point', function(d) {
        if (interactive) chart.highlightPoint(d.seriesIndex,d.pointIndex,true);
    });

    dispatch.on('elementMouseout.point', function(d) {
        if (interactive) chart.highlightPoint(d.seriesIndex,d.pointIndex,false);
    });

    //============================================================


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart.x = function(_) {
        if (!arguments.length) return getX;
        getX = d3.functor(_);
        return chart;
    };

    chart.y = function(_) {
        if (!arguments.length) return getY;
        getY = d3.functor(_);
        return chart;
    };

    chart.size = function(_) {
        if (!arguments.length) return getSize;
        getSize = d3.functor(_);
        return chart;
    };

    chart.margin = function(_) {
        if (!arguments.length) return margin;
        margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
        margin.right  = typeof _.right  != 'undefined' ? _.right  : margin.right;
        margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
        margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        return chart;
    };

    chart.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return chart;
    };

    chart.height = function(_) {
        if (!arguments.length) return height;
        height = _;
        return chart;
    };

    chart.xScale = function(_) {
        if (!arguments.length) return x;
        x = _;
        return chart;
    };

    chart.yScale = function(_) {
        if (!arguments.length) return y;
        y = _;
        return chart;
    };

    chart.zScale = function(_) {
        if (!arguments.length) return z;
        z = _;
        return chart;
    };

    chart.xDomain = function(_) {
        if (!arguments.length) return xDomain;
        xDomain = _;
        return chart;
    };

    chart.yDomain = function(_) {
        if (!arguments.length) return yDomain;
        yDomain = _;
        return chart;
    };

    chart.sizeDomain = function(_) {
        if (!arguments.length) return sizeDomain;
        sizeDomain = _;
        return chart;
    };

    chart.xRange = function(_) {
        if (!arguments.length) return xRange;
        xRange = _;
        return chart;
    };

    chart.yRange = function(_) {
        if (!arguments.length) return yRange;
        yRange = _;
        return chart;
    };

    chart.sizeRange = function(_) {
        if (!arguments.length) return sizeRange;
        sizeRange = _;
        return chart;
    };

    chart.forceX = function(_) {
        if (!arguments.length) return forceX;
        forceX = _;
        return chart;
    };

    chart.forceY = function(_) {
        if (!arguments.length) return forceY;
        forceY = _;
        return chart;
    };

    chart.forceSize = function(_) {
        if (!arguments.length) return forceSize;
        forceSize = _;
        return chart;
    };

    chart.interactive = function(_) {
        if (!arguments.length) return interactive;
        interactive = _;
        return chart;
    };

    chart.pointKey = function(_) {
        if (!arguments.length) return pointKey;
        pointKey = _;
        return chart;
    };

    chart.pointActive = function(_) {
        if (!arguments.length) return pointActive;
        pointActive = _;
        return chart;
    };

    chart.padData = function(_) {
        if (!arguments.length) return padData;
        padData = _;
        return chart;
    };

    chart.padDataOuter = function(_) {
        if (!arguments.length) return padDataOuter;
        padDataOuter = _;
        return chart;
    };

    chart.clipEdge = function(_) {
        if (!arguments.length) return clipEdge;
        clipEdge = _;
        return chart;
    };

    chart.clipVoronoi= function(_) {
        if (!arguments.length) return clipVoronoi;
        clipVoronoi = _;
        return chart;
    };

    chart.useVoronoi= function(_) {
        if (!arguments.length) return useVoronoi;
        useVoronoi = _;
        if (useVoronoi === false) {
            clipVoronoi = false;
        }
        return chart;
    };

    chart.clipRadius = function(_) {
        if (!arguments.length) return clipRadius;
        clipRadius = _;
        return chart;
    };

    chart.color = function(_) {
        if (!arguments.length) return color;
        color = nv.utils.getColor(_);
        return chart;
    };

    chart.shape = function(_) {
        if (!arguments.length) return getShape;
        getShape = _;
        return chart;
    };

    chart.onlyCircles = function(_) {
        if (!arguments.length) return onlyCircles;
        onlyCircles = _;
        return chart;
    };

    chart.id = function(_) {
        if (!arguments.length) return id;
        id = _;
        return chart;
    };

    chart.singlePoint = function(_) {
        if (!arguments.length) return singlePoint;
        singlePoint = _;
        return chart;
    };

    chart.duration = function(_) {
        if (!arguments.length) return duration;
        duration = _;
        renderWatch.reset(duration);
        return chart;
    };

    //============================================================


    return chart;
}

nv.models.sparkline = function() {
    "use strict";
    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 2, right: 0, bottom: 2, left: 0}
        , width = 400
        , height = 32
        , animate = true
        , x = d3.scale.linear()
        , y = d3.scale.linear()
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , color = nv.utils.getColor(['#000'])
        , xDomain
        , yDomain
        , xRange
        , yRange
        ;

    //============================================================


    function chart(selection) {
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right,
                availableHeight = height - margin.top - margin.bottom,
                container = d3.select(this);
            nv.utils.initSVG(container);

            //------------------------------------------------------------
            // Setup Scales

            x   .domain(xDomain || d3.extent(data, getX ))
                .range(xRange || [0, availableWidth]);

            y   .domain(yDomain || d3.extent(data, getY ))
                .range(yRange || [availableHeight, 0]);

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup containers and skeleton of chart

            var wrap = container.selectAll('g.nv-wrap.nv-sparkline').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-sparkline');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')')

            //------------------------------------------------------------


            var paths = wrap.selectAll('path')
                .data(function(d) { return [d] });
            paths.enter().append('path');
            paths.exit().remove();
            paths
                .style('stroke', function(d,i) { return d.color || color(d, i) })
                .attr('d', d3.svg.line()
                    .x(function(d,i) { return x(getX(d,i)) })
                    .y(function(d,i) { return y(getY(d,i)) })
            );


            // TODO: Add CURRENT data point (Need Min, Mac, Current / Most recent)
            var points = wrap.selectAll('circle.nv-point')
                .data(function(data) {
                    var yValues = data.map(function(d, i) { return getY(d,i); });
                    function pointIndex(index) {
                        if (index != -1) {
                            var result = data[index];
                            result.pointIndex = index;
                            return result;
                        } else {
                            return null;
                        }
                    }
                    var maxPoint = pointIndex(yValues.lastIndexOf(y.domain()[1])),
                        minPoint = pointIndex(yValues.indexOf(y.domain()[0])),
                        currentPoint = pointIndex(yValues.length - 1);
                    return [minPoint, maxPoint, currentPoint].filter(function (d) {return d != null;});
                });
            points.enter().append('circle');
            points.exit().remove();
            points
                .attr('cx', function(d,i) { return x(getX(d,d.pointIndex)) })
                .attr('cy', function(d,i) { return y(getY(d,d.pointIndex)) })
                .attr('r', 2)
                .attr('class', function(d,i) {
                    return getX(d, d.pointIndex) == x.domain()[1] ? 'nv-point nv-currentValue' :
                            getY(d, d.pointIndex) == y.domain()[0] ? 'nv-point nv-minValue' : 'nv-point nv-maxValue'
                });
        });

        return chart;
    }


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart.margin = function(_) {
        if (!arguments.length) return margin;
        margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
        margin.right  = typeof _.right  != 'undefined' ? _.right  : margin.right;
        margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
        margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        return chart;
    };

    chart.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return chart;
    };

    chart.height = function(_) {
        if (!arguments.length) return height;
        height = _;
        return chart;
    };

    chart.x = function(_) {
        if (!arguments.length) return getX;
        getX = d3.functor(_);
        return chart;
    };

    chart.y = function(_) {
        if (!arguments.length) return getY;
        getY = d3.functor(_);
        return chart;
    };

    chart.xScale = function(_) {
        if (!arguments.length) return x;
        x = _;
        return chart;
    };

    chart.yScale = function(_) {
        if (!arguments.length) return y;
        y = _;
        return chart;
    };

    chart.xDomain = function(_) {
        if (!arguments.length) return xDomain;
        xDomain = _;
        return chart;
    };

    chart.yDomain = function(_) {
        if (!arguments.length) return yDomain;
        yDomain = _;
        return chart;
    };

    chart.xRange = function(_) {
        if (!arguments.length) return xRange;
        xRange = _;
        return chart;
    };

    chart.yRange = function(_) {
        if (!arguments.length) return yRange;
        yRange = _;
        return chart;
    };

    chart.animate = function(_) {
        if (!arguments.length) return animate;
        animate = _;
        return chart;
    };

    chart.color = function(_) {
        if (!arguments.length) return color;
        color = nv.utils.getColor(_);
        return chart;
    };

    //============================================================


    return chart;
}
nv.models.doublePie = function () {

  var pie = nv.models.pie()
    , legend = nv.models.legend()
    , pieInner = pie
    , arc = d3.svg.arc()
    , arcInner = arc;

  var margin = {top: 0, right: 0, bottom: 0, left: 0}
    , width = null
    , height = null
    , single = false
    , total = {}
    , title = ''
    , tooltips = true
    , tooltip = function (key, y, e, graph) {
      return '<h3>' + key + '</h3>' +
        '<p>' + y + '</p>'
    }
    , state = {}
    , defaultState = null
    , noData = "No Data Available."
    , dispatch = d3.dispatch('tooltipShow', 'tooltipHide', 'stateChange', 'changeState');


  function chart(selection) {
    selection.each(function (data) {
      var container = d3.select(this);

      chart.container = this;

      total = {inner: 0, outer: 0}

      data.map(function (d) {
        total.inner += d.values[1];
        total.outer += d.values[0];
      });

      var availableWidth = (width || parseInt(container.style('width')) || 960) - margin.left
        , availableHeight = (height || parseInt(container.style('height')) || 400) - margin.bottom
        , pieInnerRatio = 0.6
        , pieInnerWidth = availableWidth * pieInnerRatio
        , pieInnerHeight = availableHeight * pieInnerRatio
        , halfHeight = availableHeight / 2
        , halfWidth = availableWidth / 2
        , PI = (Math.PI / 180)
        , arcRadius = halfHeight - (halfHeight / 7);

      var wrap = container.selectAll('g.nv-wrap.nv-pieChart').data([data])
        , gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-pieChart').append('g')
        , g = wrap.select('g')
        , labels = gEnter.append('g').attr('class', 'nv-arcLabels')
        , arcGroup = wrap.selectAll('.nv-arcLabels').attr("transform", "translate(" + halfWidth + "," + halfHeight + ")");

      gEnter.append('g').attr('class', 'nv-legendWrap');

      if (title) {

        var chartTitle = gEnter.append('text').attr('class', 'nv-arcChartTitle');

        chartTitle.append('tspan').attr('class', 'nv-arcChartTitleTop');
        chartTitle.append('tspan').attr('class', 'nv-arcChartTitleBotom');

        wrap.select('.nv-arcChartTitle')
          .attr("y", availableHeight / 2 + 2)

        var splited = title.split(" ");

        wrap.select('.nv-arcChartTitleTop')
          .attr('dy', -5)
          .attr('x', availableWidth / 2)
          .text(splited[0])

        wrap.select('.nv-arcChartTitleBotom')
          .attr('dy', 15)
          .attr('x', availableWidth / 2)
          .text(splited[1])
      }

      if (total.outer !== 0 && !single) {
        renderOuter();
      }

      if (total.inner !== 0) {
        renderInner();
      }

      var slices = wrap.selectAll('.nv-slice')

      slices.on('mouseover', function (d, i) {

        var tooltipLabel = pie.x()(d.data),
          y = d.value,
          content = tooltip(tooltipLabel, y, chart, d.data.values);

        var pos = [0, 0];

        nv.tooltip.show(pos, content, 's', null, chart.container.parentNode);

        pie.dispatch.elementMouseover({
          point: d.data,
          pointIndex: single ? i : i % (slices[0].length / 2),
          pos: pos
        });

      })

      legend.dispatch.on('stateChange', function (newState) {
        state = newState;
        dispatch.stateChange(state);
      });

      var hoverTimeout;

      pie.dispatch.on('elementMouseout.tooltip', function (e) {
        dispatch.tooltipHide(e);
      });

      pie.dispatch.on('elementMouseover', function (e) {

        clearTimeout(hoverTimeout);

        wrap
          .selectAll('.nv-slice').classed('gray', true);

        wrap
          .selectAll(
          '.nv-pieWrap .nv-slice:nth-of-type('+(e.pointIndex+1)+'), ' +
          '.nv-pieWrapInner .nv-slice:nth-of-type('+(e.pointIndex+1)+')'
        )
          .classed('hovered', true)
          .classed('gray', false)

      });

      pie.dispatch.on('elementMouseout', function (e) {

        clearTimeout(hoverTimeout);

        var slices = wrap.selectAll('.nv-slice');

        slices
          .classed('hovered', false);

        hoverTimeout = setTimeout(function () {

          slices
            .classed('gray', false)
        }, 400)

      });

      dispatch.on('changeState', function (e) {

        if (typeof e.disabled !== 'undefined') {
          data.forEach(function (series, i) {
            series.disabled = e.disabled[i];
          });

          state.disabled = e.disabled;
        }

      });

      dispatch.on('tooltipHide', function () {
        if (tooltips) nv.tooltip.cleanup();
      });

      function renderOuter() {

        gEnter.append('g').attr('class', 'nv-pieWrap');

        var pieWrap = g.select('.nv-pieWrap').datum([data]);

        labels.append('path').attr('class', 'nv-arcPathOuter');
        labels.append('line').attr('class', 'nv-arcLineOuter');

        labels.append('text').attr('class', 'nv-arcTextOuter')
          .text(function (d) {
            return 'Revenue';
          });

        arc
          .innerRadius(arcRadius)
          .outerRadius(arcRadius + 1)
          .startAngle(305 * PI)
          .endAngle(335 * PI)

        arcGroup.select(".nv-arcPathOuter")
          .attr("d", arc)
          .style("fill", '#8291a1')

        arcGroup.select('.nv-arcTextOuter')
          .attr("x", -halfWidth)
          .attr("y", -availableHeight / 2.5);

        arcGroup.select(".nv-arcLineOuter")
          .attr("transform", function (d) {
            return "translate(" + arc.centroid(d) + ")";
          })
          .attr("x2", -pieInnerWidth / 10)
          .attr("y2", -pieInnerWidth / 10)

        pie
          .width(availableWidth)
          .height(availableHeight)
          .donutRatio(0.6)
          .y(function (d) {
            return d.values[0];
          });


        d3.transition(pieWrap).call(pie);
      }

      function renderInner(){

        gEnter.append('g').attr('class', 'nv-pieWrapInner');

        var pieWrapInner = g.select('.nv-pieWrapInner').datum([data]);

        labels.append('path').attr('class', 'nv-arcPathInner');
        labels.append('line').attr('class', 'nv-arcLineInner');

        labels.append('text').attr('class', 'nv-arcTextInner')
          .text(function (d) {
            return 'Impressions';
          });

        pieInner
          .donutRatio(0.46)
          .y(function (d) {
            return d.values[1] ? d.values[1] : d.values[0];
          })
          .valueFormat(function (d) {
            return parseInt(d);
          })
          .width(pieInnerWidth)
          .height(pieInnerHeight);


        pieWrapInner
          .attr('transform', '' +
          'translate('
          + availableWidth * (1 - pieInnerRatio) / 2
          + ','
          + availableHeight * (1 - pieInnerRatio) / 2
          + ')');

        arcInner
          .innerRadius(arcRadius * pieInnerRatio)
          .outerRadius(arcRadius * pieInnerRatio + 1)
          .startAngle(20 * PI)
          .endAngle(60 * PI)

        arcGroup
          .select(".nv-arcPathInner")
          .attr("d", arc)

        arcGroup
          .select('.nv-arcTextInner')
          .attr("x", halfWidth)
          .attr("y", -availableHeight / 2.5);

        arcGroup
          .select(".nv-arcLineInner")
          .attr("transform", function (d) {
            return "translate(" + arcInner.centroid(d) + ")";
          })
          .attr("x2", pieInnerWidth / 5)
          .attr("y2", -pieInnerWidth / 5)

        d3.transition(pieWrapInner).call(pieInner);
      }

      legend.dispatch.on('stateChange', function (newState) {
        state = newState;
        dispatch.stateChange(state);
      });

    });

    return chart;
  }


  //============================================================
  // Expose Public Variables
  //------------------------------------------------------------

  // expose chart's sub-components
  chart.legend = legend;
  chart.dispatch = dispatch;
  chart.pie = pie;

  d3.rebind(chart, pie, 'valueFormat', 'values', 'x', 'y', 'description', 'id', 'showLabels', 'donutLabelsOutside', 'pieLabelsOutside', 'labelType', 'donut', 'donutRatio', 'labelThreshold');
  chart.options = nv.utils.optionsFunc.bind(chart);

  chart.margin = function (_) {
    if (!arguments.length) return margin;
    margin.top = typeof _.top != 'undefined' ? _.top : margin.top;
    margin.right = typeof _.right != 'undefined' ? _.right : margin.right;
    margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
    margin.left = typeof _.left != 'undefined' ? _.left : margin.left;
    return chart;
  };

  chart.width = function (_) {
    if (!arguments.length) return width;
    width = _;
    return chart;
  };

  chart.total = function (_) {
    if (!arguments.length) return total;
    total = _;
    return chart;
  };

  chart.single = function (_) {
    if (!arguments.length) return single;
    single = _;
    return chart;
  };

  chart.title = function (_) {
    if (!arguments.length) return title;
    title = _;
    return chart;
  };

  chart.height = function (_) {
    if (!arguments.length) return height;
    height = _;
    return chart;
  };

  chart.color = function (_) {
    if (!arguments.length) return color;
    color = nv.utils.getColor(_);
    legend.color(color);
    pie.color(color);
    return chart;
  };

  chart.tooltips = function (_) {
    if (!arguments.length) return tooltips;
    tooltips = _;
    return chart;
  };

  chart.tooltipContent = function (_) {
    if (!arguments.length) return tooltip;
    tooltip = _;
    return chart;
  };

  chart.state = function (_) {
    if (!arguments.length) return state;
    state = _;
    return chart;
  };

  chart.defaultState = function (_) {
    if (!arguments.length) return defaultState;
    defaultState = _;
    return chart;
  };

  chart.noData = function (_) {
    if (!arguments.length) return noData;
    noData = _;
    return chart;
  };

  //============================================================


  return chart;
}
nv.models.lineChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var lines = nv.models.line()
        , xAxis = nv.models.axis()
        , yAxis = nv.models.axis()
        , legend = nv.models.legend()
        , interactiveLayer = nv.interactiveGuideline()
        ;

    var margin = {top: 30, right: 20, bottom: 50, left: 60}
        , color = nv.utils.defaultColor()
        , width = null
        , height = null
        , showLegend = true
        , showXAxis = true
        , showYAxis = true
        , rightAlignYAxis = false
        , useInteractiveGuideline = false
        , tooltips = true
        , tooltipWidth = 210
        , tooltip = function(key, x, y, e, graph) {
            return '<h3>' + key + '</h3>' +
                '<p>' +  y + ' at ' + x + '</p>'
        }
        , x
        , y
        , state = nv.utils.state()
        , defaultState = null
        , noData = 'No Data Available.'
        , dispatch = d3.dispatch('tooltipShow', 'tooltipHide', 'stateChange', 'changeState', 'renderEnd')
        , duration = 250
        ;

    xAxis
        .orient('bottom')
        .tickPadding(7)
    ;
    yAxis
        .orient((rightAlignYAxis) ? 'right' : 'left')
    ;

    //============================================================


    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var showTooltip = function(e, offsetElement) {
        var left = e.pos[0] + ( offsetElement.offsetLeft || 0 ),
            top = e.pos[1] + ( offsetElement.offsetTop || 0),
            x = xAxis.tickFormat()(lines.x()(e.point, e.pointIndex)),
            y = yAxis.tickFormat()(lines.y()(e.point, e.pointIndex)),
            content = tooltip(e.series.key, x, y, e, chart);

        var gravity = (offsetElement.clientWidth - left) < tooltipWidth ? 'e' : 'w'

        nv.tooltip.show([left, top], content, gravity, null, offsetElement, 'nvtooltip-' + gravity);
    };

    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    var stateGetter = function(data) {
        return function(){
            return {
                active: data.map(function(d) { return !d.disabled })
            };
        }
    };

    var stateSetter = function(data) {
        return function(state) {
            if (state.active !== undefined)
                data.forEach(function(series,i) {
                    series.disabled = !state.active[i];
                });
        }
    };

    //============================================================


    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(lines);
        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);

        selection.each(function(data) {
            var container = d3.select(this),
                that = this;
            nv.utils.initSVG(container);
            var availableWidth = (width  || parseInt(container.style('width')) || 960)
                    - margin.left - margin.right,
                availableHeight = (height || parseInt(container.style('height')) || 400)
                    - margin.top - margin.bottom;


            chart.update = function() {
                if (duration === 0)
                    container.call(chart);
                else
                    container.transition().duration(duration).call(chart)
            };
            chart.container = this;

            state
                .setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            // DEPRECATED set state.disableddisabled
            state.disabled = data.map(function(d) { return !!d.disabled });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            //------------------------------------------------------------
            // Display noData message if there's nothing to show.

            if (!data || !data.length || !data.filter(function(d) { return d.values.length }).length) {
                var noDataText = container.selectAll('.nv-noData').data([noData]);

                noDataText.enter().append('text')
                    .attr('class', 'nvd3 nv-noData')
                    .attr('dy', '-.7em')
                    .style('text-anchor', 'middle');

                noDataText
                    .attr('x', margin.left + availableWidth / 2)
                    .attr('y', margin.top + availableHeight / 2)
                    .text(function(d) { return d });

                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup Scales

            x = lines.xScale();
            y = lines.yScale();

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup containers and skeleton of chart

            var wrap = container.selectAll('g.nv-wrap.nv-lineChart').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-lineChart').append('g');
            var g = wrap.select('g');

            gEnter.append("rect").style("opacity",0);
            gEnter.append('g').attr('class', 'nv-x nv-axis');
            gEnter.append('g').attr('class', 'nv-y nv-axis');
            gEnter.append('g').attr('class', 'nv-linesWrap');
            gEnter.append('g').attr('class', 'nv-legendWrap');
            gEnter.append('g').attr('class', 'nv-interactive');

            g.select("rect")
                .attr("width",availableWidth)
                .attr("height",(availableHeight > 0) ? availableHeight : 0);
            //------------------------------------------------------------
            // Legend

            if (showLegend) {
                legend.width(availableWidth);

                g.select('.nv-legendWrap')
                    .datum(data)
                    .call(legend)

                margin.bottom = legend.height() + 30;
                availableHeight = (height || parseInt(container.style('height')) || 400)
                    - margin.top - margin.bottom;

                wrap.select('.nv-legendWrap')
                    .attr('transform', 'translate(0,' + (parseInt(container.style('height')) - legend.height() - margin.top ) +')')
            }

            //------------------------------------------------------------

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            if (rightAlignYAxis) {
                g.select(".nv-y.nv-axis")
                    .attr("transform", "translate(" + availableWidth + ",0)");
            }

            //------------------------------------------------------------
            // Main Chart Component(s)


            //------------------------------------------------------------
            //Set up interactive layer
            if (useInteractiveGuideline) {
                interactiveLayer
                    .width(availableWidth)
                    .height(availableHeight)
                    .margin({left:margin.left, top:margin.top})
                    .svgContainer(container)
                    .xScale(x);
                wrap.select(".nv-interactive").call(interactiveLayer);
            }


            lines
                .width(availableWidth)
                .height(availableHeight)
                .color(data.map(function(d,i) {
                    return d.color || color(d, i);
                }).filter(function(d,i) { return !data[i].disabled }));


            var linesWrap = g.select('.nv-linesWrap')
                .datum(data.filter(function(d) { return !d.disabled }))

            linesWrap.call(lines);

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup Axes

            if (showXAxis) {
                xAxis
                    .scale(x)
                    .ticks( nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize(-availableHeight, 0);

                g.select('.nv-x.nv-axis')
                    .attr('transform', 'translate(0,' + y.range()[0] + ')');
                g.select('.nv-x.nv-axis')
                    .call(xAxis);
            }

            if (showYAxis) {
                yAxis
                    .scale(y)
                    .ticks( nv.utils.calcTicksY(availableHeight/36, data) )
                    .tickSize( -availableWidth, 0);

                g.select('.nv-y.nv-axis')
                    .call(yAxis);
            }
            //------------------------------------------------------------


            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            legend.dispatch.on('stateChange', function(newState) {
                for (var key in newState)
                    state[key] = newState[key];
                dispatch.stateChange(state);
                chart.update();
            });

            interactiveLayer.dispatch.on('elementMousemove', function(e) {
                lines.clearHighlights();
                var singlePoint, pointIndex, pointXLocation, allData = [];
                data
                    .filter(function(series, i) {
                        series.seriesIndex = i;
                        return !series.disabled;
                    })
                    .forEach(function(series,i) {
                        pointIndex = nv.interactiveBisect(series.values, e.pointXValue, chart.x());
                        lines.highlightPoint(i, pointIndex, true);
                        var point = series.values[pointIndex];
                        if (typeof point === 'undefined') return;
                        if (typeof singlePoint === 'undefined') singlePoint = point;
                        if (typeof pointXLocation === 'undefined') pointXLocation = chart.xScale()(chart.x()(point,pointIndex));
                        allData.push({
                            key: series.key,
                            value: chart.y()(point, pointIndex),
                            color: color(series,series.seriesIndex)
                        });
                    });
                //Highlight the tooltip entry based on which point the mouse is closest to.
                if (allData.length > 2) {
                    var yValue = chart.yScale().invert(e.mouseY);
                    var domainExtent = Math.abs(chart.yScale().domain()[0] - chart.yScale().domain()[1]);
                    var threshold = 0.03 * domainExtent;
                    var indexToHighlight = nv.nearestValueIndex(allData.map(function(d){return d.value}),yValue,threshold);
                    if (indexToHighlight !== null)
                        allData[indexToHighlight].highlight = true;
                }

                var xValue = xAxis.tickFormat()(chart.x()(singlePoint,pointIndex));
                interactiveLayer.tooltip
                    .position({left: pointXLocation + margin.left, top: e.mouseY + margin.top})
                    .chartContainer(that.parentNode)
                    .enabled(tooltips)
                    .valueFormatter(function(d,i) {
                        return yAxis.tickFormat()(d);
                    })
                    .data(
                    {
                        value: xValue,
                        series: allData
                    }
                )();

                interactiveLayer.renderGuideLine(pointXLocation);

            });

            interactiveLayer.dispatch.on('elementClick', function(e) {
                var pointXLocation, allData = [];

                data.filter(function(series, i) {
                    series.seriesIndex = i;
                    return !series.disabled;
                }).forEach(function(series) {
                    var pointIndex = nv.interactiveBisect(series.values, e.pointXValue, chart.x());
                    var point = series.values[pointIndex];
                    if (typeof point === 'undefined') return;
                    if (typeof pointXLocation === 'undefined') pointXLocation = chart.xScale()(chart.x()(point,pointIndex));
                    var yPos = chart.yScale()(chart.y()(point,pointIndex));
                    allData.push({
                        point: point,
                        pointIndex: pointIndex,
                        pos: [pointXLocation, yPos],
                        seriesIndex: series.seriesIndex,
                        series: series
                    });
                });

                lines.dispatch.elementClick(allData);
            });

            interactiveLayer.dispatch.on("elementMouseout",function(e) {
                dispatch.tooltipHide();
                lines.clearHighlights();
            });

            dispatch.on('tooltipShow', function(e) {
                if (tooltips) showTooltip(e, that.parentNode);
            });


            dispatch.on('changeState', function(e) {

                if (typeof e.disabled !== 'undefined' && data.length === e.disabled.length) {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });

                    state.disabled = e.disabled;
                }

                chart.update();
            });

            //============================================================

        });

        renderWatch.renderEnd('lineChart immediate');
        return chart;
    }


    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    lines.dispatch.on('elementMouseover.tooltip', function(e) {
        e.pos = [e.pos[0] +  margin.left, e.pos[1] + margin.top];
        dispatch.tooltipShow(e);
    });

    lines.dispatch.on('elementMouseout.tooltip', function(e) {
        dispatch.tooltipHide(e);
    });

    dispatch.on('tooltipHide', function() {
        if (tooltips) nv.tooltip.cleanup();
    });

    //============================================================


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.lines = lines;
    chart.legend = legend;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    chart.interactiveLayer = interactiveLayer;
    // DO NOT DELETE. This is currently overridden below
    // until deprecated portions are removed.
    chart.state = state;

    d3.rebind(chart, lines, 'defined', 'isArea', 'x', 'y', 'size', 'xScale', 'yScale', 'xDomain', 'yDomain', 'xRange', 'yRange'
        , 'forceX', 'forceY', 'interactive', 'clipEdge', 'clipVoronoi', 'useVoronoi','id', 'interpolate', 'tooltipWidth');

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart.margin = function(_) {
        if (!arguments.length) return margin;
        margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
        margin.right  = typeof _.right  != 'undefined' ? _.right  : margin.right;
        margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
        margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        return chart;
    };

    chart.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return chart;
    };

    chart.height = function(_) {
        if (!arguments.length) return height;
        height = _;
        return chart;
    };

    chart.color = function(_) {
        if (!arguments.length) return color;
        color = nv.utils.getColor(_);
        legend.color(color);
        return chart;
    };

    chart.showLegend = function(_) {
        if (!arguments.length) return showLegend;
        showLegend = _;
        return chart;
    };

    chart.showXAxis = function(_) {
        if (!arguments.length) return showXAxis;
        showXAxis = _;
        return chart;
    };

    chart.showYAxis = function(_) {
        if (!arguments.length) return showYAxis;
        showYAxis = _;
        return chart;
    };

    chart.rightAlignYAxis = function(_) {
        if(!arguments.length) return rightAlignYAxis;
        rightAlignYAxis = _;
        yAxis.orient( (_) ? 'right' : 'left');
        return chart;
    };

    chart.useInteractiveGuideline = function(_) {
        if(!arguments.length) return useInteractiveGuideline;
        useInteractiveGuideline = _;
        if (_ === true) {
            chart.interactive(false);
            chart.useVoronoi(false);
        }
        return chart;
    };

    chart.tooltips = function(_) {
        if (!arguments.length) return tooltips;
        tooltips = _;
        return chart;
    };

    chart.tooltipContent = function(_) {
        if (!arguments.length) return tooltip;
        tooltip = _;
        return chart;
    };

    // DEPRECATED
    chart.state = function(_) {
        nv.deprecated('lineChart.state');
        if (!arguments.length) return state;
        state = _;
        return chart;
    };
    for (var key in state) {
        chart.state[key] = state[key];
    }
    // END DEPRECATED

    chart.defaultState = function(_) {
        if (!arguments.length) return defaultState;
        defaultState = _;
        return chart;
    };

    chart.noData = function(_) {
        if (!arguments.length) return noData;
        noData = _;
        return chart;
    };

    chart.tooltipWidth = function(_) {
        if (!arguments.length) return tooltipWidth;
        tooltipWidth = _;
        return chart;
    };


    chart.transitionDuration = function(_) {
        nv.deprecated('lineChart.transitionDuration');
        return chart.duration(_);
    };

    chart.duration = function(_) {
        if (!arguments.length) return duration;
        duration = _;
        renderWatch.reset(duration);
        lines.duration(duration);
        xAxis.duration(duration);
        yAxis.duration(duration);
        return chart;
    };

    //============================================================

    return chart;
};

nv.models.multiBar = function() {
    "use strict";
    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 960
        , height = 500
        , x = d3.scale.ordinal()
        , y = d3.scale.linear()
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , forceY = [0] // 0 is forced by default.. this makes sense for the majority of bar graphs... user can always do chart.forceY([]) to remove
        , clipEdge = true
        , stacked = false
        , stackOffset = 'zero' // options include 'silhouette', 'wiggle', 'expand', 'zero', or a custom function
        , color = nv.utils.defaultColor()
        , hideable = false
        , barColor = null // adding the ability to set the color for each rather than the whole group
        , disabled // used in conjunction with barColor to communicate from multiBarHorizontalChart what series are disabled
        , duration = 1000
        , xDomain
        , yDomain
        , xRange
        , yRange
        , groupSpacing = 0.1
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'elementDblClick', 'elementMouseover', 'elementMouseout', 'renderEnd')
        ;

    //============================================================


    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var x0, y0 //used to store previous scales
        , renderWatch = nv.utils.renderWatch(dispatch, duration)
        ;


    //============================================================



    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right,
                availableHeight = height - margin.top - margin.bottom,
                container = d3.select(this);
            nv.utils.initSVG(container);

            // This function defines the requirements for render complete
            var endFn = function(d, i) {
                if (d.series === data.length - 1 && i === data[0].values.length - 1)
                    return true;
                return false;
            }


            if(hideable && data.length) hideable = [{
                values: data[0].values.map(function(d) {
                        return {
                            x: d.x,
                            y: 0,
                            series: d.series,
                            size: 0.01
                        };}
                )}];

            if (stacked)
                data = d3.layout.stack()
                    .offset(stackOffset)
                    .values(function(d){ return d.values })
                    .y(getY)
                (!data.length && hideable ? hideable : data);


            //add series index to each data point for reference
            data.forEach(function(series, i) {
                series.values.forEach(function(point) {
                    point.series = i;
                });
            });


            //------------------------------------------------------------
            // HACK for negative value stacking
            if (stacked)
                data[0].values.map(function(d,i) {
                    var posBase = 0, negBase = 0;
                    data.map(function(d) {
                        var f = d.values[i]
                        f.size = Math.abs(f.y);
                        if (f.y<0)  {
                            f.y1 = negBase;
                            negBase = negBase - f.size;
                        } else
                        {
                            f.y1 = f.size + posBase;
                            posBase = posBase + f.size;
                        }
                    });
                });

            //------------------------------------------------------------
            // Setup Scales

            // remap and flatten the data for use in calculating the scales' domains
            var seriesData = (xDomain && yDomain) ? [] : // if we know xDomain and yDomain, no need to calculate
                data.map(function(d) {
                    return d.values.map(function(d,i) {
                        return { x: getX(d,i), y: getY(d,i), y0: d.y0, y1: d.y1 }
                    })
                });

            x   .domain(xDomain || d3.merge(seriesData).map(function(d) { return d.x }))
                .rangeBands(xRange || [0, availableWidth], groupSpacing);

            //y   .domain(yDomain || d3.extent(d3.merge(seriesData).map(function(d) { return d.y + (stacked ? d.y1 : 0) }).concat(forceY)))
            y   .domain(yDomain || d3.extent(d3.merge(seriesData).map(function(d) { return stacked ? (d.y > 0 ? d.y1 : d.y1 + d.y ) : d.y }).concat(forceY)))
                .range(yRange || [availableHeight, 0]);

            // If scale's domain don't have a range, slightly adjust to make one... so a chart can show a single data point
            if (x.domain()[0] === x.domain()[1])
                x.domain()[0] ?
                    x.domain([x.domain()[0] - x.domain()[0] * 0.01, x.domain()[1] + x.domain()[1] * 0.01])
                    : x.domain([-1,1]);

            if (y.domain()[0] === y.domain()[1])
                y.domain()[0] ?
                    y.domain([y.domain()[0] + y.domain()[0] * 0.01, y.domain()[1] - y.domain()[1] * 0.01])
                    : y.domain([-1,1]);


            x0 = x0 || x;
            y0 = y0 || y;

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup containers and skeleton of chart

            var wrap = container.selectAll('g.nv-wrap.nv-multibar').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-multibar');
            var defsEnter = wrapEnter.append('defs');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g')

            gEnter.append('g').attr('class', 'nv-groups');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            //------------------------------------------------------------



            defsEnter.append('clipPath')
                .attr('id', 'nv-edge-clip-' + id)
                .append('rect');
            wrap.select('#nv-edge-clip-' + id + ' rect')
                .attr('width', availableWidth)
                .attr('height', availableHeight);

            g   .attr('clip-path', clipEdge ? 'url(#nv-edge-clip-' + id + ')' : '');

            var groups = wrap.select('.nv-groups').selectAll('.nv-group')
                .data(function(d) { return d }, function(d,i) { return i });
            groups.enter().append('g')
                .style('stroke-opacity', 1e-6)
                .style('fill-opacity', 1e-6);

            var exitTransition = renderWatch
                .transition(groups.exit().selectAll('rect.nv-bar'), 'multibarExit', Math.min(250, duration))
                .attr('y', function(d) { return stacked ? y0(d.y0) : y0(0) })
                .attr('height', 0)
                .remove();
            if (exitTransition.delay)
                exitTransition.delay(function(d,i) {
                    return i * duration / data[0].values.length;
                });
            groups
                .attr('class', function(d,i) { return 'nv-group nv-series-' + i })
                .classed('hover', function(d) { return d.hover })
                .style('fill', function(d,i){ return color(d, i) })
                .style('stroke', function(d,i){ return color(d, i) });
            groups
                .style('stroke-opacity', 1)
                .style('fill-opacity', 0.75);


            var bars = groups.selectAll('rect.nv-bar')
                .data(function(d) { return (hideable && !data.length) ? hideable.values : d.values });

            bars.exit().remove();


            var barsEnter = bars.enter().append('rect')
                    .attr('class', function(d,i) { return getY(d,i) < 0 ? 'nv-bar negative' : 'nv-bar positive'})
                    .attr('x', function(d,i,j) {
                        return stacked ? 0 : (j * x.rangeBand() / data.length )
                    })
                    .attr('y', function(d) { return y0(stacked ? d.y0 : 0) })
                    .attr('height', 0)
                    .attr('width', x.rangeBand() / (stacked ? 1 : data.length) )
                    .attr('transform', function(d,i) { return 'translate(' + x(getX(d,i)) + ',0)'; })
                ;
            bars
                .style('fill', function(d,i,j){ return color(d, j, i);  })
                .style('stroke', function(d,i,j){ return color(d, j, i); })
                .on('mouseover', function(d,i) { //TODO: figure out why j works above, but not here
                    d3.select(this).classed('hover', true);
                    dispatch.elementMouseover({
                        value: getY(d,i),
                        point: d,
                        series: data[d.series],
                        pos: [x(getX(d,i)) + (x.rangeBand() * (stacked ? data.length / 2 : d.series + .5) / data.length), y(getY(d,i) + (stacked ? d.y0 : 0))],  // TODO: Figure out why the value appears to be shifted
                        pointIndex: i,
                        seriesIndex: d.series,
                        e: d3.event
                    });
                })
                .on('mouseout', function(d,i) {
                    d3.select(this).classed('hover', false);
                    dispatch.elementMouseout({
                        value: getY(d,i),
                        point: d,
                        series: data[d.series],
                        pointIndex: i,
                        seriesIndex: d.series,
                        e: d3.event
                    });
                })
                .on('click', function(d,i) {
                    dispatch.elementClick({
                        value: getY(d,i),
                        point: d,
                        series: data[d.series],
                        pos: [x(getX(d,i)) + (x.rangeBand() * (stacked ? data.length / 2 : d.series + .5) / data.length), y(getY(d,i) + (stacked ? d.y0 : 0))],  // TODO: Figure out why the value appears to be shifted
                        pointIndex: i,
                        seriesIndex: d.series,
                        e: d3.event
                    });
                    d3.event.stopPropagation();
                })
                .on('dblclick', function(d,i) {
                    dispatch.elementDblClick({
                        value: getY(d,i),
                        point: d,
                        series: data[d.series],
                        pos: [x(getX(d,i)) + (x.rangeBand() * (stacked ? data.length / 2 : d.series + .5) / data.length), y(getY(d,i) + (stacked ? d.y0 : 0))],  // TODO: Figure out why the value appears to be shifted
                        pointIndex: i,
                        seriesIndex: d.series,
                        e: d3.event
                    });
                    d3.event.stopPropagation();
                });
            bars
                .attr('class', function(d,i) { return getY(d,i) < 0 ? 'nv-bar negative' : 'nv-bar positive'})
                .attr('transform', function(d,i) { return 'translate(' + x(getX(d,i)) + ',0)'; })

            if (barColor) {
                if (!disabled) disabled = data.map(function() { return true });
                bars
                    .style('fill', function(d,i,j) { return d3.rgb(barColor(d,i)).darker(  disabled.map(function(d,i) { return i }).filter(function(d,i){ return !disabled[i]  })[j]   ).toString(); })
                    .style('stroke', function(d,i,j) { return d3.rgb(barColor(d,i)).darker(  disabled.map(function(d,i) { return i }).filter(function(d,i){ return !disabled[i]  })[j]   ).toString(); });
            }

            var barSelection =
                bars.watchTransition(renderWatch, 'multibar', Math.min(250, duration))
                    .delay(function(d,i) {
                        return i * duration / data[0].values.length;
                    });
            if (stacked)
                barSelection
                    .attr('y', function(d,i) {
                        return y((stacked ? d.y1 : 0));
                    })
                    .attr('height', function(d,i) {
                        return Math.max(Math.abs(y(d.y + (stacked ? d.y0 : 0)) - y((stacked ? d.y0 : 0))),1);
                    })
                    .attr('x', function(d,i) {
                        return stacked ? 0 : (d.series * x.rangeBand() / data.length )
                    })
                    .attr('width', x.rangeBand() / (stacked ? 1 : data.length) );
            else
                barSelection
                    .attr('x', function(d,i) {
                        return d.series * x.rangeBand() / data.length
                    })
                    .attr('width', x.rangeBand() / data.length)
                    .attr('y', function(d,i) {
                        return getY(d,i) < 0 ?
                            y(0) :
                                y(0) - y(getY(d,i)) < 1 ?
                            y(0) - 1 :
                            y(getY(d,i)) || 0;
                    })
                    .attr('height', function(d,i) {
                        return Math.max(Math.abs(y(getY(d,i)) - y(0)),1) || 0;
                    });

            //store old scales for use in transitions on update
            x0 = x.copy();
            y0 = y.copy();

        });

        renderWatch.renderEnd('multibar immediate');

        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // As a getter, returns a new instance of d3 dispatch and sets appropriate vars.
    // As a setter, sets dispatch.
    // Useful when same chart instance is used to render several data models.
    // Since dispatch is instance-specific, it cannot be contained inside chart model.

    chart.dispatch = dispatch;

    chart.x = function(_) {
        if (!arguments.length) return getX;
        getX = _;
        return chart;
    };

    chart.y = function(_) {
        if (!arguments.length) return getY;
        getY = _;
        return chart;
    };

    chart.margin = function(_) {
        if (!arguments.length) return margin;
        margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
        margin.right  = typeof _.right  != 'undefined' ? _.right  : margin.right;
        margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
        margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        return chart;
    };

    chart.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return chart;
    };

    chart.height = function(_) {
        if (!arguments.length) return height;
        height = _;
        return chart;
    };

    chart.xScale = function(_) {
        if (!arguments.length) return x;
        x = _;
        return chart;
    };

    chart.yScale = function(_) {
        if (!arguments.length) return y;
        y = _;
        return chart;
    };

    chart.xDomain = function(_) {
        if (!arguments.length) return xDomain;
        xDomain = _;
        return chart;
    };

    chart.yDomain = function(_) {
        if (!arguments.length) return yDomain;
        yDomain = _;
        return chart;
    };

    chart.xRange = function(_) {
        if (!arguments.length) return xRange;
        xRange = _;
        return chart;
    };

    chart.yRange = function(_) {
        if (!arguments.length) return yRange;
        yRange = _;
        return chart;
    };

    chart.forceY = function(_) {
        if (!arguments.length) return forceY;
        forceY = _;
        return chart;
    };

    chart.stacked = function(_) {
        if (!arguments.length) return stacked;
        stacked = _;
        return chart;
    };

    chart.stackOffset = function(_) {
        if (!arguments.length) return stackOffset;
        stackOffset = _;
        return chart;
    };

    chart.clipEdge = function(_) {
        if (!arguments.length) return clipEdge;
        clipEdge = _;
        return chart;
    };

    chart.color = function(_) {
        if (!arguments.length) return color;
        color = nv.utils.getColor(_);
        return chart;
    };

    chart.barColor = function(_) {
        if (!arguments.length) return barColor;
        barColor = nv.utils.getColor(_);
        return chart;
    };

    chart.disabled = function(_) {
        if (!arguments.length) return disabled;
        disabled = _;
        return chart;
    };

    chart.id = function(_) {
        if (!arguments.length) return id;
        id = _;
        return chart;
    };

    chart.hideable = function(_) {
        if (!arguments.length) return hideable;
        hideable = _;
        return chart;
    };

    chart.groupSpacing = function(_) {
        if (!arguments.length) return groupSpacing;
        groupSpacing = _;
        return chart;
    };

    chart.duration = function(_) {
        if (!arguments.length) return duration;
        duration = _;
        renderWatch.reset(duration);
        return chart;
    }



    //============================================================
    // Deprecated Methods
    //------------------------------------------------------------

    chart.delay = function(_) {
        nv.deprecated('multiBar.delay');
        return chart.duration(_);
    };

    chart.options = nv.utils.optionsFunc.bind(chart);

    //============================================================

    return chart;
}

nv.models.multiBarChart = function() {
    "use strict";
    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var multibar = nv.models.multiBar()
        , xAxis = nv.models.axis()
        , yAxis = nv.models.axis()
        , legend = nv.models.legend()
        , controls = nv.models.legend()
        ;

    var margin = {top: 30, right: 20, bottom: 50, left: 60}
        , width = null
        , height = null
        , color = nv.utils.defaultColor()
        , showControls = true
        , showLegend = true
        , showXAxis = true
        , showYAxis = true
        , rightAlignYAxis = false
        , reduceXTicks = true // if false a tick will show for every data point
        , staggerLabels = false
        , rotateLabels = 0
        , tooltips = true
        , tooltip = function(key, x, y, e, graph) {
            return '<h3>' + key + '</h3>' +
                '<p>' +  y + ' on ' + x + '</p>'
        }
        , x //can be accessed via chart.xScale()
        , y //can be accessed via chart.yScale()
        , state = nv.utils.state()
        , defaultState = null
        , noData = "No Data Available."
        , dispatch = d3.dispatch('tooltipShow', 'tooltipHide', 'stateChange', 'changeState', 'renderEnd')
        , controlWidth = function() { return showControls ? 180 : 0 }
        , duration = 250
        ;

    state.stacked = false // DEPRECATED Maintained for backward compatibility

    multibar
        .stacked(false)
    ;
    xAxis
        .orient('bottom')
        .tickPadding(7)
        .highlightZero(true)
        .showMaxMin(false)
        .tickFormat(function(d) { return d })
    ;
    yAxis
        .orient((rightAlignYAxis) ? 'right' : 'left')
        .tickFormat(d3.format(',.1f'))
    ;

    controls.updateState(false);
    //============================================================


    //============================================================
    // Private Variables
    //------------------------------------------------------------
    var renderWatch = nv.utils.renderWatch(dispatch);
    var stacked = false;

    var showTooltip = function(e, offsetElement) {
        var left = e.pos[0] + ( offsetElement.offsetLeft || 0 ),
            top = e.pos[1] + ( offsetElement.offsetTop || 0),
            x = xAxis.tickFormat()(multibar.x()(e.point, e.pointIndex)),
            y = yAxis.tickFormat()(multibar.y()(e.point, e.pointIndex)),
            content = tooltip(e.series.key, x, y, e, chart);

        nv.tooltip.show([left, top], content, e.value < 0 ? 'n' : 's', null, offsetElement);
    };

    var stateGetter = function(data) {
        return function(){
            return {
                active: data.map(function(d) { return !d.disabled }),
                stacked: stacked
            };
        }
    };

    var stateSetter = function(data) {
        return function(state) {
            if (state.stacked !== undefined)
                stacked = state.stacked;
            if (state.active !== undefined)
                data.forEach(function(series,i) {
                    series.disabled = !state.active[i];
                });
        }
    }

    //============================================================


    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(multibar);
        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);

        selection.each(function(data) {
            var container = d3.select(this),
                that = this;
            nv.utils.initSVG(container);
            var availableWidth = (width  || parseInt(container.style('width')) || 960)
                    - margin.left - margin.right,
                availableHeight = (height || parseInt(container.style('height')) || 400)
                    - margin.top - margin.bottom;

            chart.update = function() {
                if (duration === 0)
                    container.call(chart);
                else
                    container.transition()
                        .duration(duration)
                        .call(chart);
            };
            chart.container = this;

            state
                .setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            // DEPRECATED set state.disableddisabled
            state.disabled = data.map(function(d) { return !!d.disabled });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }
            //------------------------------------------------------------
            // Display noData message if there's nothing to show.

            if (!data || !data.length || !data.filter(function(d) { return d.values.length }).length) {
                var noDataText = container.selectAll('.nv-noData').data([noData]);

                noDataText.enter().append('text')
                    .attr('class', 'nvd3 nv-noData')
                    .attr('dy', '-.7em')
                    .style('text-anchor', 'middle');

                noDataText
                    .attr('x', margin.left + availableWidth / 2)
                    .attr('y', margin.top + availableHeight / 2)
                    .text(function(d) { return d });

                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup Scales

            x = multibar.xScale();
            y = multibar.yScale();

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup containers and skeleton of chart

            var wrap = container.selectAll('g.nv-wrap.nv-multiBarWithLegend').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-multiBarWithLegend').append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-x nv-axis');
            gEnter.append('g').attr('class', 'nv-y nv-axis');
            gEnter.append('g').attr('class', 'nv-barsWrap');
            gEnter.append('g').attr('class', 'nv-legendWrap');
            gEnter.append('g').attr('class', 'nv-controlsWrap');

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Legend

            if (showLegend) {
                legend.width(availableWidth - controlWidth());

                if (multibar.barColor())
                    data.forEach(function(series,i) {
                        series.color = d3.rgb('#ccc').darker(i * 1.5).toString();
                    })

                g.select('.nv-legendWrap')
                    .datum(data)
                    .call(legend);

                margin.bottom = legend.height() + 30;
                availableHeight = (height || parseInt(container.style('height')) || 400)
                - margin.top - margin.bottom;

                wrap.select('.nv-legendWrap')
                  .attr('transform', 'translate(0,' + (parseInt(container.style('height')) - legend.height() - margin.top ) +')')

            }



            //------------------------------------------------------------


            //------------------------------------------------------------
            // Controls

            if (showControls) {
                var controlsData = [
                    { key: 'Grouped', disabled: multibar.stacked() },
                    { key: 'Stacked', disabled: !multibar.stacked() }
                ];

                controls.width(controlWidth()).color(['#444', '#444', '#444']);
                g.select('.nv-controlsWrap')
                    .datum(controlsData)
                    .attr('transform', 'translate(0,' + (-margin.top) +')')
                    .call(controls);
            }

            //------------------------------------------------------------


            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            if (rightAlignYAxis) {
                g.select(".nv-y.nv-axis")
                    .attr("transform", "translate(" + availableWidth + ",0)");
            }

            //------------------------------------------------------------
            // Main Chart Component(s)

            multibar
                .disabled(data.map(function(series) { return series.disabled }))
                .width(availableWidth)
                .height(availableHeight)
                .color(data.map(function(d,i) {
                    return d.color || color(d, i);
                }).filter(function(d,i) { return !data[i].disabled }))


            var barsWrap = g.select('.nv-barsWrap')
                .datum(data.filter(function(d) { return !d.disabled }))

            barsWrap.call(multibar);

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup Axes

            if (showXAxis) {
                xAxis
                    .scale(x)
                    .ticks( nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize(-availableHeight, 0);

                g.select('.nv-x.nv-axis')
                    .attr('transform', 'translate(0,' + y.range()[0] + ')');
                g.select('.nv-x.nv-axis')
                    .call(xAxis);

                var xTicks = g.select('.nv-x.nv-axis > g').selectAll('g');

                xTicks
                    .selectAll('line, text')
                    .style('opacity', 1)

                if (staggerLabels) {
                    var getTranslate = function(x,y) {
                        return "translate(" + x + "," + y + ")";
                    };

                    var staggerUp = 5, staggerDown = 17;  //pixels to stagger by
                    // Issue #140
                    xTicks
                        .selectAll("text")
                        .attr('transform', function(d,i,j) {
                            return  getTranslate(0, (j % 2 == 0 ? staggerUp : staggerDown));
                        });

                    var totalInBetweenTicks = d3.selectAll(".nv-x.nv-axis .nv-wrap g g text")[0].length;
                    g.selectAll(".nv-x.nv-axis .nv-axisMaxMin text")
                        .attr("transform", function(d,i) {
                            return getTranslate(0, (i === 0 || totalInBetweenTicks % 2 !== 0) ? staggerDown : staggerUp);
                        });
                }

                if (reduceXTicks)
                    xTicks
                        .filter(function(d,i) {
                            return i % Math.ceil(data[0].values.length / (availableWidth / 100)) !== 0;
                        })
                        .selectAll('text, line')
                        .style('opacity', 0);

                if(rotateLabels)
                    xTicks
                        .selectAll('.tick text')
                        .attr('transform', 'rotate(' + rotateLabels + ' 0,0)')
                        .style('text-anchor', rotateLabels > 0 ? 'start' : 'end');

                g.select('.nv-x.nv-axis').selectAll('g.nv-axisMaxMin text')
                    .style('opacity', 1);
            }


            if (showYAxis) {
                yAxis
                    .scale(y)
                    .ticks( nv.utils.calcTicksY(availableHeight/36, data) )
                    .tickSize( -availableWidth, 0);

                g.select('.nv-y.nv-axis')
                    .call(yAxis);
            }


            //------------------------------------------------------------



            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            legend.dispatch.on('stateChange', function(newState) {
                for (var key in newState)
                    state[key] = newState[key];
                dispatch.stateChange(state);
                chart.update();
            });

            controls.dispatch.on('legendClick', function(d,i) {
                if (!d.disabled) return;
                controlsData = controlsData.map(function(s) {
                    s.disabled = true;
                    return s;
                });
                d.disabled = false;

                switch (d.key) {
                    case 'Grouped':
                        multibar.stacked(false);
                        break;
                    case 'Stacked':
                        multibar.stacked(true);
                        break;
                }

                state.stacked = multibar.stacked();
                dispatch.stateChange(state);

                chart.update();
            });

            dispatch.on('tooltipShow', function(e) {
                if (tooltips) showTooltip(e, that.parentNode)
            });

            // Update chart from a state object passed to event handler
            dispatch.on('changeState', function(e) {

                if (typeof e.disabled !== 'undefined') {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });

                    state.disabled = e.disabled;
                }

                if (typeof e.stacked !== 'undefined') {
                    multibar.stacked(e.stacked);
                    state.stacked = e.stacked;
                    stacked = e.stacked;
                }

                chart.update();
            });

            //============================================================


        });

        renderWatch.renderEnd('multibarchart immediate');

        return chart;
    }


    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    multibar.dispatch.on('elementMouseover.tooltip', function(e) {
        e.pos = [e.pos[0] +  margin.left, e.pos[1] + margin.top];
        dispatch.tooltipShow(e);
    });

    multibar.dispatch.on('elementMouseout.tooltip', function(e) {
        dispatch.tooltipHide(e);
    });
    dispatch.on('tooltipHide', function() {
        if (tooltips) nv.tooltip.cleanup();
    });


    //============================================================


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.multibar = multibar;
    chart.legend = legend;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    // DO NOT DELETE. This is currently overridden below
    // until deprecated portions are removed.
    chart.state = state;

    d3.rebind(chart, multibar, 'x', 'y', 'xDomain', 'yDomain', 'xRange', 'yRange', 'forceX', 'forceY', 'clipEdge',
        'id', 'stacked', 'stackOffset', 'delay', 'barColor','groupSpacing');

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart.margin = function(_) {
        if (!arguments.length) return margin;
        margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
        margin.right  = typeof _.right  != 'undefined' ? _.right  : margin.right;
        margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
        margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        return chart;
    };

    chart.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return chart;
    };

    chart.height = function(_) {

        if (!arguments.length) return height;
        height = _;
        return chart;
    };

    chart.color = function(_) {

        if (!arguments.length) return color;
        color = nv.utils.getColor(_);
        legend.color(color);
        return chart;
    };

    chart.showControls = function(_) {
        if (!arguments.length) return showControls;
        showControls = _;
        return chart;
    };

    chart.showLegend = function(_) {
        if (!arguments.length) return showLegend;
        showLegend = _;
        return chart;
    };

    chart.showXAxis = function(_) {
        if (!arguments.length) return showXAxis;
        showXAxis = _;
        return chart;
    };

    chart.showYAxis = function(_) {
        if (!arguments.length) return showYAxis;
        showYAxis = _;
        return chart;
    };

    chart.rightAlignYAxis = function(_) {
        if(!arguments.length) return rightAlignYAxis;
        rightAlignYAxis = _;
        yAxis.orient( (_) ? 'right' : 'left');
        return chart;
    };

    chart.reduceXTicks= function(_) {
        if (!arguments.length) return reduceXTicks;
        reduceXTicks = _;
        return chart;
    };

    chart.rotateLabels = function(_) {
        if (!arguments.length) return rotateLabels;
        rotateLabels = _;
        return chart;
    }

    chart.staggerLabels = function(_) {
        if (!arguments.length) return staggerLabels;
        staggerLabels = _;
        return chart;
    };

    chart.tooltip = function(_) {
        if (!arguments.length) return tooltip;
        tooltip = _;
        return chart;
    };

    chart.tooltips = function(_) {
        if (!arguments.length) return tooltips;
        tooltips = _;
        return chart;
    };

    chart.tooltipContent = function(_) {
        if (!arguments.length) return tooltip;
        tooltip = _;
        return chart;
    };

    // DEPRECATED
    chart.state = function(_) {
        nv.deprecated('multiBarChart.state');
        if (!arguments.length) return state;
        state = _;
        return chart;
    };
    for (var key in state) {
        chart.state[key] = state[key];
    }
    // END DEPRECATED

    chart.defaultState = function(_) {
        if (!arguments.length) return defaultState;
        defaultState = _;
        return chart;
    };

    chart.noData = function(_) {
        if (!arguments.length) return noData;
        noData = _;
        return chart;
    };

    chart.transitionDuration = function(_) {
        nv.deprecated('multiBarChart.transitionDuration');
        return chart.duration(_);
    };

    chart.duration = function(_) {
        if (!arguments.length) return duration;
        duration = _;
        multibar.duration(duration);
        xAxis.duration(duration);
        yAxis.duration(duration);
        renderWatch.reset(duration);
        return chart;
    }

    //============================================================


    return chart;
}
nv.models.scatterChart = function() {
    "use strict";
    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var scatter      = nv.models.scatter()
        , xAxis        = nv.models.axis()
        , yAxis        = nv.models.axis()
        , legend       = nv.models.legend()
        , controls     = nv.models.legend()
        , distX        = nv.models.distribution()
        , distY        = nv.models.distribution()
        ;

    var margin       = {top: 30, right: 20, bottom: 50, left: 75}
        , width        = null
        , height       = null
        , color        = nv.utils.defaultColor()
        , x            = d3.fisheye ? d3.fisheye.scale(d3.scale.linear).distortion(0) : scatter.xScale()
        , y            = d3.fisheye ? d3.fisheye.scale(d3.scale.linear).distortion(0) : scatter.yScale()
        , xPadding     = 0
        , yPadding     = 0
        , showDistX    = false
        , showDistY    = false
        , showLegend   = true
        , showXAxis    = true
        , showYAxis    = true
        , rightAlignYAxis = false
        , showControls = !!d3.fisheye
        , fisheye      = 0
        , pauseFisheye = false
        , tooltips     = true
        , tooltipX     = function(key, x, y) { return '<strong>' + x + '</strong>' }
        , tooltipY     = function(key, x, y) { return '<strong>' + y + '</strong>' }
        , tooltip      = null
        , state        = nv.utils.state()
        , defaultState = null
        , dispatch     = d3.dispatch('tooltipShow', 'tooltipHide', 'stateChange', 'changeState', 'renderEnd')
        , noData       = "No Data Available."
        , transitionDuration = 250
        , duration = 250
        ;

    scatter
        .xScale(x)
        .yScale(y)
    ;
    xAxis
        .orient('bottom')
        .tickPadding(10)
    ;
    yAxis
        .orient((rightAlignYAxis) ? 'right' : 'left')
        .tickPadding(10)
    ;
    distX
        .axis('x')
    ;
    distY
        .axis('y')
    ;

    controls.updateState(false);

    //============================================================


    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var x0, y0;
    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    var showTooltip = function(e, offsetElement) {
        //TODO: make tooltip style an option between single or dual on axes (maybe on all charts with axes?)

        var left = e.pos[0] + ( offsetElement.offsetLeft || 0 ),
            top = e.pos[1] + ( offsetElement.offsetTop || 0),
            leftX = e.pos[0] + ( offsetElement.offsetLeft || 0 ),
            topX = y.range()[0] + margin.top + ( offsetElement.offsetTop || 0),
            leftY = x.range()[0] + margin.left + ( offsetElement.offsetLeft || 0 ),
            topY = e.pos[1] + ( offsetElement.offsetTop || 0),
            xVal = xAxis.tickFormat()(scatter.x()(e.point, e.pointIndex)),
            yVal = yAxis.tickFormat()(scatter.y()(e.point, e.pointIndex));

        if( tooltipX != null )
            nv.tooltip.show([leftX, topX], tooltipX(e.series.key, xVal, yVal, e, chart), 'n', 1, offsetElement, 'x-nvtooltip');
        if( tooltipY != null )
            nv.tooltip.show([leftY, topY], tooltipY(e.series.key, xVal, yVal, e, chart), 'e', 1, offsetElement, 'y-nvtooltip');
        if( tooltip != null )
            nv.tooltip.show([left, top], tooltip(e.series.key, xVal, yVal, e, chart), e.value < 0 ? 'n' : 's', null, offsetElement);
    };

    var controlsData = [
        { key: 'Magnify', disabled: true }
    ];

    var stateGetter = function(data) {
        return function(){
            return {
                active: data.map(function(d) { return !d.disabled })
            };
        }
    };

    var stateSetter = function(data) {
        return function(state) {
            if (state.active !== undefined)
                data.forEach(function(series,i) {
                    series.disabled = !state.active[i];
                });
        }
    };

    //============================================================


    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(scatter);
        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);
        if (showDistX) renderWatch.models(distX);
        if (showDistY) renderWatch.models(distY);

        selection.each(function(data) {
            var container = d3.select(this),
                that = this;
            nv.utils.initSVG(container);

            var availableWidth = (width  || parseInt(container.style('width')) || 960)
                    - margin.left - margin.right,
                availableHeight = (height || parseInt(container.style('height')) || 400)
                    - margin.top - margin.bottom;

            chart.update = function() {
                if (duration === 0)
                    container.call(chart);
                else
                    container.transition().duration(duration).call(chart);
            };
            chart.container = this;


            state
                .setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            // DEPRECATED set state.disabled
            state.disabled = data.map(function(d) { return !!d.disabled });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            //------------------------------------------------------------
            // Display noData message if there's nothing to show.

            if (!data || !data.length || !data.filter(function(d) { return d.values.length }).length) {
                var noDataText = container.selectAll('.nv-noData').data([noData]);

                noDataText.enter().append('text')
                    .attr('class', 'nvd3 nv-noData')
                    .attr('dy', '-.7em')
                    .style('text-anchor', 'middle');

                noDataText
                    .attr('x', margin.left + availableWidth / 2)
                    .attr('y', margin.top + availableHeight / 2)
                    .text(function(d) { return d });

                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup Scales

            x0 = x0 || x;
            y0 = y0 || y;

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup containers and skeleton of chart

            var wrap = container.selectAll('g.nv-wrap.nv-scatterChart').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-scatterChart nv-chart-' + scatter.id());
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            // background for pointer events
            gEnter.append('rect').attr('class', 'nvd3 nv-background');

            gEnter.append('g').attr('class', 'nv-x nv-axis');
            gEnter.append('g').attr('class', 'nv-y nv-axis');
            gEnter.append('g').attr('class', 'nv-scatterWrap');
            gEnter.append('g').attr('class', 'nv-distWrap');
            gEnter.append('g').attr('class', 'nv-legendWrap');
            gEnter.append('g').attr('class', 'nv-controlsWrap');

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Legend

            if (showLegend) {
                var legendWidth = (showControls) ? availableWidth / 2 : availableWidth;
                legend.width(legendWidth);

                wrap.select('.nv-legendWrap')
                    .datum(data)
                    .call(legend);

                if ( margin.top != legend.height()) {
                    margin.top = legend.height();
                    availableHeight = (height || parseInt(container.style('height')) || 400)
                        - margin.top - margin.bottom;
                }

                wrap.select('.nv-legendWrap')
                    .attr('transform', 'translate(' + (availableWidth - legendWidth) + ',' + (-margin.top) +')');
            }

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Controls

            if (showControls) {
                controls.width(180).color(['#444']);
                g.select('.nv-controlsWrap')
                    .datum(controlsData)
                    .attr('transform', 'translate(0,' + (-margin.top) +')')
                    .call(controls);
            }

            //------------------------------------------------------------


            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            if (rightAlignYAxis) {
                g.select(".nv-y.nv-axis")
                    .attr("transform", "translate(" + availableWidth + ",0)");
            }

            //------------------------------------------------------------
            // Main Chart Component(s)

            scatter
                .width(availableWidth)
                .height(availableHeight)
                .color(data.map(function(d,i) {
                    return d.color || color(d, i);
                }).filter(function(d,i) { return !data[i].disabled }));

            if (xPadding !== 0)
                scatter.xDomain(null);

            if (yPadding !== 0)
                scatter.yDomain(null);
            wrap.select('.nv-scatterWrap')
                .datum(data.filter(function(d) { return !d.disabled }))
                .call(scatter);

            //Adjust for x and y padding
            if (xPadding !== 0) {
                var xRange = x.domain()[1] - x.domain()[0];
                scatter.xDomain([x.domain()[0] - (xPadding * xRange), x.domain()[1] + (xPadding * xRange)]);
            }

            if (yPadding !== 0) {
                var yRange = y.domain()[1] - y.domain()[0];
                scatter.yDomain([y.domain()[0] - (yPadding * yRange), y.domain()[1] + (yPadding * yRange)]);
            }

            //Only need to update the scatter again if x/yPadding changed the domain.
            if (yPadding !== 0 || xPadding !== 0) {
                wrap.select('.nv-scatterWrap')
                    .datum(data.filter(function(d) { return !d.disabled }))
                    .call(scatter);
            }

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup Axes
            if (showXAxis) {
                xAxis
                    .scale(x)
                    .ticks( xAxis.ticks() && xAxis.ticks().length ? xAxis.ticks() : nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize( -availableHeight , 0);

                g.select('.nv-x.nv-axis')
                    .attr('transform', 'translate(0,' + y.range()[0] + ')')
                    .call(xAxis);

            }

            if (showYAxis) {
                yAxis
                    .scale(y)
                    .ticks( yAxis.ticks() && yAxis.ticks().length ? yAxis.ticks() : nv.utils.calcTicksY(availableHeight/36, data) )
                    .tickSize( -availableWidth, 0);

                g.select('.nv-y.nv-axis')
                    .call(yAxis);
            }


            if (showDistX) {
                distX
                    .getData(scatter.x())
                    .scale(x)
                    .width(availableWidth)
                    .color(data.map(function(d,i) {
                        return d.color || color(d, i);
                    }).filter(function(d,i) { return !data[i].disabled }));
                gEnter.select('.nv-distWrap').append('g')
                    .attr('class', 'nv-distributionX');
                g.select('.nv-distributionX')
                    .attr('transform', 'translate(0,' + y.range()[0] + ')')
                    .datum(data.filter(function(d) { return !d.disabled }))
                    .call(distX);
            }

            if (showDistY) {
                distY
                    .getData(scatter.y())
                    .scale(y)
                    .width(availableHeight)
                    .color(data.map(function(d,i) {
                        return d.color || color(d, i);
                    }).filter(function(d,i) { return !data[i].disabled }));
                gEnter.select('.nv-distWrap').append('g')
                    .attr('class', 'nv-distributionY');
                g.select('.nv-distributionY')
                    .attr('transform',
                        'translate(' + (rightAlignYAxis ? availableWidth : -distY.size() ) + ',0)')
                    .datum(data.filter(function(d) { return !d.disabled }))
                    .call(distY);
            }

            //------------------------------------------------------------




            if (d3.fisheye) {
                g.select('.nv-background')
                    .attr('width', availableWidth)
                    .attr('height', availableHeight);

                g.select('.nv-background').on('mousemove', updateFisheye);
                g.select('.nv-background').on('click', function() { pauseFisheye = !pauseFisheye;});
                scatter.dispatch.on('elementClick.freezeFisheye', function() {
                    pauseFisheye = !pauseFisheye;
                });
            }


            function updateFisheye() {
                if (pauseFisheye) {
                    g.select('.nv-point-paths').style('pointer-events', 'all');
                    return false;
                }

                g.select('.nv-point-paths').style('pointer-events', 'none' );

                var mouse = d3.mouse(this);
                x.distortion(fisheye).focus(mouse[0]);
                y.distortion(fisheye).focus(mouse[1]);

                g.select('.nv-scatterWrap')
                    .call(scatter);

                if (showXAxis)
                    g.select('.nv-x.nv-axis').call(xAxis);

                if (showYAxis)
                    g.select('.nv-y.nv-axis').call(yAxis);

                g.select('.nv-distributionX')
                    .datum(data.filter(function(d) { return !d.disabled }))
                    .call(distX);
                g.select('.nv-distributionY')
                    .datum(data.filter(function(d) { return !d.disabled }))
                    .call(distY);
            }



            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            controls.dispatch.on('legendClick', function(d,i) {
                d.disabled = !d.disabled;

                fisheye = d.disabled ? 0 : 2.5;
                g.select('.nv-background') .style('pointer-events', d.disabled ? 'none' : 'all');
                g.select('.nv-point-paths').style('pointer-events', d.disabled ? 'all' : 'none' );

                if (d.disabled) {
                    x.distortion(fisheye).focus(0);
                    y.distortion(fisheye).focus(0);

                    g.select('.nv-scatterWrap').call(scatter);
                    g.select('.nv-x.nv-axis').call(xAxis);
                    g.select('.nv-y.nv-axis').call(yAxis);
                } else {
                    pauseFisheye = false;
                }

                dispatch.stateChange(state);

                chart.update();
            });

            legend.dispatch.on('stateChange', function(newState) {
                for (var key in newState)
                    state[key] = newState[key];
                dispatch.stateChange(state);
                chart.update();
            });

            scatter.dispatch.on('elementMouseover.tooltip', function(e) {
                d3.select('.nv-chart-' + scatter.id() + ' .nv-series-' + e.seriesIndex + ' .nv-distx-' + e.pointIndex)
                    .attr('y1', function(d,i) { return e.pos[1] - availableHeight;});
                d3.select('.nv-chart-' + scatter.id() + ' .nv-series-' + e.seriesIndex + ' .nv-disty-' + e.pointIndex)
                    .attr('x2', e.pos[0] + distX.size());

                e.pos = [e.pos[0] + margin.left, e.pos[1] + margin.top];
                dispatch.tooltipShow(e);
            });

            dispatch.on('tooltipShow', function(e) {
                if (tooltips) showTooltip(e, that.parentNode);
            });

            // Update chart from a state object passed to event handler
            dispatch.on('changeState', function(e) {

                if (typeof e.disabled !== 'undefined') {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });

                    state.disabled = e.disabled;
                }

                chart.update();
            });

            //============================================================


            //store old scales for use in transitions on update
            x0 = x.copy();
            y0 = y.copy();


        });
        renderWatch.renderEnd('scatterChart immediate');
        return chart;
    }


    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    scatter.dispatch.on('elementMouseout.tooltip', function(e) {
        dispatch.tooltipHide(e);

        d3.select('.nv-chart-' + scatter.id() + ' .nv-series-' + e.seriesIndex + ' .nv-distx-' + e.pointIndex)
            .attr('y1', 0);
        d3.select('.nv-chart-' + scatter.id() + ' .nv-series-' + e.seriesIndex + ' .nv-disty-' + e.pointIndex)
            .attr('x2', distY.size());
    });
    dispatch.on('tooltipHide', function() {
        if (tooltips) nv.tooltip.cleanup();
    });

    //============================================================


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.scatter = scatter;
    chart.legend = legend;
    chart.controls = controls;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    chart.distX = distX;
    chart.distY = distY;
    // DO NOT DELETE. This is currently overridden below
    // until deprecated portions are removed.
    chart.state = state;

    d3.rebind(chart, scatter, 'id', 'interactive', 'pointActive', 'x', 'y', 'shape', 'size', 'xScale', 'yScale', 'zScale', 'xDomain', 'yDomain', 'xRange', 'yRange', 'sizeDomain', 'sizeRange', 'forceX', 'forceY', 'forceSize', 'clipVoronoi', 'clipRadius', 'useVoronoi');
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart.margin = function(_) {
        if (!arguments.length) return margin;
        margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
        margin.right  = typeof _.right  != 'undefined' ? _.right  : margin.right;
        margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
        margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        return chart;
    };

    chart.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return chart;
    };

    chart.height = function(_) {
        if (!arguments.length) return height;
        height = _;
        return chart;
    };

    chart.color = function(_) {
        if (!arguments.length) return color;
        color = nv.utils.getColor(_);
        legend.color(color);
        distX.color(color);
        distY.color(color);
        return chart;
    };

    chart.showDistX = function(_) {
        if (!arguments.length) return showDistX;
        showDistX = _;
        return chart;
    };

    chart.showDistY = function(_) {
        if (!arguments.length) return showDistY;
        showDistY = _;
        return chart;
    };

    chart.showControls = function(_) {
        if (!arguments.length) return showControls;
        showControls = _;
        return chart;
    };

    chart.showLegend = function(_) {
        if (!arguments.length) return showLegend;
        showLegend = _;
        return chart;
    };

    chart.showXAxis = function(_) {
        if (!arguments.length) return showXAxis;
        showXAxis = _;
        return chart;
    };

    chart.showYAxis = function(_) {
        if (!arguments.length) return showYAxis;
        showYAxis = _;
        return chart;
    };

    chart.rightAlignYAxis = function(_) {
        if(!arguments.length) return rightAlignYAxis;
        rightAlignYAxis = _;
        yAxis.orient( (_) ? 'right' : 'left');
        return chart;
    };


    chart.fisheye = function(_) {
        if (!arguments.length) return fisheye;
        fisheye = _;
        return chart;
    };

    chart.xPadding = function(_) {
        if (!arguments.length) return xPadding;
        xPadding = _;
        return chart;
    };

    chart.yPadding = function(_) {
        if (!arguments.length) return yPadding;
        yPadding = _;
        return chart;
    };

    chart.tooltips = function(_) {
        if (!arguments.length) return tooltips;
        tooltips = _;
        return chart;
    };

    chart.tooltipContent = function(_) {
        if (!arguments.length) return tooltip;
        tooltip = _;
        return chart;
    };

    chart.tooltipXContent = function(_) {
        if (!arguments.length) return tooltipX;
        tooltipX = _;
        return chart;
    };

    chart.tooltipYContent = function(_) {
        if (!arguments.length) return tooltipY;
        tooltipY = _;
        return chart;
    };

    // DEPRECATED
    chart.state = function(_) {
        nv.deprecated('scatterChart.state');
        if (!arguments.length) return state;
        state = _;
        return chart;
    };
    for (var key in state) {
        chart.state[key] = state[key];
    }
    // END DEPRECATED

    chart.defaultState = function(_) {
        if (!arguments.length) return defaultState;
        defaultState = _;
        return chart;
    };

    chart.noData = function(_) {
        if (!arguments.length) return noData;
        noData = _;
        return chart;
    };
    chart.duration = function(_) {
        if (!arguments.length) return duration;
        duration = _;
        renderWatch.reset(duration);
        scatter.duration(duration);
        xAxis.duration(duration);
        yAxis.duration(duration);
        distX.duration(duration);
        distY.duration(duration);
        return chart;
    };
    chart.transitionDuration = function(_) {
        nv.deprecated('scatterChart.transitionDuration');
        return chart.duration(_);
    };

    //============================================================


    return chart;
};
nv.models.scatterSectors = function () {
  "use strict";

  var scatter = nv.models.scatter()
    , xAxis = nv.models.axis()
    , yAxis = nv.models.axis()
    , legend = nv.models.legend()
    , controls = nv.models.legend()
    , distX = nv.models.distribution()
    , distY = nv.models.distribution();

  var margin = {top: 20, right: 20, bottom: 50, left: 50}
    , width = null
    , height = null
    , color = nv.utils.defaultColor()
    , x = scatter.xScale()
    , y = scatter.yScale()
    , showDistX = false
    , showDistY = false
    , showLegend = true
    , showXAxis = true
    , showYAxis = true
    , tooltips = true
    , tooltip = null
    , state = {}
    , defaultState = null
    , dispatch = d3.dispatch('tooltipShow', 'tooltipHide', 'stateChange', 'changeState', 'elementMouseover', 'elementMouseout')
    , noData = "No Data Available."
    , transitionDuration = 250;

  scatter
    .xScale(x)
    .yScale(y);

  xAxis
    .orient('bottom')
    .tickFormat(function (d) {
      return (parseFloat(parseFloat(d).toPrecision(3)));
    });

  yAxis
    .orient('left')
    .tickFormat(d3.format('d'));

  distX
    .axis('x');

  distY
    .axis('y');

  var showTooltip = function (e, offsetElement) {

    var left = e.pos[0] + ( offsetElement.offsetLeft || 0 ),
      top = e.pos[1] + ( offsetElement.offsetTop || 0),
      xVal = xAxis.tickFormat()(scatter.x()(e.point, e.pointIndex)),
      yVal = yAxis.tickFormat()(scatter.y()(e.point, e.pointIndex));

    if (tooltip != null)
      nv.tooltip.show([left, top], tooltip(e.series.key, xVal, yVal, e, chart), 's', null, offsetElement);
  };


  function chart(selection) {
    selection.each(function (data) {
      var container = d3.select(this)
        , that = this
        , availableWidth = (width || parseInt(container.style('width'))) - margin.left - margin.right
        , availableHeight = (height || parseInt(container.style('height'))) - margin.top - margin.bottom;

      if(isNaN(availableWidth) || isNaN(availableHeight))
        return;

      chart.container = this;

      var wrap = container.selectAll('g.nv-wrap.nv-scatterChart').data([data]);
      var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-scatterChart nv-chart-' + scatter.id());
      var gEnter = wrapEnter.append('g');
      var g = wrap.select('g');
      var sTitlePadding = 20;

      gEnter.append('rect').attr('class', 'nvd3 nv-background');
      gEnter.append('g').attr('class', 'nv-x nv-axis');
      gEnter.append('g').attr('class', 'nv-y nv-axis');
      gEnter.append('g').attr('class', 'nv-scatterWrap');
      gEnter.append('g').attr('class', 'nv-distWrap');
      gEnter.append('g').attr('class', 'nv-legendWrap');
      gEnter.append('g').attr('class', 'nv-sectorsWrap');
      gEnter.append('g').attr('class', 'nv-group-titles');

      var gSectors = wrap.select('.nv-sectorsWrap')

        , gSectorsBg = gSectors.selectAll('.nv-sector-bg')
          .data(function (d) {
            return d[0].sectors
          })

        , sTitles = gSectors.selectAll('.nv-sector-title')
          .data(function (d) {
            return d[0].sectors
          });

      gSectorsBg.enter()
        .append('rect')
        .attr('class', 'nv-sector-bg');

      wrap.selectAll('.nv-sector-bg')
        .attr("width", availableWidth / 2 - 1)
        .attr("height", availableHeight / 2 - 1)
        .attr('x', function (d, i) {
          return i % 2 ? availableWidth / 2 : 0
        })
        .attr('y', function (d, i) {
          return i % 3 ? availableHeight / 2 : 0
        });


      var sTitlesGroup = sTitles.enter().append('g');

      sTitlesGroup
        .attr('class', 'nv-sector-title')
        .attr('transform', function (d, i) {
          return  'translate('
            + (i % 2 ? availableWidth - sTitlePadding : sTitlePadding)
            + ','
            + (i % 3 ? availableHeight - sTitlePadding * 2 : sTitlePadding)
            + ')'
        })

      sTitlesGroup.append('text')
        .attr('dy', '1.5em')
        .text(function (d) {
          return d.title;
        })
        .style('text-anchor', function (d, i) {
          return  i % 2 ? 'end' : 'start'
        });


      sTitlesGroup.append('rect')
        .attr('width', function (d, i) {
          return sTitles[0][i].getBBox().width + sTitlePadding;
        })
        .attr('height', 30)
        .attr('x', function (d, i) {
          return  i % 2 ? -(sTitles[0][i].getBBox().width) / 2 : -sTitlePadding / 2
        });

      wrap.selectAll('.nv-sector-title')
        .attr('transform', function (d, i) {
          return  'translate('
            + (i % 2 ? availableWidth - sTitlePadding : sTitlePadding)
            + ','
            + (i % 3 ? availableHeight - sTitlePadding * 2.2 : sTitlePadding)
            + ')'
        })

      wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

      scatter
        .width(availableWidth)
        .height(availableHeight);

      var ratio = .1

        , getY = function (d, i) {
          return d.y
        },

        getX = function (d, i) {
          return d.x
        }

        , seriesData = d3.merge(
          data.map(function (d) {
            return d.values.map(function (d, i) {
              return {
                y: getY(d, i),
                x: getX(d, i)
              }
            })
          })
        )

        , yDomain = d3.extent(seriesData, getY)
        , xDomain = d3.extent(seriesData, getX);

      chart.xDomain([xDomain[0] - xDomain[1] * ratio , xDomain[1] + xDomain[1] * ratio]);
      chart.yDomain([yDomain[0] - yDomain[1] * ratio , yDomain[1] + yDomain[1] * ratio]);

      wrap.select('.nv-scatterWrap')
        .datum(data.filter(function (d) {
          return !d.disabled
        }))
        .call(scatter);

      if (showXAxis) {

        var step = parseFloat((xDomain[1] / 6).toPrecision(1))
        xAxis
          .scale(x)
          .tickValues(d3.range(0, xDomain[1] + step, step));

        g.select('.nv-x.nv-axis')
          .attr('transform', 'translate(0,' + y.range()[0] + ')')
          .call(xAxis);

      }

      if (showYAxis) {
        yAxis
          .scale(y)
          .ticks(yAxis.ticks() && yAxis.ticks().length ? yAxis.ticks() : availableHeight / 50)
          .tickSize(-availableWidth, 0);

        g.select('.nv-y.nv-axis')
          .call(yAxis);

        g.select('.nv-y.nv-axis > g').selectAll('g')
          .selectAll('.tick text')
          .attr('transform', 'rotate(' + -90 + ' 0,0)')
          .attr('dy', '-10')
          .style('text-anchor', 'middle');

      }

      if (showDistX) {
        distX
          .getData(scatter.x())
          .scale(x)
          .width(availableWidth)

        gEnter.select('.nv-distWrap').append('g')
          .attr('class', 'nv-distributionX');

        g.select('.nv-distributionX')
          .attr('transform', 'translate(0,' + y.range()[0] + ')')
          .datum(data)
          .call(distX);
      }

      if (showDistY) {
        distY
          .getData(scatter.y())
          .scale(y)
          .width(availableHeight)

        gEnter.select('.nv-distWrap').append('g')
          .attr('class', 'nv-distributionY');
        g.select('.nv-distributionY')
          .attr('transform',
          'translate(' + (-distY.size() ) + ',0)')
          .datum(data)
          .call(distY);
      }

      d3.selectAll('.nv-point-title').remove();

      var titles = wrap.select('.nv-group-titles').selectAll('.nv-point-title')
        .data(function (d) {
          return d[0].values
        });

      var title = titles.enter().append('g');

      title
        .attr('class', 'nv-point-title')
        .on('mouseover', function (d, i) {

          if(this.nextSibling){
            this.parentNode.appendChild(this);
          }

        });

      title.append('circle')
        .attr('r', 16)

      title.append('text')
        .style('text-anchor', 'middle')
        .attr('dy', '.4em')
        .text(function (d) {
          return d.code
        })
        .on('mouseover', function (d, i) {
          var series = data[d.series],
            point = series.values[i];

          dispatch.elementMouseover({
            point: point,
            series: series,
            pos: [x(getX(point, i)), y(getY(point, i))],
            seriesIndex: d.series,
            pointIndex: i
          });

        })
        .on('mouseout', function (d, i) {
          var series = data[d.series],
            point = series.values[i];

          dispatch.elementMouseout({
            point: point,
            series: series,
            seriesIndex: d.series,
            pointIndex: i
          });
        });

      wrap.selectAll('.nv-point-title')
        .attr('transform', function (d, i) {
          return  'translate(' + x(getX(d, i)) + ',' + y(getY(d, i)) + ')'
        });

      chart.update = function () {
        container.transition().duration(transitionDuration).call(chart);
      };

      dispatch.on('elementMouseover', function (e) {

        d3.select('.nv-chart-' + scatter.id() + ' .nv-series-' + e.seriesIndex + ' .nv-distx-' + e.pointIndex)
          .attr('y1', e.pos[1] - availableHeight + 16)
          .classed('hover', true);

        d3.select('.nv-chart-' + scatter.id() + ' .nv-series-' + e.seriesIndex + ' .nv-disty-' + e.pointIndex)
          .attr('x2', e.pos[0] + distX.size() - 16)
          .classed('hover', true);

        e.pos = [e.pos[0] + margin.left, e.pos[1] + margin.top];

        dispatch.tooltipShow(e);
      });

      dispatch.on('elementMouseout.tooltip', function (e) {

        d3.select('.nv-chart-' + scatter.id() + ' .nv-series-' + e.seriesIndex + ' .nv-distx-' + e.pointIndex)
          .attr('y1', 0)
          .classed('hover', false);
        d3.select('.nv-chart-' + scatter.id() + ' .nv-series-' + e.seriesIndex + ' .nv-disty-' + e.pointIndex)
          .attr('x2', distY.size())
          .classed('hover', false);

        dispatch.tooltipHide(e);
      });

      dispatch.on('tooltipShow', function (e) {
        if (tooltips) showTooltip(e, that.parentNode);
      });

      dispatch.on('tooltipHide', function () {
        if (tooltips) nv.tooltip.cleanup();
      });

      dispatch.on('changeState', function (e) {
        chart.update();
      });

    });

    d3.select('.nv-y .nv-axislabel').attr('y', -30);

    return chart;
  }


  //============================================================
  // Expose Public Variables
  //------------------------------------------------------------

  // expose chart's sub-components
  chart.dispatch = dispatch;
  chart.scatter = scatter;
  chart.legend = legend;
  chart.controls = controls;
  chart.xAxis = xAxis;
  chart.yAxis = yAxis;
  chart.distX = distX;
  chart.distY = distY;

  d3.rebind(chart, scatter, 'id', 'interactive', 'pointActive', 'x', 'y', 'shape', 'size', 'xScale', 'yScale', 'zScale', 'xDomain', 'yDomain', 'xRange', 'yRange', 'sizeDomain', 'sizeRange', 'forceX', 'forceY', 'forceSize', 'clipVoronoi', 'clipRadius', 'useVoronoi');
  chart.options = nv.utils.optionsFunc.bind(chart);

  chart.margin = function (_) {
    if (!arguments.length) return margin;
    margin.top = typeof _.top != 'undefined' ? _.top : margin.top;
    margin.right = typeof _.right != 'undefined' ? _.right : margin.right;
    margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
    margin.left = typeof _.left != 'undefined' ? _.left : margin.left;
    return chart;
  };

  chart.width = function (_) {
    if (!arguments.length) return width;
    width = _;
    return chart;
  };

  chart.height = function (_) {
    if (!arguments.length) return height;
    height = _;
    return chart;
  };

  chart.color = function (_) {
    if (!arguments.length) return color;
    color = nv.utils.getColor(_);
    legend.color(color);
    distX.color(color);
    distY.color(color);
    return chart;
  };

  chart.showDistX = function (_) {
    if (!arguments.length) return showDistX;
    showDistX = _;
    return chart;
  };

  chart.showDistY = function (_) {
    if (!arguments.length) return showDistY;
    showDistY = _;
    return chart;
  };

  chart.showControls = function (_) {
    if (!arguments.length) return showControls;
    showControls = _;
    return chart;
  };

  chart.showLegend = function (_) {
    if (!arguments.length) return showLegend;
    showLegend = _;
    return chart;
  };

  chart.showXAxis = function (_) {
    if (!arguments.length) return showXAxis;
    showXAxis = _;
    return chart;
  };

  chart.showYAxis = function (_) {
    if (!arguments.length) return showYAxis;
    showYAxis = _;
    return chart;
  };

  chart.rightAlignYAxis = function (_) {
    if (!arguments.length) return rightAlignYAxis;
    rightAlignYAxis = _;
    yAxis.orient((_) ? 'right' : 'left');
    return chart;
  };


  chart.fisheye = function (_) {
    if (!arguments.length) return fisheye;
    fisheye = _;
    return chart;
  };

  chart.xPadding = function (_) {
    if (!arguments.length) return xPadding;
    xPadding = _;
    return chart;
  };

  chart.yPadding = function (_) {
    if (!arguments.length) return yPadding;
    yPadding = _;
    return chart;
  };

  chart.tooltips = function (_) {
    if (!arguments.length) return tooltips;
    tooltips = _;
    return chart;
  };

  chart.tooltipContent = function (_) {
    if (!arguments.length) return tooltip;
    tooltip = _;
    return chart;
  };

  chart.state = function (_) {
    if (!arguments.length) return state;
    state = _;
    return chart;
  };

  chart.defaultState = function (_) {
    if (!arguments.length) return defaultState;
    defaultState = _;
    return chart;
  };

  chart.noData = function (_) {
    if (!arguments.length) return noData;
    noData = _;
    return chart;
  };

  chart.transitionDuration = function (_) {
    if (!arguments.length) return transitionDuration;
    transitionDuration = _;
    return chart;
  };

  //============================================================


  return chart;
}
return nv;

}));