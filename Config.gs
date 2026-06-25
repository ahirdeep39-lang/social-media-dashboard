/**
 * Config.gs
 * --------------------------------------------------------------------------
 * Central configuration for the Social Media Audit Dashboard.
 *
 * IMPORTANT: This is the ONE file you may need to edit to match your sheet.
 * Column names are matched by ALIAS (header text), not by position, so your
 * real headers can differ from the defaults. Add your real header spellings
 * to the relevant alias arrays below and everything else adapts automatically.
 * --------------------------------------------------------------------------
 */

var CONFIG = {

  // Your spreadsheet. Can be overridden at runtime in Settings (stored in
  // Script Properties under key 'SPREADSHEET_ID').
  SPREADSHEET_ID: '1OrKj45rYI7wL0dtc8XIIiu4kcu3pmc1wmnW6xgU0P6c',

  // Canonical sheet names. If your tabs are named differently, the resolver
  // in Utilities.gs will also try these aliases (case-insensitive).
  SHEETS: {
    ACCOUNTS:    { name: 'Accounts',    aliases: ['Accounts', 'Account', 'Master', 'Account List'] },
    DAILY_AUDIT: { name: 'Daily Audit', aliases: ['Daily Audit', 'DailyAudit', 'Audit', 'Audit Log', 'Scrape', 'Data'] },
    SETTINGS:    { name: 'Settings',    aliases: ['Settings', 'Config'] }
  },

  // Logical field  ->  acceptable header spellings (first match wins).
  // Header matching is case-insensitive and trims whitespace.
  ACCOUNTS_FIELDS: {
    id:          ['ID', 'Id', 'Account ID', 'AccountId', 'No'],
    platform:    ['Platform', 'Channel', 'Network'],
    accountName: ['Account Name', 'Name', 'Account', 'Handle', 'Page Name'],
    accountUrl:  ['Account URL', 'URL', 'Profile URL', 'Link', 'Page URL', 'Account Link'],
    staff:       ['Staff', 'Assigned', 'Owner', 'Assigned To', 'Manager'],
    dailyTarget: ['Daily Target', 'Target', 'Target Posts', 'Goal', 'Daily Goal'],
    status:      ['Status', 'Audit Status', 'State']
  },

  DAILY_AUDIT_FIELDS: {
    timestamp:   ['Timestamp', 'Date', 'Audit Time', 'DateTime', 'Scraped At', 'Time'],
    accountId:   ['ID', 'Account ID', 'AccountId'],
    accountName: ['Account Name', 'Name', 'Account', 'Handle'],
    platform:    ['Platform', 'Channel', 'Network'],
    accountUrl:  ['Account URL', 'URL', 'Profile URL', 'Link'],
    staff:       ['Staff', 'Assigned', 'Owner'],
    followers:   ['Followers', 'Follower Count', 'Followers Count'],
    subscribers: ['Subscribers', 'Subscriber Count', 'Subs'],
    postsToday:  ['Posts Today', 'Daily Posts', 'New Posts', "Today's Posts"],
    viewsToday:  ['Views Today', 'Daily Views', "Today's Views"],
    totalPosts:  ['Total Posts', 'Posts', 'Post Count'],
    totalViews:  ['Total Views', 'Views', 'View Count'],
    avgViews:    ['Average Views', 'Avg Views', 'Avg. Views'],
    auditStatus: ['Audit Status', 'Result', 'Scrape Status', 'Outcome', 'Status']
  },

  // Values that count as a "successful" audit (case-insensitive, contains).
  AUDIT_SUCCESS_TOKENS: ['success', 'ok', 'done', 'audited', 'complete', 'pass'],
  AUDIT_FAIL_TOKENS:    ['fail', 'error', 'blocked', 'missing', 'pending', 'timeout'],

  // Account.Status values that count as "audited" vs "pending".
  STATUS_AUDITED_TOKENS: ['audited', 'done', 'complete', 'active', 'ok'],
  STATUS_PENDING_TOKENS: ['pending', 'queued', 'new', 'waiting', 'not audited'],

  // Server-side cache (CacheService) lifetime in seconds. Keeps the dashboard
  // fast for 500+ accounts without hammering the Sheet on every refresh.
  CACHE_TTL_SECONDS: 45,

  // Default user-facing settings (overridable in the Settings sidebar; stored
  // per-installation in Script Properties).
  DEFAULTS: {
    THEME: 'dark',
    AUTO_REFRESH_SECONDS: 60,
    COMPANY_NAME: 'Social Media Audit',
    LOGO_URL: '',
    ACCENT: '#6366f1',
    ACCENT_2: '#22d3ee',
    PAGE_SIZE: 25
  }
};

/** Property keys used with PropertiesService. */
var PROP_KEYS = {
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  THEME: 'THEME',
  AUTO_REFRESH_SECONDS: 'AUTO_REFRESH_SECONDS',
  COMPANY_NAME: 'COMPANY_NAME',
  LOGO_URL: 'LOGO_URL',
  ACCENT: 'ACCENT',
  ACCENT_2: 'ACCENT_2',
  PAGE_SIZE: 'PAGE_SIZE'
};
