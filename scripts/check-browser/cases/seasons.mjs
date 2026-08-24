/** A–E · the season matrix in two windows, and the export that carries it */

import { sleep } from '../../lib/wait.mjs';
import { chip, open, pin, ready, seasonPin, toast, windows } from '../browser.mjs';
import { RUN } from '../config.mjs';
import { STALE_MS } from '../probes.mjs';
import { check } from '../report.mjs';
import { api, send } from '../stack.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runSeasons(fixtures) {
  const { HOME, context, data, makeSeason } = fixtures;
  // ======================================================================== A · the #54 canary
  //
  // The focus listener behind `refetchOnWindowFocus` is the backstop under the cross-window
  // broadcast. `handleFocus(true)` routed it through query-core's `setFocused`, a no-op once
  // `#focused` already holds that value — and two windows side by side are both permanently
  // visible, so `visibilitychange` never resets it. The backstop fired once per window lifetime
  // and was silent afterwards (#54).
  //
  // Which is why the assertion is on the SECOND focus. A case that only watches the first one
  // passes against the defect.
  console.log('A · Fokus-Refetch (#54)');
  const [a, b] = await windows(context, 2);

  /** @type {string[]} */
  let seen = [];
  a.on('request', (r) => {
    if (r.url().includes('/api/')) seen.push(r.url());
  });

  // The window must be the visible one: query-core falls back to `document.visibilityState`
  // when no boolean was ever set, and a background tab legitimately refetches nothing.
  await a.bringToFront();
  check(
    'canary precondition: the window is visible',
    (await a.evaluate(() => document.visibilityState)) === 'visible',
  );

  const focusRound = async () => {
    await sleep(STALE_MS + 500); // everything on screen is stale again
    seen = [];
    await a.evaluate(() => window.dispatchEvent(new Event('focus')));
    await sleep(1500);
    return seen.length;
  };

  const first = await focusRound();
  const again = await focusRound();
  check('the first focus refetches', first > 0, `${first} Anfragen`);
  check('the SECOND focus refetches too (#54)', again > 0, `${again} Anfragen`);

  // ======================================================================== B · the broadcast
  //
  // Only a window's own write path posts the invalidate (`useInvalidateAll`), so the negative
  // control is as load-bearing as the positive one — and it is asserted twice, because "the row
  // never showed up" also passes when the selector is simply wrong.
  console.log('\nB · Broadcast zwischen zwei Fenstern');
  await pin(a, data.id);
  await pin(b, data.id);

  const typed = `Broadcast ${RUN}`;
  await a.locator('input[placeholder^="Neue allgemeine Aufgabe"]').fill(typed);
  await a.locator('input[placeholder^="Neue allgemeine Aufgabe"]').press('Enter');
  await check(
    'the UI write reaches the other window',
    await b
      .locator('td', { hasText: typed })
      .first()
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false),
  );

  const quiet = `Curl ${RUN}`;
  // `?season=` is the header's twin — the middleware takes either, and a bare fetch has no
  // header to send.
  await send('POST', `/tasks?season=${data.id}`, { title: quiet });
  await sleep(900); // longer than the 150 ms coalescer plus a refetch
  check(
    'a write that bypasses the UI does not broadcast',
    (await b.locator('td', { hasText: quiet }).count()) === 0,
  );
  await b.reload();
  await ready(b);
  check(
    '…and it was really there (the control is not vacuous)',
    (await b.locator('td', { hasText: quiet }).count()) > 0,
  );

  // ======================================================================== C · the switch
  //
  // Season switching is window-local: repin and reload *this* window, move the registry default
  // for future windows best-effort, and leave every other window alone.
  console.log('\nC · Saisonwechsel ist fensterlokal');
  const target = await makeSeason('Wechselziel');
  // A season created over the API broadcasts nothing, so the switcher menu of a window that was
  // already open does not list it — the click would wait out its timeout on a button that is not
  // there. Only a reload makes a curl-created season visible.
  await a.reload();
  await ready(a);
  const chipBefore = await chip(b);

  // The old document re-renders with the new chip before the reload lands, so wait for the
  // document change — URL and readiness are already true.
  await Promise.all([
    a.waitForEvent('domcontentloaded', { timeout: 15_000 }),
    (async () => {
      await a.locator('button[title$="wechseln"]').first().click();
      await a.locator('button', { hasText: target.label }).last().click();
    })(),
  ]);
  await a.waitForURL(/#\/dashboard/, { timeout: 15_000 });
  await ready(a);

  check('the switching window follows', (await chip(a)) === target.label, await chip(a));
  check('…and repins', (await seasonPin(a)) === String(target.id));
  await sleep(600);
  check('the other window stays where it was', (await chip(b)) === chipBefore, chipBefore);
  check(
    'the registry default follows the switch',
    (await api('/seasons')).activeId === target.id,
    String((await api('/seasons')).activeId),
  );

  // Back to the demo's own season, so the fixtures above are deletable again: deleteSeason
  // refuses the registry default, by design.
  await send('POST', `/seasons/${HOME}/activate`);

  // ======================================================================== D · 410 recovery
  //
  // The delete has to be out of band. Deleting through another window's UI broadcasts an
  // invalidate, and the pinned window then heals *before* the step under test — the repro
  // silently stops reproducing.
  console.log('\nD · Saison unter einem Fenster gelöscht');
  const doomed = await makeSeason('Opfer');
  const c = await open(context, '/dashboard');
  await pin(c, doomed.id);
  check('the third window sits on the doomed season', (await chip(c)) === doomed.label);

  const del = await send('DELETE', `/seasons/${doomed.id}`);
  check('the season is gone server-side', del.status === 200, `HTTP ${del.status}`);

  // Any request from that window now answers 410. A focus is the honest trigger: no navigation,
  // no reload, exactly what a user coming back to the window does.
  await sleep(STALE_MS + 500);
  await c.evaluate(() => window.dispatchEvent(new Event('focus')));

  await c.waitForURL(/#\/$/, { timeout: 15_000 });
  await ready(c);
  check(
    'the window recovers to the landing page',
    (await c.evaluate(() => location.hash)) === '#/',
    await c.evaluate(() => location.hash),
  );
  await check(
    'and says so',
    await toast(c, /gelöscht/)
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false),
  );
  check('the dead pin is dropped', (await seasonPin(c)) !== String(doomed.id));

  // ======================================================================== D2 · the term
  //
  // The toast waits for `['seasons']` before naming the season, so it lands one query after the
  // page — that wait is the whole point of the case (PR50-13).
  console.log('\nD2 · Der Hinweis nennt den umbenannten Begriff');
  await send('PATCH', '/seasons/terms', { season: 'Festival' });
  const doomed2 = await makeSeason('Opfer 2');
  await pin(c, doomed2.id);
  await send('DELETE', `/seasons/${doomed2.id}`);
  await sleep(STALE_MS + 500);
  await c.evaluate(() => window.dispatchEvent(new Event('focus')));
  await c.waitForURL(/#\/$/, { timeout: 15_000 });
  await check(
    'the toast uses „Festival“',
    await toast(c, /Festival/)
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false),
  );
  await send('PATCH', '/seasons/terms', { season: null });

  // ======================================================================== E · the export
  //
  // The .xlsx export is a button that fetches through api/client, not an `<a href>`: only that
  // layer sends the season header, and only it recovers from the 410 that answers a deleted
  // season — as a navigation that 410 renders as raw JSON and strands the window (PR50-04).
  console.log('\nE · Excel-Export trägt die Saison');
  await pin(a, data.id, '/project/1');
  /** @type {string[]} */
  const exportSeasons = [];
  a.on('request', (r) => {
    if (r.url().includes('.xlsx')) exportSeasons.push(r.headers()['x-auftakt-season'] ?? '');
  });
  const [download] = await Promise.all([
    a.waitForEvent('download', { timeout: 20_000 }),
    a.getByRole('button', { name: '⬇ Excel' }).first().click(),
  ]);
  check('the export downloads a file', download.suggestedFilename().endsWith('.xlsx'), download.suggestedFilename());
  check(
    'the export request carries this window’s season',
    exportSeasons.includes(String(data.id)),
    exportSeasons.join(','),
  );

  const doomed3 = await makeSeason('Opfer 3', true);
  await pin(c, doomed3.id, '/project/1');
  await send('DELETE', `/seasons/${doomed3.id}`);
  await c.getByRole('button', { name: '⬇ Excel' }).first().click();
  await c.waitForURL(/#\/$/, { timeout: 15_000 });
  await ready(c);
  check('a dead pin does not strand the export', (await c.locator('pre').count()) === 0);
}
