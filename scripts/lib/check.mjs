/**
 * The assertion counter every gate keeps.
 *
 * `check(name, ok, detail)` is the whole vocabulary of the six `check:*` scripts: one line per
 * assertion, a running failure count, and an exit code read off that count at the end. It sat in
 * all six files as the same five lines, which is fine until the sixth one drifts — `check-boot.mjs`
 * arrived counting `checks` as well as `failures`, and the three older gates did not, so „627
 * Prüfungen" was a property of some gates and not others for no reason anybody chose.
 *
 * The counters are returned as an object rather than as two numbers because a gate reads them at
 * the very end, long after the last `check()` call has mutated them; a destructured `failures`
 * would be a snapshot of zero.
 */

/**
 * The two markers a gate prints. Both shapes predate this module and both are preserved
 * byte-for-byte: `check-api`, `check-dates` and `check-package` right-align the word inside a
 * four-character field („`  FAIL name`"), the other three pad it („` FAIL  name`"). Nothing reads
 * these lines mechanically, but they are what a person scans a failed run for, and changing the
 * shape of three gates' output is not what this extraction is for.
 */
export const MARKERS = {
  /** `check-backup`, `check-browser`, `check-boot`. */
  padded: { ok: '  ok  ', fail: ' FAIL ' },
  /** `check-api`, `check-dates`, `check-package`. */
  narrow: { ok: '  ok  ', fail: '  FAIL' },
};

/**
 * @param {{ ok: string, fail: string }} [markers] which of `MARKERS` to print with
 * @returns {{
 *   check: (name: string, ok: unknown, detail?: string) => boolean,
 *   count: { failures: number, checks: number },
 * }}
 */
export function createCheck(markers = MARKERS.padded) {
  const count = { failures: 0, checks: 0 };
  /**
   * One assertion. Returns its own verdict, so a case can branch on it without asserting twice —
   * `if (!check('the fixture is there', …)) return;`.
   */
  function check(name, ok, detail = '') {
    count.checks++;
    console.log(`${ok ? markers.ok : markers.fail} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) count.failures++;
    return Boolean(ok);
  }
  return { check, count };
}
