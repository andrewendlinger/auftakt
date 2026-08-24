/** V · the announcement overlay (WP-63) */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from '../../lib/wait.mjs';
import { WIDE, gone, open, ready, shown, until, windows } from '../browser.mjs';
import { UI, root } from '../config.mjs';
import { check } from '../report.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runAnnouncements(fixtures) {
  const { browser, context } = fixtures;
  // ======================================================================== V · announcements
  //
  // The announcement overlay (WP-63) — the only surface in the app that decides for itself
  // whether to exist, and the only one whose *absence* the other 250 assertions here depend on.
  // A full-screen `z-[60]` layer appearing unbidden would swallow every click in this gate, so
  // „inert without a payload" is asserted first and asserted again at the end, after the case has
  // installed one and taken it away.
  //
  // **The negatives are waits, not counts.** `ready()` resolves on `html[data-app-ready]`, which
  // `BootReady` also sets from an unconditional budget, so the feed request may still be in
  // flight; a `count() === 0` taken there passes against an overlay that is one round trip from
  // appearing — which is the failure this case exists to catch. `shown(…, 2000)` gives it a real
  // chance to turn up and then reports that it did not.
  //
  // The payload is hand-written into `.demo/seasons.json`, exactly the way a real dated
  // announcement is installed: nothing writes that key, there is no UI behind it, and there is
  // deliberately no fixture in `server/src/demo.ts` — a card in front of every `npm run demo`
  // would be in the way of every other visual check.
  //
  // Two contexts, and the second one is the point. Everything here runs at
  // `reducedMotion: 'reduce'` (the boot gesture's documented escape hatch), which is also the
  // branch that must render the card *without* a canvas — so the default context asserts the
  // reduced-motion variant for free. The fireworks themselves only exist at
  // `no-preference`, and „a canvas element is in the DOM" is not the assertion worth having:
  // this gate exists for the defects that appear only once something is laid out, and a canvas
  // loop that never paints is exactly one of them. So the pixels are read back.
  console.log('\nV · Ankündigungen (WP-63)');
  const registryPath = join(root, '.demo', 'seasons.json');
  const readReg = () => JSON.parse(readFileSync(registryPath, 'utf8'));
  /**
   * Hand-install into the registry, the way the one real payload is installed — and **atomically**,
   * the way the server writes the same file (`saveRegistry`, tmp + rename).
   *
   * A plain `writeFileSync` truncates the file before it fills it, so there is a window in which
   * `seasons.json` is empty on disk. The server re-reads it on *every* request, and `readRegistry`
   * treats a parse failure as corruption: it renames the file aside and bootstraps a fresh
   * registry holding one season. With four pages refetching against a demo whose season list is
   * the run's whole fixture set, that window is wide enough to hit — once in six runs here, as a
   * burst of 410s in the case *after* this one, every copied season of the run gone with it. The
   * rename is the only part of this the filesystem promises to do in one step.
   *
   * The suffix is **not** the server's. `saveRegistry` stages through `seasons.json.tmp`, and this
   * case's own clicks make the server write that file (the „Alles klar" marker) while these writes
   * are going on — two writers sharing one staging path either promote interleaved bytes or lose
   * the race to the other's rename with an ENOENT out of the try. A private name is the whole cost
   * of not having to reason about that.
   */
  const writeReg = (fn) => {
    const reg = readReg();
    fn(reg);
    const staged = `${registryPath}.tmp-check`;
    writeFileSync(staged, JSON.stringify(reg, null, 2));
    renameSync(staged, registryPath);
  };
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const overlay = (page) => page.locator('[data-announcement]');

  const v0 = await open(context);
  check('ohne Payload zeigt die Demo keine Ankündigung', !(await shown(overlay(v0), 2000)));
  await v0.close();

  // A neutral fixture, dated today. `celebrate` is set here and read in both contexts below.
  writeReg((reg) => {
    reg.announcements = [
      { id: 'testfest', title: 'Testfest', body: 'Eine Zeile.\n\nGrüße', date: TODAY.slice(5), celebrate: true },
    ];
  });

  const v1 = await open(context);
  check('ein datierter Payload erscheint beim Start', await shown(overlay(v1).first()));
  check('…mit seinem Titel', (await v1.locator('#announcement-title').textContent()) === 'Testfest');
  // The last paragraph is set apart as a sign-off — smaller, warm gold — and the lead must not
  // still carry it. Two locators, because „the body contains both" would pass on one block.
  check(
    '…der letzte Absatz steht abgesetzt als Signatur',
    (await v1.locator('.announcement-signoff').textContent())?.trim() === 'Grüße',
  );
  check(
    '…und der Fließtext trägt ihn nicht noch einmal',
    (await v1.locator('.announcement-body').textContent())?.trim() === 'Eine Zeile.',
  );
  // The reduced-motion branch, asserted as a *pair* rather than as an absence: the same payload
  // in the `no-preference` context below must produce a canvas, so a count of 0 here is only half
  // the claim. The other half is the scrimAlphaOf — the two branches pick different colours, and without
  // the fireworks the darker one reads as a defect (the agreed values are 0.80 against 0.86).
  check('…ohne Feuerwerk, weil das Fenster reduzierte Bewegung meldet', !(await shown(v1.locator('[data-announcement] canvas'), 1000)));
  const scrimAlphaOf = (page) =>
    page.evaluate(() => {
      const el = document.querySelector('[data-announcement] > [aria-hidden="true"]');
      const m = el && getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
      return m ? Number(m[1].split(',')[3] ?? 1) : 1;
    });
  const scrimReduced = await scrimAlphaOf(v1);
  check('…und hinter dem helleren der beiden Schleier', scrimReduced === 0.8, String(scrimReduced));
  // A dialog layer without being a `Modal`: the search shortcut must not reach past it and put
  // the caret in a field behind a full-screen backdrop (`registerModalLayer` → `anyModalOpen()`).
  // `ControlOrMeta`, like case S — the browser job runs on Linux.
  await v1.keyboard.press('ControlOrMeta+k');
  // The assertion is the *caret*, never „the field is not there": `GlobalSearch` renders its
  // input permanently in the header, so a count of `input[role="combobox"]` is 1 on every page
  // of the app and would pass against a shortcut that reached straight past this overlay. What
  // `anyModalOpen()` exists to prevent is focus landing in that field behind a full-screen
  // backdrop — so read the focus, and read it as a wait, because it would move one React round
  // after the keystroke.
  const caretInSearch = await until(
    () => v1.evaluate(() => document.activeElement === document.querySelector('input[role="combobox"]')),
    (v) => v === true,
    1500,
  );
  check('⌘K setzt den Cursor nicht hinter die Überlagerung', caretInSearch === false);
  // Tab cycles inside the card instead of walking out the back of it and landing on a link the
  // user cannot see. The card holds exactly one tab stop, so the wrap is back onto the button.
  await v1.keyboard.press('Tab');
  check(
    'Tab bleibt auf der Bestätigung, statt hinter die Überlagerung zu laufen',
    await v1.evaluate(() => document.activeElement?.hasAttribute('data-announcement-confirm') === true),
  );

  await overlay(v1).getByRole('button', { name: 'Danke!' }).click();
  check('„Danke!“ schließt die Karte', await gone(overlay(v1)));
  const stamped = await until(() => Promise.resolve(readReg().announcementsSeen?.ids?.testfest), (d) => d === TODAY, 5000);
  // The *server* stamps the day (localDay), never the client: a client that could name the day
  // could name yesterday and make a yearly announcement repeat on every start.
  check('…und der Server stempelt den Tag in die Registry', stamped === TODAY, String(stamped));
  await v1.reload();
  await ready(v1);
  check('…ein Neustart holt sie nicht zurück', !(await shown(overlay(v1), 2000)));
  await v1.close();

  // --- the marker is registry-wide, so confirming is a cross-window event ---
  //
  // Two windows both show the same dated card — the feed is one file, not one window's state —
  // and without the broadcast the user confirms the same greeting twice. Two *pages in one
  // context*, never two contexts: BroadcastChannel is partitioned per context, so a second
  // context would make this pass vacuously with nothing delivered and nothing expected.
  writeReg((reg) => {
    reg.announcements = [
      { id: 'zweifenster', title: 'Zweifenster', body: 'Eine Zeile.\n\nGrüße', date: TODAY.slice(5) },
    ];
  });
  const [w1, w2] = await windows(context, 2);
  check(
    'beide Fenster zeigen dieselbe Ankündigung',
    (await shown(overlay(w1).first())) && (await shown(overlay(w2).first())),
  );
  await overlay(w1).getByRole('button', { name: 'Danke!' }).click();
  check('…und die Bestätigung im einen räumt sie im anderen weg', await gone(overlay(w2)));
  await w1.close();
  await w2.close();

  // --- the card can arrive after a dialog is already open ---
  //
  // The feed is a round trip, so this is a real ordering and not a contrived one: the user opens
  // „Neuer Künstler", the answer lands, and the card covers the dialog completely. One Escape has
  // to close **one** thing — the one on screen. Before `ANNOUNCEMENT_DEPTH` neither layer marked
  // the key and both acted, so the dialog closed underneath a card the user was still reading;
  // on a dirty form it raised „Änderungen verwerfen?" at `z-40`, invisible under this backdrop.
  writeReg((reg) => {
    reg.announcements = [
      { id: 'spaetstart', title: 'Spätstart', body: 'Eine Zeile.', date: TODAY.slice(5) },
    ];
  });
  const slow = await context.newPage();
  slow.on('pageerror', (e) => check('no page error (Ankündigung über Dialog)', false, e.message));
  // Six seconds, not one: the ordering is the fixture here, and a card that arrived first would
  // swallow the click on „+ Künstler" and fail as a 30 s actionability timeout rather than as
  // anything readable. The pre-check below states the ordering instead of hoping for it.
  await slow.route('**/api/announcements', async (route) => {
    await sleep(6000);
    await route.continue();
  });
  await slow.goto(`${UI}/#/dashboard`);
  await ready(slow);
  check('die Ankündigung ist noch unterwegs', !(await shown(overlay(slow), 500)));
  await slow.getByRole('button', { name: '+ Künstler' }).click();
  // „anlegen" rather than „Künstler": the heading is renameable (WP-F), and the card's own text
  // must not match this locator.
  const artistDialog = slow.locator('.fixed.inset-0').filter({ hasText: 'anlegen' }).first();
  check('der Dialog steht, bevor die Ankündigung eintrifft', await shown(artistDialog));
  check('…dann legt sich die Karte darüber', await shown(overlay(slow).first()));
  await slow.keyboard.press('Escape');
  check('Escape schließt die Karte…', await gone(overlay(slow)));
  check('…und nicht den Dialog darunter', (await artistDialog.count()) === 1);
  await slow.close();

  // The other trigger, driven the only way it can be without shipping a second build: put the
  // marker back to a version that predates every entry in CHANGELOG.md. What this really asserts
  // is the bundling — `__APP_VERSION__` and the `?raw` import of a file *above* the Vite root
  // both have to have survived into the browser, and neither is visible to typecheck or to any
  // other gate.
  const APP_VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const newest = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split(/^## (?=\d+\.\d+\.\d+)/m)[1] ?? '';
  // A line of the entry with the Markdown taken off — what the card has to render as text.
  // Derived from the file at run time, so writing the next release's notes cannot break it.
  const strip = (line) =>
    line
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`#]/g, '')
      .replace(/^\s*[-–—]\s*/, '')
      .trim()
      .slice(0, 24);
  const entryLines = newest.split('\n').slice(1).filter((l) => l.trim());
  const notesProbe = strip(entryLines[0] ?? '');
  // The newest entry's closing line — and deliberately labelled as the *weaker* half of the pair
  // below. It is the card's last block only while the card carries a single entry; the marker is
  // set to `0.0.1`, so the card carries every entry above that, and the block `splitSignoff`
  // would set apart then belongs to the **oldest** one. The discriminator is therefore the count,
  // and this says the newest entry's closing line arrived as flowing text rather than going
  // missing.
  const lastProbe = strip(entryLines[entryLines.length - 1] ?? '');
  writeReg((reg) => {
    delete reg.announcements;
    reg.announcementsSeen = { version: '0.0.1' };
  });

  const v2 = await open(context);
  check('nach einem Update erscheint „Was ist neu“', await shown(overlay(v2).first()));
  check('…mit der laufenden Version im Titel', (await v2.locator('#announcement-title').textContent()) === `Auftakt ${APP_VERSION}`, APP_VERSION);
  const notes = (await v2.locator('.announcement-body').textContent()) ?? '';
  check('…und dem echten CHANGELOG.md aus dem Bundle', notesProbe.length > 8 && notes.includes(notesProbe), notesProbe);
  // Rendered as Markdown, not dumped as source: the entry is a list and has to arrive as one.
  check('…als Markdown gerendert, nicht als Quelltext', (await v2.locator('.announcement-body li').count()) > 0);
  // The precondition of the assertion below, asserted rather than assumed. `splitSignoff` only
  // ever sets a paragraph apart when there are two or more, so „no signature" on a single-block
  // card is true whatever the code does. Counted on the **card**, not on one entry — the marker
  // sends every entry above `0.0.1` into it, which today is one and tomorrow may be three. A
  // changelog entry has always been an intro, a list and an „Außerdem" line, so this holds either
  // way; if that ever stops being so, this must say so out loud rather than let the next check
  // pass for the wrong reason. A fixture fact, like the print case's row count, and it lives in
  // docs/VERIFYING.md as one.
  const blocks = await v2.locator('.announcement-body > p, .announcement-body > ul, .announcement-body > ol').count();
  check('die Karte trägt mehrere Blöcke — sonst prüft der nächste Fall nichts', blocks >= 2, `${blocks} Blöcke`);
  check(
    '…und trotzdem keine Signatur: kein Absatz wird abgesetzt, und die Schlusszeile steht im Fließtext',
    (await v2.locator('.announcement-signoff').count()) === 0 && lastProbe.length > 8 && notes.includes(lastProbe),
    lastProbe,
  );
  await overlay(v2).getByRole('button', { name: 'Alles klar' }).click();
  check('„Alles klar“ merkt sich die Version', await gone(overlay(v2)));
  const marked = await until(() => Promise.resolve(readReg().announcementsSeen?.version), (v) => v === APP_VERSION, 5000);
  check('…in der Registry, nicht in den Saison-Settings', marked === APP_VERSION, String(marked));
  await v2.close();

  // The fireworks, in a window that has not asked for less motion. Reading the pixels back is
  // the whole assertion: a mounted canvas whose loop never runs looks identical from the DOM.
  writeReg((reg) => {
    reg.announcements = [
      { id: 'feuerwerk', title: 'Testfest', body: 'Eine Zeile.\n\nGrüße', date: TODAY.slice(5), celebrate: true },
    ];
  });
  const lively = await browser.newContext({ reducedMotion: 'no-preference', viewport: WIDE });
  try {
    const v3 = await open(lively);
    check('ein Fenster ohne „weniger Bewegung“ bekommt das Feuerwerk', await shown(v3.locator('[data-announcement] canvas')));
    const litPixels = await until(
      () =>
        v3.evaluate(() => {
          const c = /** @type {HTMLCanvasElement | null} */ (document.querySelector('[data-announcement] canvas'));
          const g = c?.getContext('2d');
          if (!c || !g) return -1;
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
          return n;
        }),
      (n) => n > 200,
      8000,
    );
    check('…und die Schleife malt wirklich', litPixels > 200, `${litPixels} Pixel`);
    // The scrim stays translucent — the app has to remain visible behind it, which is what rules
    // out the obvious trail trick (a half-transparent wash accumulates to opaque in a few frames).
    // Read through the same helper as the reduced-motion window above, so „the two branches pick
    // different scrims" is one comparison rather than two unrelated numbers.
    const scrimLively = await scrimAlphaOf(v3);
    check(
      '…hinter einem durchscheinenden, nie deckenden Schleier — und einem dunkleren als ohne Feuerwerk',
      scrimLively > 0 && scrimLively < 0.95 && scrimLively > scrimReduced,
      `${scrimLively} gegen ${scrimReduced}`,
    );
    await v3.close();
  } finally {
    await lively.close();
  }

  // Leave the demo the way every other case found it: no payload, and a marker that says this
  // version has been seen. A gate that armed an overlay and walked away would break the next run.
  writeReg((reg) => {
    delete reg.announcements;
    reg.announcementsSeen = { version: APP_VERSION };
  });
  const v4 = await open(context);
  check('ohne Payload ist die Überlagerung wieder still', !(await shown(overlay(v4), 2000)));
  await v4.close();
}
