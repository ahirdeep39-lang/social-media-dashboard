<script>
/* ==========================================================================
   Charts.js  (served as an HTML partial; wrapped in <script> for include())
   All Chart.js construction lives here. Exposes window.DashCharts.
   ========================================================================== */
(function () {
  var registry = {}; // id -> Chart instance

  function css(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function accent(){ return css('--accent') || '#6366f1'; }
  function accent2(){ return css('--accent2') || '#22d3ee'; }
  var GRID = 'rgba(255,255,255,.06)';
  var TICK = '#93a0bf';

  function palette(n){
    var base = [accent(), accent2(), '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#fb7185', '#2dd4bf', '#c084fc'];
    var out=[]; for(var i=0;i<n;i++) out.push(base[i%base.length]); return out;
  }
  function fmt(n){
    n=Number(n)||0;
    if(Math.abs(n)>=1e9)return (n/1e9).toFixed(1)+'B';
    if(Math.abs(n)>=1e6)return (n/1e6).toFixed(1)+'M';
    if(Math.abs(n)>=1e3)return (n/1e3).toFixed(1)+'K';
    return String(Math.round(n));
  }
  function gradient(ctx, area, c1, c2){
    if(!area) return c1;
    var g=ctx.createLinearGradient(0,area.top,0,area.bottom);
    g.addColorStop(0,c2); g.addColorStop(1,'rgba(99,102,241,0)'); return g;
  }

  var baseOpts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ labels:{ color:TICK, font:{family:'Inter',size:11}, boxWidth:12, padding:14 } },
      tooltip:{ backgroundColor:'rgba(12,16,30,.95)', borderColor:'rgba(255,255,255,.12)', borderWidth:1,
        titleColor:'#fff', bodyColor:'#cbd5e1', padding:10, cornerRadius:8,
        callbacks:{ label:function(c){ return ' '+(c.dataset.label?c.dataset.label+': ':'')+fmt(c.parsed.y!=null?c.parsed.y:c.parsed); } } } },
    scales:{ x:{ grid:{color:GRID,drawBorder:false}, ticks:{color:TICK,font:{size:10}} },
      y:{ grid:{color:GRID,drawBorder:false}, ticks:{color:TICK,font:{size:10},callback:function(v){return fmt(v);}} } }
  };
  function noAxes(){ return { responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ position:'bottom', labels:{ color:TICK, font:{size:11}, boxWidth:12, padding:12 } },
      tooltip:baseOpts.plugins.tooltip } }; }

  function destroy(id){ if(registry[id]){ registry[id].destroy(); delete registry[id]; } }
  function ctxOf(id){ var el=document.getElementById(id); return el?el.getContext('2d'):null; }

  function bar(id, labels, data, opts){
    var ctx=ctxOf(id); if(!ctx)return; destroy(id);
    registry[id]=new Chart(ctx,{type:'bar',data:{labels:labels,datasets:[{label:opts&&opts.label||'',data:data,
      backgroundColor:palette(labels.length).map(function(c){return c+'cc';}),borderRadius:8,borderSkipped:false,maxBarThickness:46}]},
      options:Object.assign({},baseOpts,{plugins:Object.assign({},baseOpts.plugins,{legend:{display:false}})})});
  }
  function hbar(id, labels, data){
    var ctx=ctxOf(id); if(!ctx)return; destroy(id);
    registry[id]=new Chart(ctx,{type:'bar',data:{labels:labels,datasets:[{data:data,
      backgroundColor:palette(labels.length).map(function(c){return c+'cc';}),borderRadius:7,maxBarThickness:22}]},
      options:Object.assign({},baseOpts,{indexAxis:'y',plugins:Object.assign({},baseOpts.plugins,{legend:{display:false}})})});
  }
  function line(id, labels, datasets){
    var ctx=ctxOf(id); if(!ctx)return; destroy(id);
    var ds=datasets.map(function(d,i){
      var col=i===0?accent():accent2();
      return {label:d.label,data:d.data,borderColor:col,backgroundColor:function(c){return gradient(c.chart.ctx,c.chart.chartArea,col,col+'55');},
        fill:true,tension:.4,borderWidth:2,pointRadius:0,pointHoverRadius:4,pointHoverBackgroundColor:col};
    });
    registry[id]=new Chart(ctx,{type:'line',data:{labels:labels,datasets:ds},options:baseOpts});
  }
  function doughnut(id, labels, data){
    var ctx=ctxOf(id); if(!ctx)return; destroy(id);
    registry[id]=new Chart(ctx,{type:'doughnut',data:{labels:labels,datasets:[{data:data,
      backgroundColor:[accent(),'rgba(147,160,191,.25)'],borderColor:'rgba(0,0,0,0)',borderWidth:0,hoverOffset:6}]},
      options:Object.assign({cutout:'70%'},noAxes())});
  }
  function radar(id, labels, data){
    var ctx=ctxOf(id); if(!ctx)return; destroy(id);
    registry[id]=new Chart(ctx,{type:'radar',data:{labels:labels,datasets:[{label:'Achievement %',data:data,
      borderColor:accent2(),backgroundColor:accent2()+'33',pointBackgroundColor:accent2(),borderWidth:2}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:baseOpts.plugins.tooltip},
        scales:{r:{angleLines:{color:GRID},grid:{color:GRID},pointLabels:{color:TICK,font:{size:10}},ticks:{display:false,backdropColor:'transparent'},suggestedMin:0,suggestedMax:100}}}});
  }
  function grouped(id, labels, series){
    var ctx=ctxOf(id); if(!ctx)return; destroy(id);
    var cols=[accent(),accent2()];
    registry[id]=new Chart(ctx,{type:'bar',data:{labels:labels,datasets:series.map(function(s,i){
      return {label:s.label,data:s.data,backgroundColor:cols[i%2]+'cc',borderRadius:6,maxBarThickness:30};})},
      options:baseOpts});
  }

  function renderAll(d){
    var c=d.charts;
    line('chDailyTrend', c.dailyTrend.map(p=>p.label), [
      {label:'Posts', data:c.dailyTrend.map(p=>p.posts)},
      {label:'Views', data:c.dailyTrend.map(p=>p.views)}
    ]);
    doughnut('chAuditProgress', ['Audited','Pending'], [c.auditProgress.audited, c.auditProgress.pending]);
    bar('chFollowersPlatform', c.followersByPlatform.map(x=>x.label), c.followersByPlatform.map(x=>x.value));
    bar('chViewsPlatform', c.viewsByPlatform.map(x=>x.label), c.viewsByPlatform.map(x=>x.value));
    bar('chPostsPlatform', c.postsByPlatform.map(x=>x.label), c.postsByPlatform.map(x=>x.value));
    grouped('chStaff', c.staffPerformance.map(x=>x.label), [
      {label:'Posts Today', data:c.staffPerformance.map(x=>x.posts)},
      {label:'Total Views', data:c.staffPerformance.map(x=>x.views)}
    ]);
    radar('chTarget', c.targetAchievement.map(x=>x.label), c.targetAchievement.map(x=>x.pct));
    hbar('chTop', c.topAccounts.map(x=>x.label), c.topAccounts.map(x=>x.value));
    hbar('chLow', c.lowAccounts.map(x=>x.label), c.lowAccounts.map(x=>x.value));
    line('chFollowersGrowth', c.followersGrowth.map(x=>x.label), [{label:'Followers', data:c.followersGrowth.map(x=>x.value)}]);
    line('chViewsGrowth', c.viewsGrowth.map(x=>x.label), [{label:'Views', data:c.viewsGrowth.map(x=>x.value)}]);
    renderTrend(d, window.__trendGrain || 'weekly');
  }

  function renderTrend(d, grain){
    window.__trendGrain = grain;
    var t = grain==='monthly' ? d.charts.monthlyTrend : d.charts.weeklyTrend;
    line('chWeekMonth', t.map(p=>p.label), [
      {label:'Posts', data:t.map(p=>p.posts)},
      {label:'Views', data:t.map(p=>p.views)}
    ]);
  }

  window.DashCharts = { renderAll:renderAll, renderTrend:renderTrend, fmt:fmt, destroyAll:function(){ Object.keys(registry).forEach(destroy); } };
})();
</script>
