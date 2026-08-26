/**
 * The run's bookkeeping, in a module of its own because every case file has to count into the
 * same totals.
 *
 * ES modules are singletons, so `check` imported from fifteen scenario files is one closure over
 * one counter — which is the whole reason the split below could keep „✓ alles ok (… Prüfungen)"
 * meaning what it meant when every assertion — 627 on the day of the split — sat in one file.
 */
import { createCheck } from '../lib/check.mjs';

export const { check, count } = createCheck();
