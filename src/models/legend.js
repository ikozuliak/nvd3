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