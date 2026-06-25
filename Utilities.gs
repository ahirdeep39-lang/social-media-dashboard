/**
 * Utilities.gs
 * --------------------------------------------------------------------------
 * Read-only data access layer + helpers.
 *
 * Design rules:
 *  - NEVER writes to source sheets except the optional Settings sheet/properties.
 *  - Resolves sheets and columns by alias so it adapts to the real workbook.
 *  - Caches expensive reads in CacheService for speed at scale.
 * --------------------------------------------------------------------------
 */

/** Returns the active spreadsheet (respects a runtime override). */
function getSpreadsheet_() {
  var overrideId = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.SPREADSHEET_ID);
  var id = overrideId || CONFIG.SPREADSHEET_ID;
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Cannot open spreadsheet "' + id + '". Check the ID in Settings and that this script has access. (' + e.message + ')');
  }
}

/** Case-insensitive trimmed compare helper. */
function norm_(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

/** Resolve a sheet by its configured name + aliases. Returns null if absent. */
function resolveSheet_(sheetDef) {
  var ss = getSpreadsheet_();
  var sheets = ss.getSheets();
  var wanted = [sheetDef.name].concat(sheetDef.aliases || []).map(norm_);
  for (var i = 0; i < sheets.length; i++) {
    if (wanted.indexOf(norm_(sheets[i].getName())) !== -1) return sheets[i];
  }
  return null;
}

/** List all sheet names in the workbook (for the schema/setup screen). */
function listAllSheetNames_() {
  return getSpreadsheet_().getSheets().map(function (s) { return s.getName(); });
}

/**
 * Build a header -> column index map (0-based) from a header row.
 * Returns { byHeader: {normHeader: idx}, headers: [...] }.
 */
function buildHeaderMap_(headerRow) {
  var byHeader = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = norm_(headerRow[i]);
    if (h && byHeader[h] === undefined) byHeader[h] = i;
  }
  return { byHeader: byHeader, headers: headerRow };
}

/** Given a header map and a list of aliases, return the matched column index or -1. */
function findCol_(headerMap, aliases) {
  for (var i = 0; i < aliases.length; i++) {
    var idx = headerMap.byHeader[norm_(aliases[i])];
    if (idx !== undefined) return idx;
  }
  return -1;
}

/**
 * Read a sheet into an array of plain objects keyed by LOGICAL field names,
 * using the alias map. Unknown/missing fields resolve to null but never throw.
 *
 * @param {Object} sheetDef  one of CONFIG.SHEETS.*
 * @param {Object} fieldMap  logicalName -> [aliases]
 * @return {{rows: Object[], missing: string[], present: string[], found: boolean, sheetName: string}}
 */
function readSheetAsObjects_(sheetDef, fieldMap) {
  var sheet = resolveSheet_(sheetDef);
  if (!sheet) {
    return { rows: [], missing: Object.keys(fieldMap), present: [], found: false, sheetName: sheetDef.name };
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    return { rows: [], missing: Object.keys(fieldMap), present: [], found: true, sheetName: sheet.getName() };
  }

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headerMap = buildHeaderMap_(values[0]);

  // Resolve each logical field to a column index.
  var colIndex = {};
  var present = [];
  var missing = [];
  Object.keys(fieldMap).forEach(function (logical) {
    var idx = findCol_(headerMap, fieldMap[logical]);
    colIndex[logical] = idx;
    if (idx === -1) missing.push(logical); else present.push(logical);
  });

  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var raw = values[r];
    // Skip fully empty rows.
    var empty = raw.every(function (c) { return c === '' || c === null; });
    if (empty) continue;

    var obj = { _row: r + 1 };
    Object.keys(colIndex).forEach(function (logical) {
      var idx = colIndex[logical];
      obj[logical] = idx === -1 ? null : raw[idx];
    });
    rows.push(obj);
  }

  return { rows: rows, missing: missing, present: present, found: true, sheetName: sheet.getName() };
}

/* ----------------------------- value parsing ----------------------------- */

/** Parse a number that might be "1,234", "1.2K", "3.4M", "—", etc. */
function toNumber_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  var s = String(v).trim().replace(/,/g, '').toLowerCase();
  if (s === '' || s === '-' || s === '—' || s === 'n/a' || s === 'na') return 0;
  var mult = 1;
  if (/k$/.test(s)) { mult = 1e3; s = s.slice(0, -1); }
  else if (/m$/.test(s)) { mult = 1e6; s = s.slice(0, -1); }
  else if (/b$/.test(s)) { mult = 1e9; s = s.slice(0, -1); }
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n * mult;
}

/** Coerce a cell to a Date if possible, else null. */
function toDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (v === null || v === undefined || v === '') return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Timezone-aware yyyy-MM-dd for a date. */
function dayKey_(d) {
  if (!d) return '';
  return Utilities.formatDate(d, getTz_(), 'yyyy-MM-dd');
}

function getTz_() {
  try { return getSpreadsheet_().getSpreadsheetTimeZone() || Session.getScriptTimeZone(); }
  catch (e) { return Session.getScriptTimeZone() || 'UTC'; }
}

/** True if a status/result string matches any token in the list. */
function matchesTokens_(value, tokens) {
  var s = norm_(value);
  if (!s) return false;
  for (var i = 0; i < tokens.length; i++) {
    if (s.indexOf(tokens[i]) !== -1) return true;
  }
  return false;
}

/* ------------------------------- caching --------------------------------- */

function getCache_() { return CacheService.getScriptCache(); }

/** Get JSON from cache or compute+store it. */
function cached_(key, ttl, computeFn) {
  var cache = getCache_();
  try {
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* fall through to recompute */ }
  var val = computeFn();
  try {
    var str = JSON.stringify(val);
    // CacheService rejects values > 100KB; only cache if it fits.
    if (str.length < 95000) cache.put(key, str, ttl);
  } catch (e) { /* skip caching large payloads */ }
  return val;
}

function clearCache_() {
  try { getCache_().removeAll(['dash_payload_v1']); } catch (e) {}
}

/* ------------------------------ settings --------------------------------- */

/** Read effective settings (Script Properties override CONFIG.DEFAULTS). */
function getSettings_() {
  var p = PropertiesService.getScriptProperties();
  return {
    theme: p.getProperty(PROP_KEYS.THEME) || CONFIG.DEFAULTS.THEME,
    autoRefreshSeconds: toNumber_(p.getProperty(PROP_KEYS.AUTO_REFRESH_SECONDS)) || CONFIG.DEFAULTS.AUTO_REFRESH_SECONDS,
    spreadsheetId: p.getProperty(PROP_KEYS.SPREADSHEET_ID) || CONFIG.SPREADSHEET_ID,
    companyName: p.getProperty(PROP_KEYS.COMPANY_NAME) || CONFIG.DEFAULTS.COMPANY_NAME,
    logoUrl: p.getProperty(PROP_KEYS.LOGO_URL) || CONFIG.DEFAULTS.LOGO_URL,
    accent: p.getProperty(PROP_KEYS.ACCENT) || CONFIG.DEFAULTS.ACCENT,
    accent2: p.getProperty(PROP_KEYS.ACCENT_2) || CONFIG.DEFAULTS.ACCENT_2,
    pageSize: toNumber_(p.getProperty(PROP_KEYS.PAGE_SIZE)) || CONFIG.DEFAULTS.PAGE_SIZE
  };
}

/** Persist settings from the sidebar. Only writes provided keys. */
function saveSettings_(obj) {
  var p = PropertiesService.getScriptProperties();
  var map = {
    THEME: obj.theme,
    AUTO_REFRESH_SECONDS: obj.autoRefreshSeconds,
    SPREADSHEET_ID: obj.spreadsheetId,
    COMPANY_NAME: obj.companyName,
    LOGO_URL: obj.logoUrl,
    ACCENT: obj.accent,
    ACCENT_2: obj.accent2,
    PAGE_SIZE: obj.pageSize
  };
  Object.keys(map).forEach(function (k) {
    if (map[k] !== undefined && map[k] !== null && map[k] !== '') {
      p.setProperty(k, String(map[k]));
    }
  });
  clearCache_();
  return getSettings_();
}

/** Human-friendly number formatting for server-rendered reports. */
function fmtNum_(n) {
  n = toNumber_(n);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
