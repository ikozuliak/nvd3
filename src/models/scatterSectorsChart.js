nv.models.scatterSectors = function () {
  "use strict";

  var scatter = nv.models.scatter()
    , xAxis = nv.models.axis()
    , yAxis = nv.models.axis()
    , legend = nv.models.legend()
    , controls = nv.models.legend()
    , distX = nv.models.distribution()
    , tooltip  = nv.models.tooltip()
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

      dispatch.on('elementMouseover.tooltip', function (e) {

        d3.select('.nv-chart-' + scatter.id() + ' .nv-series-' + e.seriesIndex + ' .nv-distx-' + e.pointIndex)
          .attr('y1', e.pos[1] - availableHeight + 16)
          .classed('hover', true);

        d3.select('.nv-chart-' + scatter.id() + ' .nv-series-' + e.seriesIndex + ' .nv-disty-' + e.pointIndex)
          .attr('x2', e.pos[0] + distX.size() - 16)
          .classed('hover', true);

        e.pos = {left: e.pos[0] + margin.left + 4, top: e.pos[1]};

        tooltip
          .chartContainer(that.parentNode)
          .position(e.pos)
          .data(e)
          .hidden(false);
      });

      dispatch.on('elementMouseout.tooltip', function (e) {

        d3.select('.nv-chart-' + scatter.id() + ' .nv-series-' + e.seriesIndex + ' .nv-distx-' + e.pointIndex)
          .attr('y1', 0)
          .classed('hover', false);
        d3.select('.nv-chart-' + scatter.id() + ' .nv-series-' + e.seriesIndex + ' .nv-disty-' + e.pointIndex)
          .attr('x2', distY.size())
          .classed('hover', false);

        tooltip.hidden(true);
      });

    });

    d3.select('.nv-y .nv-axislabel').attr('y', -30);

    return chart;
  }

  // Expose Public Variables
  //------------------------------------------------------------

  // expose chart's sub-components
  chart.dispatch = dispatch;
  chart.scatter = scatter;
  chart.legend = legend;
  chart.xAxis = xAxis;
  chart.yAxis = yAxis;
  chart.distX = distX;
  chart.distY = distY;
  chart.tooltip = tooltip;

  chart.options = nv.utils.optionsFunc.bind(chart);
  chart._options = Object.create({}, {
    // simple options, just get/set the necessary values
    width:      {get: function(){return width;}, set: function(_){width=_;}},
    height:     {get: function(){return height;}, set: function(_){height=_;}},
    container:  {get: function(){return container;}, set: function(_){container=_;}},
    showDistX:  {get: function(){return showDistX;}, set: function(_){showDistX=_;}},
    showDistY:  {get: function(){return showDistY;}, set: function(_){showDistY=_;}},
    showLegend: {get: function(){return showLegend;}, set: function(_){showLegend=_;}},
    showXAxis:  {get: function(){return showXAxis;}, set: function(_){showXAxis=_;}},
    showYAxis:  {get: function(){return showYAxis;}, set: function(_){showYAxis=_;}},
    defaultState:     {get: function(){return defaultState;}, set: function(_){defaultState=_;}},
    noData:     {get: function(){return noData;}, set: function(_){noData=_;}},
    duration:   {get: function(){return duration;}, set: function(_){duration=_;}},

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
    tooltipXContent:    {get: function(){return tooltip.contentGenerator();}, set: function(_){
      // deprecated after 1.7.1
      nv.deprecated('tooltipContent', 'This option is removed, put values into main tooltip.');
    }},
    tooltipYContent:    {get: function(){return tooltip.contentGenerator();}, set: function(_){
      // deprecated after 1.7.1
      nv.deprecated('tooltipContent', 'This option is removed, put values into main tooltip.');
    }},

    // options that require extra logic in the setter
    margin: {get: function(){return margin;}, set: function(_){
      margin.top    = _.top    !== undefined ? _.top    : margin.top;
      margin.right  = _.right  !== undefined ? _.right  : margin.right;
      margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
      margin.left   = _.left   !== undefined ? _.left   : margin.left;
    }},
    rightAlignYAxis: {get: function(){return rightAlignYAxis;}, set: function(_){
      rightAlignYAxis = _;
      yAxis.orient( (_) ? 'right' : 'left');
    }},
    color: {get: function(){return color;}, set: function(_){
      color = nv.utils.getColor(_);
      legend.color(color);
      distX.color(color);
      distY.color(color);
    }}
  });

  nv.utils.inheritOptions(chart, scatter);
  nv.utils.initOptions(chart);
  return chart;
}