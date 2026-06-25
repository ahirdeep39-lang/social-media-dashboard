<script>
/* ==========================================================================
   Dashboard.js  (served as an HTML partial; wrapped in <script> for include())
   Client controller. Talks to the server via google.script.run.
   ========================================================================== */
(function () {
  'use strict';

  var STATE = {
    data: null,
    filters: { platform:'all', staff:'all', date:'', status:'all', search:'', sort:'views' },
    activeTable: 'latestAudit',
    tableSearch: '',
    page: 1,
    sortCol: null,
    sortDir: 1,
    timer: null,
    refreshSeconds: (window.BOOT && window.BOOT.autoRefreshSeconds) || 60,
    reportType: 'daily',
    busy: false
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ----------------------------- KPI config ----------------------------- */
  var KPI_DEFS = [
    { key:'totalAccounts', label:'Total Accounts', icon:'account_circle' },
    { key:'accountsAudited', label:'Accounts Audited', icon:'verified' },
    { key:'pendingAccounts', label:'Pending Accounts', icon:'pending_actions' },
    { key:'followers', label:'Followers', icon:'groups', big:true },
    { key:'subscribers', label:'Subscribers', icon:'subscriptions', big:true },
    { key:'postsToday', label:'Posts Today', icon:'post_add' },
    { key:'viewsToday', label:'Views Today', icon:'visibility', big:true },
    { key:'averageViews', label:'Average Views', icon:'speed', big:true },
    { key:'totalPosts', label:'Total Posts', icon:'article', big:true },
    { key:'targetPosts', label:'Target Posts', icon:'flag' },
    { key:'completedPosts', label:'Completed Posts', icon:'task_alt' },
    { key:'completionPct', label:'Completion %', icon:'donut_large', pct:true },
    { key:'auditSuccessRate', label:'Audit Success Rate', icon:'shield', pct:true },
    { key:'lastAuditTime', label:'Last Audit Time', icon:'schedule', text:true }
  ];

  /* --------------------------- table columns ---------------------------- */
  var AUDIT_COLS = [
    { k:'timestamp', t:'Time' }, { k:'name', t:'Account' }, { k:'platform', t:'Platform' },
    { k:'staff', t:'Staff' }, { k:'followers', t:'Followers', n:true }, { k:'views', t:'Total Views', n:true },
    { k:'viewsToday', t:'Views Today', n:true }, { k:'posts', t:'Posts', n:true },
    { k:'postsToday', t:'Today', n:true }, { k:'status', t:'Status', badge:true }
  ];
  var ACC_COLS = [
    { k:'name', t:'Account' }, { k:'platform', t:'Platform' }, { k:'staff', t:'Staff' },
    { k:'target', t:'Target', n:true }, { k:'status', t:'Status', badge:true }
  ];
  var TABLE_COLS = {
    latestAudit:AUDIT_COLS, topAccounts:AUDIT_COLS, failedAudits:AUDIT_COLS,
    highestViews:AUDIT_COLS, lowestViews:AUDIT_COLS, newestPosts:AUDIT_COLS, latestFollowers:AUDIT_COLS,
    missingPosts:ACC_COLS, inactiveAccounts:ACC_COLS
  };

  function fmt(n){ return window.DashCharts ? window.DashCharts.fmt(n) : n; }

  /* ----------------------------- boot ----------------------------------- */
  function init(){
    applyBranding(window.BOOT || {});
    bindUI();
    loadData(true);
    checkSchema();
    startAutoRefresh();
  }

  function applyBranding(s){
    if(s.accent) document.documentElement.style.setProperty('--accent', s.accent);
    if(s.accent2) document.documentElement.style.setProperty('--accent2', s.accent2);
    if(s.companyName){ $('#brandName').textContent = s.companyName; }
    if(s.logoUrl){ $('#brandLogo').innerHTML = '<img src="'+s.logoUrl+'" alt="logo">'; }
    if(s.autoRefreshSeconds) STATE.refreshSeconds = s.autoRefreshSeconds;
  }

  /* --------------------------- server calls ----------------------------- */
  function run(fn, args){
    return new Promise(function (resolve, reject){
      var r = google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
      r[fn].apply(r, args || []);
    });
  }

  function setStatus(mode, text){
    var pill = $('#auditStatus');
    pill.className = 'status-pill ' + (mode||'');
    $('#auditStatusText').textContent = text || 'Idle';
  }

  function loadData(initial){
    if(STATE.busy) return;
    STATE.busy = true;
    setStatus('loading', 'Refreshing…');
    $('#refreshIcon').classList.add('spinning');

    run('getDashboardData', [STATE.filters]).then(function (d){
      STATE.busy = false;
      $('#refreshIcon').classList.remove('spinning');
      if(!d || d.ok === false){ fail(d && d.error); return; }
      STATE.data = d;
      renderKpis(d.kpis);
      window.DashCharts.renderAll(d);
      populateFilterOptions(d.filterOptions);
      renderTable();
      $('#lastUpdated').textContent = 'Last updated: ' + d.generatedAt;
      $('#footCounts').textContent = d.counts.filteredAccounts + ' accounts · ' + d.counts.filteredAudits + ' audit rows';
      setStatus('live', 'Live');
      if(initial) revealApp();
    }).catch(function (e){ STATE.busy=false; $('#refreshIcon').classList.remove('spinning'); fail(e && e.message); });
  }

  function fail(msg){
    setStatus('', 'Error');
    toast('Failed to load data: ' + (msg || 'unknown error'), true);
    revealApp();
  }

  function revealApp(){
    var loader = $('#boot-loader'); if(loader){ loader.classList.add('fade'); setTimeout(function(){ loader.remove(); }, 500); }
    $('#app').classList.add('ready');
  }

  function checkSchema(){
    run('getSchemaReport').then(function (r){
      if(!r) return;
      var banner = $('#setupBanner');
      if(r.ok && r.dailyAudit && r.dailyAudit.found){ banner.classList.add('hidden'); return; }
      var html = '<b>Setup check</b> — the dashboard is running, but note:';
      var items = (r.problems||[]).slice();
      if(r.dailyAudit && !r.dailyAudit.found){ items.push('No "Daily Audit" sheet yet — your scraper can create it later; KPIs that depend on it will show 0 until then.'); }
      if(r.accounts && r.accounts.missing && r.accounts.missing.length){ items.push('Accounts columns not detected: ' + r.accounts.missing.join(', ') + '. Add the headers or extend aliases in Config.gs.'); }
      if(!items.length){ banner.classList.add('hidden'); return; }
      html += '<ul>' + items.map(function(i){ return '<li>'+escapeHtml(i)+'</li>'; }).join('') + '</ul>';
      banner.innerHTML = html; banner.classList.remove('hidden');
    }).catch(function(){});
  }

  /* ----------------------------- KPIs ----------------------------------- */
  function renderKpis(k){
    var grid = $('#kpiGrid'); grid.innerHTML = '';
    KPI_DEFS.forEach(function (def, i){
      var raw = k[def.key];
      var val = def.text ? raw : (def.pct ? raw + '%' : fmt(raw));
      var barPct = def.pct ? Math.min(100, Number(raw)||0) : null;
      if(def.key==='accountsAudited' && k.totalAccounts) barPct = Math.round((k.accountsAudited/k.totalAccounts)*100);
      var el = document.createElement('div');
      el.className = 'kpi glass';
      el.style.animationDelay = (i*0.03)+'s';
      el.innerHTML =
        '<div class="k-ic"><span class="material-icons-round">'+def.icon+'</span></div>'+
        '<div class="k-val">'+val+'</div>'+
        '<div class="k-lab">'+def.label+'</div>'+
        (barPct!=null ? '<div class="k-bar"><i style="width:'+barPct+'%"></i></div>' : '');
      grid.appendChild(el);
    });
  }

  /* --------------------------- filter options --------------------------- */
  function populateFilterOptions(opts){
    if(!opts) return;
    fillSelect($('#fPlatform'), opts.platforms, STATE.filters.platform, 'All Platforms');
    fillSelect($('#fStaff'), opts.staff, STATE.filters.staff, 'All Staff');
  }
  function fillSelect(sel, items, current, allLabel){
    var cur = sel.value || current || 'all';
    sel.innerHTML = '<option value="all">'+allLabel+'</option>' +
      (items||[]).map(function(x){ return '<option value="'+escapeHtml(x)+'">'+escapeHtml(x)+'</option>'; }).join('');
    sel.value = (items||[]).indexOf(cur)!==-1 ? cur : 'all';
  }

  /* ------------------------------ tables -------------------------------- */
  function currentRows(){
    if(!STATE.data) return [];
    var rows = (STATE.data.tables[STATE.activeTable] || []).slice();
    var q = STATE.tableSearch.trim().toLowerCase();
    if(q){
      rows = rows.filter(function(r){
        return Object.keys(r).some(function(k){ return String(r[k]).toLowerCase().indexOf(q)!==-1; });
      });
    }
    if(STATE.sortCol){
      var c = STATE.sortCol;
      rows.sort(function(a,b){
        var av=a[c], bv=b[c];
        if(typeof av==='number' && typeof bv==='number') return (av-bv)*STATE.sortDir;
        return String(av).localeCompare(String(bv))*STATE.sortDir;
      });
    } else {
      rows = applySortPref(rows);
    }
    return rows;
  }

  function applySortPref(rows){
    var s = STATE.filters.sort;
    var key = s==='followers'?'followers':s==='posts'?'posts':s==='recent'?'timestamp':'views';
    if(rows.length && rows[0][key]!==undefined){
      rows.sort(function(a,b){
        if(key==='timestamp') return String(b[key]).localeCompare(String(a[key]));
        return (Number(b[key])||0)-(Number(a[key])||0);
      });
    }
    return rows;
  }

  function renderTable(){
    var cols = TABLE_COLS[STATE.activeTable] || AUDIT_COLS;
    var rows = currentRows();
    var pageSize = (STATE.data && STATE.data.settings && STATE.data.settings.pageSize) || 25;
    var pages = Math.max(1, Math.ceil(rows.length/pageSize));
    if(STATE.page>pages) STATE.page = pages;
    var start = (STATE.page-1)*pageSize;
    var pageRows = rows.slice(start, start+pageSize);

    var thead = $('#dataTable thead');
    thead.innerHTML = '<tr>'+cols.map(function(c){
      var arrow = STATE.sortCol===c.k ? (STATE.sortDir===1?' ▲':' ▼') : '';
      return '<th data-col="'+c.k+'">'+c.t+arrow+'</th>';
    }).join('')+'</tr>';
    $$('#dataTable thead th').forEach(function(th){
      th.onclick = function(){
        var col = th.getAttribute('data-col');
        if(STATE.sortCol===col) STATE.sortDir*=-1; else { STATE.sortCol=col; STATE.sortDir=1; }
        renderTable();
      };
    });

    var tbody = $('#dataTable tbody');
    if(!pageRows.length){
      tbody.innerHTML = '<tr><td colspan="'+cols.length+'" style="padding:24px;text-align:center;color:var(--muted)">No rows match the current filters.</td></tr>';
    } else {
      tbody.innerHTML = pageRows.map(function(r){
        return '<tr>'+cols.map(function(c){ return '<td>'+cell(r,c)+'</td>'; }).join('')+'</tr>';
      }).join('');
    }
    $('#rowCount').textContent = rows.length + ' rows';
    $('#pageInfo').textContent = 'Page '+STATE.page+' / '+pages;
    $('#prevPage').disabled = STATE.page<=1;
    $('#nextPage').disabled = STATE.page>=pages;
  }

  function cell(r,c){
    var v = r[c.k];
    if(c.badge){
      var ok = r.success===true || /success|ok|done|complete|active/i.test(String(v));
      var bad = /fail|error|blocked|missing|pending/i.test(String(v));
      var cls = ok?'ok':bad?'fail':'neutral';
      return '<span class="badge '+cls+'">'+escapeHtml(v||'—')+'</span>';
    }
    if(c.n) return fmt(v);
    if(c.k==='name' && r.url){ return '<a class="tlink" href="'+escapeHtml(r.url)+'" target="_blank" rel="noopener">'+escapeHtml(v||'')+'</a>'; }
    return escapeHtml(v==null?'':v);
  }

  /* ------------------------------ UI bind ------------------------------- */
  function bindUI(){
    $('#refreshBtn').onclick = function(){ loadData(false); checkSchema(); };
    $('#settingsBtn').onclick = openSettings;
    $('#reportBtn').onclick = function(){ $('#reportModal').classList.remove('hidden'); previewReport(); };
    $('#closeReport').onclick = function(){ $('#reportModal').classList.add('hidden'); };

    $('#fPlatform').onchange = onFilter('platform');
    $('#fStaff').onchange = onFilter('staff');
    $('#fStatus').onchange = onFilter('status');
    $('#fDate').onchange = onFilter('date');
    $('#fSort').onchange = function(){ STATE.filters.sort = this.value; STATE.sortCol=null; renderTable(); };
    $('#fSearch').oninput = debounce(function(){ STATE.filters.search = $('#fSearch').value; STATE.page=1; loadData(false); }, 450);
    $('#clearFilters').onclick = function(){
      STATE.filters = { platform:'all', staff:'all', date:'', status:'all', search:'', sort:'views' };
      $('#fPlatform').value='all'; $('#fStaff').value='all'; $('#fStatus').value='all'; $('#fDate').value=''; $('#fSearch').value=''; $('#fSort').value='views';
      STATE.page=1; STATE.sortCol=null; loadData(false);
    };

    $('#tableSearch').oninput = debounce(function(){ STATE.tableSearch = $('#tableSearch').value; STATE.page=1; renderTable(); }, 250);
    $$('#tableTabs button').forEach(function(b){
      b.onclick = function(){
        $$('#tableTabs button').forEach(function(x){ x.classList.remove('active'); });
        b.classList.add('active'); STATE.activeTable = b.getAttribute('data-t'); STATE.page=1; STATE.sortCol=null; renderTable();
      };
    });
    $('#prevPage').onclick = function(){ if(STATE.page>1){ STATE.page--; renderTable(); } };
    $('#nextPage').onclick = function(){ STATE.page++; renderTable(); };

    $$('#trendSeg button').forEach(function(b){
      b.onclick = function(){
        $$('#trendSeg button').forEach(function(x){x.classList.remove('active');}); b.classList.add('active');
        if(STATE.data) window.DashCharts.renderTrend(STATE.data, b.getAttribute('data-g'));
      };
    });

    $$('.rtype').forEach(function(b){
      b.onclick = function(){ $$('.rtype').forEach(function(x){x.classList.remove('active');}); b.classList.add('active'); STATE.reportType=b.getAttribute('data-r'); previewReport(); };
    });
    $('#downloadPdf').onclick = downloadPdf;
    $('#downloadCsv').onclick = downloadCsv;
  }

  function onFilter(key){ return function(){ STATE.filters[key] = this.value; STATE.page=1; loadData(false); }; }

  /* ----------------------------- reports -------------------------------- */
  function previewReport(){
    var box = $('#reportPreview'); box.innerHTML = '<div style="padding:30px;color:#64748b">Building preview…</div>';
    run('generateReport', [STATE.reportType, STATE.filters]).then(function(r){
      if(!r || r.ok===false){ box.innerHTML = '<div style="padding:24px;color:#b91c1c">Error: '+escapeHtml((r&&r.error)||'failed')+'</div>'; return; }
      box.innerHTML = r.html;
    }).catch(function(e){ box.innerHTML = '<div style="padding:24px;color:#b91c1c">'+escapeHtml(e.message)+'</div>'; });
  }
  function downloadPdf(){
    toast('Generating PDF…');
    run('exportReportPdf', [STATE.reportType, STATE.filters]).then(function(res){
      if(!res || res.ok===false){ toast('PDF failed: '+((res&&res.error)||''), true); return; }
      saveBase64(res.base64, res.filename, res.mime); toast('PDF downloaded');
    }).catch(function(e){ toast('PDF failed: '+e.message, true); });
  }
  function downloadCsv(){
    toast('Exporting CSV…');
    run('exportExcelData', [STATE.filters]).then(function(res){
      if(!res || res.ok===false){ toast('Export failed', true); return; }
      saveBase64(res.base64, res.filename, res.mime); toast('CSV downloaded');
    }).catch(function(e){ toast('Export failed: '+e.message, true); });
  }
  function saveBase64(b64, name, mime){
    var bytes = atob(b64); var arr = new Uint8Array(bytes.length);
    for(var i=0;i<bytes.length;i++) arr[i]=bytes.charCodeAt(i);
    var blob = new Blob([arr], {type:mime||'application/octet-stream'});
    var url = URL.createObjectURL(blob); var a=document.createElement('a');
    a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function openSettings(){
    // In the web app context, settings open in a new tab template-served fallback.
    if(google.script.host){ try { google.script.host.close(); } catch(e){} }
    toast('Open Settings from the Sheets menu: 📊 → Settings');
  }

  /* --------------------------- auto refresh ----------------------------- */
  function startAutoRefresh(){
    if(STATE.timer) clearInterval(STATE.timer);
    var ms = Math.max(15, STATE.refreshSeconds) * 1000;
    STATE.timer = setInterval(function(){ if(!document.hidden) loadData(false); }, ms);
  }

  /* ------------------------------ helpers ------------------------------- */
  function debounce(fn, ms){ var t; return function(){ var a=arguments,c=this; clearTimeout(t); t=setTimeout(function(){ fn.apply(c,a); }, ms); }; }
  function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function toast(msg, err){
    var t=$('#toast'); t.textContent=msg; t.className='toast show'+(err?' err':'');
    clearTimeout(t._h); t._h=setTimeout(function(){ t.className='toast hidden'; }, 3200);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
</script>
