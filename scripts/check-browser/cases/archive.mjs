/** AH–AK · the archive and its boundary */

import { sleep } from '../../lib/wait.mjs';
import { clickIfThere, gone, open, pin, ready, shown, topDialog, until } from '../browser.mjs';
import { UI } from '../config.mjs';
import { handedOver } from '../fixtures.mjs';
import { check } from '../report.mjs';
import { api, scoped, send } from '../stack.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runArchive(fixtures) {
  const { HOME, agedSeason, context } = fixtures;
  /** `boxOf` comes from `toolbox`, which runs two files earlier. */
  const { boxOf } = handedOver(fixtures, ['boxOf']);
  // ======================================================================== AH–AK · the archive
  //
  // Distinct from I/I2, which own the **Papierkorb** — soft-deleted records, their dependency
  // counts, restore and undo. This is the other mechanism sharing `#/archiv`: a task in the
  // „erledigt" category whose `erledigt_am` has aged past `ARCHIVE_AFTER_DAYS` leaves every live
  // list. Nothing drove it — not the views that stop showing an aged task, not what the archived
  // row can and cannot do from there, and not the boundary itself.
  //
  // No date is written down anywhere below. `demo.ts` stamps its five archived rows relative to
  // today, so „past the cutoff" holds whenever the gate runs, and AJ's own pair is computed from
  // `/api/settings.archive_after_days` — the same number the page prints in its heading.

  /**
   * One row of the archived-task table. `ArchivePage` is a plain `<table>` + `.map()`, not
   * `TaskTable`, so there is no `data-task-id` and no `tbody[data-group-id]` to address — every
   * handle from „Der Aufgabenbaum" matches nothing here. `controls` is what makes „this row offers
   * nothing" a reading rather than an opinion.
   */
  const archiveRows = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('table tbody tr')].map((tr) => ({
        title: (tr.querySelector('td')?.textContent ?? '').trim(),
        links: [...tr.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? ''),
        controls: tr.querySelectorAll(
          'button, input, select, textarea, [contenteditable], div.cursor-text',
        ).length,
        taskId: tr.getAttribute('data-task-id'),
      })),
    );

  /**
   * Both halves of `#/archiv`, read **per section**: „Keine Treffer." is the same `EmptyState` in
   * both, so only the `<h2>` above one tells them apart. `textContent` rather than `innerText`,
   * because every heading in the app is CSS-uppercased.
   */
  const archiveSections = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('h2')].map((h) => {
        const sec = h.closest('.space-y-3');
        return {
          head: (h.textContent ?? '').trim(),
          tasks: sec?.querySelectorAll('table tbody tr').length ?? 0,
          trash: sec?.querySelectorAll('div.divide-y > div').length ?? 0,
          empty: (sec?.querySelector('div.bg-neutral-50')?.textContent ?? '').trim(),
        };
      }),
    );

  /** Whatever task table is on screen, as row ids. */
  const rowIds = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('tr[data-task-id]')].map((tr) => tr.getAttribute('data-task-id') ?? ''),
    );

  /**
   * The dashboard's „Fortschritt" tile as one line — „<pct>% <done>/<total> FORTSCHRITT", the
   * label CSS-uppercased like every other one.
   *
   * The *innermost* `div.rounded-2xl` whose last child is the label: `Card` carries that class too,
   * and so does every artist card, several of which say „… erledigt" in their chips.
   */
  const fortschritt = (page) =>
    page.evaluate(() => {
      const tile = [...document.querySelectorAll('div.rounded-2xl')].find(
        (d) => d.querySelector('div.rounded-2xl') === null && d.lastElementChild?.textContent === 'Fortschritt',
      );
      return tile ? /** @type {HTMLElement} */ (tile).innerText.replace(/\s+/g, ' ').trim() : '';
    });

  /** `dayCount` from `client/src/lib/dates.ts` — „1 Tag" / „30 Tage", which the two texts below use. */
  const dayCountDe = (n) => `${n} Tag${n === 1 ? '' : 'e'}`;

  /** `YYYY-MM-DD HH:MM:SS`, local — the shape `acceptsErledigtAm` takes and SQLite compares. */
  const pad2 = (n) => String(n).padStart(2, '0');
  const stampAt = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  };

  // ======================================================================== AH · what the lists drop
  //
  // Read-only, against the demo's own season: the five archived rows are `demo.ts`'s and nothing
  // here writes. Two surfaces stop showing an aged task — a project's table and the Übersicht's
  // season-wide list — and „Fortschritt" is the pair, the one number that must *not* stop at that
  // edge (CCL-04).
  console.log('\nAH · Was die Listen verschweigen und was das Archiv zeigt');
  const arc = await open(context, '/dashboard');
  await pin(arc, HOME, '/project/1');

  const archColumns = await api('/custom-columns');
  const archStatus = archColumns.find((c) => c.kind === 'builtin' && c.key === 'status');
  const archDone = JSON.parse(archStatus?.options ?? '[]').find((o) => o.done)?.value ?? 'done';
  const agedRows = await api('/tasks?scope=archive');
  const liveSeason = await api('/tasks?scope=live');
  const allSeason = await api('/tasks?scope=all');
  const liveIds = new Set(liveSeason.map((t) => t.id));
  check(
    'die Demo pflanzt fünf archivierte Aufgaben: alle erledigt, alle mit Abschlussdatum',
    agedRows.length === 5 && agedRows.every((t) => t.status === archDone && !!t.erledigt_am),
    agedRows.map((t) => `${t.id}:${t.erledigt_am}`).join(' '),
  );
  // The one server-side reading this case takes, and the fixture fact both halves below lean on:
  // the archive is exactly the difference between the two scopes, so „missing from the table" and
  // „listed in the Archiv" are about the same five rows and not about two unrelated sets.
  check(
    '…und sie sind genau das, was der Live-Liste fehlt',
    allSeason.length === liveSeason.length + agedRows.length && agedRows.every((t) => !liveIds.has(t.id)),
    `${allSeason.length} alle, ${liveSeason.length} live, ${agedRows.length} archiviert`,
  );

  const p1Live = await api('/tasks?project_id=1&scope=live');
  const p1All = await api('/tasks?project_id=1&scope=all');
  // Polled on the length the assertion then compares: `ready()` also resolves from `BootReady`'s
  // unconditional 700 ms budget, so a one-shot read is an empty table on a loaded runner — and an
  // empty table satisfies „the archived rows are not there" perfectly.
  const p1Rows = await until(() => rowIds(arc), (r) => r.length === p1Live.length, 8000);
  check(
    'die Projekttabelle zeigt genau die lebende Liste — die beiden archivierten Zeilen fehlen',
    [...p1Rows].sort().join(' ') === p1Live.map((t) => String(t.id)).sort().join(' '),
    `${p1Rows.join(' ')} statt ${p1Live.map((t) => t.id).join(' ')}`,
  );
  // The pair, and the reason this case needs no date at all: tasks 4 and 53 are both done children
  // of task 1, and only the older one is gone. „Erledigt" on its own archives nothing.
  const youngDone = p1All.find((t) => t.id === 4);
  const agedKid = p1All.find((t) => t.id === 53);
  check(
    '…die beiden erledigten Kinder derselben Aufgabe liegen auf verschiedenen Seiten der Grenze',
    youngDone?.status === archDone &&
      agedKid?.status === archDone &&
      p1Rows.includes('4') &&
      !p1Rows.includes('53'),
    `4 seit ${youngDone?.erledigt_am} → ${p1Rows.includes('4')}, 53 seit ${agedKid?.erledigt_am} → ${p1Rows.includes('53')}`,
  );

  await arc.goto(`${UI}/#/dashboard`);
  await arc.reload();
  await ready(arc);
  // Polled on the *neighbour* the assertion also reads: „the aged row is absent" is true of a
  // table that has not rendered a single row yet, and `ready()` legitimately resolves there.
  const festival = await until(() => rowIds(arc), (r) => r.includes('20'), 8000);
  // The season-wide „Festival" list is the second table an aged row could turn up in, and task 27
  // („Save-the-Date verschickt") is the one archived todo that belongs to it. Task 20 is its live
  // neighbour, so this is not „the list rendered nothing".
  check(
    'auch die „Festival“-Liste der Übersicht lässt die gealterte Saison-Aufgabe weg',
    !festival.includes('27') && festival.includes('20'),
    festival.join(' '),
  );

  // …and the one number that must see *past* the edge. Fed the page's own `scope: 'live'` list,
  // „Fortschritt" falls as work is finished and ages out — 0 %, 0/0 for a project that is finished
  // (CCL-04). Both counts are read here, because comparing against only one of them passes either
  // way: on a freshly seeded demo they are 8/51 and 3/46, and inside this run — case F has added a
  // task by now — 9/52 and 4/47.
  const cnt = (rows) => ({ done: rows.filter((t) => t.status === archDone).length, total: rows.length });
  const allCount = cnt(allSeason);
  const liveCount = cnt(liveSeason);
  const tile = await until(() => fortschritt(arc), (t) => /\d+\/[1-9]/.test(t), 8000);
  check(
    'die „Fortschritt“-Kachel zählt über die Archivgrenze hinweg (CCL-04)',
    tile.includes(`${allCount.done}/${allCount.total}`),
    `${tile} — erwartet ${allCount.done}/${allCount.total}`,
  );
  check(
    '…und die Live-Liste hätte etwas anderes gesagt: sonst prüfte die Zeile darüber nichts',
    allCount.done !== liveCount.done && allCount.total !== liveCount.total,
    `alle ${allCount.done}/${allCount.total}, live ${liveCount.done}/${liveCount.total}`,
  );

  await arc.goto(`${UI}/#/archiv`);
  await arc.reload();
  await ready(arc);
  const listed = await until(() => archiveRows(arc), (r) => r.length === agedRows.length, 8000);
  check(
    'das Archiv zeigt genau diese fünf und keine andere Zeile',
    listed.map((r) => r.title).sort().join(' | ') === agedRows.map((t) => t.title).sort().join(' | '),
    listed.map((r) => r.title).join(' | ') || 'leer',
  );
  // PGS-24: the heading states the policy the server really follows. A hardcoded „30" passes
  // against a build that has stopped reading the constant.
  const retention = (await api('/settings')).archive_after_days;
  const archHeads = (await archiveSections(arc)).map((s) => s.head);
  check(
    '…unter einer Überschrift, die die Aufbewahrungsfrist des Servers nennt (PGS-24)',
    archHeads[0] === `Erledigte Aufgaben (älter als ${dayCountDe(retention)})`,
    `${archHeads.join(' / ')} bei archive_after_days=${retention}`,
  );
  // Three shapes of Zuordnung in one table, which is what those fixtures exist for: a project row
  // links to both, an artist-only row to one, and the season-wide todo to nothing at all.
  const linksOf = (title) => listed.find((r) => r.title === title)?.links.join(' ') ?? 'keine Zeile';
  check(
    'die Zuordnung nennt Künstler und Projekt, wo es welche gibt — und bleibt leer, wo nicht',
    linksOf('Probenraum gebucht') === '#/artist/1 #/project/1' &&
      linksOf('Vorvertrag unterschrieben') === '#/artist/3' &&
      linksOf('Save-the-Date verschickt') === '',
    `24: ${linksOf('Probenraum gebucht')} | 26: ${linksOf('Vorvertrag unterschrieben')} | 27: „${linksOf('Save-the-Date verschickt')}“`,
  );

  // The archive is a view, not a deletion, and the search is where that becomes visible:
  // `/api/search` filters `deleted_at` and the live parents and nothing else. Following the hit
  // lands on the page the task belongs to, where the row is not in the table — the same one-way
  // trip the Zuordnung link makes in AI, asserted there.
  await arc.keyboard.press('ControlOrMeta+k');
  await arc.keyboard.type('Probenraum');
  const found = await until(
    () => arc.locator('#gs-hits [role="option"]').evaluateAll((els) => els.map((e) => e.id)),
    (ids) => ids.includes('gs-hit-t24'),
    8000,
  );
  check(
    'die Suche findet die archivierte Aufgabe weiterhin',
    found.includes('gs-hit-t24'),
    found.join(' ') || 'keine Treffer',
  );
  await arc.keyboard.press('Escape');
  await arc.keyboard.press('Escape');

  // ======================================================================== AI · what the row offers
  //
  // The other half of „a view": an archived row is a *report*, not a task. Case M owns WP-58 on the
  // task table's done row — the strike's propagation into block children and the precondition it
  // relies on — and nothing here re-asserts that mechanism. What is asserted is this page's own
  // markup: four `<td>`s, three of them struck, and a `prose-md--done` of its own.
  console.log('\nAI · Was eine archivierte Zeile hergibt und was nicht');
  // An invariant guard rather than a regression detector, and worth knowing before writing a canary
  // for it: what this line forbids is a control being *added* to the archive table, and no plausible
  // revert of an existing fix takes it red on its own (the `scope: 'all'` canary does, but for the
  // row count). What bites AI is the strike, the Zitat's colour, the search box and the badge's link.
  const bare = await until(() => archiveRows(arc), (r) => r.length === agedRows.length, 8000);
  check(
    'keine der Zeilen trägt ein Bedienelement — keinen Knopf, kein Feld, keinen Kommentarkasten',
    bare.length === agedRows.length && bare.every((r) => r.controls === 0 && r.taskId === null),
    bare.map((r) => `${r.title}:${r.controls}`).join(' | ') || 'keine Zeilen',
  );
  // The pair, on the same screen: this page does render controls, this table does not.
  const trashButtons = await arc
    .locator('div.divide-y > div')
    .evaluateAll((els) => els.map((e) => [...e.querySelectorAll('button')].map((b) => b.textContent).join('+')));
  check(
    '…während jede Papierkorb-Zeile darunter zwei davon hat',
    trashButtons.length > 0 && trashButtons.every((t) => t === 'Wiederherstellen+Endgültig löschen'),
    `${trashButtons.length} Zeilen: ${[...new Set(trashButtons)].join(' / ')}`,
  );

  // A missing button is not a missing handler: `InlineNotes` opens on a single click and
  // `CommentCell` on a double one, and neither surface exists here. Task 25 is the one archived row
  // with a comment, i.e. the only cell a double click could plausibly open. An invariant guard like
  // the line above, and for the same reason: what it forbids is an editor being *added* here.
  const archCommentRow = arc.locator('table tbody tr').filter({ hasText: 'Technikrider geprüft' });
  await clickIfThere(arc.locator('table tbody tr').first().locator('td').first());
  const archCommentBox = await boxOf(archCommentRow.locator('td').nth(3));
  if (archCommentBox) await arc.mouse.dblclick(archCommentBox.x + 20, archCommentBox.y + 8);
  await sleep(500); // long enough for an editor this must not be mounting
  const openedEditors = await arc.locator('.rte-content').count();
  check(
    'ein Klick auf den Titel und ein Doppelklick auf den Kommentar öffnen nichts',
    !!archCommentBox && openedEditors === 0 && (await arc.locator('table input').count()) === 0,
    `${openedEditors} Editoren, Kommentarzelle ${archCommentBox ? 'gefunden' : 'nicht gefunden'}`,
  );

  const look = await arc.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const row = [...document.querySelectorAll('table tbody tr')].find(
      (r) => (r.querySelectorAll('td')[3]?.textContent ?? '').trim().length > 0,
    );
    if (!row) return null;
    const tds = [...row.querySelectorAll('td')];
    return {
      row: cs(row)?.color ?? '',
      deco: tds.map((td) => cs(td)?.textDecorationLine ?? ''),
      link: cs(tds[1]?.querySelector('a'))?.color ?? 'kein Link',
      quote: cs(row.querySelector('blockquote'))?.color ?? 'kein Zitat',
      cell: cs(tds[3])?.color ?? '',
    };
  });
  check(
    'Aufgabe, „Erledigt am“ und Kommentar sind durchgestrichen — die Zuordnung nicht',
    look?.deco.join(' ') === 'line-through none line-through line-through',
    look?.deco.join(' ') ?? 'keine Zeile mit Kommentar',
  );
  check(
    '…das Grau erbt trotzdem jede Zelle, den Link darin eingeschlossen',
    !!look && look.link === look.row && look.row !== '',
    `Link ${look?.link}, Zeile ${look?.row}`,
  );
  // `.prose-md blockquote` paints `#6b7280` of its own (index.css) and `.prose-md--done` hands it
  // back to the row — so the pair is the assertion and needs no second fixture: the Zitat takes the
  // row's grey *and* is not the colour it would carry without the modifier.
  check(
    'das Zitat im archivierten Kommentar nimmt das Grau der Zeile statt seines eigenen',
    !!look && look.quote === look.cell && look.quote !== 'rgb(107, 114, 128)',
    `Zitat ${look?.quote}, Zelle ${look?.cell}`,
  );

  // The box above both lists is labelled for the whole Archiv, so it has to narrow both (PGS-22) —
  // and „Keine Treffer." is a different empty state from „Noch nichts archiviert", which case AK
  // reads. Only the `<h2>` above one of them tells the two apart, hence `archiveSections`.
  //
  // Every `fill` here is bounded and swallowed for the reason `clickIfThere` exists: a build that
  // has lost the box would otherwise wait out the default 30 s actionability timeout and then
  // **throw**, taking the rest of the run down instead of letting three assertions report.
  const archSearch = arc.locator('input[placeholder="Archiv durchsuchen…"]');
  const search = (text) => archSearch.fill(text, { timeout: 5000 }).catch(() => {});
  await search('Probenraum');
  const narrowed = await until(() => archiveSections(arc), (s) => s[0]?.tasks === 1, 5000);
  check(
    'die Suche über dem Archiv verengt auch den Papierkorb (PGS-22)',
    narrowed[0]?.tasks === 1 && narrowed[1]?.trash === 0 && narrowed[1]?.empty === 'Keine Treffer.',
    JSON.stringify(narrowed),
  );
  await search('Gelöschter');
  const other = await until(() => archiveSections(arc), (s) => s[1]?.trash === 1, 5000);
  check(
    '…und in der anderen Richtung ebenso',
    other[0]?.tasks === 0 && other[0]?.empty === 'Keine Treffer.' && other[1]?.trash === 1,
    JSON.stringify(other),
  );
  await search('');
  const cleared = await until(() => archiveSections(arc), (s) => s[0]?.tasks === agedRows.length, 5000);
  check(
    '…geleert stehen beide Listen wieder vollständig da',
    cleared[0]?.tasks === agedRows.length && cleared[1]?.trash === trashButtons.length,
    JSON.stringify(cleared),
  );

  // What the row *can* do. The Zuordnung cell is where the task came from, and its badge is the way
  // back — to the page, not to the row: the archive edge is one-way from here, exactly as it is
  // from the search hit above.
  // By the row's text, not by position: all five archived rows tie under `TASK_ORDER_DUE` (every
  // one done, none with a due date), so `first()` is only task 24 by insert order and a sixth
  // fixture would silently make this the wrong row.
  const badge = await clickIfThere(
    arc.locator('table tbody tr').filter({ hasText: 'Probenraum gebucht' }).locator('a[href="#/project/1"]'),
  );
  // Guarded, and the fallback is a plain `goto`: a build whose badge is not a link at all must take
  // the line below red and still let the *pair* underneath report, which is about what the project
  // page holds and not about how it was reached. An unguarded `waitForURL` throws there and ends
  // the run — measured, in the canary for exactly this link.
  if (badge) await arc.waitForURL(/#\/project\/1$/, { timeout: 15_000 }).catch(() => {});
  else await arc.goto(`${UI}/#/project/1`);
  await arc.reload();
  await ready(arc);
  const backHome = await until(() => rowIds(arc), (r) => r.length === p1Live.length, 8000);
  check(
    'die Projektmarke der Zeile führt dorthin zurück, wo die Aufgabe herkam',
    badge && (await arc.evaluate(() => location.hash)) === '#/project/1' && backHome.length === p1Live.length,
    `${badge ? 'geklickt' : 'keine Verknüpfung'}, ${await arc.evaluate(() => location.hash)}, ${backHome.length} Zeilen`,
  );
  const liveShape = await arc.evaluate(
    (title) => {
      const done = document.querySelector('tr[data-task-id="4"]');
      const commented = document.querySelector('tr[data-task-id="5"]');
      return {
        buttons: done?.querySelectorAll('button').length ?? 0,
        titled: [...(done?.querySelectorAll('button') ?? [])].some((b) => (b.textContent ?? '').trim() === title),
        commentBox: commented?.querySelectorAll('div.cursor-text').length ?? 0,
      };
    },
    youngDone?.title ?? '',
  );
  check(
    '…wo die archivierte Zeile weiterhin fehlt, ihre lebende erledigte Schwester aber alles trägt, was jener fehlte',
    !backHome.includes('24') &&
      !backHome.includes('53') &&
      liveShape.buttons > 0 &&
      liveShape.titled &&
      liveShape.commentBox === 1,
    `${JSON.stringify(liveShape)}, 24/53 gerendert=${backHome.includes('24')}/${backHome.includes('53')}`,
  );

  // ======================================================================== AJ · the boundary itself
  //
  // In a season of its own, and not a copy — `agedSeason`, made with the other fixture seasons
  // before any case has written. `erledigt_am` is server-derived,
  // so the two stamps go in through the one door that accepts them: the `{status, erledigt_am}`
  // pair `acceptsErledigtAm` takes, which exists for the undo stack (SDL-02). A lone `erledigt_am`
  // is dropped and the transform stamps today instead, which would read as a broken archive query.
  //
  // Both are computed from the server's own retention constant, ten minutes either side of it. That
  // is also what says the cutoff is a *timestamp*: twenty minutes decide, not a calendar day.
  console.log('\nAJ · Die Grenze: zwanzig Minuten entscheiden');
  const G = scoped(agedSeason.id);
  const retentionDays = (await api(G('/settings'))).archive_after_days;
  const gStatusCol = (await api(G('/custom-columns'))).find((c) => c.kind === 'builtin' && c.key === 'status');
  const gOptions = JSON.parse(gStatusCol?.options ?? '[]');
  const gDone = gOptions.find((o) => o.done)?.value ?? 'done';
  const gArtist = (await send('POST', G('/artists'), { name: 'Grenzfall', color: '#0b5fe9' })).body;
  const gProject = (
    await send('POST', G('/projects'), { artist_id: gArtist.id, code: 'GR1', name: 'Stichtag' })
  ).body;
  const TEN_MIN = 600_000;
  // `setDate`, never `Date.now() - N * 86_400_000`. The server's cutoff is
  // `datetime('now', 'localtime', '-N days')` — calendar-day arithmetic on the *naive local*
  // clock, i.e. the same wall-clock time N days ago — while a fixed span of milliseconds is an
  // absolute one. For the ~30 days after either DST transition the two differ by exactly one
  // hour, six times this case's ±10-minute margin, so in Europe/Berlin the older fixture lands on
  // the wrong side of the cutoff and four assertions go red against correct code. CI runs in UTC
  // and never sees it (docs/VERIFYING.md, „Das Archiv").
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffMs = cutoff.getTime();
  /** A task completed `offset` ms from the cutoff — or an open one when `offset` is null. */
  const atBoundary = async (title, offset) => {
    const made = (await send('POST', G('/tasks'), { project_id: gProject.id, title })).body;
    if (offset == null) return { ...made, wanted: null };
    const wanted = stampAt(cutoffMs + offset);
    const patched = await send('PATCH', G(`/tasks/${made.id}`), { status: gDone, erledigt_am: wanted });
    return { ...patched.body, wanted };
  };
  const older = await atBoundary('Zehn Minuten jenseits der Grenze', -TEN_MIN);
  const younger = await atBoundary('Zehn Minuten diesseits der Grenze', TEN_MIN);
  const stillOpen = await atBoundary('Noch offen', null);
  check(
    'beide Abschlusszeitpunkte stehen so in der Datenbank, wie sie gesetzt wurden (SDL-02)',
    older.erledigt_am === older.wanted && younger.erledigt_am === younger.wanted,
    `${older.erledigt_am} / ${younger.erledigt_am}`,
  );
  // Read off the two stored stamps rather than off the clock, so the failure detail is the pair the
  // server really holds.
  const apartMs =
    Date.parse(String(younger.erledigt_am).replace(' ', 'T')) -
    Date.parse(String(older.erledigt_am).replace(' ', 'T'));
  check(
    '…zwanzig Minuten liegen dazwischen, kein Kalendertag',
    apartMs === 2 * TEN_MIN,
    `${older.erledigt_am} → ${younger.erledigt_am}`,
  );

  const gLive = await api(G(`/tasks?project_id=${gProject.id}&scope=live`));
  const gArchived = await api(G(`/tasks?project_id=${gProject.id}&scope=archive`));
  check(
    'erledigt allein archiviert nichts: die jüngere Zeile steht mit der offenen in der Live-Liste',
    gLive.map((t) => t.id).sort().join(' ') === [younger.id, stillOpen.id].sort().join(' '),
    gLive.map((t) => `${t.id}:${t.status}`).join(' ') || 'leer',
  );
  check(
    '…und das Archiv hält genau die ältere',
    gArchived.map((t) => t.id).join(' ') === String(older.id),
    gArchived.map((t) => t.id).join(' ') || 'leer',
  );

  const gp = await open(context, '/dashboard');
  await pin(gp, agedSeason.id, `/project/${gProject.id}`);
  const gRows = await until(() => rowIds(gp), (r) => r.length === gLive.length, 8000);
  check(
    'die Projekttabelle zeigt die jüngere und die offene Zeile, die ältere nicht',
    [...gRows].sort().join(' ') === gLive.map((t) => String(t.id)).sort().join(' ') &&
      !gRows.includes(String(older.id)),
    gRows.join(' ') || 'keine Zeilen',
  );
  await gp.goto(`${UI}/#/archiv`);
  await gp.reload();
  await ready(gp);
  const gArchivePage = await until(() => archiveRows(gp), (r) => r.length === 1, 8000);
  check(
    '…und das Archiv dieser Saison zeigt sie, und nur sie',
    gArchivePage.length === 1 && gArchivePage[0]?.title === older.title,
    gArchivePage.map((r) => r.title).join(' | ') || 'leer',
  );

  // ======================================================================== AK · what „erledigt“ means
  //
  // The archive is the pair `(status = the done option) AND (erledigt_am <= cutoff)`, and only the
  // first half is configurable. Moving the flag to another category is therefore the one path in
  // the app that takes a task back *out* of the archive — and it is a definition change, not a
  // write: `erledigt_am` is untouched and the rows simply stop matching.
  //
  // The door is „Verwalten" on `#/einstellungen/aufgaben`, not the Kategorien tab, which holds the
  // other three option lists (case Q) and not this one.
  console.log('\nAK · Was „erledigt“ heißt, entscheidet über das Archiv');
  /** Open „Spalten verwalten" → the Status row's ✎, and say whether both really opened. */
  const openStatusEditor = async (page) => {
    await page.goto(`${UI}/#/einstellungen/aufgaben`);
    await page.reload();
    await ready(page);
    await clickIfThere(page.getByRole('button', { name: 'Verwalten' }));
    const manager = topDialog(page);
    const managerUp = await shown(manager.getByRole('heading', { name: 'Spalten verwalten' }), 8000);
    // „Status" appears in no other row's text — Priorität reads „Priorität / Auswahl · 3".
    await clickIfThere(
      manager.locator('[data-column-row]').filter({ hasText: 'Status' }).first().locator('button[title="Bearbeiten"]'),
    );
    const editor = topDialog(page);
    const editorUp = await shown(editor.getByRole('heading', { name: /„Status“ bearbeiten/ }), 8000);
    return { editor, ok: managerUp && editorUp };
  };
  /** Which option rows carry the „erledigt" radio, in order. */
  const doneFlags = (editor) =>
    editor
      .locator('input[type="radio"]')
      .evaluateAll((els) => els.map((el) => /** @type {HTMLInputElement} */ (el).checked));

  const flagFirst = await openStatusEditor(gp);
  const optionLabels = flagFirst.ok
    ? await flagFirst.editor
        .locator('[data-option-label]')
        .evaluateAll((els) => els.map((el) => /** @type {HTMLInputElement} */ (el).value))
    : [];
  const flagsBefore = flagFirst.ok ? await doneFlags(flagFirst.editor) : [];
  check(
    'der Editor der Status-Spalte trägt die Kategorien der Saison, und genau eine ist „erledigt“',
    flagFirst.ok && optionLabels.length === gOptions.length && flagsBefore.filter(Boolean).length === 1,
    `${optionLabels.join(' | ')} — ${flagsBefore.join(',')}`,
  );

  // A radio, not a checkbox: picking one clears the others (`OptionsEditor.update`), so there is
  // nothing to untick first. The target category is the one no fixture task holds, so the only thing
  // this save changes is which rows the archive query can match.
  const doneIndex = flagsBefore.indexOf(true);
  const flagTarget = doneIndex === 1 ? 0 : 1;
  await clickIfThere(flagFirst.editor.locator('[data-option-row]').nth(flagTarget).locator('input[type="radio"]'));
  const flagsAfter = await until(
    () => doneFlags(flagFirst.editor),
    (f) => f[flagTarget] === true && f.filter(Boolean).length === 1,
    4000,
  );
  check(
    '…das Umschalten nimmt es der alten Kategorie ab, statt eine zweite zu markieren',
    flagsAfter[flagTarget] === true && flagsAfter.filter(Boolean).length === 1,
    flagsAfter.join(','),
  );
  await clickIfThere(flagFirst.editor.getByRole('button', { name: 'Speichern' }), 8000);
  const storedOptions = await until(
    () =>
      api(G('/custom-columns')).then((cols) =>
        JSON.parse(cols.find((c) => c.key === 'status')?.options ?? '[]'),
      ),
    (o) => o[flagTarget]?.done === true && o.filter((x) => x.done).length === 1,
    8000,
  );
  check(
    'gespeichert trägt genau die andere Kategorie das Kennzeichen, unter ihrem alten Wert',
    storedOptions.filter((o) => o.done).length === 1 &&
      storedOptions[flagTarget]?.done === true &&
      storedOptions[flagTarget]?.value === gOptions[flagTarget]?.value,
    storedOptions.map((o) => `${o.label}${o.done ? '*' : ''}`).join(' | '),
  );
  // „Spalten verwalten" stays open behind the editor it opened, and its backdrop would eat the next
  // navigation's clicks.
  await gp.keyboard.press('Escape');
  await gone(gp.getByRole('heading', { name: 'Spalten verwalten' }), 5000);

  await gp.goto(`${UI}/#/archiv`);
  await gp.reload();
  await ready(gp);
  const archEmpty = await until(() => archiveSections(gp), (s) => (s[0]?.empty ?? '').length > 0, 8000);
  check(
    'das Archiv ist damit leer — und sagt die Frist des Servers dazu, statt „30“ zu behaupten',
    archEmpty[0]?.tasks === 0 &&
      archEmpty[0]?.empty ===
        `Noch nichts archiviert. Erledigte Aufgaben wandern ${dayCountDe(retentionDays)} nach Abschluss hierher.`,
    JSON.stringify(archEmpty[0]),
  );
  await gp.goto(`${UI}/#/project/${gProject.id}`);
  await gp.reload();
  await ready(gp);
  const backInTable = await until(() => rowIds(gp), (r) => r.length === 3, 8000);
  check(
    '…und die gealterte Zeile steht wieder in der Projekttabelle',
    backInTable.length === 3 && backInTable.includes(String(older.id)),
    backInTable.join(' ') || 'keine Zeilen',
  );
  const untouched = await api(G(`/tasks/${older.id}`));
  check(
    '…ohne dass ihr „Erledigt am“ angefasst worden wäre: geändert hat sich die Definition, nicht die Zeile',
    untouched.erledigt_am === older.wanted && untouched.status === gDone,
    `${untouched.erledigt_am} / ${untouched.status}`,
  );

  // And back, because „the archive emptied" is also what a broken archive query looks like.
  const flagSecond = await openStatusEditor(gp);
  if (flagSecond.ok) {
    await clickIfThere(flagSecond.editor.locator('[data-option-row]').nth(doneIndex).locator('input[type="radio"]'));
    await clickIfThere(flagSecond.editor.getByRole('button', { name: 'Speichern' }), 8000);
  }
  const archivedAgain = await until(
    () => api(G(`/tasks?project_id=${gProject.id}&scope=archive`)).then((r) => r.map((t) => t.id)),
    (ids) => ids.length === 1,
    8000,
  );
  check(
    'zurückgeschoben liegt sie wieder im Archiv: die Grenze folgt dem Kennzeichen, nicht dem Wort „Erledigt“',
    archivedAgain.join(' ') === String(older.id),
    archivedAgain.join(' ') || 'leer',
  );
  await gp.keyboard.press('Escape');

  // Handed forward to `columns`, which reuses them unchanged.
  Object.assign(fixtures, { pad2, rowIds });
}
