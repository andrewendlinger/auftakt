/** I–K · deleting a record, and reordering by the ⠿ */

import { sleep } from '../../lib/wait.mjs';
import { dragHandleOnto, dragOver, gone, grabHandle, open, pin, ready, shown, toast, topDialog, until } from '../browser.mjs';
import { RUN, UI } from '../config.mjs';
import { check } from '../report.mjs';
import { api, scoped, send } from '../stack.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runRecords(fixtures) {
  const { context, sorted, trash } = fixtures;
  // ======================================================================== I · the delete path
  //
  // Every case below runs in a *copied* season, which keeps the row ids (`copyRows` carries `id`)
  // and so keeps the fixture facts docs/VERIFYING.md pins — while leaving the shared demo the
  // other cases read untouched. The copy drops soft-deleted rows, so this season's Papierkorb
  // starts empty and `/deleted` names exactly what this case put there.
  //
  // **How the page was reached is part of the case.** „Daten konnten nicht aktualisiert werden.
  // (not found)" after a delete reproduces when the page was reached by a client-side navigation
  // and *not* after a `page.goto` to it: `navigate()` is a React Router transition, so the
  // unmount races a DELETE that takes ~2 ms against localhost, and the two routes in lose that
  // race at different rates. So this case clicks its way in — Übersicht → Künstlerkarte →
  // Projektkarte — which is what makes the „no error toast" assertion below mean anything, and
  // what a script that `goto`s the page under test can never assert (it reports the bug fixed
  // while a user hits it on the first click).
  //
  // The delete itself is WP-34's path: „✎ Bearbeiten" → „Löschen" → a nested confirm → „In den
  // Papierkorb". There is no 🗑 next to the print link, and `getByRole('button', { name:
  // 'Löschen' })` is ambiguous on any page with tasks on it — the task table's row 🗑 carries
  // `title="Löschen"` too — so every dialog button here is scoped to the topmost `.fixed.inset-0`.
  console.log('\nI · Löschen, Papierkorb, Rückgängig');
  const T = scoped(trash.id);
  const e = await open(context, '/dashboard');
  await pin(e, trash.id, '/dashboard');
  // A locator is a query, not a snapshot, so this one `.last()` re-resolves on every use — it is
  // the edit dialog while that is topmost and the confirm once it stacks on top.
  const top = topDialog(e);

  await e.locator('[data-section="artists"] a[href="#/artist/1"]').first().click();
  await e.waitForURL(/#\/artist\/1$/, { timeout: 15_000 });
  // The URL changes with the transition, one query before the projects are on screen — a
  // `count()` read straight after it is 0 against a page that renders the card a moment later.
  const card = e.locator('[data-project-card="2"]');
  check('the project is a card on its artist’s page', (await shown(card)) && (await card.count()) === 1);
  await card.click();
  await e.waitForURL(/#\/project\/2$/, { timeout: 15_000 });

  await e.getByRole('button', { name: '✎ Bearbeiten' }).click();
  const editHeading = e.getByRole('heading', { name: 'Projekt bearbeiten' });
  await editHeading.waitFor({ timeout: 8000 });
  check('the edit dialog carries the delete button (WP-34)', await top.getByRole('button', { name: 'Löschen' }).isVisible());

  await top.getByRole('button', { name: 'Löschen' }).click();
  await e.getByRole('heading', { name: 'Projekt löschen' }).waitFor({ timeout: 8000 });
  // The dependent count is fetched when the *confirm* opens, so „Wird geprüft, was mitgeht …" is
  // what is on screen first — reading the dialog straight away asserts against the pending state.
  await top.getByText(/Mit dabei:/).waitFor({ timeout: 8000 });
  const confirmBody = await top.innerText();
  check("the confirm counts the project's tasks", /3 Aufgaben/.test(confirmBody), confirmBody.replace(/\n/g, ' | '));
  check('…and points at the Archiv', /Gelöschte Einträge/.test(confirmBody));

  // Escape closes the question and leaves the form standing — the case `ModalDepthCtx` exists for.
  await e.keyboard.press('Escape');
  await e.getByRole('heading', { name: 'Projekt löschen' }).waitFor({ state: 'detached', timeout: 8000 });
  check('Escape closes the confirm only, the form stays', await editHeading.isVisible());
  check('…and nothing was deleted', (await send('GET', T('/projects/2'))).status === 200);

  await top.getByRole('button', { name: 'Löschen' }).click();
  await top.getByRole('button', { name: 'In den Papierkorb' }).click();
  await e.waitForURL(/#\/artist\/1$/, { timeout: 15_000 });
  check('the delete lands on the parent page', (await e.evaluate(() => location.hash)) === '#/artist/1');
  check('the row is soft-deleted', (await send('GET', T('/projects/2'))).status === 404);

  // Scoped to the toast that names *this* record: toasts stack and hold six seconds, so in a
  // script an earlier step's „Rückgängig" is still on screen and `.first()` reverts the wrong row.
  check('an undo toast names the deleted project', await shown(toast(e, /Schulworkshop/)));
  // The assertion the clicked route above exists for: `useUndoableDelete`'s `gone` marks the
  // deleted row's own keys stale instead of refetching them, so the page still mounted under the
  // redirect does not ask for a row that is in the Papierkorb, 404, and get told something is
  // wrong when nothing is. Read after the „gelöscht" toast, which lands once the delete settled.
  check('…and no „nicht aktualisiert" error toast beside it', (await toast(e, /nicht aktualisiert/).count()) === 0);
  check('the project card disappears from the artist page', await gone(card));

  // A bookmark to the deleted row must render the LoadError panel, not a spinner and not a
  // record served out of the cache (PGS-05).
  await e.goto(`${UI}/#/project/2`);
  await e.reload(); // a `goto` to a different hash keeps data-app-ready — it says nothing about the route
  await ready(e);
  check(
    'a bookmark to the deleted project shows „nicht gefunden“ (PGS-05)',
    await shown(e.getByText('Projekt nicht gefunden')),
  );

  await e.goto(`${UI}/#/archiv`);
  await e.reload();
  await ready(e);
  const trashRow = e.locator('div.divide-y > div').filter({ hasText: 'Schulworkshop' });
  check('the Papierkorb lists the project', (await shown(trashRow)) && (await trashRow.count()) === 1);
  await trashRow.getByRole('button', { name: 'Wiederherstellen' }).click();
  const restoredProject = await until(
    () => send('GET', T('/projects/2')).then((r) => r.status),
    (s) => s === 200,
  );
  check('restoring brings it back', restoredProject === 200, `HTTP ${restoredProject}`);

  // ======================================================================== I2 · a dirty form
  //
  // The delete does **not** ask „Änderungen verwerfen?" — asking about unsaved edits to a record
  // on its way to the Papierkorb is a question with no meaningful answer (WP-34) — and the edit
  // must be dropped rather than written on the way out. Artist 3 is the count fixture: it reaches
  // 2 projects, 1 contact, 14 tasks and 1 event, which is what proves the number walks *through*
  // its projects rather than stopping at them.
  console.log('\nI2 · Löschen aus einem geänderten Formular');
  await e.goto(`${UI}/#/dashboard`);
  await e.reload();
  await ready(e);
  const artistCard = e.locator('[data-section="artists"] a[href="#/artist/3"]');
  check('the artist is a card on the Übersicht', (await shown(artistCard)) && (await artistCard.count()) === 1);
  await artistCard.first().click();
  await e.waitForURL(/#\/artist\/3$/, { timeout: 15_000 });

  await e.getByRole('button', { name: '✎ Bearbeiten' }).click();
  await e.getByRole('heading', { name: /bearbeiten$/ }).waitFor({ timeout: 8000 });
  // `TextInput` renders no `type` — except in a `RecordFormModal`, whose text branch passes
  // `type="text"` explicitly. So this matches Name and not the colour field's untyped hex box,
  // which is the *only* other input in this dialog.
  await top.locator('input[type="text"]').first().fill(`Wird eh gelöscht ${RUN}`);
  await top.getByRole('button', { name: 'Löschen' }).click();
  await top.getByText(/Mit dabei:/).waitFor({ timeout: 8000 });
  const cascade = await top.innerText();
  check(
    'the confirm counts through the projects, not up to them',
    /\b2 Projekte\b/.test(cascade) &&
      /\b1 Kontakt\b/.test(cascade) &&
      /\b14 Aufgaben\b/.test(cascade) &&
      /\b1 Termin\b/.test(cascade),
    cascade.replace(/\n/g, ' | '),
  );

  await top.getByRole('button', { name: 'In den Papierkorb' }).click();
  await e.waitForURL(/#\/dashboard$/, { timeout: 15_000 });

  // Everything about the deleted state is **read** here and asserted after the undo, because the
  // toast carrying that button is dismissed by a plain 6 s `setTimeout` that hovering does not
  // pause. Five round trips plus an unbounded `gone()` between the delete and the click is how a
  // run that is green on this machine goes red on a slower one — and the failure would read as
  // „undo is broken" rather than „the script was too slow to press it". The reads themselves
  // cannot be moved *after* the click: every one of them describes a row the undo brings back.
  const discardPrompt = await e.getByText('Änderungen verwerfen?').count();
  const cardGone = await gone(artistCard, 4000);
  const deletedStatus = (await send('GET', T('/artists/3'))).status;
  const binned = (await api(T('/deleted'))).find((d) => d.type === 'artist');
  const hits = await api(T(`/search?q=${encodeURIComponent('Klanginstallation')}`));

  // `click()` waits for the button; a `count()` here would race the toast's own render.
  await toast(e, /Kollektiv Halbton/).getByRole('button', { name: 'Rückgängig' }).first().click();
  const restoredArtist = await until(
    () => send('GET', T('/artists/3')).then((r) => r.status),
    (s) => s === 200,
  );

  check('a dirty form deletes without asking about the edits', discardPrompt === 0);
  check('the artist is soft-deleted', deletedStatus === 404, `HTTP ${deletedStatus}`);
  check('the artist card disappears from the Übersicht', cardGone);
  check('…and the unsaved edit was dropped, not written', binned?.label === 'Kollektiv Halbton', String(binned?.label));
  // SDL-01: an entry with live children never auto-purges, so „alles wiederherstellbar" holds
  // indefinitely rather than for 30 days.
  check('…and the entry will not auto-purge while children hang off it', binned?.purge_at === null, String(binned?.purge_at));
  check(
    'a deleted artist takes its projects out of the search',
    hits.projects.filter((p) => p.artist_id === 3).length === 0,
    JSON.stringify(hits.projects),
  );
  check('undo restores the artist', restoredArtist === 200, `HTTP ${restoredArtist}`);

  // ======================================================================== J · reordering rows
  //
  // Drag is the most fragile interaction in the program — eight call sites, four of them
  // responsive grids — and two hard-won details keep it working: the payload is a private MIME
  // type, because `text/plain` made every drag a native *text* drag that any editable element
  // accepts, so releasing a row over the search field or an inline editor typed the raw row id
  // into it and the commit-on-blur saved it (CCL-15); and the arm is released from the *window*,
  // because a grab that ends anywhere but on the ⠿ never fires the handle's own `pointerup` and
  // left the row `draggable` for good (CCL-19).
  //
  // The interleaving is the point of the contact cases, not decoration. Project 1's three
  // contacts carry `sort_order` 0, 6, 7 and artist 1's two carry 1, 8, so a reorder that
  // renumbered by hand — or renumbered the wrong parent's list — reshuffles rows on a page nobody
  // was looking at. Each half of this case therefore asserts the *other* parent stayed put.
  console.log('\nJ · Umsortieren per ⠿ — Kontakte und Karten');
  const S = scoped(sorted.id);
  const f = await open(context, '/project/1');
  await pin(f, sorted.id, '/project/1');

  const contactsOf = (query) => api(S(`/contacts?${query}`));
  const stamps = (rows) => rows.map((c) => `${c.name}:${c.sort_order}`).join(' | ');
  const projectContacts = f.locator('[data-section="kontakte"] li');
  const artistBefore = stamps(await contactsOf('artist_id=1'));
  const projectBefore = (await contactsOf('project_id=1')).map((c) => c.name);

  await dragHandleOnto(
    f,
    projectContacts.filter({ hasText: 'Wanda Groß' }).first(),
    projectContacts.filter({ hasText: 'Merle Dahlke' }).first(),
  );
  const moved = await until(() => contactsOf('project_id=1'), (r) => r[0]?.name === 'Wanda Groß');
  check('the third contact moved to the top', moved[0]?.name === 'Wanda Groß', stamps(moved));
  check(
    '…and nothing else changed its relative order',
    JSON.stringify(moved.slice(1).map((c) => c.name)) ===
      JSON.stringify(projectBefore.filter((n) => n !== 'Wanda Groß')),
    stamps(moved),
  );
  // The renumbering covers the whole of *this* parent's list, which is what makes the interleave
  // safe: every row the reorder may touch is in the payload, so the sequence restarts at 0.
  check(
    'sort_order is renumbered 0..n-1',
    JSON.stringify(moved.map((c) => c.sort_order)) === '[0,1,2]',
    stamps(moved),
  );
  check(
    'the other parent’s interleaved rows are untouched',
    stamps(await contactsOf('artist_id=1')) === artistBefore,
    artistBefore,
  );

  await f.goto(`${UI}/#/artist/1`);
  await f.reload();
  await ready(f);
  const artistContacts = f.locator('[data-section="kontakte"] li');
  await dragHandleOnto(
    f,
    artistContacts.filter({ hasText: 'Sven Ostermann' }).first(),
    artistContacts.filter({ hasText: 'Piet Aalders' }).first(),
  );
  const movedArtist = await until(() => contactsOf('artist_id=1'), (r) => r[0]?.name === 'Sven Ostermann');
  check('contacts reorder on the artist page too', movedArtist[0]?.name === 'Sven Ostermann', stamps(movedArtist));
  check(
    '…and this time it is the project’s rows that stay put',
    stamps(await contactsOf('project_id=1')) === stamps(moved),
    stamps(moved),
  );

  await f.goto(`${UI}/#/dashboard`);
  await f.reload();
  await ready(f);
  const cardsBefore = (await api(S('/artists'))).map((a) => a.name);
  await dragHandleOnto(
    f,
    f.locator('[data-section="artists"] a[href="#/artist/4"]').first(),
    f.locator('[data-section="artists"] a[href="#/artist/1"]').first(),
  );
  const cardsAfter = await until(
    () => api(S('/artists')).then((r) => r.map((a) => a.name)),
    (names) => names[0] === 'Jonas Wehrmann',
  );
  check('the last artist card moved to the front', cardsAfter[0] === 'Jonas Wehrmann', cardsAfter.join(' | '));
  check(
    '…and the others kept their relative order',
    JSON.stringify(cardsAfter.slice(1)) === JSON.stringify(cardsBefore.filter((n) => n !== 'Jonas Wehrmann')),
    cardsAfter.join(' | '),
  );
  await f.reload();
  await ready(f);
  // Polled, not sampled: `ready()` can arrive on the 700 ms budget with the artists query still
  // in flight, and an `evaluateAll` taken then returns `[]` against a page that is fine.
  const hrefs = await until(
    () =>
      f
        .locator('[data-section="artists"] a[href^="#/artist/"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('href'))),
    (list) => list.length >= 4,
  );
  check('the persisted order survives a reload', hrefs[0] === '#/artist/4', hrefs.slice(0, 4).join(' '));

  // ======================================================================== K · the drag’s limit
  //
  // Links are one flat `sort_order` sequence rendered in groups, so a drop across a category
  // would move a row under a heading that contradicts it — `canDrop` refuses those pairings.
  // Project 1's „Technik" is the only link group with two rows, which makes it the only place a
  // reorder is observable at all, and its `sort_order` values (0, 6) are interleaved with the
  // other groups' (5, 7) — the same trap as the contacts above.
  //
  // A refused drop used to be silent: the row simply snapped back, and a rule nobody can see
  // reads as a broken feature (WP-35). So the refusal is asserted three ways — the handle's own
  // tooltip names the limit, the foreign groups dim *mid-flight*, and the release changes
  // nothing.
  console.log('\nK · Links sortieren nur innerhalb ihrer Kategorie');
  await f.goto(`${UI}/#/project/1`);
  await f.reload();
  await ready(f);

  const links = () => api(S('/links?project_id=1')).then((r) => r.map((l) => l.label));
  const linkRows = f.locator('[data-section="links"] li');
  const rider = linkRows.filter({ hasText: 'Technikrider' }).first();
  const plan = linkRows.filter({ hasText: 'Bühnenplan' }).first();
  const vertrag = linkRows.filter({ hasText: 'Vertrag (unterschrieben)' }).first();
  const linksBefore = await links();

  await dragHandleOnto(f, plan, rider);
  const linksAfter = await until(links, (l) => l.indexOf('Bühnenplan') < l.indexOf('Technikrider (PDF)'));
  check(
    'a link leads its category group after the drag',
    linksAfter.indexOf('Bühnenplan') < linksAfter.indexOf('Technikrider (PDF)'),
    linksAfter.join(' | '),
  );
  // Passing the *whole* list to `arrayMoveTo` rather than the group's rows is what leaves the
  // other groups alone: lifting one item out and re-inserting it elsewhere keeps every other
  // item's relative position, so renumbering all of them afterwards rewrites nothing else.
  const others = (l) => l !== 'Bühnenplan';
  check(
    'every link outside the group kept its relative order',
    JSON.stringify(linksAfter.filter(others)) === JSON.stringify(linksBefore.filter(others)),
    linksAfter.filter(others).join(' | '),
  );

  const tooltip = await plan.locator('[title^="Zum Verschieben ziehen"]').first().getAttribute('title');
  check('the handle names the limit', tooltip === 'Zum Verschieben ziehen (innerhalb der Kategorie)', String(tooltip));

  // Hold the drag over the foreign group and read the dimming before releasing. It is a CSS
  // transition, so a sample taken the instant the pointer arrives still reads ~0.99 — poll for
  // it instead of guessing at a sleep, and require the dragged row's own group to stay lit,
  // which is the half that fails if the dimming is simply applied to everything.
  const groups = () =>
    f
      .locator('[data-section="links"] div.transition-opacity')
      .evaluateAll((els) =>
        els.map((el) => [el.querySelector('span')?.textContent?.trim() ?? '', getComputedStyle(el).opacity]),
      );
  await grabHandle(f, plan);
  await dragOver(f, vertrag);
  const dimmed = await until(
    groups,
    (gs) => gs.some(([name, o]) => !/technik/i.test(name) && Number(o) < 0.6),
    5000,
  );
  check(
    'mid-flight the foreign groups dim and the source group stays lit',
    dimmed.length > 1 &&
      dimmed.every(([name, o]) => (/technik/i.test(name) ? Number(o) === 1 : Number(o) < 0.6)) &&
      dimmed.some(([name]) => /vertrag/i.test(name)),
    JSON.stringify(dimmed),
  );
  await f.mouse.up();

  // A refused drop issues no request at all, so there is nothing to poll for — the honest shape
  // is a beat longer than the reorder above took, then the same read.
  await sleep(800);
  // One read for both the verdict and the detail — two fetches can sample different moments, and
  // the log would then contradict its own verdict on exactly the run that needs reading.
  const refused = await links();
  check(
    'the refused drop across the category border changed nothing',
    JSON.stringify(refused) === JSON.stringify(linksAfter),
    refused.join(' | '),
  );

  // The ⠿ used to be invisible until the row was hovered (WP-35). Reload with the pointer parked
  // off every row, so nothing is hovered and the resting state is what is measured.
  await f.mouse.move(1390, 990);
  await f.reload();
  await ready(f);
  const rest = await f
    .locator('[data-section="links"] [title^="Zum Verschieben ziehen"]')
    .first()
    .evaluate((el) => getComputedStyle(el).opacity);
  check('a handle nobody is hovering is still visible', Number(rest) > 0.2, `opacity ${rest}`);

  // Handed forward to `reorder`, which reuses it unchanged.
  Object.assign(fixtures, { S });
}
