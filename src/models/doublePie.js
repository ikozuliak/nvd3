nv.models.doublePie = function () {

  var pie = nv.models.pie()
    , legend = nv.models.legend()
    , pieInner = nv.models.pie()
    , arc = d3.svg.arc()
    , tooltip = nv.models.tooltip()
    , arcInner = arc;

  var margin = {top: 0, right: 0, bottom: 0, left: 0}
    , width = null
    , height = null
    , single = false
    , showLegend = true
    , total = {}
    , title = ''
    , tooltips = true
    , tooltipContent = function (key, y, e, graph) {
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

      var that = this;

      chart.container = this;

      total = {inner: 0, outer: 0}

      data.map(function (d) {
        total.inner += d.values[1];
        total.outer += d.values[0];
      });

      var availableWidth = (width || parseInt(container.style('width')) || 960) - margin.left
        , wrap = container.selectAll('g.nv-wrap.nv-pieChart').data([data])
        , availableHeight = (height || parseInt(container.style('height')) || 400) - margin.bottom;

      var  gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-pieChart').append('g')
        , g = wrap.select('g')
        , labels = gEnter.append('g').attr('class', 'nv-arcLabels')
        , legendWrap = gEnter.append('g').attr('class', 'nv-legendWrap');

      // Legend
      if (showLegend) {
        var legendWidth = availableWidth;

        legend.width(legendWidth);

        g.select('.nv-legendWrap')
          .datum(data)
          .call(legend);

        if ( margin.bottom != legend.height()) {
          margin.bottom = legend.height();
          availableHeight = nv.utils.availableHeight(height, container, margin);
        }

        wrap.select('.nv-legendWrap')
          .attr('transform', 'translate('+(legendWidth - g.select('.nv-legendWrap').node().getBBox().width)/2 +',' + (this.clientHeight - legend.height() - 10 ) +')');

      }

      var pieInnerRatio = 0.6
        , pieInnerWidth = availableWidth * pieInnerRatio
        , pieInnerHeight = availableHeight * pieInnerRatio
        , halfHeight = availableHeight / 2
        , halfWidth = availableWidth / 2
        , PI = (Math.PI / 180)
        , arcRadius = halfHeight - (halfHeight / 7)
        , arcGroup = wrap.selectAll('.nv-arcLabels').attr("transform", "translate(" + halfWidth + "," + halfHeight + ")");

      chart.update = function() { container.transition().call(chart); };


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
      var hoverTimeout;

      slices.on('mouseover', function (e, i) {

        var pos = {"left":0, "top": single ? -40 : 0};
        var pointIndex = single ? i : i % (slices[0].length / 2);

        e.data.series = [1];
        e.data.total = total;

        tooltip
          .chartContainer(that.parentNode)
          .position(pos)
          .data(e.data)
          .hidden(false);

        clearTimeout(hoverTimeout);

        wrap
          .selectAll('.nv-slice').classed('gray', true);

        wrap
          .selectAll(
          '.nv-pieWrap .nv-slice:nth-of-type('+(pointIndex+1)+'), ' +
          '.nv-pieWrapInner .nv-slice:nth-of-type('+(pointIndex+1)+')'
        )
          .classed('hovered', true)
          .classed('gray', false)

      });

      slices.on('mouseout', function (e, i) {

        clearTimeout(hoverTimeout);

        tooltip.hidden(true);

        var slices = wrap.selectAll('.nv-slice');

        slices
          .classed('hovered', false);

        hoverTimeout = setTimeout(function () {
          slices
            .classed('gray', false)
        }, 200)

      });

      dispatch.on('changeState', function (e) {

        if (typeof e.disabled !== 'undefined') {
          data.forEach(function (series, i) {
            series.disabled = e.disabled[i];
          });

          state.disabled = e.disabled;
        }

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
          .attr("x", -halfHeight)
          .attr("y", -availableHeight / 2.5);

        arcGroup.select(".nv-arcLineOuter")
          .attr("transform", function (d) {
            return "translate(" + arc.centroid(d) + ")";
          })
          .attr("x2", -pieInnerHeight / 15)
          .attr("y2", -pieInnerHeight / 15);

        pie
          .donut(true)
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
          .donut(true)
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
          .attr("x", halfHeight)
          .attr("y", -availableHeight / 2.5);

        arcGroup
          .select(".nv-arcLineInner")
          .attr("transform", function (d) {
            return "translate(" + arcInner.centroid(d) + ")";
          })
          .attr("x2", pieInnerHeight / 4)
          .attr("y2", -pieInnerHeight / 4)

        d3.transition(pieWrapInner).call(pieInner);
      }
      legend.dispatch.on('stateChange', function(newState) {
        for (var key in newState) {
          state[key] = newState[key];
        }
        dispatch.stateChange(state);
        chart.update();
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
  chart.tooltip = tooltip;
  chart.options = nv.utils.optionsFunc.bind(chart);

  // use Object get/set functionality to map between vars and chart functions
  chart._options = Object.create({}, {
    // simple options, just get/set the necessary values
    noData:         {get: function(){return noData;},         set: function(_){noData=_;}},
    showLegend:     {get: function(){return showLegend;},     set: function(_){showLegend=_;}},
    single:         {get: function(){return single;},     set: function(_){single=_;}},
    title:          {get: function(){return title;},          set: function(_){title=_;}},
    legendPosition: {get: function(){return legendPosition;}, set: function(_){legendPosition=_;}},
    defaultState:   {get: function(){return defaultState;},   set: function(_){defaultState=_;}},

    // deprecated options
    tooltips:    {get: function(){return tooltip.enabled();}, set: function(_){
      // deprecated after 1.7.1
      nv.deprecated('tooltips', 'use chart.tooltip.enabled() instead');
      tooltip.enabled(!!_);
    }},
    tooltipContent:    {get: function(){return tooltip.contentGenerator();}, set: function(_){
      // deprecated after 1.7.1
      nv.deprecated('tooltipContent', 'use chart.tooltip.contentGenerator() instead');
      tooltip.contentGenerator(_);
    }},

    // options that require extra logic in the setter
    color: {get: function(){return color;}, set: function(_){
      color = _;
      legend.color(color);
      pie.color(color);
    }},
    duration: {get: function(){return duration;}, set: function(_){
      duration = _;
      renderWatch.reset(duration);
    }},
    margin: {get: function(){return margin;}, set: function(_){
      margin.top    = _.top    !== undefined ? _.top    : margin.top;
      margin.right  = _.right  !== undefined ? _.right  : margin.right;
      margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
      margin.left   = _.left   !== undefined ? _.left   : margin.left;
    }}
  });
  nv.utils.inheritOptions(chart, pie);
  nv.utils.initOptions(chart);
  return chart;
}