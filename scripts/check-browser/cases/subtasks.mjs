/** W–Z · the task tree */

import { sleep } from '../../lib/wait.mjs';
import { gone, open, pin, ready, shown, topDialog, until } from '../browser.mjs';
import { API, RUN, UI } from '../config.mjs';
import { check } from '../report.mjs';
import { api, scoped, send } from '../stack.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runSubtasks(fixtures) {
  const { HOME, context, subtree } = fixtures;
  // ======================================================================== W–Z · the task tree
  //
  // The demo plants the subtask fixtures deliberately — a tree with a coloured and a done child,
  // an archived fourth child the table never shows, and an orphan whose parent is in the
  // Papierkorb — and until now nothing drove them. `npm run check:api` owns the server half of
  // `parent_id` (the two-level rule, self-reference, cycles, the startup flattening); these four
  // cases are the UI half, and they overlap it nowhere: every assertion below is about what the
  // *table* does with a tree the server has already accepted.
  //
  // Three handles carry all of it. `tbody[data-group-id]` is one top-level task with everything
  // folded under it, `tr[data-task-id]` a row, and `data-depth` its **render position** — not
  // `parent_id`, which is the distinction the orphan case exists for. A project page's first
  // `<tbody>` is the Besetzung grid and has none of them, so nothing here counts `tbody` alone.

  /** One group's rows, as `id@depth` — the composer has neither attribute and reads `+@`. */
  const treeRows = (page, id) =>
    page.evaluate(
      (id) =>
        [...document.querySelectorAll(`tbody[data-group-id="${id}"] tr`)].map(
          (tr) => `${tr.getAttribute('data-task-id') ?? '+'}@${tr.getAttribute('data-depth') ?? ''}`,
        ),
      id,
    );
  /** The top-level tasks in the order the table renders them. */
  const treeGroups = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('tbody[data-group-id]')].map((tb) => tb.getAttribute('data-group-id')),
    );
  const treeRowCount = (page) => page.locator('tr[data-task-id]').count();
  /**
   * The disclosure chevron in a row's gutter — the *only* button in that cell, the ⠿ beside it
   * being a `<span>`. Addressed that way rather than by title because the title is the state
   * („Einklappen" / „Ausklappen") and a locator that changes with what it asserts is no handle.
   */
  const chevron = (page, id) => page.locator(`tr[data-task-id="${id}"] td:first-child button`);
  /** The counter pill, the second disclosure target. Its own title carries „einklappen" too. */
  const counter = (page, id) =>
    page.locator(`tr[data-task-id="${id}"] button[title*="Unteraufgaben erledigt"]`);
  const rowButton = (page, id, title) => page.locator(`tr[data-task-id="${id}"] button[title="${title}"]`);
  /** The 12 px elbow, i.e. „this row is drawn as somebody's child". A leaf and an orphan have none. */
  const elbows = (page, id) => page.locator(`tr[data-task-id="${id}"] td:first-child span.h-px`).count();
  /**
   * Text of something that may legitimately not be there — every reading below doubles as the
   * failure's own detail, and a locator that matches nothing must report „" rather than throw the
   * remaining cases away with it.
   */
  const textOf = (locator) => locator.first().innerText().catch(() => '');
  /**
   * The chevron's rotation, polled — and read off `rotate`, not off `transform`.
   *
   * Tailwind v4 compiles `rotate-90` to the standalone `rotate` property, so `transform` computes
   * to `none` in *both* states and an assertion written the obvious way fails against working
   * code. And it is a 150 ms `transition-transform` (which in v4 covers `rotate` too), while
   * `reducedMotion: 'reduce'` touches animations and not transitions — so a value sampled straight
   * after the click is mid-flight and neither state.
   */
  const spun = (page, id, want) =>
    until(
      () =>
        chevron(page, id)
          .locator('svg')
          .evaluate((el) => getComputedStyle(el).rotate)
          .catch(() => 'kein Chevron'),
      (r) => (want === 'none' ? r === 'none' : r !== 'none'),
      4000,
    );

  // ======================================================================== W · fold and unfold
  //
  // Read-only, and deliberately against the demo's own season: the tree here is `server/src/
  // demo.ts`'s showcase (task 1 with children 2, 3 coloured and 4 done) and folding writes
  // nothing at all, so there is nothing for a copy to protect.
  console.log('\nW · Unteraufgaben auf- und zuklappen');
  const w = await open(context, '/dashboard');
  await pin(w, HOME, '/project/1');

  // Every first read of a table is polled, never sampled: `ready()` also resolves from
  // `BootReady`'s unconditional 700 ms budget, so a one-shot `count()` taken there reads an empty
  // table on a loaded runner — and „no rows" satisfies half the assertions in this file.
  const plantedTree = await until(() => treeRows(w, 1), (r) => r.length === 4, 8000);
  check(
    'die Demo pflanzt einen Baum: der Elterntask und seine drei lebenden Kinder',
    plantedTree.join(' ') === '1@0 2@1 3@1 4@1',
    plantedTree.join(' '),
  );
  check('…und die Zählerpille daneben sagt, wie viele davon erledigt sind', (await textOf(counter(w, 1))) === '1/3', await textOf(counter(w, 1)));
  check(
    'aufgeklappt tritt die Pille zurück und trägt keinen Fortschritt',
    (await counter(w, 1)
      .evaluate((el) => getComputedStyle(el).backgroundImage)
      .catch(() => 'keine Pille')) === 'none',
  );
  const turnedOpen = await spun(w, 1, 'turned');
  check('…und das Chevron steht wirklich gedreht', turnedOpen === '90deg', turnedOpen);
  // Both sides of `aria-expanded`, like both sides of the rotation: a chevron hardwired to „true"
  // satisfies the folded assertion's opposite and nothing else here would notice.
  check('…und meldet sich als aufgeklappt', (await chevron(w, 1).getAttribute('aria-expanded').catch(() => null)) === 'true');

  const groupsBefore = (await treeGroups(w)).join(' ');
  const rowsBefore = await treeRowCount(w);
  /** @type {string[]} */
  const duringFold = [];
  const watchFold = (r) => {
    if (r.url().includes('/api/')) duringFold.push(`${r.method()} ${r.url().replace(API, '')}`);
  };
  w.on('request', watchFold);
  await chevron(w, 1).click();
  check('zuklappen nimmt die Unteraufgaben aus der Tabelle', await gone(w.locator('tr[data-task-id="2"]')));
  await sleep(500); // long enough for a refetch this must not be making
  w.off('request', watchFold);

  check('…die Gruppe hält danach nur noch ihren Kopf', (await treeRows(w, 1)).join(' ') === '1@0', (await treeRows(w, 1)).join(' '));
  check(
    '…und sonst nichts: die drei Zeilen fehlen, jede andere Gruppe steht unverändert da',
    (await treeRowCount(w)) === rowsBefore - 3 && (await treeGroups(w)).join(' ') === groupsBefore,
    `${await treeRowCount(w)} von ${rowsBefore} Zeilen, ${(await treeGroups(w)).join(' ')}`,
  );
  // The state is `useState` in TaskTable — no request, and nothing to reload. A fold that talked
  // to the server would also be a fold that survived a season switch, which nobody asked for.
  check('…ohne einen einzigen Aufruf: das Falten ist reine Ansicht', duringFold.length === 0, duringFold.join(' | '));
  check('…und das Chevron meldet es an sich selbst', (await chevron(w, 1).getAttribute('aria-expanded').catch(() => null)) === 'false');
  const turnedShut = await spun(w, 1, 'none');
  check('…das Chevron dreht zurück', turnedShut === 'none', turnedShut);
  // Folded, the pill stands in for the rows it hid, so it stops being decoration: 1 of 3 done is
  // a third of its own width. Expanded it was `none` above — the pair is the assertion.
  const fill = await counter(w, 1)
    .evaluate((el) => getComputedStyle(el).backgroundImage)
    .catch(() => 'keine Pille');
  check('…und die Pille trägt den Fortschritt jetzt selbst', fill.includes('linear-gradient') && fill.includes('33%'), fill);
  const pillTitle = (await counter(w, 1).getAttribute('title').catch(() => null)) ?? '';
  check('…und bietet das Gegenteil an', /ausklappen$/.test(pillTitle), pillTitle);

  // The pill is the second disclosure target — for anyone who never notices the chevron.
  await counter(w, 1).click();
  check('die Pille klappt auch wieder auf', (await treeRows(w, 1)).join(' ') === '1@0 2@1 3@1 4@1', (await treeRows(w, 1)).join(' '));
  await chevron(w, 1).click();
  await gone(w.locator('tr[data-task-id="2"]'));
  await w.reload();
  await ready(w);
  check(
    'ein Neuladen zeigt wieder alle Unteraufgaben — gefaltet wird nur die Ansicht',
    (await treeRows(w, 1)).join(' ') === '1@0 2@1 3@1 4@1',
    (await treeRows(w, 1)).join(' '),
  );

  // ======================================================================== X · a new subtask
  //
  // In a copy from here on: everything below writes. The copy keeps every row id, so the demo's
  // tree facts hold inside it — except the orphan, which no copy can carry (see case Z).
  console.log('\nX · Eine Unteraufgabe anlegen');
  const SUB = scoped(subtree.id);
  const x = await open(context, '/dashboard');
  await pin(x, subtree.id, '/project/8');
  const composer = x.locator('input[placeholder^="Neue Unteraufgabe"]');

  // The row first, then what it does *not* carry: `ready()` also resolves from `BootReady`'s
  // unconditional 700 ms budget, so „no chevron, no counter" counted straight after it is 0 and 0
  // on a table that has not rendered a single row yet — the emptiest possible pass.
  const leafRow = await shown(x.locator('tr[data-task-id="31"]'));
  check('Aufgabe 31 ist ein Blatt: kein Chevron, keine Zählerpille', leafRow && (await chevron(x, 31).count()) === 0 && (await counter(x, 31).count()) === 0);
  check('…und bietet trotzdem „Unteraufgabe hinzufügen" an', await shown(rowButton(x, 31, 'Unteraufgabe hinzufügen')));

  await rowButton(x, 31, 'Unteraufgabe hinzufügen').click();
  const composerOpen = await shown(composer);
  check('der Eingabefeld-Platzhalter steht als letzte Zeile der Gruppe', composerOpen && (await treeRows(x, 31)).join(' ') === '31@0 +@', (await treeRows(x, 31)).join(' '));
  check('…und hat den Fokus, ohne dass jemand hineinklicken müsste', (await x.evaluate(() => document.activeElement?.getAttribute('placeholder') ?? '')).startsWith('Neue Unteraufgabe'));

  // Typed *first*: an Escape on an empty composer is discarded by every conceivable build, so the
  // assertion that it writes nothing would hold against one that commits on close as well.
  const beforeAdd = (await api(SUB('/tasks?project_id=8'))).length;
  const abandoned = `Verworfen ${RUN}`;
  await composer.fill(abandoned);
  await x.keyboard.press('Escape');
  check('Escape schließt ihn wieder', await gone(composer));
  const afterEscape = await api(SUB('/tasks?project_id=8'));
  check(
    '…und wirft weg, was darin stand, statt es anzulegen',
    afterEscape.length === beforeAdd && !afterEscape.some((t) => t.title === abandoned),
    `${afterEscape.length} statt ${beforeAdd} Aufgaben`,
  );

  const kidTitle = `Unteraufgabe ${RUN}`;
  await rowButton(x, 31, 'Unteraufgabe hinzufügen').click();
  if (await shown(composer)) {
    await composer.fill(kidTitle);
    await composer.press('Enter');
  }
  const kid = await until(
    () => api(SUB('/tasks?project_id=8')).then((rows) => rows.find((t) => t.title === kidTitle)),
    (t) => !!t,
  );
  check('Enter legt die Unteraufgabe an', !!kid, kid ? `#${kid.id}` : 'nicht gefunden');
  // The server cannot know where a subtask belongs: the composer sends the parent's own scope,
  // so a child created on a project page lands in that project's list rather than in the
  // season-wide „Festival" one.
  check('…unter ihrem Elterntask und in dessen Liste', kid?.parent_id === 31 && kid?.project_id === 8, `parent ${kid?.parent_id}, Projekt ${kid?.project_id}`);
  // The POST resolves a query before the row does — `onAdded` invalidates and the table re-renders
  // on the refetch — so the row is a wait, not a read taken the moment the API knows about it.
  const grown = await until(() => treeRows(x, 31), (r) => r.length === 3, 8000);
  check('…und sie erscheint eingerückt in derselben Gruppe', grown.join(' ') === `31@0 ${kid?.id}@1 +@`, grown.join(' '));
  check('das Blatt ist damit ein Elterntask geworden', (await chevron(x, 31).count()) === 1 && (await textOf(counter(x, 31))) === '0/1', await textOf(counter(x, 31)));
  // Deliberate: the composer is the „add several" affordance, so it stays for the next title.
  check('…und der Composer bleibt für die nächste stehen', await shown(composer, 2000));
  // The UI half of the server's 400 (`check:api`: „a third level is refused"): the row that would
  // ask for one does not offer the button. Keyed on `parent_id`, which is why case Z can tell the
  // two tests apart.
  const kidId = kid?.id ?? -1;
  check('eine Unteraufgabe bekommt selbst keine Unteraufgaben angeboten', !!kid && (await rowButton(x, kidId, 'Unteraufgabe hinzufügen').count()) === 0);
  check('…und auch kein „Verschieben“: sie reist mit ihrem Elterntask', !!kid && (await rowButton(x, kidId, 'Verschieben').count()) === 0);

  await x.keyboard.press('Escape');
  await gone(composer);
  // A composer opened into a folded group would be invisible, so `startSubtask` unfolds first.
  await chevron(x, 32).click();
  await gone(x.locator('tr[data-task-id="33"]'));
  await rowButton(x, 32, 'Unteraufgabe hinzufügen').click();
  check(
    '„＋“ auf einer zugeklappten Gruppe klappt sie erst auf',
    (await shown(composer)) && (await treeRows(x, 32)).join(' ') === '32@0 33@1 +@',
    (await treeRows(x, 32)).join(' '),
  );
  await x.keyboard.press('Escape');
  await gone(composer);

  // ======================================================================== Y · done, up or down
  //
  // „Erledigt" is not a literal: the done value is whichever Status option carries the flag.
  console.log('\nY · Erledigt: Elterntask und Kind');
  const subColumns = await api(SUB('/custom-columns'));
  const subStatus = subColumns.find((c) => c.kind === 'builtin' && c.key === 'status');
  const subDone = JSON.parse(subStatus?.options ?? '[]').find((o) => o.done)?.value ?? 'done';
  const setStatus = async (page, id, value) => {
    // Two `listbox` triggers per row (Status and Bereich); the first is Status. And
    // `useAnchoredPopover` closes on any scroll outside its menu — including the one `click()`
    // performs for itself — so the trigger is scrolled into view first.
    const trigger = page.locator(`tr[data-task-id="${id}"] button[aria-haspopup="listbox"]`).first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const option = page.locator(`[role="option"][data-value="${value}"]`).first();
    if (await shown(option, 5000)) await option.click();
    else await page.keyboard.press('Escape');
  };

  await x.goto(`${UI}/#/project/1`);
  await x.reload(); // a `goto` to another hash keeps data-app-ready — it says nothing about the route
  await ready(x);
  const copiedTree = await until(() => treeRows(x, 1), (r) => r.length === 4, 8000);
  check('die Kopie trägt denselben Baum', copiedTree.join(' ') === '1@0 2@1 3@1 4@1', copiedTree.join(' '));

  await setStatus(x, 2, subDone);
  const kidsDone = await until(() => textOf(counter(x, 1)), (t) => t === '2/3', 8000);
  check('ein erledigtes Kind zählt sofort mit', kidsDone === '2/3', kidsDone);
  // A status change re-sorts, and the question is *where* it sorts to: inside the group, never
  // out of it. Both halves in one read, because a row that left would satisfy „it is behind its
  // sibling" vacuously.
  const insideGroup = await treeRows(x, 1);
  check('…bleibt aber eingerückt bei seinem Elterntask', insideGroup.includes('2@1'), insideGroup.join(' '));
  // Both positions have to be *found* before one can be behind the other: a missing „3@1" is -1,
  // and -1 is below every index there is — the comparison would pass on a group that lost the row
  // the assertion is about.
  const openSister = insideGroup.indexOf('3@1');
  const doneSister = insideGroup.indexOf('2@1');
  check(
    '…und sinkt innerhalb der Gruppe unter die offene Schwester',
    openSister >= 0 && doneSister >= 0 && openSister < doneSister,
    insideGroup.join(' '),
  );
  const parentAfterKid = await api(SUB('/tasks/1'));
  check('…der Elterntask wird davon nicht miterledigt', parentAfterKid.status !== subDone, String(parentAfterKid.status));

  await setStatus(x, 1, subDone);
  const sunk = await until(() => treeGroups(x), (g) => g[g.length - 1] === '1', 8000);
  check('ein erledigter Elterntask sinkt ans Ende der Tabelle', sunk[sunk.length - 1] === '1', sunk.join(' '));
  const travelled = await treeRows(x, 1);
  check(
    '…und nimmt seine Unteraufgaben mit, statt sie oben zurückzulassen',
    travelled[0] === '1@0' && [...travelled.slice(1)].sort().join(' ') === '2@1 3@1 4@1',
    travelled.join(' '),
  );
  const kidsAfterParent = (await api(SUB('/tasks?project_id=1'))).filter((t) => t.parent_id === 1);
  check(
    '…erledigt sie aber nicht mit',
    kidsAfterParent.some((t) => t.id === 3 && t.status !== subDone),
    kidsAfterParent.map((t) => `${t.id}:${t.status}`).join(' '),
  );
  check('…und die Pille steht auch auf der grauen Zeile noch richtig', (await textOf(counter(x, 1))) === '2/3', await textOf(counter(x, 1)));

  // ======================================================================== Z · the orphan
  //
  // A subtask whose parent is in the Papierkorb. The rule is „never hide a task just because its
  // parent is gone", so `effectiveParent` promotes it to top level — a *render* decision, which
  // is why the stored `parent_id` is asserted beside it.
  //
  // The first half runs on the demo's own season, because no copy can carry the fixture:
  // `createSeason` drops soft-deleted rows and nulls a `parent_id` whose parent stayed behind, so
  // in a copy task 12 is an ordinary root task that looks exactly the same on screen.
  console.log('\nZ · Die verwaiste Unteraufgabe');
  await w.goto(`${UI}/#/project/5`);
  await w.reload();
  await ready(w);

  const waise = await until(() => treeRows(w, 12), (r) => r.length === 1, 8000);
  check('die Waise steht als eigene Gruppe auf oberster Ebene', waise.join(' ') === '12@0', waise.join(' '));
  // „It renders flat" is the absence of the elbow — and alone that passes on a build that draws
  // no connectors at all, so a real child of the same table is measured in the same breath.
  check(
    '…ohne Verbindungslinie, anders als ein echtes Kind daneben',
    (await elbows(w, 12)) === 0 && (await elbows(w, 46)) === 1,
    `Waise ${await elbows(w, 12)}, Kind ${await elbows(w, 46)}`,
  );
  check('…während ihr parent_id unangetastet auf den gelöschten Elterntask zeigt', (await api('/tasks/12')).parent_id === 11, String((await api('/tasks/12')).parent_id));
  // The one row where the two tests disagree: „Verschieben" asks the render depth (TTU-30 —
  // moving it is how the user repairs it), „Unteraufgabe hinzufügen" asks `parent_id` (TTU-15 —
  // offering it here is how a three-level tree gets built). Both, or the swap goes unnoticed.
  check('…sie lässt sich verschieben — so repariert man sie', (await rowButton(w, 12, 'Verschieben').count()) === 1);
  check('…bekommt aber keine eigenen Unteraufgaben angeboten', (await rowButton(w, 12, 'Unteraufgabe hinzufügen').count()) === 0);
  check(
    '…und ein echtes Kind hat beides nicht, ein echter Elterntask beides',
    (await rowButton(w, 46, 'Verschieben').count()) === 0 &&
      (await rowButton(w, 46, 'Unteraufgabe hinzufügen').count()) === 0 &&
      (await rowButton(w, 41, 'Verschieben').count()) === 1 &&
      (await rowButton(w, 41, 'Unteraufgabe hinzufügen').count()) === 1,
    `Kind ${await rowButton(w, 46, 'Verschieben').count()}/${await rowButton(w, 46, 'Unteraufgabe hinzufügen').count()}, Elterntask ${await rowButton(w, 41, 'Verschieben').count()}/${await rowButton(w, 41, 'Unteraufgabe hinzufügen').count()}`,
  );

  // Why the pair survives at all: the parent cannot be purged while a live child references it
  // (SDL-01), and the Papierkorb says so rather than promising a date it will not keep.
  await w.goto(`${UI}/#/archiv`);
  await w.reload();
  await ready(w);
  const parentRow = w.locator('div.divide-y > div').filter({ hasText: 'Gelöschter Elterntask' });
  check(
    'der Papierkorb erklärt, warum das Paar bleibt',
    (await shown(parentRow)) && /bleibt, bis abhängige Einträge entfernt sind/.test(await parentRow.first().innerText()),
    (await parentRow.first().innerText().catch(() => 'keine Zeile')).replace(/\n/g, ' | '),
  );

  // The other half, in the copy: how the app *makes* one. The count in the dialog is the TTU-05
  // assertion — it comes from the `scope: 'all'` list, so it sees the archived child 53 that the
  // table does not, and a count taken from the rendered rows would say three.
  const allTasks = x.waitForResponse((r) => r.url().includes('tasks?scope=all'), { timeout: 20_000 }).catch(() => null);
  await x.goto(`${UI}/#/project/1`);
  await x.reload();
  await ready(x);
  await allTasks;
  const shownKids = await until(() => treeRows(x, 1), (r) => r.length === 4, 8000);
  check('die Tabelle zeigt drei Unteraufgaben', shownKids.filter((r) => r.endsWith('@1')).length === 3, shownKids.join(' '));

  // The number is frozen into the dialog when the 🗑 is pressed, so the response wait above is
  // necessary and not sufficient: React still has to commit the query before the click handler
  // reads it. Asking again is the only correct fix — nothing about the tree changes while the
  // dialog is up, and a build that counts from the rendered rows answers „3" at every attempt.
  const askHeading = x.getByRole('heading', { name: 'Aufgabe löschen' });
  const ask = topDialog(x);
  let askedKids = false;
  let askText = '';
  for (let attempt = 0; attempt < 4 && !/4 Unteraufgaben/.test(askText); attempt++) {
    if (attempt) {
      await x.keyboard.press('Escape');
      await gone(askHeading);
      await sleep(250);
    }
    await rowButton(x, 1, 'Löschen').click();
    askedKids = await shown(askHeading);
    if (!askedKids) break;
    askText = await ask.innerText();
  }
  check('das Löschen eines Elterntasks fragt nach den Kindern', askedKids);
  check(
    '…und zählt die archivierte vierte mit, die auf dem Schirm gar nicht steht (TTU-05)',
    askedKids && /4 Unteraufgaben/.test(askText),
    askText.replace(/\n/g, ' | '),
  );
  if (askedKids) await ask.getByRole('button', { name: 'Nur diese Aufgabe' }).click();
  const orphaned = await until(() => treeRows(x, 2), (r) => r.length > 0, 8000);
  check('„Nur diese Aufgabe" nimmt allein den Elterntask mit', (await send('GET', SUB('/tasks/1'))).status === 404 && (await send('GET', SUB('/tasks/2'))).status === 200);
  check('…seine Kinder bleiben und stehen als eigene Gruppen da', orphaned.join(' ') === '2@0' && (await treeRows(x, 3)).join(' ') === '3@0', `${orphaned.join(' ')} / ${(await treeRows(x, 3)).join(' ')}`);
  check('…ohne das Angebot, selbst welche zu bekommen', (await rowButton(x, 2, 'Unteraufgabe hinzufügen').count()) === 0 && (await rowButton(x, 3, 'Unteraufgabe hinzufügen').count()) === 0);
  check('…und mit unverändertem parent_id: die Beförderung ist Darstellung, kein Schreibvorgang', (await api(SUB('/tasks/2'))).parent_id === 1, String((await api(SUB('/tasks/2'))).parent_id));

  await x.goto(`${UI}/#/archiv`);
  await x.reload();
  await ready(x);
  const binnedParent = x.locator('div.divide-y > div').filter({ hasText: 'Instrumente – Anmietung und Transport' });
  // Asserted rather than merely guarded: without this the missing row is silent here and surfaces
  // ten seconds later as „the children were not re-nested", which is a different bug.
  const parentInBin = check('der gelöschte Elterntask liegt im Papierkorb', await shown(binnedParent));
  if (parentInBin) await binnedParent.getByRole('button', { name: 'Wiederherstellen' }).first().click();
  await until(() => send('GET', SUB('/tasks/1')).then((r) => r.status), (s) => s === 200);
  await x.goto(`${UI}/#/project/1`);
  await x.reload();
  await ready(x);
  const renested = await until(() => treeRows(x, 1), (r) => r.length === 4, 8000);
  check(
    'wird der Elterntask wiederhergestellt, hängen die Kinder wieder unter ihm',
    renested.filter((r) => r.endsWith('@1')).length === 3,
    renested.join(' '),
  );

  // Handed forward to `toolbox`, `images`, which reuse it unchanged.
  Object.assign(fixtures, { textOf });
}
