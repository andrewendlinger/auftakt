/** S–T · the keyboard contract and the search overlay */

import { sleep } from '../../lib/wait.mjs';
import { gone, open, ready, shown, until } from '../browser.mjs';
import { UI } from '../config.mjs';
import { tabStop } from '../probes.mjs';
import { check } from '../report.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runKeyboard(fixtures) {
  const { context } = fixtures;
  // ======================================================================== S · the keyboard
  //
  // WP-42 gave every `Modal` three duties, and all three are about where the caret is rather than
  // about what is on screen: place focus on open, keep Tab inside the card, hand focus back to the
  // opener on close. Focus left behind the backdrop meant the next Enter pressed the button that
  // had opened the dialog — and opened it a second time.
  //
  // Every assertion below is a *position in the dialog's own tab order* (`tabStop`), never a count
  // of keystrokes: a `type="date"` is three tab stops, so a fixed-length walk silently ends inside
  // a picker and reads as a broken tab order (docs/VERIFYING.md). Index 0 is the header's ✕, so
  // „the first field of the body" is 1 — which is the rule WP-42 states, and the ✕ keeps its place
  // in the natural order rather than being the first thing anyone lands on.
  console.log('\nS · Tastatur: Fokus setzen, halten, zurückgeben (WP-42)');
  const k = await open(context, '/artist/1');
  await k.getByRole('button', { name: '✎ Bearbeiten' }).first().click();
  await k.getByRole('heading', { name: /bearbeiten$/ }).waitFor({ timeout: 8000 });

  // Polled: the focus effect is passive, so a read taken as the heading appears can precede it.
  const opened = await until(() => tabStop(k), (v) => v.at >= 0, 5000);
  check(
    'der Dialog setzt den Fokus auf das erste Feld des Rumpfes, nicht auf das ✕ (WP-42)',
    opened.at === 1 && opened.tag === 'INPUT',
    JSON.stringify(opened),
  );
  /** @type {{ at: number, n: number, tag: string, text: string }[]} */
  const walk = [];
  for (let i = 0; i < Math.max(opened.n - 1, 1); i++) {
    await k.keyboard.press('Tab');
    walk.push(await tabStop(k));
  }
  check(
    'Tab bleibt im Dialog',
    walk.length > 1 && walk.every((w) => w.at >= 0),
    walk.map((w) => `${w.at}`).join(' '),
  );
  check(
    '…läuft im Kreis und kommt am ersten Feld heraus, nicht am ✕',
    walk[walk.length - 1]?.at === opened.at && !walk.some((w) => w.at === 0),
    walk.map((w) => `${w.at}:${w.tag}`).join(' '),
  );
  // Backwards the ✕ *is* in the way, deliberately: it keeps its natural place, and only the wrap
  // off it goes to the end of the dialog rather than to the page behind the backdrop.
  await k.keyboard.press('Shift+Tab');
  const onClose = await tabStop(k);
  check('Shift+Tab vom ersten Feld erreicht das ✕', onClose.at === 0, JSON.stringify(onClose));
  await k.keyboard.press('Shift+Tab');
  const wrapped = await tabStop(k);
  check('…und von dort springt es ans Ende des Dialogs', wrapped.at === wrapped.n - 1, JSON.stringify(wrapped));

  // Read before the dialog goes: „focus is on the opener afterwards" is also true of a dialog that
  // never took focus in the first place, which is precisely the state the effect above prevents.
  const beforeClose = await tabStop(k);
  await k.keyboard.press('Escape');
  const shut = await gone(k.locator('.fixed.inset-0'));
  check('Escape schließt den ungeänderten Dialog', shut, `${await k.locator('.fixed.inset-0').count()} Dialoge`);
  // Identity, not a substring: focus dropped to `<body>` answers `document.activeElement` with the
  // body, and *its* `textContent` is the whole page — „✎ Bearbeiten" included. A check that asks
  // whether the text contains the button's label is therefore green on precisely the regression it
  // guards, which is loose focus.
  const handedBack = await until(
    () =>
      k.evaluate(() => {
        const el = document.activeElement;
        return { tag: el?.tagName ?? 'BODY', text: (el?.textContent ?? '').trim() };
      }),
    (v) => v.tag === 'BUTTON' && v.text === '✎ Bearbeiten',
    5000,
  );
  check(
    '…und der Fokus kommt aus dem Dialog zurück auf den Knopf, der ihn geöffnet hat (WP-42)',
    beforeClose.at >= 0 && handedBack.tag === 'BUTTON' && handedBack.text === '✎ Bearbeiten',
    `${JSON.stringify(beforeClose)} → ${JSON.stringify(handedBack)}`,
  );

  // ======================================================================== S2 · the exception
  //
  // `PillSelect`'s option menu is the one place the trap deliberately lets go: it portals to
  // `document.body` and runs the listbox contract with *real* focus on the options (RTE-11), so
  // pulling focus back into the card would break the field it serves.
  //
  // The menu also brings its own click-away layer — another `div.fixed.inset-0`, appended to the
  // end of the body — so `topDialog()` stops being the dialog the moment it opens. Everything
  // below therefore addresses the Modal as the *first* one.
  console.log('\nS2 · Das portalte Menü ist die Ausnahme (RTE-11)');
  await k.getByRole('button', { name: '+ Termin' }).first().click();
  await k.getByRole('heading', { name: 'Neuer Termin' }).waitFor({ timeout: 8000 });
  const eventDialog = k.locator('.fixed.inset-0').first();
  await eventDialog.locator('button[aria-haspopup="listbox"]').first().click();
  check('das Menü öffnet', await shown(k.locator('[role="listbox"]')));
  const portaled = await k.evaluate(() => {
    const card = document.querySelector('.fixed.inset-0 > div');
    const menu = document.querySelector('[role="listbox"]');
    return {
      role: document.activeElement?.getAttribute('role') ?? '',
      option: (document.activeElement?.textContent ?? '').trim(),
      inCard: !!card && card.contains(document.activeElement),
      atBody: menu?.parentElement === document.body,
      layers: document.querySelectorAll('.fixed.inset-0').length,
    };
  });
  check(
    'der Fokus steht auf einer Option außerhalb der Dialogkarte (RTE-11)',
    portaled.role === 'option' && !portaled.inCard && portaled.atBody,
    JSON.stringify(portaled),
  );
  check('…und das Menü legt eine zweite .fixed.inset-0 über den Dialog', portaled.layers === 2, `${portaled.layers} Schichten`);
  await k.keyboard.press('ArrowDown');
  const stepped = await until(
    () => k.evaluate(() => ({ text: (document.activeElement?.textContent ?? '').trim(), role: document.activeElement?.getAttribute('role') ?? '' })),
    (v) => v.text !== portaled.option,
    3000,
  );
  check('dort bewegt ↓ den Fokus weiter, nicht Tab', stepped.role === 'option' && stepped.text !== portaled.option, `${portaled.option} → ${stepped.text}`);
  await k.keyboard.press('Escape');
  const returnedToPill = await until(
    () =>
      k.evaluate(() => {
        const card = document.querySelector('.fixed.inset-0 > div');
        return {
          haspopup: document.activeElement?.getAttribute('aria-haspopup') ?? '',
          inCard: !!card && card.contains(document.activeElement),
          menus: document.querySelectorAll('[role="listbox"]').length,
        };
      }),
    (v) => v.menus === 0,
    5000,
  );
  check('Escape schließt nur das Menü und gibt den Fokus an die Pille zurück', returnedToPill.haspopup === 'listbox' && returnedToPill.inCard, JSON.stringify(returnedToPill));
  // ✕ and „Abbrechen" are deliberate exits and never ask about changes — Escape here would.
  await eventDialog.locator('button[title="Schließen"]').click();
  const eventShut = await gone(k.locator('.fixed.inset-0'));
  check('der Termin-Dialog lässt sich über ✕ schließen', eventShut, `${await k.locator('.fixed.inset-0').count()} Dialoge`);

  // ======================================================================== T · the search overlay
  //
  // The search field is a combobox and the hits are `[role="option"]` that focus never enters:
  // ↑/↓ move `aria-activedescendant` while the caret stays in the field, because the field is a
  // *filter* and every keystroke after ↓ would otherwise have to be routed back into it. The hits
  // are `tabIndex={-1}` for the same reason — they used to be twenty tab stops behind the field.
  //
  // So nothing here reads `document.activeElement` to find the marked hit, and nothing presses
  // Enter on a hit: both are how a script asserts the opposite of the contract (WP-43).
  console.log('\nT · Die Suchüberlagerung (WP-43)');
  const field = k.locator('input[role="combobox"]');
  await k.keyboard.press('ControlOrMeta+k');
  const inField = await until(
    () => k.evaluate(() => document.activeElement === document.querySelector('input[role="combobox"]')),
    (v) => v === true,
    5000,
  );
  check('⌘K setzt den Cursor ins Suchfeld', inField);
  await k.keyboard.type('Konzert');
  const hitCount = await until(() => k.locator('#gs-hits [role="option"]').count(), (n) => n > 1, 8000);
  check('die Trefferliste öffnet und hat mehrere Treffer', hitCount > 1, `${hitCount} Treffer`);

  const marker = () =>
    k.evaluate(() => {
      const input = document.querySelector('input[role="combobox"]');
      const hits = Array.from(document.querySelectorAll('#gs-hits [role="option"]'));
      return {
        ad: input?.getAttribute('aria-activedescendant') ?? '',
        ids: hits.map((h) => h.id),
        selected: hits.filter((h) => h.getAttribute('aria-selected') === 'true').map((h) => h.id),
        tabIndexes: [...new Set(hits.map((h) => /** @type {HTMLElement} */ (h).tabIndex))],
        inField: document.activeElement === input,
      };
    });
  const firstHit = await marker();
  check(
    'der Marker steht auf dem ersten Treffer und ist genau einer',
    firstHit.ad === firstHit.ids[0] && firstHit.selected.join() === firstHit.ad,
    JSON.stringify({ ad: firstHit.ad, selected: firstHit.selected }),
  );
  check('Treffer sind keine Tabstopps', firstHit.tabIndexes.join() === '-1', firstHit.tabIndexes.join());
  await k.keyboard.press('ArrowDown');
  const second = await until(marker, (m) => m.ad === m.ids[1], 5000);
  check(
    '↓ bewegt den Marker und lässt den Fokus im Feld',
    second.ad === second.ids[1] && second.selected.join() === second.ad && second.inField,
    JSON.stringify({ ad: second.ad, inField: second.inField }),
  );
  await k.keyboard.press('Tab');
  // `hits` is in the reading because „focus is not on a hit" is also true of a panel that closed
  // on the keystroke — the assertion is about the *open* list having no tab stops in it.
  const afterTab = await k.evaluate(() => ({
    isHit: !!document.activeElement?.closest('#gs-hits [role="option"]'),
    role: document.activeElement?.getAttribute('role') ?? '',
    tag: document.activeElement?.tagName ?? 'BODY',
    hits: document.querySelectorAll('#gs-hits [role="option"]').length,
  }));
  check(
    'Tab führt aus dem Feld heraus, aber nie auf einen Treffer',
    afterTab.hits > 0 && !afterTab.isHit && afterTab.role !== 'option',
    JSON.stringify(afterTab),
  );

  // ⌘F is the second way in and answers the other habit; it has to work from outside the field too.
  await k.keyboard.press('ControlOrMeta+f');
  const backInField = await until(
    () => k.evaluate(() => document.activeElement === document.querySelector('input[role="combobox"]')),
    (v) => v === true,
    5000,
  );
  check('⌘F holt den Cursor zurück ins Feld', backInField);
  // Walked to, never counted: which groups this query returns is a fixture fact, and the group
  // order decides how many ↓ a project hit is away.
  const wantedHit = (await marker()).ids.find((id) => id.startsWith('gs-hit-p')) ?? '';
  for (let i = 0; i < 12 && (await marker()).ad !== wantedHit; i++) await k.keyboard.press('ArrowDown');
  const onProject = await marker();
  check('der Marker lässt sich bis auf einen Projekttreffer laufen', !!wantedHit && onProject.ad === wantedHit, onProject.ad || 'kein Projekttreffer');
  await k.keyboard.press('Enter');
  const wantedHash = `#/project/${wantedHit.replace('gs-hit-p', '')}`;
  const opening = await until(() => k.evaluate(() => location.hash), (h) => h === wantedHash, 8000);
  check('Enter im Feld öffnet den markierten Treffer', opening === wantedHash, `${opening} für ${wantedHit}`);
  check('…und leert die Suche', (await field.inputValue()) === '', await field.inputValue());

  await k.keyboard.press('ControlOrMeta+f');
  await k.keyboard.type('Konzert');
  await shown(k.locator('#gs-hits [role="option"]'));
  await k.keyboard.press('Escape');
  const panelGone = await until(() => k.locator('#gs-hits').count(), (n) => n === 0, 5000);
  check(
    'Escape legt zuerst die Liste weg und lässt die Eingabe stehen',
    panelGone === 0 && (await field.inputValue()) === 'Konzert',
    await field.inputValue(),
  );
  await k.keyboard.press('Escape');
  const emptied = await until(() => field.inputValue(), (v) => v === '', 5000);
  check('…und erst der zweite Escape leert sie', emptied === '', emptied);

  // The rule that makes the two shortcuts safe: over an open dialog they do nothing. A listener
  // that moved focus would tear the trap open from the outside and park the caret behind the
  // backdrop — the state `Modal`'s focus effect exists to prevent (WP-43).
  await k.goto(`${UI}/#/artist/1`);
  await k.reload();
  await ready(k);
  await k.getByRole('button', { name: '✎ Bearbeiten' }).first().click();
  await k.getByRole('heading', { name: /bearbeiten$/ }).waitFor({ timeout: 8000 });
  await k.keyboard.press('ControlOrMeta+f');
  await k.keyboard.press('ControlOrMeta+k');
  await sleep(400);
  const inert = await k.evaluate(() => {
    const search = document.querySelector('input[role="combobox"]');
    return {
      dialog: document.querySelectorAll('.fixed.inset-0').length,
      onSearch: document.activeElement === search,
      expanded: search?.getAttribute('aria-expanded') ?? '',
      panels: document.querySelectorAll('#gs-hits').length,
    };
  });
  check(
    '⌘F und ⌘K sind bei offenem Dialog wirkungslos (WP-43)',
    inert.dialog === 1 && !inert.onSearch && inert.panels === 0 && inert.expanded === 'false',
    JSON.stringify(inert),
  );
  await k.keyboard.press('Escape');
  await k.close();
}
