// The preload bridge, replaced by one that records instead of acting.
//
// Two of the app's surfaces only exist when `window.auftakt` does — the update card (WP-60) and
// the diagnostics half of the feedback dialog (WP-54) — and neither may be driven for real: the
// real `saveDiagnostics` writes a file to the desktop of whoever runs this, and the real
// `installUpdate` downloads a release. So the preload bridge is replaced by one that **records**
// instead — which is also the instrument for WP-66's promise that nothing opens by itself: a call
// that no longer happens is a recorder that stays empty.
//
// Ported from `~/.claude/tools/playwright/lib/drive.mjs` rather than imported: that module is the
// ad-hoc runtime's, it imports `playwright` (this gate has only `playwright-core`) and it points at
// :4317. The pattern is the shared part and it stays documented there; this is its committed copy.

/**
 * Install the recording bridge. Must run before the first navigation — see `open`'s `prepare`.
 *
 * `opts.platform` and the two update answers are parameters because the card branches on them and
 * each branch fails *silently* on the wrong value: without `canInstall` the „Herunterladen &
 * installieren" button is simply not in the DOM and the click waits out its timeout.
 *
 * @param {import('playwright-core').Page} page
 * @param {{ platform?: string, silent?: unknown, manual?: unknown }} opts
 */
export const stubElectron = (page, opts = {}) =>
  page.addInitScript((o) => {
    const w = /** @type {any} */ (window);
    // Recorders, not spies: a `mailto:` is fire-and-forget, so the URL handed to `openExternal`
    // is the only observable the feedback dialog produces at all.
    w.__external = [];
    w.__saved = [];
    // The runtime log's renderer half (WP-69e). Recorded rather than dropped for the same
    // reason as the two above — a call that no longer happens has to be observable — and
    // because a case that ends with lines in here is a case that hit an error it never
    // asserted on. Nothing drives it: every non-Electron case already runs without a bridge
    // at all, which is the degradation that matters.
    w.__logged = [];
    // Replaced by the real subscriber and the real resolver as soon as the update card mounts and
    // its button is clicked; no-ops until then, so a script may call them unconditionally.
    w.__updateProgress = () => {};
    w.__finishUpdate = () => {};
    // Off by default: every save answers at once unless a case asks to hold one open.
    w.__holdSave = false;
    w.__finishSave = () => {};
    w.auftakt = {
      exportDatabase() {},
      importDatabase() {},
      chooseBackupDir() {},
      openExternal(url) {
        w.__external.push(url);
      },
      logEvent(payload) {
        w.__logged.push(payload);
      },
      getVersion: () => Promise.resolve('0.0.0-test'),
      // `refresh` is the card's own distinction: false is the cached silent startup check it
      // reads on mount, true the one „Nach Updates suchen" asks for.
      checkForUpdates: (refresh) => Promise.resolve((refresh ? o.manual : o.silent) ?? null),
      // The percentage is *pushed* from main, so a bridge whose members only answer questions
      // leaves the card frozen in its first frame — which is exactly the frame the WP-60 defect
      // left it in for ever, i.e. a stub that cannot drive this proves nothing about the fix.
      installUpdate: () =>
        new Promise((resolve) => {
          w.__finishUpdate = resolve;
        }),
      onUpdateProgress: (cb) => {
        w.__updateProgress = cb;
        return () => {
          w.__updateProgress = () => {};
        };
      },
      getDiagnostics: () =>
        Promise.resolve({
          summary:
            'Startdiagnose — 2 Einträge (Zeit in UTC):\n' +
            '2026-08-11 12:00 · v0.0.0-test · play/done · bereit 420 · Ende 2100 ms\n' +
            '2026-08-11 12:03 · v0.0.0-test · cross/abort:hitch · bereit 430 · Ende 1800 ms',
          hasLog: true,
          file: '/tmp/Auftakt/app-log.jsonl',
          system: 'macOS 15.6 · 1728×1117 @2×',
        }),
      // Two things the naive stub got wrong and the dialog depends on (WP-66). It **emulates
      // `uniqueBundleName`**: main never overwrites a bundle already lying on the desktop, so
      // the second save of one reference comes back `…-2.txt` — a stub that always answers
      // `…​.txt` makes the one name the handover must not predict indistinguishable from the
      // one it may. And it can be **held**, like `installUpdate`: with `__holdSave` set the
      // promise parks until `__finishSave()`, which is the only way to observe that „Bericht
      // speichern" waits for the write instead of opening a handover naming a guess.
      saveDiagnostics: (ref, report) => {
        w.__saved.push({ ref, report });
        const n = w.__saved.filter((s) => s.ref === ref).length;
        const name = `Auftakt-Diagnose-${ref}${n > 1 ? `-${n}` : ''}.txt`;
        if (!w.__holdSave) return Promise.resolve({ ok: true, name });
        return new Promise((resolve) => {
          w.__finishSave = () => resolve({ ok: true, name });
        });
      },
      bootSettled: () => Promise.resolve(),
      onBackupConfigChanged: () => () => {},
      platform: o.platform ?? 'darwin',
    };
  }, opts);
