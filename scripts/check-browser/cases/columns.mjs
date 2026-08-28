/** AL–AO · the custom column types */

import { sleep } from '../../lib/wait.mjs';
import {
  clickFailure,
  clickIfThere,
  gone,
  notePopoverReopened,
  open,
  pin,
  ready,
  scrollSettled,
  shown,
  topDialog,
  until,
} from '../browser.mjs';
import { SETTLED_MS, UI } from '../config.mjs';
import { handedOver } from '../fixtures.mjs';
import { check } from '../report.mjs';
import { api, scoped, send } from '../stack.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runColumns(fixtures) {
  const { columnsSeason, context, heldRoutes } = fixtures;
  /** Both come from `archive`, which runs immediately before this file. */
  const { pad2, rowIds } = handedOver(fixtures, ['pad2', 'rowIds']);
  // ======================================================================== AL–AO · the column types
  //
  // The task table has no fixed column list — every column is a `custom_columns` row — but the
  // *types* are not data-driven at all. `CustomCell` is four hardcoded branches, each with its own
  // way of taking a value in (an `InlineInput`, a native date picker, a checkbox, a `PillSelect`)
  // and its own way of putting it back on screen. The demo plants three of the four with values
  // (select · checkbox · date) plus one artist-scoped select; `text` has no fixture at all — it is
  // the branch `CustomCell` reaches by falling through — and nothing drove any of them.
  //
  // `npm run check:api` owns the server half: the `writable` allowlist, the `custom_values` merge,
  // the scope/parent CHECK. What only a browser can see is a type that renders but silently
  // refuses input, or accepts it and drops it.
  //
  // Case G owns the per-page hide/show *write shape* — one global built-in on an artist page,
  // `{"due":false}`, the override pruned again on re-show. AO's ground is the interplay: three
  // columns of three types hidden in one burst, the two different stores the same 👁 writes to,
  // and what hiding a column does to a sort that is running on it.

  /** One column per type, created below. None of these names exists on the demo — asserted. */
  const CC_NAMES = ['Zuständig', 'Zusage bis', 'Vertrag', 'Phase'];
  /**
   * The „Phase" categories in the order the user arranges them — workflow order, which is
   * deliberately *not* alphabetical. That difference is what makes „an Auswahl column sorts by its
   * configured order" (TTU-19) an assertion rather than a coincidence.
   */
  const CC_PHASES = ['Vorbereitung', 'Durchführung', 'Nachbereitung'];
  /** The demo's three global custom columns — one select, one checkbox, one date. */
  const CC_GLOBALS = ['Bereich', 'Bestätigt', 'Abgabe'];

  /** Bounded and swallowed, like `clickIfThere`: a red assertion must degrade, never end the run. */
  const ccFill = (locator, text, timeout = 5000) =>
    locator.first().fill(text, { timeout }).then(() => true).catch(() => false);
  const ccPick = (locator, value, timeout = 5000) =>
    locator.first().selectOption(value, { timeout }).then(() => true).catch(() => false);
  const ccPress = (locator, key, timeout = 5000) =>
    locator.first().press(key, { timeout }).then(() => true).catch(() => false);
  /** `#rrggbb` as Chromium serialises it, so a colour assertion can name the column's own value. */
  const ccRgb = (hex) => {
    const n = Number.parseInt(String(hex).replace('#', ''), 16);
    return Number.isNaN(n) ? String(hex) : `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  };

  // ======================================================================== AL · one column per type
  console.log('\nAL · Eine Spalte je Typ, über „⚙ Spalten“ angelegt');
  const CC = scoped(columnsSeason.id);
  const cc = await open(context, '/dashboard');
  await pin(cc, columnsSeason.id, '/project/2');

  /** This page's own columns. A scoped list has to name its parent, or the route answers 400. */
  const ccOwnCols = () => api(CC('/custom-columns?scope=project&project_id=2'));
  const ccProject = () => api(CC('/projects/2'));

  /**
   * The task table's header row as plain text.
   *
   * Found by „Aufgabe" rather than as `document.querySelector('table')`: a project description can
   * hold a Markdown table of its own. Every cell position below is counted off this list rather
   * than written down — the demo's column set is a fixture and this slice adds four more to it.
   */
  const ccHeads = () =>
    cc.evaluate(() => {
      const table = [...document.querySelectorAll('table')].find((t) =>
        [...t.querySelectorAll('thead th')].some((th) => (th.textContent ?? '').trim() === 'Aufgabe'),
      );
      return [...(table?.querySelectorAll('thead th') ?? [])].map((th) => (th.textContent ?? '').trim());
    });
  /**
   * `td` position (1-based) of the column whose header contains `name`. The gutter is cell 1 in
   * the header row and in every body row, so the two line up index for index. Refreshed by hand
   * wherever the column set changes below; a name that is not in the row yields 0, which
   * `ccCell` turns into a locator that cannot match (see there).
   */
  let ccHeadRow = [];
  const ccAt = (name) => ccHeadRow.findIndex((h) => h.toLowerCase().includes(name.toLowerCase())) + 1;
  /**
   * `nth-child(9999)` and never `nth-child(0)` for a column that is not on screen. On this
   * Chromium `td:nth-child(0)` matches **every** `td` of the row rather than none — measured
   * through `document.querySelectorAll` as well as through Playwright — so a missing column
   * silently addressed the first control in the row, and one failure detail described a checkbox
   * where a date cell was expected.
   */
  const ccCell = (taskId, name) => {
    const i = ccAt(name);
    return cc.locator(`tr[data-task-id="${taskId}"] td:nth-child(${i > 0 ? i : 9999})`);
  };

  const ccBefore = await ccOwnCols();
  const ccAllCols = await api(CC('/custom-columns'));
  check(
    'die Kopie startet ohne eigene Spalten auf dieser Seite …',
    ccBefore.length === 0,
    ccBefore.map((c) => c.name).join(' | ') || 'keine',
  );
  // The precondition every poll below leans on: nothing this case waits for can be satisfied by a
  // column or a value the demo already planted.
  check(
    '…und keiner der vier Namen ist in der Saison vergeben',
    !ccAllCols.some((c) => CC_NAMES.includes(c.name)),
    ccAllCols.map((c) => c.name).join(' | '),
  );

  await clickIfThere(cc.getByRole('button', { name: '⚙ Spalten' }).first());
  const ccDlg = topDialog(cc);
  const ccManagerUp = await shown(ccDlg.getByRole('heading', { name: 'Spalten verwalten' }), 8000);
  check(
    '„Spalten verwalten“ ist offen und die Liste dieser Seite ist leer',
    ccManagerUp && (await shown(ccDlg.getByText('Noch keine Spalten.'), 4000)),
  );
  // Both of these are counts of something that is *not* there, so both carry `ccManagerUp`: a
  // dialog that never opened has no reset button and no category rows either.
  check(
    '…und „Auf Saison-Vorgabe zurücksetzen“ wird nicht angeboten, solange nichts abweicht',
    ccManagerUp && (await ccDlg.getByRole('button', { name: /Saison-Vorgabe/ }).count()) === 0,
  );

  const ccTypeSelect = ccDlg.locator('select');
  const ccTypes = await ccTypeSelect
    .locator('option')
    .evaluateAll((els) => els.map((el) => `${el.value}=${(el.textContent ?? '').trim()}`))
    .catch(() => []);
  check(
    'die „Neue Spalte“-Auswahl bietet genau die vier Typen an, die in `custom_values` landen',
    ccTypes.join(' | ') === 'text=Text | date=Datum | checkbox=Checkbox | select=Auswahl (farbig)',
    ccTypes.join(' | ') || 'keine Optionen',
  );
  check(
    'für „Text“ gibt es keine Kategorienliste',
    ccManagerUp && (await ccDlg.locator('[data-option-row]').count()) === 0,
  );
  await ccPick(ccTypeSelect, 'select');
  const ccSeeds = await until(
    () => ccDlg.locator('[data-option-label]').evaluateAll((els) => els.map((el) => el.value)),
    (v) => v.length > 0,
    4000,
  );
  check(
    '„Auswahl“ bringt zwei Startkategorien mit, die auf ihre Namen warten',
    ccSeeds.join(' | ') === 'offen | fertig',
    ccSeeds.join(' | ') || 'keine',
  );
  await ccPick(ccTypeSelect, 'text');
  check(
    '…und zurück auf „Text“ ist die Liste wieder weg',
    ccManagerUp && (await until(() => ccDlg.locator('[data-option-row]').count(), (n) => n === 0, 4000)) === 0,
  );

  // The one thing this form refuses, and it refuses silently: `add` starts with
  // `if (!name.trim() || busyRef.current) return`, so there is no disabled button and no message —
  // unlike the option editors on „Kategorien" (case Q), which go stumpf with the reason beside the
  // row. „Nothing happened" is therefore a beat plus a re-read, never a wait for something to
  // appear. It is an **invariant guard**: it forbids a nameless column being created, and no
  // plausible revert of an existing fix takes it red on its own.
  // …and the two things that keep „nothing was created" from being true for the wrong reason: the
  // dialog was open, and the button really was pressed. Without them this reads green in exactly
  // the state the switcher-chip defect above left the run in — no manager, no button, no column.
  const ccNamelessClicked = await clickIfThere(ccDlg.getByRole('button', { name: '+ Spalte hinzufügen' }));
  await sleep(700);
  const ccNameless = await ccOwnCols();
  check(
    'ohne Namen wird keine Spalte angelegt',
    ccManagerUp && ccNamelessClicked && ccNameless.length === 0,
    `geklickt ${ccNamelessClicked}, ${ccNameless.map((c) => c.name).join(' | ') || 'keine Spalte'}`,
  );

  /**
   * Fill the „Neue Spalte" form and submit it, then wait for the form to **clear itself**.
   *
   * That last wait is the trap. The reset — `setName('')`, `setOptions([])`, `setType('text')` —
   * runs after the POST resolves, so a `selectOption` issued as soon as the API lists the new
   * column is overwritten a tick later and the *next* column is created as a Text one, with every
   * assertion about it silently about the wrong type (docs/VERIFYING.md).
   */
  const ccAdd = async (name, type, iconTitle) => {
    await ccPick(ccTypeSelect, type);
    await ccFill(ccDlg.getByPlaceholder('z. B. Verantwortlich'), name);
    if (iconTitle) await clickIfThere(ccDlg.locator(`button[title="${iconTitle}"]`));
    if (type === 'select') {
      // The two seed rows go, one click per render: `OptionsEditor`'s rows are keyed by index, so
      // two clicks on „the last ✕" inside one render address the same position twice. Removed
      // rather than renamed, because `normalizeOptions` keeps an existing `value` — a renamed
      // „offen" would still be stored as `offen`, and the categories below want label == value.
      for (let i = 0; i < 2; i++) {
        await clickIfThere(
          ccDlg.locator('[data-option-row]').last().getByRole('button', { name: 'Entfernen' }),
        );
        await until(() => ccDlg.locator('[data-option-row]').count(), (n) => n === 1 - i, 4000);
      }
      for (const [i, label] of CC_PHASES.entries()) {
        await clickIfThere(ccDlg.getByRole('button', { name: '+ Kategorie' }));
        await until(() => ccDlg.locator('[data-option-row]').count(), (n) => n === i + 1, 4000);
        await ccFill(ccDlg.locator('[data-option-label]').last(), label);
      }
    }
    await clickIfThere(ccDlg.getByRole('button', { name: '+ Spalte hinzufügen' }));
    await until(
      () => ccDlg.getByPlaceholder('z. B. Verantwortlich').inputValue().catch(() => null),
      (v) => v === '',
      8000,
    );
    // Polled on the season's **whole** column list rather than on this page's own group. Whether
    // the create really put the column in this page's scope is what the assertion below is about,
    // and a wait that presupposed it would turn that assertion into a bare timeout.
    const all = await until(
      () => api(CC('/custom-columns')),
      (cols) => cols.some((c) => c.name === name),
      8000,
    );
    return all.find((c) => c.name === name);
  };

  const ccText = await ccAdd('Zuständig', 'text', 'Person');
  const ccDate = await ccAdd('Zusage bis', 'date');
  const ccBox = await ccAdd('Vertrag', 'checkbox');
  const ccSel = await ccAdd('Phase', 'select');
  const ccFour = [ccText, ccDate, ccBox, ccSel];
  check(
    'vier Spalten, eine je Typ — jede an dieser Seite und an keiner anderen',
    ccFour.every(
      (c, i) =>
        !!c &&
        c.type === ['text', 'date', 'checkbox', 'select'][i] &&
        c.scope === 'project' &&
        c.project_id === 2 &&
        c.artist_id === null &&
        // `kind` and `key` are not client-writable, so a create is always a custom column bound to
        // the blob rather than to a `tasks` field (CCL-24).
        c.kind === 'custom' &&
        c.key === null,
    ),
    ccFour.map((c) => `${c?.name}:${c?.type}:${c?.scope}/${c?.project_id}:${c?.kind}`).join(' | '),
  );
  check(
    '…und nur die „Auswahl“ trägt Kategorien, in der eingestellten Reihenfolge',
    JSON.parse(ccSel?.options ?? '[]')
      .map((o) => `${o.label}=${o.value}`)
      .join(' | ') === CC_PHASES.map((p) => `${p}=${p}`).join(' | ') &&
      [ccText, ccDate, ccBox].every((c) => c?.options === null),
    `${ccSel?.options} / ${[ccText, ccDate, ccBox].map((c) => String(c?.options)).join(', ')}`,
  );

  /** One manager row, addressed by the column's name — `[data-column-row]` matches both lists. */
  const ccRowText = (name) =>
    ccDlg
      .locator('[data-column-row]')
      .filter({ hasText: name })
      .first()
      .evaluate((el) => (el.textContent ?? '').trim())
      .catch(() => '');
  const ccRowTexts = [];
  for (const name of CC_NAMES) ccRowTexts.push(await ccRowText(name));
  check(
    'die Liste dieser Seite nennt jeden Typ mit seinem deutschen Namen',
    ['Text', 'Datum', 'Checkbox', 'Auswahl · 3'].every((label, i) => ccRowTexts[i]?.includes(label)),
    ccRowTexts.join(' | '),
  );
  const ccSwatches = await ccDlg
    .locator('[data-column-row]')
    .filter({ hasText: 'Phase' })
    .first()
    .locator('span.rounded-full[title]')
    .count();
  check(
    '…und zeigt die drei Kategorienfarben der „Auswahl“ als Punkte',
    ccSwatches === 3,
    `${ccSwatches} Punkte`,
  );

  // Read while the manager is still open: creating a column invalidates, so it reaches the table
  // without a reload — and a case that reloads first cannot tell that apart from a build that only
  // picks a new column up on the next load.
  ccHeadRow = await until(ccHeads, (h) => h.some((x) => x.includes('Phase')), 8000);
  // The last `th` is the actions column and carries no text, so the four own ones are the four
  // before it — which is also the assertion: `compareColumns` puts every global first (TTU-21).
  check(
    'die vier Köpfe stehen in der Tabelle, ohne Neuladen und hinter den globalen',
    ccHeadRow.slice(-5, -1).join(' | ') === '👤 Zuständig | Zusage bis | Vertrag | Phase',
    ccHeadRow.join(' | '),
  );
  check(
    '…und der Dialog steht dabei noch offen',
    (await ccDlg.getByRole('heading', { name: 'Spalten verwalten' }).count()) === 1,
  );
  check(
    'nur die Spalte mit Symbol trägt es im Kopf, die anderen stehen ohne da',
    ccText?.icon === '👤' && ccBox?.icon === null && ccHeadRow.includes('Vertrag'),
    `${ccText?.icon} / ${ccBox?.icon}`,
  );
  await cc.keyboard.press('Escape');
  await gone(cc.getByRole('heading', { name: 'Spalten verwalten' }), 5000);

  // ======================================================================== AM · one value per type
  //
  // Four widgets, four ways in, one blob. The row starts empty — a fixture fact of project 2 — so
  // every poll below can only be satisfied by what this case types into it.
  console.log('\nAM · Ein Wert je Typ: eingegeben, gespeichert, angezeigt');
  const CC_TASK = 34; // „Schulen kontaktieren", the one project-2 row that carries a Fällig date
  const CC_OTHER = 35; // „Material für Workshop drucken" — no dates at all, the empty control
  const ccValues = (id) => api(CC(`/tasks/${id}`)).then((t) => JSON.parse(t.custom_values || '{}'));
  const ccKey = (col) => String(col?.id ?? 0);

  const ccEmptyStart = await ccValues(CC_TASK);
  check(
    'die Zeile startet ohne einen einzigen eigenen Wert',
    Object.keys(ccEmptyStart).length === 0,
    JSON.stringify(ccEmptyStart),
  );

  // Built with `setDate`, never `Date.now() + n * 86_400_000`: everything stored here is naive
  // local time, and a fixed span of milliseconds names a different day across a DST change.
  const ccDay = new Date();
  ccDay.setDate(ccDay.getDate() + 40);
  const ccIso = `${ccDay.getFullYear()}-${pad2(ccDay.getMonth() + 1)}-${pad2(ccDay.getDate())}`;
  const ccGerman = `${pad2(ccDay.getDate())}.${pad2(ccDay.getMonth() + 1)}.${ccDay.getFullYear()}`;

  /** Open a cell's inline editor, type, commit with Enter. Every step bounded and swallowed. */
  const ccType = async (taskId, name, text) => {
    await clickIfThere(ccCell(taskId, name).locator('button'));
    const input = ccCell(taskId, name).locator('input');
    if (!(await shown(input, 4000))) return false;
    await ccFill(input, text);
    return ccPress(input, 'Enter');
  };
  /**
   * A pill is a popover: `useAnchoredPopover` closes on any outside scroll, and the scroll a click
   * performs for itself arrives *after* the menu opened — so scroll first, then click. The menu
   * is waited for rather than assumed, so a caller that could not open it says so.
   *
   * **Scrolling first is only half of it, and the other half is what CI went red on** (#155).
   * Playwright's `click()` scrolls a second time — after its visible/stable/enabled wait, with
   * nothing between that scroll and the mouse events — so a layout that has moved since the
   * explicit scroll gives it something to scroll, and the event it queues is delivered a frame
   * later, into the listener the menu registered as it opened. What moves the layout on a loaded
   * runner is the refetch each of the three writes above fans out over the run's ~30 windows.
   * Measured with that move injected: `listbox+` 1104 ms, `scroll` 1105 ms, `listbox-` 1111 ms,
   * 4 of 12 runs — the rate the `browser` job showed, and the reason the same failure arrived
   * once as „Eintrag sichtbar false" and once as „sichtbar true, geklickt false".
   *
   * So what is waited for is a menu that has **survived a frame**, not one that has appeared:
   * `scrollSettled` before the click delivers the scroll this helper caused, `scrollSettled` after
   * it delivers the one the click caused, and a listbox still standing past both was not opened
   * into a pending close. A menu that is gone by then was never open, so the gesture is simply
   * made again — the second attempt finds the row where the first left it, scrolls nothing and
   * queues nothing. Three attempts, so a build whose pill genuinely does not open still goes red by
   * assertion rather than looping — and every retry is both named where it happens and counted onto
   * the summary line, the way `surfaceSettled`'s reload is, because „this run raced and recovered"
   * must never read as „this run was clean".
   */
  const ccPillIn = (taskId, name) => ccCell(taskId, name).locator('button[aria-haspopup="listbox"]');
  const ccOpenPill = async (taskId, name) => {
    const ccMenuEl = cc.locator('[role="listbox"]');
    for (let attempt = 1; attempt <= 3; attempt++) {
      await ccPillIn(taskId, name).scrollIntoViewIfNeeded().catch(() => {});
      await scrollSettled(cc);
      if (!(await clickIfThere(ccPillIn(taskId, name)))) return false;
      if (await shown(ccMenuEl, 4000)) {
        await scrollSettled(cc);
        if ((await ccMenuEl.count()) > 0) return true;
      }
      notePopoverReopened(name, attempt, 3);
    }
    return false;
  };

  /**
   * One reading of a row's cells — text, checkbox state, pill colour and how many controls the
   * cell offers. A single `evaluate`, because two round trips can straddle a background refetch's
   * re-render and compare readings taken from different commits. Declared above the writes because
   * each write is now waited out on what it reads (see the block below).
   */
  const ccRender = (taskId, positions) =>
    cc.evaluate(
      ([id, pos]) => {
        const tds = [...document.querySelectorAll(`tr[data-task-id="${id}"] td`)];
        /** @type {Record<string, {text: string, checked: boolean|null, pill: string|null, controls: number}>} */
        const out = {};
        for (const [key, i] of Object.entries(pos)) {
          const td = tds[Number(i) - 1];
          const box = /** @type {HTMLInputElement | null | undefined} */ (
            td?.querySelector('input[type="checkbox"]')
          );
          const pill = td?.querySelector('button[aria-haspopup="listbox"]');
          out[key] = {
            text: (td?.textContent ?? '').trim(),
            checked: box ? box.checked : null,
            pill: pill ? getComputedStyle(pill).backgroundColor : null,
            controls: td
              ? td.querySelectorAll('button, input, select, textarea, [contenteditable], div.cursor-text').length
              : -1,
          };
        }
        return out;
      },
      [taskId, positions],
    );
  const ccFourAt = () => ({
    text: ccAt('Zuständig'),
    date: ccAt('Zusage bis'),
    box: ccAt('Vertrag'),
    sel: ccAt('Phase'),
  });

  // One write at a time, and each one waited out on the **screen** before the next gesture — not
  // on the API. A task write publishes nothing optimistically, so `ccValues` (the GET) reports the
  // value while the row is still mid-write: the commit's blanket invalidate has fired but its
  // refetch has not landed, the cell has not re-rendered and `InlineInput` is still mounted. A
  // gesture started there lands on a table that re-renders under it — the pick goes nowhere and the
  // cell stays „—" (measured once in a full run). So each write polls `ccRender` until its value is
  // on screen, which proves the refetch landed and the row re-rendered. That is the determinism
  // „several writes inside one refetch window" needs; AN·6 reaches it from the other side, by
  // holding the GET on purpose (#177).
  await ccType(CC_TASK, 'Zuständig', 'Merle Dahlke');
  await until(() => ccRender(CC_TASK, ccFourAt()), (r) => r.text?.text === 'Merle Dahlke', 8000);
  await ccType(CC_TASK, 'Zusage bis', ccIso);
  await until(() => ccRender(CC_TASK, ccFourAt()), (r) => r.date?.text === ccGerman, 8000);
  await clickIfThere(ccCell(CC_TASK, 'Vertrag').locator('input[type="checkbox"]'));
  await until(() => ccRender(CC_TASK, ccFourAt()), (r) => r.box?.checked === true, 8000);
  // The pick is the one write here that is neither a keystroke nor a toggle, and it is the one
  // that has landed nowhere on a slow runner — twice in CI, both times as `select:undefined` and a
  // grey placeholder. That was the popover being shut by the scroll its own click performed, and
  // `ccOpenPill` above now waits that scroll out (#155). Two waits all the same, because there are
  // still two things to wait for: `ccOpenPill` waits for the listbox, and the *option inside it* is
  // waited for here — a menu that is on screen while the table under it re-renders can still be
  // empty. Both booleans, and the click's own, travel into the check: without them „the value was
  // not stored" and „the option was never clicked" are the same red line, and the run that needs
  // reading is the one that cannot say which.
  const ccPillOpen = await ccOpenPill(CC_TASK, 'Phase');
  const ccOption = cc.locator(`[role="option"][data-value="${CC_PHASES[0]}"]`);
  const ccOptionShown = await shown(ccOption, 4000);
  const ccPicked = await clickIfThere(ccOption);
  // Read while the `false` is still in hand: without it „geklickt false" is three different
  // defects wearing one word, and this line is the one that placed WP-83 (browser.mjs).
  const ccWhy = ccPicked ? '' : ` — ${clickFailure()}`;

  const ccStored = await until(() => ccValues(CC_TASK), (v) => Object.keys(v).length === 4, 8000);
  check(
    'alle vier Typen schreiben in dieselbe Zelle der Zeile, jeder unter seiner Spalten-id',
    ccPillOpen &&
      ccOptionShown &&
      ccPicked &&
      ccStored[ccKey(ccText)] === 'Merle Dahlke' &&
      ccStored[ccKey(ccDate)] === ccIso &&
      ccStored[ccKey(ccBox)] === true &&
      ccStored[ccKey(ccSel)] === CC_PHASES[0],
    `Menü ${ccPillOpen}, Eintrag sichtbar ${ccOptionShown}, geklickt ${ccPicked}${ccWhy}, ${JSON.stringify(ccStored)}`,
  );
  check(
    '…die Checkbox als echter Boolean, die drei anderen als Zeichenkette',
    typeof ccStored[ccKey(ccBox)] === 'boolean' &&
      [ccText, ccDate, ccSel].every((c) => typeof ccStored[ccKey(c)] === 'string'),
    ccFour.map((c) => `${c?.type}:${typeof ccStored[ccKey(c)]}`).join(' '),
  );

  // The colour comes from the column's own options rather than from a literal: it is the swatch
  // the user picked in the form above, and a hardcoded value would pass on a pill painted by
  // something else entirely.
  const ccFirstColour = ccRgb(JSON.parse(ccSel?.options ?? '[]')[0]?.color);
  // It is also in the poll's predicate, and that is not tidiness: the pill carries Tailwind's
  // `transition`, so its background is interpolating from the grey placeholder for 150 ms after
  // the pick, and `reducedMotion: 'reduce'` touches animations rather than transitions. A reading
  // taken on the *label* alone caught it mid-flight at `rgb(254, 227, 227)` for a category
  // configured as `#fee2e2`, which reads as „the pill paints the wrong colour".
  const ccOn = await until(
    () => ccRender(CC_TASK, ccFourAt()),
    (r) => r.text?.text === 'Merle Dahlke' && r.sel?.text === CC_PHASES[0] && r.sel?.pill === ccFirstColour,
    8000,
  );
  check('die Textspalte zeigt genau das Getippte', ccOn.text?.text === 'Merle Dahlke', String(ccOn.text?.text));
  check(
    'die Datumsspalte zeigt den deutschen Tag, gespeichert bleibt die ISO-Form',
    ccOn.date?.text === ccGerman && ccStored[ccKey(ccDate)] === ccIso,
    `${ccOn.date?.text} / ${ccStored[ccKey(ccDate)]}`,
  );
  check('die Checkbox steht auf gesetzt', ccOn.box?.checked === true, String(ccOn.box?.checked));
  check(
    'die Auswahl trägt die Bezeichnung ihrer Kategorie in deren eigener Farbe',
    ccOn.sel?.text === CC_PHASES[0] && ccOn.sel?.pill === ccFirstColour,
    `${ccOn.sel?.text} / ${ccOn.sel?.pill} statt ${ccFirstColour}`,
  );

  const ccOff = await ccRender(CC_OTHER, ccFourAt());
  check(
    'die Nachbarzeile bleibt in allen vier Spalten leer — „—“, „—“, ungesetzt, „—“',
    ccOff.text?.text === '—' &&
      ccOff.date?.text === '—' &&
      ccOff.box?.checked === false &&
      ccOff.sel?.text === '—',
    `${ccOff.text?.text} | ${ccOff.date?.text} | ${ccOff.box?.checked} | ${ccOff.sel?.text}`,
  );

  /** The values a pill's menu offers, in order — then close it again. */
  const ccMenu = async (taskId, name) => {
    if (!(await ccOpenPill(taskId, name))) return null;
    const values = await cc
      .locator('[role="listbox"] [role="option"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-value') ?? ''));
    await cc.keyboard.press('Escape');
    await gone(cc.locator('[role="listbox"]'), 4000);
    return values;
  };
  const ccSelMenu = await ccMenu(CC_TASK, 'Phase');
  const ccStatusMenu = await ccMenu(CC_TASK, 'Status');
  check(
    'die eigene Auswahl bietet zusätzlich „kein Wert“ an …',
    (ccSelMenu ?? []).join(' | ') === ['', ...CC_PHASES].join(' | '),
    (ccSelMenu ?? []).join(' | ') || 'kein Menü',
  );
  // `CustomCell` passes `allowEmpty` and the Status branch does not, so the empty entry is the one
  // thing that tells the two uses of the same pill apart — „it lists the categories" does not.
  // The second half is an **invariant guard**: nothing would *add* an empty option to Status, so
  // only the pair means anything, and it is the line above that a revert reddens.
  check(
    '…die Status-Spalte daneben nicht: dieselbe Pille, zwei Verträge',
    Array.isArray(ccStatusMenu) && ccStatusMenu.length > 0 && !ccStatusMenu.includes(''),
    (ccStatusMenu ?? []).join(' | ') || 'kein Menü',
  );

  // ======================================================================== AN · what a cell refuses
  //
  // The other half of „does the type work": what must *not* be written. Every refusal below is
  // paired with the acceptance that proves the cell was reachable at all — AM is that pair for the
  // three positive cases, and the two that need one of their own carry it in the same check.
  console.log('\nAN · Was eine Zelle verwirft — und was sie nicht verlieren darf');

  /**
   * Every task PATCH this page issues, so „nothing was written" is a reading and not a hope.
   * @type {string[]}
   */
  const ccPatches = [];
  cc.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().includes('/api/tasks/')) ccPatches.push(r.url());
  });

  // 1 · a half-typed date, in an **empty** cell: typing a segment into a filled one replaces that
  // segment and the value stays complete, so the same check would pass vacuously there.
  ccPatches.length = 0;
  await clickIfThere(ccCell(CC_OTHER, 'Zusage bis').locator('button'));
  const ccHalf = ccCell(CC_OTHER, 'Zusage bis').locator('input');
  if (await shown(ccHalf, 4000)) await cc.keyboard.type('12');
  const ccBad = await ccHalf
    .first()
    .evaluate((el) => {
      const input = /** @type {HTMLInputElement} */ (el);
      return { value: input.value, bad: input.validity.badInput };
    })
    .catch(() => null);
  // Asserted as its own precondition: on a browser whose date segments are ordered differently,
  // two digits might complete the field and everything below would pass without a repro.
  check(
    'zwei Ziffern in einer leeren Datumszelle sind noch kein Datum — der Browser sagt es selbst',
    ccBad?.bad === true && ccBad?.value === '',
    JSON.stringify(ccBad),
  );
  await ccPress(ccHalf, 'Enter');
  await sleep(600);
  const ccStillOpen = await ccCell(CC_OTHER, 'Zusage bis').locator('input').count();
  check(
    'Enter schreibt darauf nichts und lässt den Editor offen, damit das Datum fertig getippt werden kann (WP-43)',
    ccStillOpen === 1 && ccPatches.length === 0,
    `${ccStillOpen} Feld(er), ${ccPatches.length} PATCH`,
  );
  await cc.keyboard.press('Escape');
  await gone(ccCell(CC_OTHER, 'Zusage bis').locator('input'), 4000);
  const ccOtherValues = await ccValues(CC_OTHER);
  check(
    '…und Escape wirft die Ziffern weg, statt eine leere Zelle daraus zu machen',
    Object.keys(ccOtherValues).length === 0 && ccPatches.length === 0,
    `${JSON.stringify(ccOtherValues)}, ${ccPatches.length} PATCH`,
  );

  // 2 · Escape in a text cell that *has* a value: the draft goes, the stored value stands.
  ccPatches.length = 0;
  await clickIfThere(ccCell(CC_TASK, 'Zuständig').locator('button'));
  const ccDraft = ccCell(CC_TASK, 'Zuständig').locator('input');
  if (await shown(ccDraft, 4000)) {
    await ccFill(ccDraft, 'Etwas ganz anderes');
    await ccPress(ccDraft, 'Escape');
  }
  await sleep(600);
  const ccKept = (await ccValues(CC_TASK))[ccKey(ccText)];
  check(
    'Escape in einer Textzelle verwirft den Entwurf, ohne zu schreiben',
    ccPatches.length === 0 && ccKept === 'Merle Dahlke',
    `${ccPatches.length} PATCH, ${JSON.stringify(ccKept)}`,
  );

  // 3 · the pair only the API witnesses: an emptied custom cell keeps its key with an empty value
  // (`empty: 'raw'`), an emptied Fällig really becomes NULL (`empty: 'clear'`). Both are „—".
  const ccDueBefore = (await api(CC(`/tasks/${CC_TASK}`))).due_date;
  await ccType(CC_TASK, 'Zuständig', '');
  const ccCleared = await until(() => ccValues(CC_TASK), (v) => v[ccKey(ccText)] === '', 8000);
  check(
    'eine geleerte eigene Textspalte behält ihren Schlüssel mit leerem Wert',
    ccKey(ccText) in ccCleared && ccCleared[ccKey(ccText)] === '',
    JSON.stringify(ccCleared),
  );
  await ccType(CC_TASK, 'Fällig', '');
  const ccDueAfter = await until(
    () => api(CC(`/tasks/${CC_TASK}`)).then((t) => t.due_date),
    (v) => v === null,
    8000,
  );
  check(
    '…während das geleerte eingebaute „Fällig“ daneben wirklich NULL wird',
    !!ccDueBefore && ccDueAfter === null,
    `${ccDueBefore} → ${JSON.stringify(ccDueAfter)}`,
  );
  const ccDashes = await until(
    () => ccRender(CC_TASK, { text: ccAt('Zuständig'), due: ccAt('Fällig') }),
    (r) => r.text?.text === '—' && r.due?.text === '—',
    8000,
  );
  check(
    '…und beide zeigen denselben Strich: der Unterschied steht nur in der Datenbank',
    ccDashes.text?.text === '—' && ccDashes.due?.text === '—',
    `${ccDashes.text?.text} / ${ccDashes.due?.text}`,
  );

  // 4 · unticking writes `false` rather than dropping the key — a checkbox has no „unset".
  await clickIfThere(ccCell(CC_TASK, 'Vertrag').locator('input[type="checkbox"]'));
  const ccUnticked = await until(() => ccValues(CC_TASK), (v) => v[ccKey(ccBox)] === false, 8000);
  check(
    'die abgehakte Checkbox schreibt `false`, statt den Schlüssel zu entfernen',
    ccKey(ccBox) in ccUnticked && ccUnticked[ccKey(ccBox)] === false,
    JSON.stringify(ccUnticked),
  );

  // 5 · the built-in that renders and takes nothing, on purpose — with the pair that says the row
  // was reachable at all. („Erstellt am" is the other one and ships hidden.)
  //
  // The markup half and the behaviour half below are both **invariant guards**: they forbid an
  // editor being *added* to a read-only cell, which no revert of an existing fix produces. The pair
  // between them — the custom text cell of the same row offering exactly one control — is what a
  // broken selector fails on, and canaries 1 and 3 redden that column's neighbours for other
  // reasons.
  const ccReadOnly = await ccRender(CC_TASK, {
    upd: ccAt('Zuletzt bearbeitet'),
    text: ccAt('Zuständig'),
  });
  check(
    '„Zuletzt bearbeitet“ zeigt einen Wert und bietet kein einziges Bedienelement an …',
    ccReadOnly.upd?.controls === 0 && (ccReadOnly.upd?.text ?? '').length > 0,
    JSON.stringify(ccReadOnly.upd),
  );
  check(
    '…die eigene Textspalte derselben Zeile dagegen genau eines',
    ccReadOnly.text?.controls === 1,
    JSON.stringify(ccReadOnly.text),
  );
  // The behaviour half of the guard above: a missing button is not a missing handler.
  await clickIfThere(ccCell(CC_TASK, 'Zuletzt bearbeitet'));
  await sleep(400);
  check(
    'ein Klick darauf öffnet nichts — ein fehlender Knopf ist nicht dasselbe wie ein fehlender Handler',
    (await ccCell(CC_TASK, 'Zuletzt bearbeitet').locator('input').count()) === 0,
  );

  // 6 · two cells written before the row's own refetch has landed (TTU-23). `commitCustom` sends
  // the changed key alone and the server merges it; a version that sent the whole blob would
  // rebuild it from the `task` captured at render time and silently undo the first write. The GET
  // has to be held, or the refetch beats the second click and both versions pass — measured on
  // this page: PATCH 1 at +0 ms, its refetch issued at +11 ms and held, PATCH 2 at +61 ms.
  // `continue()` is guarded: an in-flight handler that is still sleeping when the `unroute` below
  // runs rejects with „Route is already handled", and a route callback is outside this file's try
  // — the rejection took the whole run down rather than one assertion.
  await cc.route('**/api/tasks*', async (route) => {
    if (route.request().method() === 'GET') await sleep(1200);
    await route.continue().catch(() => {});
  });
  await clickIfThere(ccCell(CC_TASK, 'Vertrag').locator('input[type="checkbox"]'));
  await ccOpenPill(CC_TASK, 'Phase');
  await clickIfThere(cc.locator(`[role="option"][data-value="${CC_PHASES[1]}"]`));
  const ccBoth = await until(
    () => ccValues(CC_TASK),
    (v) => v[ccKey(ccBox)] === true && v[ccKey(ccSel)] === CC_PHASES[1],
    12_000,
  );
  await cc.unroute('**/api/tasks*');
  check(
    'zwei Zellen kurz hintereinander, bevor die Zeile neu geladen ist: beide Werte stehen (TTU-23)',
    ccBoth[ccKey(ccBox)] === true && ccBoth[ccKey(ccSel)] === CC_PHASES[1],
    JSON.stringify(ccBoth),
  );

  // 7 · the open menu survives the table re-laying out under it (WP-83). Not a scroll anybody
  // performs: an open `InlineInput` is wider than the value it commits — `min-w-48` here, `w-40`
  // on the date cell — and it closes only once its write's blanket `invalidate()` resolves, which
  // on a run with this gate's windows open arrives long after the server already has the value.
  // So the column narrows *while the pill's menu stands*, and with the wrapper at its right-hand
  // end the browser has to pull `scrollLeft` back into range — a `scroll` event with nobody
  // behind it, which used to shut the menu 9 ms later (docs/VERIFYING.md).
  //
  // Held rather than raced: parking the PATCH's *answer* puts the editor's close exactly where a
  // loaded runner puts it by accident, so this is one measurement and not a coin toss. Unforced,
  // the same clamp landed inside the *opening* gesture in 6 of 30 runs — where `ccOpenPill`'s
  // retry hides it — and inside the click far more rarely, which is why it took four CI reds.
  /** The `overflow-x-auto` the task table sits in, and nothing else on the page. */
  const ccWrap = (mode) =>
    cc.evaluate((how) => {
      const table = [...document.querySelectorAll('table')].find((t) =>
        [...t.querySelectorAll('thead th')].some((th) => (th.textContent ?? '').trim() === 'Aufgabe'),
      );
      const w = table?.closest('div.overflow-x-auto');
      if (!w) return null;
      if (how === 'end') {
        w.scrollLeft = w.scrollWidth;
        return null;
      }
      return { left: Math.round(w.scrollLeft), sw: Math.round(w.scrollWidth) };
    }, mode);
  /** Where the pill sits on screen — the reference the hook's own guard decides against. */
  const ccPillBox = () =>
    ccPillIn(CC_TASK, 'Phase')
      .first()
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top) };
      })
      .catch(() => null);
  /** Park the next task PATCH's answer until `release()`. Same shape as the landing case's. */
  const ccHoldPatch = () => {
    /** @type {{ held: boolean, release: (v?: unknown) => void }} */
    const state = { held: false, release: () => {} };
    const gate = new Promise((r) => {
      state.release = r;
    });
    heldRoutes.push(state);
    return cc
      .route('**/api/tasks/*', async (route) => {
        if (route.request().method() === 'PATCH' && !state.held) {
          state.held = true;
          await gate;
        }
        await route.continue().catch(() => {}); // see the guard above
      })
      .then(() => state);
  };

  const ccHold = await ccHoldPatch();
  await clickIfThere(ccCell(CC_TASK, 'Zuständig').locator('button'));
  const ccWideInput = ccCell(CC_TASK, 'Zuständig').locator('input');
  const ccEditorUp = await shown(ccWideInput, 4000);
  await ccFill(ccWideInput, 'Merle Dahlke-Wittenbrink (Vertretung)');
  await ccWrap('end');
  await scrollSettled(cc);
  // Opening the pill is also what blurs the editor, so the commit — and the answer now parked —
  // is the same gesture that puts the menu on screen, exactly as in AM.
  const ccMenuUp = await ccOpenPill(CC_TASK, 'Phase');
  await until(async () => ccHold.held, (v) => v === true, SETTLED_MS);
  const ccWrapBefore = await ccWrap();
  const ccPillBefore = await ccPillBox();
  ccHold.release();
  const ccWrapAfter = await until(
    ccWrap,
    (w) => !!w && !!ccWrapBefore && w.sw < ccWrapBefore.sw && w.left < ccWrapBefore.left,
    SETTLED_MS,
  );
  const ccPillAfter = await ccPillBox();
  const ccMenuSurvived = (await cc.locator('[role="listbox"]').count()) > 0;
  await cc.unroute('**/api/tasks/*');

  // The precondition, and it carries every part of the cause: the editor was open, the menu was
  // open, the table really did get narrower and the browser really did pull the wrapper back. A
  // check for „the menu is still there" without this passes on a run where nothing ever happened.
  check(
    'der schließende Editor macht die Tabelle schmaler, und der Browser setzt den Wrapper zurück — ohne dass jemand scrollt (WP-83)',
    ccEditorUp &&
      ccMenuUp &&
      !!ccWrapBefore &&
      !!ccWrapAfter &&
      ccWrapAfter.sw < ccWrapBefore.sw &&
      ccWrapAfter.left < ccWrapBefore.left,
    `Editor ${ccEditorUp}, Menü ${ccMenuUp}, ${ccWrapBefore?.sw}→${ccWrapAfter?.sw} breit, links ${ccWrapBefore?.left}→${ccWrapAfter?.left}`,
  );
  // And the finding. The pill's own position is in the detail because it is the reason: the table
  // loses exactly what the clamp takes back, so the trigger never moves and the menu was never
  // out of place — a scroll that moves nothing may not take a menu away mid-Auswahl.
  check(
    '…und das offene Menü bleibt trotzdem stehen, weil die Pille sich dabei nicht bewegt hat',
    ccMenuSurvived && !!ccPillBefore && !!ccPillAfter && ccPillBefore.x === ccPillAfter.x && ccPillBefore.y === ccPillAfter.y,
    `${ccMenuSurvived ? 'Menü steht' : 'Menü zu'}, Pille ${JSON.stringify(ccPillBefore)} → ${JSON.stringify(ccPillAfter)}`,
  );
  await cc.keyboard.press('Escape');
  await gone(cc.locator('[role="listbox"]'), 4000);
  // Put the text cell back the way AN·3 left it, so AO reads the state this file documented.
  await send('PATCH', CC(`/tasks/${CC_TASK}`), { custom_values: { [ccKey(ccText)]: '' } });

  // 8 · the other half of AN·7 (#176). WP-83 handles the *clamp* case — a `scroll` event fires and
  // the pill happens to be stationary. This is the case with no clamp at all: with `scrollLeft` at 0
  // there is room to spare, so a column collapsing to the pill's left narrows the table and slides
  // the pill left with **nothing dispatched**. `onScroll` never runs, and before #176 the open menu
  // simply stayed where it opened — now detached from its pill. The cause is a genuine column
  // collapse (the table's border-box narrows, exactly as a closing editor narrows it) and the follow
  // is asserted only here, where it was injected. A `ResizeObserver` on the pill's ancestors is the
  // only thing that can move the menu without a scroll, so a pass is proof it fired.
  await cc.evaluate(() => {
    const table = [...document.querySelectorAll('table')].find((t) =>
      [...t.querySelectorAll('thead th')].some((th) => (th.textContent ?? '').trim() === 'Aufgabe'),
    );
    const wrap = table?.closest('div.overflow-x-auto');
    if (wrap) wrap.scrollLeft = 0; // room to spare ⇒ the coming shrink needs no clamp
  });
  await scrollSettled(cc);
  /** The Status pill's on-screen left and the open menu's left, plus the pill's column index. */
  const ccFollowMeasure = () =>
    cc.evaluate((taskId) => {
      const tr = /** @type {HTMLTableRowElement | null} */ (
        document.querySelector(`tr[data-task-id="${taskId}"]`)
      );
      const table = tr?.closest('table');
      const sTh = /** @type {HTMLTableCellElement | undefined} */ (
        table
          ? [...table.querySelectorAll('thead th')].find((th) => (th.textContent ?? '').trim() === 'Status')
          : undefined
      );
      const sIdx = sTh ? sTh.cellIndex : -1;
      const pill = sIdx >= 0 ? tr?.cells[sIdx]?.querySelector('button[aria-haspopup="listbox"]') : null;
      const menu = document.querySelector('[role="listbox"]');
      const pr = pill?.getBoundingClientRect();
      const mr = menu?.getBoundingClientRect();
      return {
        menuOpen: !!menu,
        sIdx,
        pillLeft: pr ? Math.round(pr.left) : null,
        menuLeft: mr ? Math.round(mr.left) : null,
      };
    }, CC_TASK);
  const ccFollowOpen = await ccOpenPill(CC_TASK, 'Status');
  const ccFollowBefore = await ccFollowMeasure();
  const ccFollowLeftIdx = ccFollowBefore.sIdx - 1; // the column immediately left of the pill
  const ccFollowShrink = await cc.evaluate((leftIdx) => {
    const table = [...document.querySelectorAll('table')].find((t) =>
      [...t.querySelectorAll('thead th')].some((th) => (th.textContent ?? '').trim() === 'Aufgabe'),
    );
    if (!table || leftIdx < 0) return { ok: false };
    const w = /** @type {{ __pop176scrolled?: boolean }} */ (/** @type {unknown} */ (window));
    w.__pop176scrolled = false;
    document.addEventListener('scroll', () => { w.__pop176scrolled = true; }, true);
    const w0 = Math.round(table.getBoundingClientRect().width);
    for (const row of table.rows) {
      const cell = row.cells[leftIdx];
      if (cell) cell.style.display = 'none';
    }
    return { ok: true, widthBefore: w0, widthAfter: Math.round(table.getBoundingClientRect().width) };
  }, ccFollowLeftIdx);
  await cc.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(60);
  const ccFollowAfter = await ccFollowMeasure();
  const ccFollowScrolled = await cc.evaluate(
    () => /** @type {{ __pop176scrolled?: boolean }} */ (/** @type {unknown} */ (window)).__pop176scrolled === true,
  );
  // Restore the collapsed column — AO reloads right after, but leave the DOM as found.
  await cc.evaluate((leftIdx) => {
    const table = [...document.querySelectorAll('table')].find((t) =>
      [...t.querySelectorAll('thead th')].some((th) => (th.textContent ?? '').trim() === 'Aufgabe'),
    );
    if (table && leftIdx >= 0) for (const row of table.rows) {
      const cell = row.cells[leftIdx];
      if (cell) cell.style.display = '';
    }
  }, ccFollowLeftIdx);

  // Precondition: the menu opened, a column really collapsed, the pill really slid left, and no
  // scroll was behind it — without all of that, „the menu followed" would prove nothing.
  check(
    'eine Spalte links der Pille klappt zusammen, die Pille rutscht nach links — und niemand scrollt dabei (#176)',
    ccFollowOpen &&
      !!ccFollowShrink.ok &&
      ccFollowShrink.widthAfter < ccFollowShrink.widthBefore &&
      ccFollowBefore.pillLeft != null &&
      ccFollowAfter.pillLeft != null &&
      ccFollowBefore.pillLeft - ccFollowAfter.pillLeft >= 5 &&
      !ccFollowScrolled,
    `Menü ${ccFollowOpen}, ${ccFollowShrink.widthBefore}→${ccFollowShrink.widthAfter} breit, Pille ${ccFollowBefore.pillLeft}→${ccFollowAfter.pillLeft}, scroll ${ccFollowScrolled}`,
  );
  // The finding: the ResizeObserver kept the menu glued to the pill it moved with.
  check(
    '…und das offene Menü folgt der Pille, statt sich von ihr zu lösen (#176)',
    ccFollowAfter.menuOpen &&
      ccFollowAfter.menuLeft != null &&
      ccFollowAfter.pillLeft != null &&
      Math.abs(ccFollowAfter.menuLeft - ccFollowAfter.pillLeft) <= 2,
    ccFollowAfter.menuOpen ? `Menü x ${ccFollowAfter.menuLeft} vs Pille x ${ccFollowAfter.pillLeft}` : 'Menü zu',
  );
  await cc.keyboard.press('Escape');
  await gone(cc.locator('[role="listbox"]'), 4000);

  // ======================================================================== AO · hiding across the types
  //
  // Case G asserts the write shape for one global built-in on an artist page. Here: what the same
  // 👁 does in the *other* list, three types hidden in one burst, and what hiding a column does to
  // a sort that is running on it — which is only reachable from a page's own scope group, because
  // the manager sits on the page and the table therefore stays mounted across the write.
  console.log('\nAO · Ein- und Ausblenden quer über die Typen');

  // One category per task, chosen so all three candidate orders differ: the season default is
  // 35 40 34, the configured category order 34 40 35, and a plain string compare over the stored
  // values would give 40 35 34. Written over the API and reloaded — the pill is AM's ground, and
  // what this case is about starts at the header.
  const CC_ORDER = { 34: CC_PHASES[0], 40: CC_PHASES[1], 35: CC_PHASES[2] };
  for (const [id, value] of Object.entries(CC_ORDER)) {
    await send('PATCH', CC(`/tasks/${id}`), { custom_values: { [ccKey(ccSel)]: value } });
  }
  const ccConfigured = CC_PHASES.map((p) => Object.keys(CC_ORDER).find((id) => CC_ORDER[id] === p));
  const ccAlphabetical = Object.keys(CC_ORDER).sort((a, b) => (CC_ORDER[a] < CC_ORDER[b] ? -1 : 1));

  await cc.goto(`${UI}/#/project/2`);
  await cc.reload();
  await ready(cc);
  ccHeadRow = await until(ccHeads, (h) => h.some((x) => x.includes('Phase')), 8000);
  const ccDefaultOrder = await until(() => rowIds(cc), (r) => r.length === 3, 8000);
  check(
    'die drei Zeilen stehen in der Reihenfolge der Saison-Regel',
    ccDefaultOrder.join(' ') === '35 40 34',
    ccDefaultOrder.join(' ') || 'keine Zeilen',
  );

  /**
   * A header cell of the **task** table. Anchored the way `ccHeads` is: a project description can
   * render a Markdown table of its own, and a page-wide `table thead th` would let a heading in
   * one of those answer for a column.
   */
  const ccTh = (name) =>
    cc
      .locator('table')
      .filter({ has: cc.locator('thead th', { hasText: /^Aufgabe$/ }) })
      .first()
      .locator('thead th')
      .filter({ hasText: new RegExp(name, 'i') })
      .first();
  /** The ⠿'s tooltip: the bare sentence, or the one naming the sort that has disabled it. */
  const ccHandleTitle = () =>
    cc
      .locator('tr[data-task-id] td:first-child span[title]')
      .first()
      .getAttribute('title')
      .catch(() => '');
  const ccTitleBefore = await ccHandleTitle();

  await clickIfThere(ccTh('Phase'));
  // „changed at all" rather than „is the expected order", deliberately: a build that sorts by the
  // wrong key still changes the order, and this way the assertion below reports *that* order
  // instead of timing out and reporting the one it started from. Canary 11 is what it looks like.
  const ccSorted = await until(() => rowIds(cc), (r) => r.join(' ') !== ccDefaultOrder.join(' '), 8000);
  check(
    'ein Klick auf den „Phase“-Kopf ordnet nach der eingestellten Kategorien-Reihenfolge (TTU-19)',
    ccSorted.join(' ') === ccConfigured.join(' '),
    `${ccSorted.join(' ')} (erwartet ${ccConfigured.join(' ')})`,
  );
  check(
    '…und nicht alphabetisch nach dem gespeicherten Wert — die drei Reihenfolgen sind alle verschieden',
    ccConfigured.join(' ') !== ccAlphabetical.join(' ') &&
      ccConfigured.join(' ') !== ccDefaultOrder.join(' ') &&
      ccSorted.join(' ') !== ccAlphabetical.join(' '),
    `konfiguriert ${ccConfigured.join(' ')}, alphabetisch ${ccAlphabetical.join(' ')}, Vorgabe ${ccDefaultOrder.join(' ')}`,
  );
  const ccMarker = await ccTh('Phase').innerText().catch(() => '');
  check(
    '…der Kopf zeigt die Richtung, und der ⠿ sagt, warum er gerade nicht zieht',
    ccMarker.includes('▲') && (await ccHandleTitle())?.startsWith('Spaltensortierung aktiv'),
    `${ccMarker.replace(/\n/g, ' ')} / ${await ccHandleTitle()}`,
  );

  await clickIfThere(cc.getByRole('button', { name: '⚙ Spalten' }).first());
  const ccMgr2 = topDialog(cc);
  const ccMgr2Up = await shown(ccMgr2.getByRole('heading', { name: 'Spalten verwalten' }), 8000);
  await clickIfThere(
    ccMgr2.locator('[data-column-row]').filter({ hasText: 'Phase' }).first().locator('button[title="Ausblenden"]'),
  );
  const ccConfirm = topDialog(cc);
  // Truncated for the *detail* only: when this dialog fails to appear, `topDialog` is the manager
  // behind it and its whole text — every column row, every emoji preset — would be the line.
  const ccConfirmText = (
    await ccConfirm.evaluate((el) => (el.textContent ?? '').trim()).catch(() => '')
  ).replace(/\s+/g, ' ');
  const ccConfirmSeen = ccConfirmText.slice(0, 140) || 'kein Dialog';
  check(
    'die eigene Spalte auszublenden fragt erst nach — und sagt, dass die Werte bleiben',
    ccMgr2Up &&
      ccConfirmText.includes('Spalte „Phase“ ausblenden') &&
      ccConfirmText.includes('Die vorhandenen Werte bleiben erhalten'),
    ccConfirmSeen,
  );
  await clickIfThere(ccConfirm.getByRole('button', { name: 'Ausblenden' }));
  const ccHiddenFlag = await until(
    () => ccOwnCols().then((cols) => cols.find((c) => c.id === ccSel?.id)?.enabled),
    (v) => v === 0,
    8000,
  );
  // The discriminator against case G: the same 👁, one list further down, writes the column's
  // season default and leaves this page's own map alone.
  //
  // The map half is „nothing was written", and that cannot be waited *for* — a poll on `=== null`
  // is satisfied by its first read, so a build that wrote both stores would slip past whenever its
  // entity PATCH had not landed yet at the moment `enabled` flipped. It is a beat and then a read,
  // the same shape as the nameless-column refusal above; 700 ms is two orders of magnitude past a
  // localhost round trip, and the page issues no `PATCH /projects` at all until case AO's burst.
  await sleep(700);
  const ccPageMap = (await ccProject()).task_columns;
  check(
    '…und schreibt dann die Saison-Vorgabe der Spalte, nicht die Karte der Seite',
    ccHiddenFlag === 0 && ccPageMap === null,
    `enabled ${ccHiddenFlag}, task_columns ${JSON.stringify(ccPageMap)}`,
  );

  await cc.keyboard.press('Escape');
  await gone(cc.getByRole('heading', { name: 'Spalten verwalten' }), 5000);
  ccHeadRow = await until(ccHeads, (h) => !h.some((x) => x.includes('Phase')), 8000);
  check('der Kopf ist damit weg', !ccHeadRow.some((x) => x.includes('Phase')), ccHeadRow.join(' | '));
  const ccBackToDefault = await until(
    () => rowIds(cc),
    (r) => r.join(' ') === ccDefaultOrder.join(' '),
    8000,
  );
  check(
    'die Sortierung nach ihr hört auf zu wirken, ohne dass die Tabelle neu geladen wurde (WP-59, TTU-18)',
    ccBackToDefault.join(' ') === ccDefaultOrder.join(' '),
    ccBackToDefault.join(' '),
  );
  check(
    '…und der ⠿ zieht wieder',
    ccTitleBefore === 'Zum Verschieben ziehen' && (await ccHandleTitle()) === ccTitleBefore,
    `${await ccHandleTitle()} (vorher ${ccTitleBefore})`,
  );

  await clickIfThere(cc.getByRole('button', { name: '⚙ Spalten' }).first());
  const ccMgr3 = topDialog(cc);
  await shown(ccMgr3.getByRole('heading', { name: 'Spalten verwalten' }), 8000);
  await clickIfThere(
    ccMgr3.locator('[data-column-row]').filter({ hasText: 'Phase' }).first().locator('button[title="Einblenden"]'),
  );
  const ccShownFlag = await until(
    () => ccOwnCols().then((cols) => cols.find((c) => c.id === ccSel?.id)?.enabled),
    (v) => v === 1,
    8000,
  );
  const ccResorted = await until(() => rowIds(cc), (r) => r.join(' ') === ccConfigured.join(' '), 8000);
  // Showing asks nothing — `toggleEnabled` writes straight through — which is also why the flag
  // above can only be 1 if no confirmation was waiting for a click.
  check(
    'wieder eingeblendet ordnet sie erneut: die Sortierung war ausgesetzt, nicht gelöscht',
    ccShownFlag === 1 && ccResorted.join(' ') === ccConfigured.join(' '),
    `enabled ${ccShownFlag}, ${ccResorted.join(' ')}`,
  );

  // Three types in one burst — the case the per-page map exists to survive (SHL-10): every write
  // persists the whole map, so a toggle computed from the pre-first-toggle value undoes its
  // predecessor. Against localhost the writes settle between two clicks, so the entity PATCH is
  // held back and the burst really is one.
  await cc.route('**/api/projects/*', async (route) => {
    if (route.request().method() === 'PATCH') await sleep(400);
    await route.continue().catch(() => {}); // see the guard above
  });
  for (const name of CC_GLOBALS) {
    await clickIfThere(
      ccMgr3.locator('[data-column-row]').filter({ hasText: name }).first().locator('button[title="Ausblenden"]'),
    );
  }
  const ccMap = await until(
    () => ccProject().then((p) => JSON.parse(p.task_columns ?? 'null')),
    (v) => !!v && Object.keys(v).length === 3,
    12_000,
  );
  await cc.unroute('**/api/projects/*');
  // Stated rather than assumed: an id that came back `undefined` would turn the check below into
  // „`custom:undefined` is not in the map", which names the map and not the column that is missing.
  const ccGlobalIds = CC_GLOBALS.map((n) => ccAllCols.find((c) => c.name === n)?.id);
  check(
    'die drei globalen Spalten der Demo sind je eine Zeile mit eigener id',
    ccGlobalIds.every((id) => typeof id === 'number'),
    CC_GLOBALS.map((n, i) => `${n}:${ccGlobalIds[i]}`).join(' | '),
  );
  check(
    'drei Spalten dreier Typen nacheinander ausgeblendet: alle drei stehen in der Karte der Seite (SHL-10)',
    Object.keys(ccMap ?? {}).length === 3 && ccGlobalIds.every((id) => ccMap?.[`custom:${id}`] === false),
    JSON.stringify(ccMap),
  );
  // Polled, not read once. The map above is the *server's* state; the badge is the row's own,
  // rendered from the entity cache — and canary 9a caught the two disagreeing for a moment, with
  // three keys stored and one badge on screen.
  //
  // The predicate carries both halves of what the assertion reads — three flagged rows *and* those
  // three being these three — because a count on its own is satisfied by the wrong three: „Phase"
  // was re-shown fifty lines up and gives its own badge back a render later, so „three flagged" is
  // briefly true of a set holding „Phase" and not „Abgabe". And the budget is `SETTLED_MS`, like
  // everything else in this file that reads a screen: WP-82 put `invalidate()` inside the queued
  // write, so the burst is published a rung at a time — 3 → 1 → 2 → 3 — and the client is one
  // write behind the server for the whole of it. Eight seconds is under that on a loaded machine,
  // which is what two of this file's CI reds were.
  const ccBadges = await until(
    () =>
      ccMgr3
        .locator('[data-column-row]')
        .evaluateAll((els) =>
          els.map((el) => [
            (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
            (el.textContent ?? '').includes('abweichend'),
          ]),
        ),
    (rows) =>
      rows.filter(([, flagged]) => flagged).length === 3 &&
      CC_GLOBALS.every((n) => rows.some(([text, flagged]) => flagged && text.includes(n))),
    SETTLED_MS,
  );
  check(
    '…und genau diese drei Zeilen tragen „abweichend“',
    ccBadges.filter(([, flagged]) => flagged).length === 3 &&
      CC_GLOBALS.every((n) => ccBadges.some(([text, flagged]) => flagged && text.includes(n))),
    ccBadges.filter(([, f]) => f).map(([t]) => t).join(' | ') || 'keine',
  );
  check(
    '„Auf Saison-Vorgabe zurücksetzen“ wird jetzt angeboten',
    (await ccMgr3.getByRole('button', { name: /Saison-Vorgabe/ }).count()) === 1,
  );
  await cc.keyboard.press('Escape');
  await gone(cc.getByRole('heading', { name: 'Spalten verwalten' }), 5000);
  // The predicate carries everything the assertion below reads — the three globals gone *and* the
  // four own columns still standing — and not just the first half of either. A canary that hid one
  // of the three satisfied a poll keyed on „Bereich" while the other two were still on screen; and
  // a head that has not yet brought „Phase" back satisfies „the three are gone" while the check
  // still fails on `CC_NAMES`. Both are the assertion passing or failing on a coin toss. Budgeted
  // at `SETTLED_MS` for the reason given at `ccBadges` above.
  ccHeadRow = await until(
    ccHeads,
    (h) =>
      CC_GLOBALS.every((n) => !h.some((x) => x.includes(n))) &&
      CC_NAMES.every((n) => h.some((x) => x.includes(n))),
    SETTLED_MS,
  );
  check(
    'die drei Köpfe sind von dieser Seite weg, die vier eigenen stehen weiter da',
    CC_GLOBALS.every((n) => !ccHeadRow.some((h) => h.includes(n))) &&
      CC_NAMES.every((n) => ccHeadRow.some((h) => h.includes(n))),
    ccHeadRow.join(' | '),
  );

  // The other page of the same season: the departure belongs to project 2 and to nothing else —
  // and project 2's own four columns are not there either, which is the scope half (WP-51).
  await cc.goto(`${UI}/#/project/3`);
  await cc.reload();
  await ready(cc);
  const ccNeighbour = await until(
    ccHeads,
    (h) => h.includes('Aufgabe') && CC_GLOBALS.every((n) => h.some((x) => x.includes(n))),
    8000,
  );
  check(
    'die Nachbarseite zeigt alle drei weiterhin — und keine der vier fremden',
    CC_GLOBALS.every((n) => ccNeighbour.some((h) => h.includes(n))) &&
      CC_NAMES.every((n) => !ccNeighbour.some((h) => h.includes(n))),
    ccNeighbour.join(' | '),
  );

  await cc.goto(`${UI}/#/project/2`);
  await cc.reload();
  await ready(cc);
  await clickIfThere(cc.getByRole('button', { name: '⚙ Spalten' }).first());
  const ccMgr4 = topDialog(cc);
  await shown(ccMgr4.getByRole('heading', { name: 'Spalten verwalten' }), 8000);
  await clickIfThere(ccMgr4.getByRole('button', { name: /Saison-Vorgabe/ }));
  const ccReset = await until(() => ccProject().then((p) => p.task_columns), (v) => v === null, 8000);
  check(
    '„Auf Saison-Vorgabe zurücksetzen“ nimmt die ganze Karte zurück, nicht einen Eintrag',
    ccReset === null,
    JSON.stringify(ccReset),
  );
  await cc.keyboard.press('Escape');
  await gone(cc.getByRole('heading', { name: 'Spalten verwalten' }), 5000);
  ccHeadRow = await until(
    ccHeads,
    (h) => CC_GLOBALS.every((n) => h.some((x) => x.includes(n))),
    8000,
  );
  check(
    '…und alle drei Köpfe stehen wieder da',
    CC_GLOBALS.every((n) => ccHeadRow.some((h) => h.includes(n))),
    ccHeadRow.join(' | '),
  );
}
