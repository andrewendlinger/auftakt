/**
 * Moved into `appLog.ts` (WP-69a), which holds the boot log and the runtime log in one file.
 * This shim only carries the names `main.ts` and `diagnostics.ts` still import; WP-69b moves
 * those imports and deletes it.
 */
export {
  BOOT_LOG_NAME,
  BOOT_REPORT_MAX_CHARS,
  bootDiagnostics,
  writeBootReport,
  type BootDiagnostics,
} from './appLog';
