export const IPC = {
  // System cleaner
  SYSTEM_SCAN: 'cleaner:system:scan',
  SYSTEM_CLEAN: 'cleaner:system:clean',

  // Browser cleaner
  BROWSER_SCAN: 'cleaner:browser:scan',
  BROWSER_CLEAN: 'cleaner:browser:clean',

  // App cleaner
  APP_SCAN: 'cleaner:app:scan',
  APP_CLEAN: 'cleaner:app:clean',

  // Gaming cleaner
  GAMING_SCAN: 'cleaner:gaming:scan',
  GAMING_CLEAN: 'cleaner:gaming:clean',

  // Recycle bin
  RECYCLE_BIN_SCAN: 'cleaner:recyclebin:scan',
  RECYCLE_BIN_CLEAN: 'cleaner:recyclebin:clean',

  // Registry
  REGISTRY_SCAN: 'cleaner:registry:scan',
  REGISTRY_FIX: 'cleaner:registry:fix',

  // Startup
  STARTUP_LIST: 'startup:list',
  STARTUP_TOGGLE: 'startup:toggle',
  STARTUP_DELETE: 'startup:delete',
  STARTUP_BOOT_TRACE: 'startup:boot-trace',

  // Debloater
  DEBLOATER_SCAN: 'debloater:scan',
  DEBLOATER_REMOVE: 'debloater:remove',
  DEBLOATER_REMOVE_PROGRESS: 'debloater:remove:progress',

  // Disk analyzer
  DISK_ANALYZE: 'disk:analyze',
  DISK_DRIVES: 'disk:drives',

  // Network cleanup
  NETWORK_SCAN: 'cleaner:network:scan',
  NETWORK_CLEAN: 'cleaner:network:clean',

  // Progress events (main -> renderer)
  SCAN_PROGRESS: 'scan:progress',
  REGISTRY_FIX_PROGRESS: 'registry:fix:progress',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // System
  ELEVATION_CHECK: 'elevation:check',

  // Scheduled scans
  SCHEDULE_NEXT_SCAN: 'schedule:next-scan',
  SCHEDULE_SCAN_TRIGGER: 'schedule:scan-trigger',
  SCHEDULE_SCAN_COMPLETE: 'schedule:scan-complete',

  // Settings apply (renderer -> main, fire-and-forget)
  SETTINGS_APPLY_STARTUP: 'settings:apply-startup',
  SETTINGS_APPLY_TRAY: 'settings:apply-tray',

  // Scan history
  HISTORY_GET: 'history:get',
  HISTORY_ADD: 'history:add',
  HISTORY_CLEAR: 'history:clear',

  // Window controls
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
} as const
