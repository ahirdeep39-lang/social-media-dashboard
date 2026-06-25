/**
 * Code.gs
 * --------------------------------------------------------------------------
 * Main server controller for the Social Media Audit Dashboard.
 *  - onOpen()              : builds the Sheets menu
 *  - doGet()              : serves the web-app dashboard
 *  - getDashboardData()    : the single aggregation endpoint (cached)
 *  - getSchemaReport()     : runtime schema validation for the setup banner
 *  - report / export / settings endpoints
 * --------------------------------------------------------------------------
 */

/* ============================= MENU + UI ================================= */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Social Media Dashboard')
    .addItem('Open Dashboard', 'openDashboardSidebar')
    .addItem('Refresh Data', 'refreshNow')
    .addSeparator()
    .addItem('Generate Report', 'openReportDialog')
    .addItem('Export Report PDF', 'exportReportPdfFlow')
    .addItem('Export Data (Excel/CSV)', 'exportExcelFlow')
    .addSeparator()
    .addItem('Settings', 'openSettingsSidebar')
    .addToUi();
}

/** Serve the full-page web app. */
function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Dashboard');
  t.bootSettings = getSettings_();
  return t.evaluate()
    .setTitle('Social Media Audit Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** HTML partial include helper used by templates: <?!= include('Dashboard.css') ?> */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Opens the dashboard inside the Sheets UI as a wide sidebar. */
function openDashboardSidebar() {
  var t = HtmlService.createTemplateFromFile('Dashboard');
  t.bootSettings = getSettings_();
  var html = t.evaluate().setTitle('Social Media Dashboard');
  SpreadsheetApp.getUi().showSidebar(html);
}

function openSettingsSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('Dashboard Settings');
  SpreadsheetApp.getUi().showSidebar(html);
}

function openReportDialog() {
  var html = HtmlService.createHtmlOutputFromFile('Report')
    .setWidth(900).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Generate Report');
}

function refreshNow() {
  clearCache_();
  SpreadsheetApp.getActiveSpreadsheet().toast('Dashboard cache cleared. Reopen / refresh the dashboard.', 'Refreshed', 4);
}

/* ========================= SCHEMA VALIDATION ============================ */

/**
 * Runtime schema check. The dashboard shows this as a setup banner so you
 * never get a silent failure if a sheet/column is missing or misnamed.
 */
function getSchemaReport() {
  return safe_(function () {
    var allSheets = listAllSheetNames_();
    var acc = readSheetAsObjects_(CONFIG.SHEETS.ACCOUNTS, CONFIG.ACCOUNTS_FIELDS);
    var aud = readSheetAsObjects_(CONFIG.SHEETS.DAILY_AUDIT, CONFIG.DAILY_AUDIT_FIELDS);

    var problems = [];
    if (!acc.found) problems.push('Sheet "' + CONFIG.SHEETS.ACCOUNTS.name + '" not found.');
    if (!aud.found) problems.push('Sheet "' + CONFIG.SHEETS.DAILY_AUDIT.name + '" not found (scraper output). It can be created later.');

    // Only ID/Name + Platform are strictly required on Accounts.
    var accCritical = ['accountName', 'platform'];
    accCritical.forEach(function (f) {
      if (acc.found && acc.missing.indexOf(f) !== -1) {
        problems.push('Accounts is missing a column for "' + f + '" (aliases: ' + CONFIG.ACCOUNTS_FIELDS[f].join(', ') + ').');
      }
    });

    return {
      ok: problems.length === 0,
      problems: problems,
      allSheets: allSheets,
      accounts: { found: acc.found, sheetName: acc.sheetName, present: acc.present, missing: acc.missing, rowCount: acc.rows.length },
      dailyAudit: { found: aud.found, sheetName: aud.sheetName, present: aud.present, missing: aud.missing, rowCount: aud.rows.length }
    };
  });
}

/* ========================= MAIN AGGREGATION ============================= */

/**
 * Single endpoint the client calls. Applies filters, aggregates KPIs,
 * charts and tables. Heavily cached. Returns a JSON-safe object.
 *
 * @param {Object} filters {platform, staff, date, search, status, sort}
 */
function getDashboardData(filters) {
  filters = filters || {};
  var key = 'dash_payload_v1::' + JSON.stringify(filters) +
            '::' + (PropertiesService.getScriptProperties().getProperty(PROP_KEYS.SPREADSHEET_ID) || CONFIG.SPREADSHEET_ID);
  return safe_(function () {
    return cached_(key, CONFIG.CACHE_TTL_SECONDS, function () {
      return buildPayload_(filters);
    });
  });
}

function buildPayload_(filters) {
  var settings = getSettings_();
  var accRes = readSheetAsObjects_(CONFIG.SHEETS.ACCOUNTS, CONFIG.ACCOUNTS_FIELDS);
  var audRes = readSheetAsObjects_(CONFIG.SHEETS.DAILY_AUDIT, CONFIG.DAILY_AUDIT_FIELDS);

  var accounts = accRes.rows;
  var audits = audRes.rows;
  var tz = getTz_();
  var todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  // ---- normalize accounts ----
  accounts = accounts.map(function (a) {
    return {
      id: a.id != null && a.id !== '' ? String(a.id) : null,
      platform: a.platform ? String(a.platform).trim() : 'Unknown',
      name: a.accountName ? String(a.accountName).trim() : (a.id ? String(a.id) : 'Unnamed'),
      url: a.accountUrl ? String(a.accountUrl).trim() : '',
      staff: a.staff ? String(a.staff).trim() : 'Unassigned',
      target: toNumber_(a.dailyTarget),
      status: a.status ? String(a.status).trim() : ''
    };
  });

  // ---- normalize audits ----
  audits = audits.map(function (r) {
    var d = toDate_(r.timestamp);
    return {
      ts: d ? d.getTime() : 0,
      day: d ? dayKey_(d) : '',
      id: r.accountId != null && r.accountId !== '' ? String(r.accountId) : null,
      name: r.accountName ? String(r.accountName).trim() : '',
      platform: r.platform ? String(r.platform).trim() : '',
      staff: r.staff ? String(r.staff).trim() : '',
      url: r.accountUrl ? String(r.accountUrl).trim() : '',
      followers: toNumber_(r.followers),
      subscribers: toNumber_(r.subscribers),
      postsToday: toNumber_(r.postsToday),
      viewsToday: toNumber_(r.viewsToday),
      totalPosts: toNumber_(r.totalPosts),
      totalViews: toNumber_(r.totalViews),
      avgViews: toNumber_(r.avgViews),
      auditStatus: r.auditStatus ? String(r.auditStatus).trim() : '',
      success: !matchesTokens_(r.auditStatus, CONFIG.AUDIT_FAIL_TOKENS) &&
               (matchesTokens_(r.auditStatus, CONFIG.AUDIT_SUCCESS_TOKENS) || r.auditStatus === '')
    };
  }).filter(function (r) { return r.ts > 0 || r.name || r.id; });

  // ---- filter option lists (pre-filter, so dropdowns stay complete) ----
  var platformSet = {}, staffSet = {};
  accounts.forEach(function (a) { platformSet[a.platform] = 1; staffSet[a.staff] = 1; });
  audits.forEach(function (r) { if (r.platform) platformSet[r.platform] = 1; if (r.staff) staffSet[r.staff] = 1; });

  // ---- apply filters ----
  var fPlatform = filters.platform && filters.platform !== 'all' ? norm_(filters.platform) : null;
  var fStaff    = filters.staff && filters.staff !== 'all' ? norm_(filters.staff) : null;
  var fStatus   = filters.status && filters.status !== 'all' ? norm_(filters.status) : null;
  var fSearch   = filters.search ? norm_(filters.search) : null;
  var fDate     = filters.date ? String(filters.date) : null; // yyyy-MM-dd

  function accPass(a) {
    if (fPlatform && norm_(a.platform) !== fPlatform) return false;
    if (fStaff && norm_(a.staff) !== fStaff) return false;
    if (fStatus) {
      var isAudited = matchesTokens_(a.status, CONFIG.STATUS_AUDITED_TOKENS);
      if (fStatus === 'audited' && !isAudited) return false;
      if (fStatus === 'pending' && isAudited) return false;
    }
    if (fSearch && norm_(a.name).indexOf(fSearch) === -1 && norm_(a.platform).indexOf(fSearch) === -1 && norm_(a.staff).indexOf(fSearch) === -1) return false;
    return true;
  }
  function audPass(r) {
    if (fPlatform && norm_(r.platform) !== fPlatform) return false;
    if (fStaff && norm_(r.staff) !== fStaff) return false;
    if (fDate && r.day !== fDate) return false;
    if (fSearch && norm_(r.name).indexOf(fSearch) === -1 && norm_(r.platform).indexOf(fSearch) === -1 && norm_(r.staff).indexOf(fSearch) === -1) return false;
    return true;
  }

  var fAccounts = accounts.filter(accPass);
  var fAudits = audits.filter(audPass);

  // ---- latest snapshot per account (by id, else by name) ----
  var latest = {};
  fAudits.forEach(function (r) {
    var k = r.id || norm_(r.name);
    if (!k) return;
    if (!latest[k] || r.ts > latest[k].ts) latest[k] = r;
  });
  var latestList = Object.keys(latest).map(function (k) { return latest[k]; });

  // ---- KPIs ----
  var totalAccounts = fAccounts.length;
  var auditedAccounts = fAccounts.filter(function (a) {
    if (matchesTokens_(a.status, CONFIG.STATUS_AUDITED_TOKENS)) return true;
    var k = a.id || norm_(a.name);
    return latest[k] && latest[k].day === todayKey && latest[k].success;
  }).length;
  var pendingAccounts = Math.max(0, totalAccounts - auditedAccounts);

  var followers = sumBy_(latestList, 'followers');
  var subscribers = sumBy_(latestList, 'subscribers');
  var totalPostsLatest = sumBy_(latestList, 'totalPosts');

  var todayAudits = fAudits.filter(function (r) { return r.day === todayKey; });
  var postsToday = sumBy_(todayAudits, 'postsToday');
  var viewsToday = sumBy_(todayAudits, 'viewsToday');
  var avgViews = latestList.length ? Math.round(sumBy_(latestList, 'avgViews') / latestList.length) : 0;
  if (!avgViews && totalPostsLatest > 0) avgViews = Math.round(sumBy_(latestList, 'totalViews') / totalPostsLatest);

  var targetPosts = sumBy_(fAccounts, 'target');
  var completedPosts = postsToday;
  var completionPct = targetPosts > 0 ? Math.min(100, Math.round((completedPosts / targetPosts) * 100)) : 0;

  var successCount = todayAudits.filter(function (r) { return r.success; }).length;
  var auditSuccessRate = todayAudits.length ? Math.round((successCount / todayAudits.length) * 100) : 0;

  var lastAuditTs = 0;
  fAudits.forEach(function (r) { if (r.ts > lastAuditTs) lastAuditTs = r.ts; });
  var lastAuditTime = lastAuditTs ? Utilities.formatDate(new Date(lastAuditTs), tz, 'dd MMM yyyy, HH:mm') : '—';

  var kpis = {
    totalAccounts: totalAccounts,
    accountsAudited: auditedAccounts,
    pendingAccounts: pendingAccounts,
    followers: followers,
    subscribers: subscribers,
    postsToday: postsToday,
    viewsToday: viewsToday,
    averageViews: avgViews,
    totalPosts: totalPostsLatest,
    targetPosts: targetPosts,
    completedPosts: completedPosts,
    completionPct: completionPct,
    auditSuccessRate: auditSuccessRate,
    lastAuditTime: lastAuditTime
  };

  // ---- charts ----
  var byPlatform = groupAgg_(latestList, 'platform', ['followers', 'viewsToday', 'totalViews', 'postsToday', 'totalPosts']);
  var byStaff = groupAgg_(latestList, 'staff', ['followers', 'totalViews', 'postsToday', 'totalPosts']);

  var daily = timeSeries_(fAudits, tz, 'day');
  var weekly = timeSeries_(fAudits, tz, 'week');
  var monthly = timeSeries_(fAudits, tz, 'month');

  var ranked = latestList.slice().sort(function (a, b) { return b.totalViews - a.totalViews; });
  var topAccounts = ranked.slice(0, 10).map(viewRow_);
  var lowAccounts = ranked.slice().reverse().slice(0, 10).map(viewRow_);

  // Target achievement per staff
  var targetByStaff = {};
  fAccounts.forEach(function (a) {
    targetByStaff[a.staff] = targetByStaff[a.staff] || { target: 0, done: 0 };
    targetByStaff[a.staff].target += a.target;
  });
  todayAudits.forEach(function (r) {
    var s = r.staff || 'Unassigned';
    targetByStaff[s] = targetByStaff[s] || { target: 0, done: 0 };
    targetByStaff[s].done += r.postsToday;
  });

  var charts = {
    followersByPlatform: byPlatform.map(function (g) { return { label: g.key, value: g.followers }; }),
    viewsByPlatform:     byPlatform.map(function (g) { return { label: g.key, value: g.totalViews }; }),
    postsByPlatform:     byPlatform.map(function (g) { return { label: g.key, value: g.totalPosts }; }),
    staffPerformance:    byStaff.map(function (g) { return { label: g.key, posts: g.postsToday, views: g.totalViews }; }),
    dailyTrend:   daily,
    weeklyTrend:  weekly,
    monthlyTrend: monthly,
    topAccounts:  topAccounts.map(function (r) { return { label: r.name, value: r.views }; }),
    lowAccounts:  lowAccounts.map(function (r) { return { label: r.name, value: r.views }; }),
    followersGrowth: daily.map(function (p) { return { label: p.label, value: p.followers }; }),
    viewsGrowth:     daily.map(function (p) { return { label: p.label, value: p.views }; }),
    targetAchievement: Object.keys(targetByStaff).map(function (s) {
      var t = targetByStaff[s];
      return { label: s, target: t.target, done: t.done, pct: t.target ? Math.round((t.done / t.target) * 100) : 0 };
    }),
    auditProgress: { audited: auditedAccounts, pending: pendingAccounts }
  };

  // ---- tables ----
  var latestAuditTable = fAudits.slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 500).map(viewRow_);
  var failedAudits = fAudits.filter(function (r) { return !r.success; }).sort(function (a, b) { return b.ts - a.ts; }).slice(0, 500).map(viewRow_);
  var highestViews = ranked.slice(0, 200).map(viewRow_);
  var lowestViews = ranked.slice().reverse().slice(0, 200).map(viewRow_);

  // accounts with no posts today vs target > 0
  var postedToday = {};
  todayAudits.forEach(function (r) { var k = r.id || norm_(r.name); if (r.postsToday > 0) postedToday[k] = 1; });
  var missingPosts = fAccounts.filter(function (a) {
    var k = a.id || norm_(a.name);
    return a.target > 0 && !postedToday[k];
  }).map(accView_);

  // inactive = no audit in last 7 days
  var weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  var inactive = fAccounts.filter(function (a) {
    var k = a.id || norm_(a.name);
    return !latest[k] || latest[k].ts < weekAgo;
  }).map(accView_);

  var newestPosts = fAudits.filter(function (r) { return r.postsToday > 0; })
    .sort(function (a, b) { return b.ts - a.ts; }).slice(0, 200).map(viewRow_);

  var latestFollowers = latestList.slice().sort(function (a, b) { return b.followers - a.followers; }).slice(0, 200).map(viewRow_);

  var tables = {
    latestAudit: latestAuditTable,
    topAccounts: topAccounts,
    failedAudits: failedAudits,
    highestViews: highestViews,
    lowestViews: lowestViews,
    missingPosts: missingPosts,
    inactiveAccounts: inactive,
    newestPosts: newestPosts,
    latestFollowers: latestFollowers
  };

  return {
    ok: true,
    generatedAt: Utilities.formatDate(new Date(), tz, 'dd MMM yyyy, HH:mm:ss'),
    settings: settings,
    filterOptions: {
      platforms: Object.keys(platformSet).filter(Boolean).sort(),
      staff: Object.keys(staffSet).filter(Boolean).sort()
    },
    schemaOk: accRes.found && (accRes.missing.indexOf('accountName') === -1 || accRes.missing.indexOf('platform') === -1),
    kpis: kpis,
    charts: charts,
    tables: tables,
    counts: { accounts: accounts.length, audits: audits.length, filteredAccounts: fAccounts.length, filteredAudits: fAudits.length }
  };
}

/* ----------------------------- agg helpers ------------------------------ */

function sumBy_(arr, field) {
  var s = 0; for (var i = 0; i < arr.length; i++) s += toNumber_(arr[i][field]); return s;
}

function groupAgg_(arr, keyField, sumFields) {
  var map = {};
  arr.forEach(function (r) {
    var k = r[keyField] || 'Unknown';
    if (!map[k]) { map[k] = { key: k }; sumFields.forEach(function (f) { map[k][f] = 0; }); }
    sumFields.forEach(function (f) { map[k][f] += toNumber_(r[f]); });
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return (b[sumFields[0]] || 0) - (a[sumFields[0]] || 0); });
}

function timeSeries_(audits, tz, grain) {
  var buckets = {};
  audits.forEach(function (r) {
    if (!r.ts) return;
    var d = new Date(r.ts);
    var label;
    if (grain === 'day') label = Utilities.formatDate(d, tz, 'MM-dd');
    else if (grain === 'week') label = Utilities.formatDate(d, tz, "yyyy-'W'ww");
    else label = Utilities.formatDate(d, tz, 'yyyy-MM');
    if (!buckets[label]) buckets[label] = { label: label, posts: 0, views: 0, followers: 0, sort: r.ts };
    buckets[label].posts += r.postsToday;
    buckets[label].views += r.viewsToday;
    buckets[label].followers += r.followers;
    if (r.ts < buckets[label].sort) buckets[label].sort = r.ts;
  });
  return Object.keys(buckets).map(function (k) { return buckets[k]; })
    .sort(function (a, b) { return a.sort - b.sort; })
    .slice(-30);
}

function viewRow_(r) {
  return {
    timestamp: r.ts ? Utilities.formatDate(new Date(r.ts), getTz_(), 'dd MMM HH:mm') : '',
    name: r.name || r.id || '',
    platform: r.platform || '',
    staff: r.staff || '',
    followers: r.followers || 0,
    views: r.totalViews || 0,
    viewsToday: r.viewsToday || 0,
    posts: r.totalPosts || 0,
    postsToday: r.postsToday || 0,
    status: r.auditStatus || (r.success ? 'Success' : ''),
    success: !!r.success,
    url: r.url || ''
  };
}

function accView_(a) {
  return { name: a.name, platform: a.platform, staff: a.staff, target: a.target, status: a.status || '—', url: a.url };
}

/** Uniform error wrapper so the client always gets {ok:false,error} not a 500. */
function safe_(fn) {
  try { return fn(); }
  catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
}

/* ============================ SETTINGS API ============================== */

function apiGetSettings() { return safe_(getSettings_); }
function apiSaveSettings(obj) { return safe_(function () { return saveSettings_(obj); }); }
function apiClearCache() { return safe_(function () { clearCache_(); return { ok: true }; }); }

/* ============================ REPORTS + EXPORT =========================== */

/**
 * Build report HTML for a given type. Used by Report.html preview and by PDF export.
 * type: 'daily' | 'weekly' | 'monthly' | 'staff' | 'platform'
 */
function generateReport(type, filters) {
  return safe_(function () {
    var data = buildPayload_(filters || {});
    if (data.ok === false) return data;
    var s = getSettings_();
    var tz = getTz_();
    var now = Utilities.formatDate(new Date(), tz, 'dd MMM yyyy, HH:mm');
    var title = ({
      daily: 'Daily Audit Report', weekly: 'Weekly Performance Report',
      monthly: 'Monthly Performance Report', staff: 'Staff Performance Report',
      platform: 'Platform Performance Report'
    })[type] || 'Audit Report';

    var k = data.kpis;
    var kpiCards = [
      ['Total Accounts', k.totalAccounts], ['Audited', k.accountsAudited], ['Pending', k.pendingAccounts],
      ['Followers', fmtNum_(k.followers)], ['Subscribers', fmtNum_(k.subscribers)], ['Posts Today', k.postsToday],
      ['Views Today', fmtNum_(k.viewsToday)], ['Avg Views', fmtNum_(k.averageViews)], ['Total Posts', fmtNum_(k.totalPosts)],
      ['Target Posts', k.targetPosts], ['Completed', k.completedPosts], ['Completion %', k.completionPct + '%'],
      ['Audit Success', k.auditSuccessRate + '%'], ['Last Audit', k.lastAuditTime]
    ];

    var section = '';
    if (type === 'staff') section = reportTable_('Staff Performance', ['Staff', 'Posts Today', 'Total Views'],
      data.charts.staffPerformance.map(function (r) { return [r.label, r.posts, fmtNum_(r.views)]; }));
    else if (type === 'platform') section = reportTable_('Platform Performance', ['Platform', 'Followers', 'Total Views', 'Total Posts'],
      data.charts.followersByPlatform.map(function (r, i) {
        return [r.label, fmtNum_(r.value), fmtNum_((data.charts.viewsByPlatform[i] || {}).value || 0), fmtNum_((data.charts.postsByPlatform[i] || {}).value || 0)];
      }));
    else section = reportTable_('Top Performing Accounts', ['Account', 'Platform', 'Staff', 'Views', 'Followers'],
      data.tables.topAccounts.map(function (r) { return [r.name, r.platform, r.staff, fmtNum_(r.views), fmtNum_(r.followers)]; }));

    var failed = reportTable_('Failed Audits', ['Time', 'Account', 'Platform', 'Status'],
      data.tables.failedAudits.slice(0, 20).map(function (r) { return [r.timestamp, r.name, r.platform, r.status]; }));

    var html =
      '<div style="font-family:Inter,Arial,sans-serif;color:#0f172a;padding:24px;max-width:900px;margin:auto">' +
      '<div style="display:flex;align-items:center;gap:12px;border-bottom:3px solid ' + s.accent + ';padding-bottom:14px;margin-bottom:18px">' +
      (s.logoUrl ? '<img src="' + s.logoUrl + '" style="height:42px">' : '') +
      '<div><div style="font-size:22px;font-weight:800">' + escapeHtml_(s.companyName) + '</div>' +
      '<div style="font-size:13px;color:#475569">' + title + ' &middot; ' + now + '</div></div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">' +
      kpiCards.map(function (c) {
        return '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px">' +
          '<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em">' + c[0] + '</div>' +
          '<div style="font-size:18px;font-weight:700;margin-top:2px">' + c[1] + '</div></div>';
      }).join('') + '</div>' +
      section + failed +
      '<div style="margin-top:24px;font-size:11px;color:#94a3b8;text-align:center">Generated by Social Media Audit Dashboard</div>' +
      '</div>';

    return { ok: true, html: html, title: title };
  });
}

function reportTable_(title, headers, rows) {
  var th = headers.map(function (h) { return '<th style="text-align:left;padding:8px 10px;background:#f1f5f9;font-size:12px;color:#334155">' + h + '</th>'; }).join('');
  var tr = rows.map(function (r) {
    return '<tr>' + r.map(function (c) { return '<td style="padding:7px 10px;border-bottom:1px solid #eef2f7;font-size:12px">' + escapeHtml_(String(c)) + '</td>'; }).join('') + '</tr>';
  }).join('');
  return '<h3 style="font-size:15px;margin:18px 0 8px">' + title + '</h3>' +
    '<table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden"><thead><tr>' + th + '</tr></thead><tbody>' +
    (tr || '<tr><td style="padding:8px;color:#94a3b8">No data</td></tr>') + '</tbody></table>';
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

/** Returns a base64 PDF + filename for client-side download. */
function exportReportPdf(type, filters) {
  return safe_(function () {
    var rep = generateReport(type, filters);
    if (rep.ok === false) return rep;
    var blob = HtmlService.createHtmlOutput(rep.html).getBlob().getAs('application/pdf')
      .setName(rep.title.replace(/\s+/g, '_') + '_' + Utilities.formatDate(new Date(), getTz_(), 'yyyyMMdd_HHmm') + '.pdf');
    return { ok: true, base64: Utilities.base64Encode(blob.getBytes()), filename: blob.getName(), mime: 'application/pdf' };
  });
}

/** Returns base64 CSV (Excel-compatible) of the latest-audit table. */
function exportExcelData(filters) {
  return safe_(function () {
    var data = buildPayload_(filters || {});
    if (data.ok === false) return data;
    var rows = data.tables.latestAudit;
    var headers = ['Timestamp', 'Account', 'Platform', 'Staff', 'Followers', 'Total Views', 'Views Today', 'Total Posts', 'Posts Today', 'Status'];
    var csv = headers.join(',') + '\n' + rows.map(function (r) {
      return [r.timestamp, r.name, r.platform, r.staff, r.followers, r.views, r.viewsToday, r.posts, r.postsToday, r.status]
        .map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    var blob = Utilities.newBlob(csv, 'text/csv', 'audit_export_' + Utilities.formatDate(new Date(), getTz_(), 'yyyyMMdd_HHmm') + '.csv');
    return { ok: true, base64: Utilities.base64Encode(blob.getBytes()), filename: blob.getName(), mime: 'text/csv' };
  });
}

/* ---- menu-driven flows (save to Drive + notify) ---- */

function exportReportPdfFlow() {
  var rep = generateReport('daily', {});
  if (rep.ok === false) { SpreadsheetApp.getUi().alert('Error: ' + rep.error); return; }
  var blob = HtmlService.createHtmlOutput(rep.html).getBlob().getAs('application/pdf')
    .setName(rep.title.replace(/\s+/g, '_') + '.pdf');
  var file = DriveApp.createFile(blob);
  SpreadsheetApp.getUi().alert('PDF saved to your Drive:\n' + file.getUrl());
}

function exportExcelFlow() {
  var res = exportExcelData({});
  if (res.ok === false) { SpreadsheetApp.getUi().alert('Error: ' + res.error); return; }
  var blob = Utilities.newBlob(Utilities.base64Decode(res.base64), res.mime, res.filename);
  var file = DriveApp.createFile(blob);
  SpreadsheetApp.getUi().alert('CSV saved to your Drive:\n' + file.getUrl());
}
