/** AT–AX · the reorderable surfaces */

import { sleep } from '../../lib/wait.mjs';
import { stubElectron } from '../bridge.mjs';
import { clickIfThere, dragHandleOnto, dragOver, grabHandle, moveTo, open, pin, ready, seasonPin, until } from '../browser.mjs';
import { NO_MATCH, RUN } from '../config.mjs';
import { handedOver } from '../fixtures.mjs';
import { check } from '../report.mjs';
import { api, send } from '../stack.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runReorder(fixtures) {
  const { HOME, context, sorted } = fixtures;
  /** `S` — the sorted season's query scope — comes from `records`, twelve files earlier. */
  const { S } = handedOver(fixtures, ['S']);
  // ======================================================================== AT · the task table
  //
  // The last five ⠿ surfaces the gate did not drive (#109), and this is the one with rules. Three
  // of them decide whether a row may be dropped on another, and each has a defect behind it:
  //
  //  * **Equal rank** — `compareByRules` over the active rules *truncated at* „Manuelle
  //    Reihenfolge" must return 0. The demo's block 41–45 is tuned for exactly that: four rows of
  //    one status, a fifth of another, all with the same (hidden, therefore inert) Priorität.
  //  * **The same *effective* parent** — the promotion a row whose parent is in the Papierkorb
  //    gets, not the raw `parent_id`. It renders among the top-level rows, and comparing
  //    `parent_id` made it a sibling of nobody: no drop target ever lit up (TTU-14). The demo has
  //    such a row; a *copy* does not, so this case builds its own — see there.
  //  * **No header-click sort in force.** A header click is a temporary *view*: dragging under it
  //    renumbered `sort_order` to match an order the user never configured, with no undo (TTU-04).
  //    The ⠿ stays where it is, disabled, and says why.
  //
  // Every refusal is paired with the acceptance that proves the gesture arrived at all, and the
  // mid-flight readings are taken while the pointer is still held (case K's pattern). All of it in
  // the `sorted` copy, whose tasks are the demo's own — `copyRows` carries ids.
  console.log('\nAT · Aufgabenzeilen: gleicher Rang, gleicher Elternteil');
  // `S` is case J's binding for this same copy — one season, one scope helper.
  const tt = await open(context, '/project/5');
  await pin(tt, sorted.id, '/project/5');

  /** Project 5's tasks as the server has them, in `sort_order` — children included. */
  const ttApi = () => api(S('/tasks?project_id=5'));
  const ttOf = (rows, id) => rows.find((t) => t.id === id);
  const ttStamp = (rows) => rows.map((t) => `${t.id}:${t.sort_order}`).join(' ');
  /**
   * The rows the *table* treats as top level. A `parent_id` that no live row carries is a
   * promotion, and that promotion is the whole of TTU-14 — so it is spelled out here rather than
   * read as `parent_id === null`, which would put the orphan in neither group.
   */
  const ttTop = (rows) => rows.filter((t) => t.parent_id === null || !rows.some((x) => x.id === t.parent_id));
  const ttKids = (rows) => rows.filter((t) => rows.some((x) => x.id === t.parent_id));
  const ttRow = (id) => tt.locator(`tr[data-task-id="${id}"]`);
  /** The table in display order, each row with the depth it renders at. */
  const ttDom = () =>
    tt
      .locator('tr[data-task-id]')
      .evaluateAll((els) =>
        els.map((el) => `${el.getAttribute('data-task-id')}:${el.getAttribute('data-depth')}`),
      );
  const ttLevel0 = (dom) => dom.filter((r) => r.endsWith(':0')).map((r) => Number(r.split(':')[0]));
  /**
   * What every row shows *while the pointer is held*, in one `evaluate` so all three readings come
   * from one layout: the drop highlight (`outline outline-2`, so `outlineStyle` is the reading —
   * every other row's is `none`), the dragged row's `opacity-40`, and `draggable`, which in
   * „armed" mode is true for the grabbed row alone and for nothing at rest (CCL-01).
   */
  const ttHeld = () =>
    tt.locator('tr[data-task-id]').evaluateAll((els) =>
      els.map((el) => {
        const s = getComputedStyle(el);
        return {
          id: Number(el.getAttribute('data-task-id')),
          target: s.outlineStyle !== 'none',
          faded: Number(s.opacity) < 0.6,
          armed: el.getAttribute('draggable') === 'true',
        };
      }),
    );
  /** „which rows are `key` right now", as a stable string — the card grids below read the same way. */
  const idsWith = (rows, key) => rows.filter((r) => r[key]).map((r) => r.id).join(' ') || 'keine';
  /**
   * „`want` really is a different order from `before`".
   *
   * `moveTo` hands its input back unchanged when either id is missing from the list — the same
   * contract `arrayMoveTo` has — so an expectation built from a list that lost a row would be the
   * starting order itself, and „it moved" would then be true of a drag that did nothing at all.
   * Every accepted-drag assertion below carries this beside its own reading.
   */
  const aMove = (before, want) => before.join(' ') !== want.join(' ');

  const ttStart = await ttApi();
  const ttSameRank = [41, 42, 43, 44];
  const ttStatuses = new Set(ttSameRank.map((id) => ttOf(ttStart, id)?.status ?? NO_MATCH));
  // `?? NO_MATCH` on both sides, and the odd row asserted to *exist*: a fixture that had lost task
  // 45 would otherwise compare `undefined` against a set built from the fallback and pass — with
  // no row of another rank left on the page for the refusal below to be tried on.
  const ttOdd = ttOf(ttStart, 45)?.status ?? NO_MATCH;
  check(
    'Vorbedingung: vier gleichrangige Zeilen, eine fünfte mit anderem Status, drei Kinder darunter',
    ttStatuses.size === 1 &&
      !ttStatuses.has(NO_MATCH) &&
      ttOdd !== NO_MATCH &&
      !ttStatuses.has(ttOdd) &&
      [46, 47, 48].every((id) => ttOf(ttStart, id)?.parent_id === 41),
    `41–44 ${[...ttStatuses].join('/')}, 45 ${ttOdd}, Kinder von ${[46, 47, 48].map((id) => ttOf(ttStart, id)?.parent_id).join('/')}`,
  );
  const ttDom0 = await until(ttDom, (d) => d.length >= 9, 8000);
  check(
    '…und genau diese drei stehen eine Stufe tiefer, alles andere auf der obersten Ebene',
    [46, 47, 48].every((id) => ttDom0.includes(`${id}:1`)) &&
      ttDom0.filter((r) => r.endsWith(':1')).length === 3,
    ttDom0.join(' '),
  );

  // The accepted move first: without it every refusal below could be a drag that never started.
  const ttTopBefore = ttLevel0(ttDom0);
  const ttKidsBefore = ttStamp(ttKids(ttStart));
  const ttWant1 = moveTo(ttTopBefore, 44, 41);
  const ttGrab1 = await dragHandleOnto(tt, ttRow(44), ttRow(41));
  const ttDom1 = await until(ttDom, (d) => ttLevel0(d).join(' ') === ttWant1.join(' '), 8000);
  check(
    'eine Zeile lässt sich auf eine gleichrangige Schwester ziehen und steht danach an deren Platz',
    ttGrab1 && aMove(ttTopBefore, ttWant1) && ttLevel0(ttDom1).join(' ') === ttWant1.join(' '),
    `gegriffen ${ttGrab1}, ${ttLevel0(ttDom1).join(' ')} statt ${ttWant1.join(' ')}`,
  );
  const ttAfter1 = await ttApi();
  // The renumbering covers the whole *displayed* sibling list, which is what keeps `sort_order`
  // meaningful once the rules re-sort the table (and what TTU-07 got wrong in the other direction).
  check(
    '…und die ganze Geschwisterliste ist nach dem Bild auf dem Schirm neu durchnummeriert, 0..n-1',
    ttStamp(ttTop(ttAfter1)) === ttWant1.map((id, i) => `${id}:${i}`).join(' '),
    ttStamp(ttTop(ttAfter1)),
  );
  check(
    '…die Kinder darunter rührt sie nicht an',
    ttStamp(ttKids(ttAfter1)) === ttKidsBefore,
    `${ttStamp(ttKids(ttAfter1))} (vorher ${ttKidsBefore})`,
  );

  // Held, not released: the highlight and the dimming are what the user has to read *during* the
  // gesture, and a refused pairing withholds the first while keeping the second.
  const ttGrab2 = await grabHandle(tt, ttRow(41));
  const ttCarry1 = await dragOver(tt, ttRow(42));
  // Both states in the predicate, because the assertion below reads both. Here that is
  // discipline rather than a repro — a `<tr>` carries no transition and the two land in one
  // commit — but on the cards in AU it is the difference between green and one red run in three.
  const ttOverSame = await until(
    ttHeld,
    (rows) => rows.some((r) => r.target) && rows.some((r) => r.faded),
    5000,
  );
  check(
    'mitten im Zug hebt sich die gleichrangige Schwester hervor — und nur sie',
    ttGrab2 &&
      ttCarry1 &&
      idsWith(ttOverSame, 'target') === '42' &&
      idsWith(ttOverSame, 'faded') === '41' &&
      idsWith(ttOverSame, 'armed') === '41',
    `gegriffen ${ttGrab2}, Ziel ${idsWith(ttOverSame, 'target')}, blass ${idsWith(ttOverSame, 'faded')}, scharf ${idsWith(ttOverSame, 'armed')}`,
  );
  const ttCarry2 = await dragOver(tt, ttRow(45));
  // Nothing to poll for: the highlight is *withheld*, and a poll for a negative is satisfied by
  // its first read. A beat longer than the highlight above took to appear, then one reading —
  // still with the pointer down, so „nothing lights up" cannot be „the drag is over".
  await sleep(500);
  const ttOverOther = await ttHeld();
  check(
    '…über der Zeile mit dem anderen Status hebt sich keine hervor, und die gezogene bleibt blass',
    idsWith(ttOverOther, 'target') === 'keine' &&
      idsWith(ttOverOther, 'faded') === '41' &&
      idsWith(ttOverOther, 'armed') === '41',
    `Ziel ${idsWith(ttOverOther, 'target')}, blass ${idsWith(ttOverOther, 'faded')}, scharf ${idsWith(ttOverOther, 'armed')}`,
  );
  await tt.mouse.up();
  // A refused drop issues no request at all, so there is nothing to wait on — the honest shape is
  // a beat longer than the accepted reorder above took, then the same read (docs/VERIFYING.md).
  await sleep(800);
  const ttAfter2 = await ttApi();
  check(
    'losgelassen über der anderen Rangstufe ändert der Zug nichts',
    ttGrab2 && ttCarry2 && ttStamp(ttAfter2) === ttStamp(ttAfter1),
    `gegriffen ${ttGrab2}, getragen ${ttCarry2}, ${ttStamp(ttTop(ttAfter2))}`,
  );

  const ttGrab3 = await dragHandleOnto(tt, ttRow(46), ttRow(42));
  await sleep(800);
  const ttAfter3 = await ttApi();
  check(
    'ein Kind lässt sich auch auf eine gleichrangige Zeile der obersten Ebene nicht ziehen — der Elternteil entscheidet mit',
    ttGrab3 && ttStamp(ttAfter3) === ttStamp(ttAfter2),
    `gegriffen ${ttGrab3}, ${ttStamp(ttAfter3)}`,
  );

  const ttGrab4 = await dragHandleOnto(tt, ttRow(48), ttRow(46));
  const ttWant4 = moveTo(ttKids(ttAfter3).map((t) => t.id), 48, 46);
  const ttAfter4 = await until(
    ttApi,
    (r) => ttKids(r).map((t) => t.id).join(' ') === ttWant4.join(' '),
    8000,
  );
  check(
    'unter demselben Elternteil ist derselbe Zug erlaubt',
    ttGrab4 &&
      aMove(ttKids(ttAfter3).map((t) => t.id), ttWant4) &&
      ttKids(ttAfter4).map((t) => t.id).join(' ') === ttWant4.join(' '),
    `gegriffen ${ttGrab4}, ${ttStamp(ttKids(ttAfter4))}`,
  );
  // Each sibling group is renumbered on its own, so the two levels' ordinals sit on top of one
  // another — by design: `sort_order` orders a row among its siblings, not in the table.
  check(
    '…und zwar für sich: die Ordinalzahlen der beiden Ebenen liegen übereinander, die obere Gruppe steht unverändert',
    ttStamp(ttKids(ttAfter4)) === ttWant4.map((id, i) => `${id}:${i}`).join(' ') &&
      ttStamp(ttTop(ttAfter4)) === ttStamp(ttTop(ttAfter2)),
    `Kinder ${ttStamp(ttKids(ttAfter4))} / oben ${ttStamp(ttTop(ttAfter4))}`,
  );

  // The orphan TTU-14 is about — **built rather than borrowed**. `copySeasonData` re-roots a
  // subtask whose parent stayed behind (`parent_id = null`, db.ts), so the demo's own task 12
  // arrives in this copy as an ordinary top-level row and the fixture is simply not in it. Two
  // rows and a soft delete put it back: `DELETE` stamps one row, so the child stays live under a
  // trashed parent, which is that state exactly. The status is the host row's, so the pair ties
  // under the rank rule and only the parent rule is left to decide.
  const ttHost = ttOf(ttAfter4, 13);
  const ttGhost = (
    await send('POST', S('/tasks'), {
      project_id: 5,
      title: `Elternzeile ${RUN}`,
      status: ttHost?.status,
    })
  ).body;
  const ttOrphan = (
    await send('POST', S('/tasks'), {
      project_id: 5,
      parent_id: ttGhost?.id,
      title: `Verwaiste Zeile ${RUN}`,
      status: ttHost?.status,
    })
  ).body;
  await send('DELETE', S(`/tasks/${ttGhost?.id}`));
  // A write straight to the API broadcasts nothing, so the page has to be told to look again.
  await tt.reload();
  await ready(tt);
  const ttWithOrphan = await ttApi();
  const ttDomOrphan = await until(ttDom, (d) => d.some((r) => r.startsWith(`${ttOrphan?.id}:`)), 8000);
  check(
    'Vorbedingung: eine Zeile, deren Elternzeile im Papierkorb liegt — sie trägt weiter deren id und steht trotzdem oben (TTU-14)',
    ttOf(ttWithOrphan, ttOrphan?.id)?.parent_id === ttGhost?.id &&
      !ttOf(ttWithOrphan, ttGhost?.id) &&
      ttDomOrphan.includes(`${ttOrphan?.id}:0`),
    `Waise ${ttOrphan?.id} → Elter ${ttOf(ttWithOrphan, ttOrphan?.id)?.parent_id} (${ttOf(ttWithOrphan, ttGhost?.id) ? 'lebt' : 'gelöscht'}), Tiefe ${ttDomOrphan.find((r) => r.startsWith(`${ttOrphan?.id}:`))}`,
  );
  const ttWant5 = moveTo(ttLevel0(ttDomOrphan), ttOrphan?.id, 13);
  const ttGrab5 = await dragHandleOnto(tt, ttRow(ttOrphan?.id), ttRow(13));
  const ttAfter5 = await until(
    ttApi,
    (r) => ttTop(r).map((t) => t.id).join(' ') === ttWant5.join(' '),
    8000,
  );
  check(
    'die verwaiste Unteraufgabe darf auf eine Zeile der obersten Ebene, weil sie dort steht (TTU-14)',
    ttGrab5 &&
      aMove(ttLevel0(ttDomOrphan), ttWant5) &&
      ttTop(ttAfter5).map((t) => t.id).join(' ') === ttWant5.join(' '),
    `gegriffen ${ttGrab5}, ${ttTop(ttAfter5).map((t) => t.id).join(' ')} statt ${ttWant5.join(' ')}`,
  );
  check(
    '…und bleibt dabei, was sie ist: die Beförderung ist eine Ansicht, kein Schreibvorgang',
    ttOf(ttAfter5, ttOrphan?.id)?.parent_id === ttGhost?.id && !ttOf(ttAfter5, ttGhost?.id),
    `parent_id ${ttOf(ttAfter5, ttOrphan?.id)?.parent_id}, Elternzeile ${ttOf(ttAfter5, ttGhost?.id) ? 'lebt' : 'gelöscht'}`,
  );

  /** How many of each kind of ⠿ the table has, beside the number of rows it renders. */
  const ttHandles = () =>
    tt.evaluate(() => ({
      live: document.querySelectorAll('tr[data-task-id] [title^="Zum Verschieben ziehen"]').length,
      dead: document.querySelectorAll('tr[data-task-id] [title^="Spaltensortierung"]').length,
      rows: document.querySelectorAll('tr[data-task-id]').length,
    }));
  const ttHead = tt.locator('table thead th').filter({ hasText: 'Aufgabe' }).first();
  const ttFree = await ttHandles();
  const ttSorted = await clickIfThere(ttHead);
  const ttLocked = await until(ttHandles, (h) => h.dead > 0, 5000);
  check(
    'ein Klick auf den Spaltenkopf nimmt jeder Zeile den Griff — und lässt ihn stehen, damit die Zeile sagen kann, warum (TTU-04)',
    ttSorted &&
      ttFree.live === ttFree.rows &&
      ttFree.dead === 0 &&
      ttLocked.dead === ttLocked.rows &&
      ttLocked.live === 0,
    `geklickt ${ttSorted}, frei ${JSON.stringify(ttFree)}, sortiert ${JSON.stringify(ttLocked)}`,
  );
  // Both bounded and swallowed. A build that stops rendering the disabled ⠿ leaves this locator
  // matching nothing, and an unguarded `getAttribute` then waits 30 s and **throws** — which ends
  // the run at this line instead of reddening it. Measured: the canary for that very rule did it.
  const attr = (locator, name) =>
    locator
      .first()
      .getAttribute(name, { timeout: 5000 })
      .catch(() => null);
  const ttWhy = await attr(tt.locator('tr[data-task-id] [title^="Spaltensortierung"]'), 'title');
  const ttCycle = await attr(ttHead, 'title');
  check(
    '…und beide Tooltips nennen denselben Weg zurück: den Spaltenkopf noch einmal',
    ttWhy === 'Spaltensortierung aktiv — zum Verschieben die Sortierung zurücksetzen (Spaltenkopf erneut klicken)' &&
      ttCycle === 'Sortieren: aufsteigend → absteigend → Standard',
    `${ttWhy} / ${ttCycle}`,
  );
  const ttGrab6 = await grabHandle(tt, ttRow(44), '[title^="Spaltensortierung"]');
  const ttCarry6 = await dragOver(tt, ttRow(42));
  await sleep(500);
  const ttUnderSort = await ttHeld();
  await tt.mouse.up();
  await sleep(800);
  const ttAfter6 = await ttApi();
  check(
    'derselbe Zug am stumpfen Griff schärft keine Zeile, hebt keine hervor und schreibt nichts',
    ttGrab6 &&
      ttCarry6 &&
      idsWith(ttUnderSort, 'armed') === 'keine' &&
      idsWith(ttUnderSort, 'target') === 'keine' &&
      ttStamp(ttAfter6) === ttStamp(ttAfter5),
    `gegriffen ${ttGrab6}, getragen ${ttCarry6}, scharf ${idsWith(ttUnderSort, 'armed')}, Ziel ${idsWith(ttUnderSort, 'target')}, ${ttStamp(ttTop(ttAfter6))}`,
  );
  const ttTwice = (await clickIfThere(ttHead)) && (await clickIfThere(ttHead));
  const ttBack = await until(ttHandles, (h) => h.live > 0, 5000);
  check(
    'der dritte Klick auf denselben Kopf gibt die Griffe zurück (TTU-18)',
    ttTwice && ttBack.live === ttBack.rows && ttBack.dead === 0,
    `geklickt ${ttTwice}, ${JSON.stringify(ttBack)}`,
  );

  // Closed for the reason #138 documents: every window this gate leaves open joins the fan-out of
  // every later blanket `invalidate()`, against one Express process — the storm's own supply line.
  await tt.close().catch(() => {});

  // ======================================================================== AU · the two card grids
  //
  // Both are `useListReorder` over a flat list, and neither has a `canDrop` — what they have that
  // the row lists do not is a card that *does something when clicked*. The ⠿ sits inside it (in
  // the project card's `<Link>`, beside the season card's `role="button"`), and `DragHandle`
  // swallows the click for exactly that reason, so „the drag did not navigate" is half the case.
  //
  // The season grid is also the one list whose order is not a column: `reorderSeasons` rewrites
  // the registry array itself, and the cards on `#/` are that array.
  console.log('\nAU · Projekt- und Saisonkarten');
  const pcApi = (artistId) => api(S(`/projects?artist_id=${artistId}`));
  const pcStamp = (rows) => rows.map((p) => `${p.id}:${p.sort_order}`).join(' ');
  // The demo gives every Künstler exactly two live projects, and on a two-card grid „everything
  // else kept its relative order" is a statement about nothing. So this case adds the third card
  // itself, over the API and into its own copy, before the page is ever opened.
  const pcBefore = await pcApi(1);
  const pcThird = (
    await send('POST', S('/projects'), { artist_id: 1, code: 'NQ3', name: `Drittes Projekt ${RUN}` })
  ).body;
  const pcForeign = await pcApi(2);
  check(
    'Vorbedingung: Künstler 1 hat die zwei Projekte der Demo — die dritte Karte legt dieser Fall selbst an',
    pcBefore.length === 2 && Number(pcThird?.id) > 0,
    `${pcBefore.length} Projekte, neu ${pcThird?.id ?? 'keins'}`,
  );

  const pc = await open(context, '/artist/1');
  await pin(pc, sorted.id, '/artist/1');
  const pcCard = (id) => pc.locator(`[data-project-card="${id}"]`);
  const pcDom = () =>
    pc.locator('[data-project-card]').evaluateAll((els) =>
      els.map((el) => Number(el.getAttribute('data-project-card'))),
    );
  /** The cards' mid-flight cues: the drop target's `ring-2` (a box shadow) and `opacity-40`. */
  const pcHeld = () =>
    pc.locator('[data-project-card]').evaluateAll((els) =>
      els.map((el) => {
        const s = getComputedStyle(el);
        return {
          id: Number(el.getAttribute('data-project-card')),
          target: s.boxShadow !== 'none',
          faded: Number(s.opacity) < 0.6,
        };
      }),
    );

  const pcOrder = await until(pcDom, (d) => d.length === 3, 8000);
  const pcWant = moveTo(pcOrder, pcOrder[2], pcOrder[0]);
  const pcGrab = await grabHandle(pc, pcCard(pcOrder[2]));
  const pcCarry = await dragOver(pc, pcCard(pcOrder[0]));
  // The ring and the fade are two properties of one `transition`, and they do not arrive in the
  // same frame: the first run of this case polled for the ring alone and read the carried card at
  // full opacity — „blass keine" against a card that was on its way to 0.4.
  const pcFlight = await until(
    pcHeld,
    (rows) => rows.some((r) => r.target) && rows.some((r) => r.faded),
    5000,
  );
  check(
    'mitten im Zug trägt die Zielkarte den Ring und die gezogene wird blass',
    pcGrab &&
      pcCarry &&
      idsWith(pcFlight, 'target') === String(pcOrder[0]) &&
      idsWith(pcFlight, 'faded') === String(pcOrder[2]),
    `gegriffen ${pcGrab}, Ziel ${idsWith(pcFlight, 'target')}, blass ${idsWith(pcFlight, 'faded')}`,
  );
  await pc.mouse.up();
  const pcAfter = await until(
    () => pcApi(1).then((r) => r.map((p) => p.id)),
    (ids) => ids.join(' ') === pcWant.join(' '),
    8000,
  );
  check(
    'die letzte Projektkarte steht danach vorn, die beiden anderen in ihrer alten Reihenfolge dahinter',
    aMove(pcOrder, pcWant) && pcAfter.join(' ') === pcWant.join(' '),
    `${pcAfter.join(' ')} statt ${pcWant.join(' ')}`,
  );
  const pcRows = await pcApi(1);
  // One read for the verdict *and* the detail: two fetches can sample different moments, and the
  // log would then contradict its own verdict on exactly the run that needs reading.
  const pcForeignAfter = await pcApi(2);
  check(
    '…und die Karten dieses Künstlers sind 0..n-1 durchnummeriert, die eines anderen unberührt',
    pcStamp(pcRows) === pcWant.map((id, i) => `${id}:${i}`).join(' ') &&
      pcStamp(pcForeignAfter) === pcStamp(pcForeign),
    `${pcStamp(pcRows)} | fremd ${pcStamp(pcForeignAfter)} (vorher ${pcStamp(pcForeign)})`,
  );
  // The whole reason `DragHandle` swallows its own click: the handle sits inside the card's
  // `<Link>`, so a press that did not become a drag would otherwise open the project.
  check(
    '…und der Zug hat nicht navigiert: die Seite ist noch die des Künstlers',
    pc.url().endsWith('#/artist/1'),
    pc.url(),
  );

  // The season grid, on the page whose content belongs to no season at all.
  const ld = await open(context, '/', (page) => stubElectron(page));
  const scRegistry = () => api('/seasons');
  const scCardOf = (label) =>
    ld.locator(`[data-section="saisons"] div.group.relative:has([aria-label$="„${label}“ öffnen"])`);
  const scStart = await scRegistry();
  const scIds = scStart.seasons.map((s) => s.id);
  const scPinBefore = await seasonPin(ld);
  const scWant = moveTo(scIds, scIds[2], scIds[0]);
  const scGrab = await dragHandleOnto(
    ld,
    scCardOf(scStart.seasons[2]?.label ?? NO_MATCH),
    scCardOf(scStart.seasons[0]?.label ?? NO_MATCH),
  );
  const scAfter = await until(
    () => scRegistry().then((r) => r.seasons.map((s) => s.id)),
    (ids) => ids.join(' ') === scWant.join(' '),
    8000,
  );
  check(
    'auch die Saisonkarten lassen sich umsortieren — und das ist die Reihenfolge der Registry selbst',
    scGrab && aMove(scIds, scWant) && scAfter.join(' ') === scWant.join(' '),
    `gegriffen ${scGrab}, ${scAfter.slice(0, 4).join(' ')}… statt ${scWant.slice(0, 4).join(' ')}…`,
  );
  const scReg = await scRegistry();
  const scPinAfter = await seasonPin(ld);
  check(
    '…und das Fenster hat dabei keine Saison gewechselt: derselbe Pin, dieselbe voreingestellte Saison, dieselbe Seite',
    scPinAfter === scPinBefore && scReg.activeId === scStart.activeId && ld.url().endsWith('#/'),
    `Pin ${scPinBefore} → ${scPinAfter}, aktiv ${scStart.activeId} → ${scReg.activeId}, ${ld.url()}`,
  );
  await ld.reload();
  await ready(ld);
  const scShown = await until(
    () =>
      ld
        .locator('[data-section="saisons"] [role="button"][aria-label$="öffnen"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? '')),
    (labels) => labels.length >= scIds.length,
    8000,
  );
  // Compared as „does this card's label end the aria-label", never by taking the term back out of
  // it: `Saison` is a renameable word and this run renames it elsewhere.
  const scWantLabels = scWant.map((id) => scReg.seasons.find((s) => s.id === id)?.label ?? NO_MATCH);
  check(
    '…die neue Reihenfolge steht nach einem Neuladen so da, wie die Registry sie hält',
    scShown.length === scWantLabels.length &&
      scShown.every((aria, i) => aria.endsWith(`„${scWantLabels[i]}“ öffnen`)),
    scShown.slice(0, 3).join(' | '),
  );

  await pc.close().catch(() => {});

  // ======================================================================== AV · the landing lists
  //
  // Two document lists on one page, and they are two *stores*: the builtin „Dokumente" card is
  // `landing.documents`, a custom Dokumente-Bereich keeps its rows inside its own section row.
  // Neither has a `reorder` endpoint — the move *is* a `PATCH /api/landing`, so a script waiting
  // for `**/reorder` waits for ever (docs/VERIFYING.md).
  //
  // What makes this list different from every other one: `DocList` uses `useDragReorder` directly
  // rather than `useListReorder`, because that one computes the new order from the array its
  // caller *rendered*. Here that is SHL-01 reached through the drag — a document added in another
  // window since this render is absent from the snapshot, and a PATCH would delete it outright,
  // with no Papierkorb behind `seasons.json`. So the case adds one from outside first.
  console.log('\nAV · Die zwei Dokumentenlisten der Startseite');
  const ldBlob = () => api('/landing');
  const ldStamp = (docs) => (docs ?? []).map((d) => `${d.id}:${d.label}`).join(' | ');
  const ldRow = (key, text) => ld.locator(`[data-section="${key}"] li`).filter({ hasText: text }).first();
  /** Every write this page issues, so „no reorder request" is a reading rather than a hope. */
  const ldWrites = [];
  const ldWatch = (req) => {
    if (req.method() !== 'GET' && req.url().includes('/api/')) {
      ldWrites.push(`${req.method()} ${req.url().split('/api')[1].split('?')[0]}`);
    }
  };
  ld.on('request', ldWatch);

  const ldStart = await ldBlob();
  const ldLinks = ldStart.sections.find((s) => s.type === 'links');
  const ldText = ldStart.sections.find((s) => s.type === 'text');
  const ldSectionDocs = (blob) => blob.sections.find((s) => s.id === ldLinks?.id)?.documents ?? [];
  const ldOwnLabels = new Set(ldStart.documents.map((d) => d.label));
  const ldFirst = ldStart.documents[0];
  const ldLast = ldStart.documents.at(-1);
  // The two rows this case drags, addressed by their own text — and `hasText` is a *substring*
  // match, so „exactly one row carries it" is part of the precondition rather than a hope. Earlier
  // cases have added documents to this blob (it is the one store no fixture season isolates), so
  // what is on screen is computed from the API and never from `demo.ts`.
  const ldMatches = (label) =>
    ld.locator('[data-section="dokumente"] li').filter({ hasText: label }).count();
  check(
    'Vorbedingung: beide Listen haben etwas zu verschieben, keine Zeile steht in beiden, und die zwei Zeilen dieses Falls sind eindeutig',
    ldStart.documents.length >= 2 &&
      (ldLinks?.documents ?? []).length === 2 &&
      !!ldText &&
      (ldLinks?.documents ?? []).every((d) => !ldOwnLabels.has(d.label)) &&
      (await ldMatches(ldFirst?.label ?? NO_MATCH)) === 1 &&
      (await ldMatches(ldLast?.label ?? NO_MATCH)) === 1,
    `${ldStart.documents.length} Dokumente (${ldFirst?.label} … ${ldLast?.label}) / Bereich „${ldLinks?.name}“ ${ldStamp(ldLinks?.documents)}`,
  );

  const ldFar = `Aus der Ferne ${RUN}`;
  await send('PATCH', '/landing', {
    documents: [...ldStart.documents.map(({ id, label, url }) => ({ id, label, url })), { label: ldFar, url: null }],
  });
  const ldGrown = await ldBlob();
  check(
    'ein anderes Fenster legt ein Dokument dazu, von dem diese Seite nichts weiß',
    ldGrown.documents.length === ldStart.documents.length + 1 &&
      ldGrown.documents.at(-1)?.label === ldFar,
    ldStamp(ldGrown.documents),
  );

  const ldWant = moveTo(ldGrown.documents.map((d) => d.id), ldLast?.id, ldFirst?.id);
  const ldGrab = await dragHandleOnto(
    ld,
    ldRow('dokumente', ldLast?.label ?? NO_MATCH),
    ldRow('dokumente', ldFirst?.label ?? NO_MATCH),
  );
  const ldAfter = await until(
    ldBlob,
    (b) => b.documents.map((d) => d.id).join(' ') === ldWant.join(' '),
    8000,
  );
  check(
    'die letzte Zeile der eingebauten Liste steht nach dem Zug an erster Stelle',
    ldGrab &&
      aMove(ldGrown.documents.map((d) => d.id), ldWant) &&
      ldAfter.documents.map((d) => d.id).join(' ') === ldWant.join(' '),
    `gegriffen ${ldGrab}, ${ldStamp(ldAfter.documents)}`,
  );
  // The whole point of computing over `read()`: the row this page never saw is still there, and
  // still last, because the move was applied to the list *as the server has it* (SHL-01).
  check(
    '…und das Dokument aus dem anderen Fenster hat der Zug nicht mitgenommen',
    ldAfter.documents.some((d) => d.label === ldFar) &&
      ldAfter.documents.at(-1)?.label === ldFar &&
      ldAfter.documents.length === ldGrown.documents.length,
    ldStamp(ldAfter.documents),
  );
  // `assignDocIds` keeps id *and* order: a row whose id travelled to another label would be a
  // renumbering, and every ✎/🗑 on this page addresses its row by id.
  check(
    '…jede Zeile behält dabei ihre id',
    ldWant.every((id) => {
      const before = ldGrown.documents.find((d) => d.id === id)?.label;
      return before !== undefined && ldAfter.documents.find((d) => d.id === id)?.label === before;
    }),
    ldStamp(ldAfter.documents),
  );
  check(
    '…geschrieben wurde die Ablage selbst: ein PATCH, keine einzige Umsortier-Anfrage',
    ldWrites.filter((w) => w.endsWith('/landing')).length === 1 &&
      !ldWrites.some((w) => w.includes('/reorder')),
    ldWrites.join(' | ') || 'nichts',
  );
  check(
    '…und der eigene Bereich daneben steht unverändert',
    ldStamp(ldSectionDocs(ldAfter)) === ldStamp(ldLinks?.documents),
    ldStamp(ldSectionDocs(ldAfter)),
  );

  const ldSecKey = `lt${ldLinks?.id}`;
  const ldSecRows = ldLinks?.documents ?? [];
  const ldGrab2 = await dragHandleOnto(
    ld,
    ldRow(ldSecKey, ldSecRows[1]?.label ?? NO_MATCH),
    ldRow(ldSecKey, ldSecRows[0]?.label ?? NO_MATCH),
  );
  const ldSecWant = moveTo(ldSecRows.map((d) => d.id), ldSecRows[1]?.id, ldSecRows[0]?.id);
  const ldAfter2 = await until(
    ldBlob,
    (b) => ldSectionDocs(b).map((d) => d.id).join(' ') === ldSecWant.join(' '),
    8000,
  );
  check(
    'der eigene Dokumente-Bereich sortiert seine eigenen Zeilen, in seiner eigenen Zeile der Registry',
    ldGrab2 &&
      aMove(ldSecRows.map((d) => d.id), ldSecWant) &&
      ldSectionDocs(ldAfter2).map((d) => d.id).join(' ') === ldSecWant.join(' '),
    `gegriffen ${ldGrab2}, ${ldStamp(ldSectionDocs(ldAfter2))}`,
  );
  check(
    '…und lässt die eingebaute Liste und den Textbereich stehen: eine Linse, ein Bereich',
    ldStamp(ldAfter2.documents) === ldStamp(ldAfter.documents) &&
      ldAfter2.sections.find((s) => s.id === ldText?.id)?.value === ldText?.value &&
      ldAfter2.sections.length === ldStart.sections.length,
    `${ldStamp(ldAfter2.documents)} / Text „${String(ldAfter2.sections.find((s) => s.id === ldText?.id)?.value).slice(0, 24)}…“`,
  );

  // Two drags on rows whose label is a *button* into the outside world. The recorder is the
  // instrument for both halves: nothing opened while dragging, and the same row opened on a click,
  // which is what says the recorder was watching at all.
  const ldQuiet = await ld.evaluate(() => /** @type {any} */ (window).__external);
  const ldOpenable = ldAfter2.documents.find((d) => d.url);
  const ldClicked = await clickIfThere(
    ldRow('dokumente', ldOpenable?.label ?? NO_MATCH).getByRole('button', { name: ldOpenable?.label ?? NO_MATCH }),
  );
  const ldOpened = await until(
    () => ld.evaluate(() => /** @type {any} */ (window).__external),
    (v) => v.length > 0,
    5000,
  );
  check(
    'kein Zug hat etwas geöffnet — ein Klick auf dieselbe Zeile schon: ein ⠿ wird gegriffen, nie geklickt',
    ldQuiet.length === 0 && ldClicked && ldOpened.length === 1,
    `nach zwei Zügen ${ldQuiet.length}, geklickt ${ldClicked}, danach ${ldOpened.join(' ')}`,
  );
  ld.off('request', ldWatch);

  await ld.close().catch(() => {});

  // ======================================================================== AW · „anordnen"
  //
  // The arranger is the one reorderer that runs in `mode: 'always'` — while „Bereiche bearbeiten"
  // is on, the whole section carries `draggable` and the ⠿ in its strip is an affordance rather
  // than the trigger — and the one with a *fixed* position in the list: the toolbar sits in the
  // grid after `toolbarAfterKey`, so the section it follows may not move and nothing may pass it.
  // Before that rule, ▲ on the section below „Künstler" swapped it above the grid and rendered
  // „✓ Fertig" — the only way out of the mode — halfway down the page (SHL-17).
  //
  // #136 asserted the anchor through the strip's two buttons on `#/`. This is the other half: the
  // gaps either side of it are illegal *drops*, which is a different code path (`canDrop`) and the
  // one a user reaches with the mouse. Driven on the Übersicht, whose arrangement is a per-season
  // setting and therefore isolated in the copy.
  console.log('\nAW · „Bereiche bearbeiten“: der feste Anker und seine Nachbarlücken');
  const ar = await open(context, '/dashboard');
  await pin(ar, sorted.id, '/dashboard');
  const arSec = (key) => ar.locator(`[data-section="${key}"]`);
  const arStored = () =>
    api(S('/settings')).then((s) => (s.dashboard_layout ?? []).map((e) => `${e.key}:${e.width}`).join(' '));
  /** Every section with its arrange-mode furniture, in one reading. */
  const arShape = () =>
    ar.locator('[data-section]').evaluateAll((els) =>
      els.map((el) => ({
        key: el.getAttribute('data-section') ?? '',
        width: el.getAttribute('data-width') ?? '',
        drag: el.getAttribute('draggable') === 'true',
        strip: el.querySelectorAll(':scope > div [aria-label="Nach oben"]').length,
        // The *own* `opacity-100`, as a whole class token. `DragHandle`'s base list carries
        // `group-hover:opacity-100` for every live handle in the app, so a substring test is true
        // of the hover-only state as well — it says „there is a handle", not „it is pinned
        // visible", and the revert that takes the arranger's override away stays green under it.
        handle: /(^|\s)opacity-100(\s|$)/.test(
          el.querySelector('[title^="Zum Verschieben ziehen"]')?.className ?? '',
        ),
        outline: getComputedStyle(el).outlineColor,
        faded: Number(getComputedStyle(el).opacity) < 0.6,
      })),
    );
  const arKeys = (shape) => shape.map((s) => `${s.key}:${s.width}`).join(' ');
  /**
   * Which section is highlighted, read as the *odd colour out* rather than against a literal:
   * every section in this mode carries a dashed outline and only the drop target's colour differs,
   * and a Tailwind shade serialises as `oklch(…)` that no hardcoded rgb would ever match.
   */
  const arTarget = (shape) => {
    const colours = [...new Set(shape.map((s) => s.outline))];
    if (colours.length === 1) return 'keine';
    const rare = colours.filter((c) => shape.filter((s) => s.outline === c).length === 1);
    // Anything but „all alike" or „all alike but one" is a reading this case cannot interpret, and
    // saying so beats reporting „keine" for two highlighted sections.
    if (colours.length !== 2 || rare.length !== 1) return `${colours.length} Farben`;
    return shape.find((s) => s.outline === rare[0])?.key ?? 'keine';
  };

  const arRest = await until(
    arShape,
    (s) => s.length > 5 && !s.some((x) => x.drag) && !s.some((x) => x.strip),
    8000,
  );
  check(
    'außerhalb von „Bereiche bearbeiten“ ist kein Bereich ziehbar und keine Leiste da',
    arRest.length > 5 && !arRest.some((s) => s.drag) && !arRest.some((s) => s.strip),
    `${arRest.length} Bereiche, ziehbar ${arRest.filter((s) => s.drag).length}, Leisten ${arRest.filter((s) => s.strip).length}`,
  );
  const arEntered = await clickIfThere(ar.getByRole('button', { name: '✎ Bereiche bearbeiten' }));
  const arOn = await until(arShape, (s) => s.every((x) => x.drag && x.strip === 1 && x.handle), 5000);
  check(
    '…im Modus trägt jeder Bereich seine Leiste mit einem dauerhaft sichtbaren ⠿ und ist ziehbar',
    arEntered &&
      arOn.length === arRest.length &&
      arOn.every((s) => s.drag && s.strip === 1 && s.handle),
    `ziehbar ${arOn.filter((s) => s.drag).length}/${arOn.length}, Leisten ${arOn.filter((s) => s.strip === 1).length}, ⠿ ${arOn.filter((s) => s.handle).length}`,
  );

  /** The grid in DOM order with the toolbar in it — the anchor is the cell „✓ Fertig" follows. */
  const arGrid = () =>
    ar.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        (b.textContent ?? '').includes('✓ Fertig'),
      );
      const bar = btn?.closest('div.sm\\:col-span-2');
      return [...(bar?.parentElement?.children ?? [])].map(
        // `btn ?? null` only for `contains`'s signature: no „✓ Fertig" leaves no `bar`, hence no
        // children and no call at all — the empty grid is what the assertion below then reports.
        (el) => el.getAttribute('data-section') ?? (el.contains(btn ?? null) ? 'werkzeuge' : el.tagName),
      );
    });
  const arGrid0 = await arGrid();
  const arAnchor = arGrid0[arGrid0.indexOf('werkzeuge') - 1] ?? NO_MATCH;
  check(
    'die Werkzeugleiste sitzt im Raster selbst, hinter dem ersten Bereich — der ist der Anker',
    arGrid0.indexOf('werkzeuge') === 1 && arAnchor === arOn[0]?.key,
    arGrid0.join(' '),
  );

  // The accepted move first, and with it the reading that says the highlight can be read at all.
  const arBefore = arKeys(arOn);
  // Two of the season sections the demo's `dashboard_layout` opts in, both short enough to be on
  // screen together and both *behind* the anchor, so this move is the legal one.
  const arSource = 'stats';
  const arTargetKey = 'termine';
  await arSec(arTargetKey).evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
  const arGrabA = await grabHandle(ar, arSec(arSource));
  const arCarryA = await dragOver(ar, arSec(arTargetKey));
  const arFlight = await until(
    arShape,
    (s) => arTarget(s) !== 'keine' && s.some((x) => x.faded),
    5000,
  );
  check(
    'mitten im Zug hebt sich der Zielbereich hervor und der gezogene wird blass',
    arGrabA && arCarryA && arTarget(arFlight) === arTargetKey && arFlight.filter((s) => s.faded).map((s) => s.key).join(' ') === arSource,
    `gegriffen ${arGrabA}, Ziel ${arTarget(arFlight)}, blass ${arFlight.filter((s) => s.faded).map((s) => s.key).join(' ') || 'keiner'}`,
  );
  await ar.mouse.up();
  const arWantKeys = moveTo(arOn.map((s) => s.key), arSource, arTargetKey);
  const arAfter = await until(arShape, (s) => s.map((x) => x.key).join(' ') === arWantKeys.join(' '), 8000);
  check(
    'ein Bereich lässt sich auf einen anderen ziehen und steht danach an dessen Platz',
    aMove(arOn.map((s) => s.key), arWantKeys) &&
      arAfter.map((s) => s.key).join(' ') === arWantKeys.join(' '),
    arKeys(arAfter),
  );
  // The write is the whole arrangement — every key with its width, not just the one that moved.
  const arStoredAfter = await until(arStored, (v) => v === arKeys(arAfter), 8000);
  check(
    '…und gespeichert wird die ganze Anordnung, jede Breite eingeschlossen',
    arStoredAfter === arKeys(arAfter) && arStoredAfter !== arBefore,
    `${arStoredAfter} (vorher ${arBefore})`,
  );

  // Now the two illegal gestures. Both start from the top of the page, where the anchor is.
  //
  // The neighbour is the section directly below it — the one whose ▲ #136 found permanently
  // disabled, because the anchor stays put and nothing may pass it. This is that same rule seen
  // from the mouse: the gap in front of the anchor is not a drop target either.
  await ar.evaluate(() => window.scrollTo(0, 0));
  const arNeighbour = arAfter[1]?.key ?? NO_MATCH;
  const arGrabB = await grabHandle(ar, arSec(arNeighbour));
  const arCarryB = await dragOver(ar, arSec(arAnchor));
  await sleep(500);
  const arOverAnchor = await arShape();
  await ar.mouse.up();
  await sleep(800);
  const arAfterB = await arShape();
  check(
    'über dem Anker hebt sich nichts hervor — die Lücke vor ihm ist kein Ziel',
    arGrabB &&
      arTarget(arOverAnchor) === 'keine' &&
      arOverAnchor.filter((s) => s.faded).map((s) => s.key).join(' ') === arNeighbour,
    `gegriffen ${arGrabB}, Ziel ${arTarget(arOverAnchor)}, blass ${arOverAnchor.filter((s) => s.faded).map((s) => s.key).join(' ') || 'keiner'}`,
  );
  const arStoredB = await arStored();
  check(
    '…und losgelassen ändert der Zug nichts',
    arGrabB && arCarryB && arKeys(arAfterB) === arKeys(arAfter) && arStoredB === arStoredAfter,
    `gegriffen ${arGrabB}, getragen ${arCarryB}, ${arKeys(arAfterB)}`,
  );

  await ar.evaluate(() => window.scrollTo(0, 0));
  const arGrabC = await grabHandle(ar, arSec(arAnchor));
  const arCarryC = await dragOver(ar, arSec(arNeighbour));
  await sleep(500);
  const arCarryAnchor = await arShape();
  await ar.mouse.up();
  await sleep(800);
  const arAfterC = await arShape();
  check(
    'der Anker selbst lässt sich greifen, aber nirgends absetzen: er ist blass, und kein Bereich wird zum Ziel',
    arGrabC &&
      arCarryC &&
      arCarryAnchor.filter((s) => s.faded).map((s) => s.key).join(' ') === arAnchor &&
      arTarget(arCarryAnchor) === 'keine' &&
      arKeys(arAfterC) === arKeys(arAfter),
    `gegriffen ${arGrabC}, getragen ${arCarryC}, blass ${arCarryAnchor.filter((s) => s.faded).map((s) => s.key).join(' ') || 'keiner'}, Ziel ${arTarget(arCarryAnchor)}, ${arKeys(arAfterC)}`,
  );
  const arGrid1 = await arGrid();
  check(
    '…weshalb „✓ Fertig“ nach allen drei Zügen noch dort steht, wo es hingehört (SHL-17)',
    arGrid1.indexOf('werkzeuge') === 1 && arGrid1[0] === arAnchor,
    arGrid1.join(' '),
  );
  const arLeft = await clickIfThere(ar.getByRole('button', { name: '✓ Fertig' }));
  const arOff = await until(arShape, (s) => !s.some((x) => x.drag) && !s.some((x) => x.strip), 5000);
  check(
    '„✓ Fertig“ beendet den Modus: die Bereiche sind wieder unbeweglich',
    arLeft && !arOff.some((s) => s.drag) && !arOff.some((s) => s.strip) && arKeys(arOff) === arKeys(arAfter),
    `geklickt ${arLeft}, ziehbar ${arOff.filter((s) => s.drag).length}, Leisten ${arOff.filter((s) => s.strip).length}`,
  );
  await ar.close().catch(() => {});

  // ======================================================================== AX · the appended section
  //
  // The arranger's other half, and the only one that runs on *every* load: the merge that gives a
  // stored layout the keys it has never seen (`SectionArranger.tsx:705-713`). It appends them at
  // the **end**, which is right for a genuinely new section and wrong for one split out of an
  // existing one — WP-48 split the welded `kontakte` into `kontakte` and `links`, and "Dokumente
  // und Links" has been sitting at the bottom of the customer's pages ever since (the WP-70
  // audit's F1; `docs/DECISIONS.md`, "The project page's Kontakte and Links are two sections").
  //
  // WP-78 put both damaged states on the demo and until now they were prose. Three shapes, and the
  // pair in the middle is the point:
  //
  //   * **project 1 / artist 1** carry no layout at all and follow the spec order — the healthy
  //     state, in which „Dokumente“ sits next to „Kontakte“.
  //   * **project 3** — a stored layout that predates the split and has no `links` entry at all,
  //     so the merge appends it on every load and nothing is ever written down.
  //   * **project 10 / artist 5** have `links` *in* the layout, at the end, where an earlier merge
  //     put it and the next touch of the arranger froze it.
  //
  // The last two are nearly indistinguishable on the page, which is exactly why the complaint could
  // not be diagnosed from a screenshot: only the width and the database tell them apart. That is
  // what makes this the net for the day F1 gets a product-side answer — a merge taught to insert
  // `links` beside `kontakte` moves the first shape and leaves the second, and these four readings
  // are what says which pages the customer would see move on the next start.
  //
  // Read-only against the demo's own season: those four rows *are* the fixtures, and a case that
  // arranged them would be rewriting what it is here to read. The one write is the last check, and
  // it happens in the `sorted` copy.
  console.log('\nAX · Was ein gespeichertes Layout nicht kennt');

  /** Every `[data-section]` cell with the width the arranger gave it — case AP's reading. */
  const axShape = (page) =>
    page
      .locator('[data-section]')
      .evaluateAll((els) =>
        els.map((el) => `${el.getAttribute('data-section')}:${el.getAttribute('data-width')}`),
      );
  /**
   * The same list as the *database* holds it. `layout` is JSON text and NULL is the sentinel for
   * "never arranged, follow the template" — so a page with no layout of its own answers `null`
   * here and the reading stays a reading rather than becoming an empty array that looks like one.
   * Tombstones are spelled out, because the last check below is about entries a write puts down
   * that nobody touched.
   */
  const axStored = async (path) => {
    const row = await api(path);
    if (typeof row?.layout !== 'string') return null;
    return JSON.parse(row.layout).map(
      (e) => `${e.key}:${e.width}${e.hidden ? '·versteckt' : ''}`,
    );
  };
  /**
   * One page of the demo's own season, read once it is laid out and closed again.
   *
   * `n` is what the fixture's layout comes to, and waiting for it is not decoration: the arranger
   * renders its whole grid in one pass, so the list is 0 and then complete — a one-shot read on a
   * loaded runner is an empty array, which would satisfy "`links` is not in the middle" perfectly.
   */
  const axRead = async (path, n) => {
    const page = await open(context, path);
    await pin(page, HOME, path);
    const shape = await until(() => axShape(page), (s) => s.length >= n, 8000);
    await page.close().catch(() => {});
    return shape;
  };

  const axP1 = await axRead('/project/1', 5);
  const axP3 = await axRead('/project/3', 4);
  const axP10 = await axRead('/project/10', 16);
  const axP3Db = await axStored('/projects/3');
  const axP10Db = await axStored('/projects/10');

  check(
    'ohne eigenes Layout stehen „Kontakte“ und „Dokumente“ nebeneinander, beide halbbreit — die Form, die WP-48 gemeint hat',
    axP1.join(' ').includes('kontakte:half links:half'),
    axP1.join(' ') || 'keine Bereiche',
  );
  check(
    'ein gespeichertes Layout ohne „Dokumente“ bekommt den Bereich bei jedem Laden hinten angehängt — und nichts davon wird geschrieben',
    axP3.join(' ') === 'aufgaben:full termine:half kontakte:half links:half' &&
      axP3Db !== null &&
      axP3Db.join(' ') === 'aufgaben:full termine:half kontakte:half',
    `Seite ${axP3.join(' ')} | Datenbank ${axP3Db === null ? 'kein eigenes Layout' : axP3Db.join(' ')}`,
  );
  check(
    '…steht „Dokumente“ dagegen im Layout, sieht die Seite fast genauso aus: derselbe letzte Platz, und nur die Breite und die Datenbank unterscheiden die beiden Zustände',
    axP3.at(-1) === 'links:half' &&
      axP10.at(-1) === 'links:full' &&
      axP10Db !== null &&
      axP10Db.length === 16 &&
      axP10Db.at(-1) === 'links:full',
    `Projekt 3 …${axP3.slice(-2).join(' ')} | Projekt 10 …${axP10.slice(-2).join(' ')} | Datenbank ${axP10Db?.length ?? 0} Einträge, zuletzt ${axP10Db?.at(-1) ?? '—'}`,
  );

  // The artist page is where five of the customer's six unrepaired pages are, and the contrast is
  // sharper there: nothing on it defaults to half width, so the healthy state is not "side by
  // side" but "directly after Kontakte" — and the damaged one puts „Dokumente“ behind the task
  // table, which is the bottom of a long page.
  const axA1 = await axRead('/artist/1', 7);
  const axA5 = await axRead('/artist/5', 7);
  check(
    'auf der Künstlerseite dasselbe Paar: ohne Layout folgt „Dokumente“ den Kontakten, mit gespeichertem Layout steht es hinter allem, der Aufgabentabelle eingeschlossen',
    axA1.join(' ').includes('kontakte:full links:full') &&
      axA1.indexOf('links:full') < axA1.indexOf('aufgaben:full') &&
      axA5.at(-1) === 'links:full' &&
      // `includes` first: `indexOf` answers -1 for a section that is not on the page at all, and
      // -1 is below every index — so „behind the task table" would stay true of a build that had
      // stopped rendering the task table. The `axA1` arm above needs no such guard: it compares
      // two indices, and a missing one takes that comparison red on its own.
      axA5.includes('aufgaben:full') &&
      axA5.indexOf('aufgaben:full') < axA5.length - 1,
    `Künstler 1: ${axA1.join(' ')} | Künstler 5: ${axA5.join(' ')}`,
  );

  // And the gesture that turns the first shape into the second, which is the whole mechanism in one
  // click. `move()` persists `full` — the *merged* array — so one ▲ on „Kontakte“ writes down
  // „Dokumente“ at the end and the two hidden Einblicke with it, although the user touched
  // none of the three. In the `sorted` copy, because it writes; `copySeasonData` carries `layout`
  // and preserves ids, so project 3 is the same shape there as it is on the demo.
  const axF = await open(context, '/project/3');
  await pin(axF, sorted.id, '/project/3');
  const axFBefore = await axStored(S('/projects/3'));
  const axFOn = await clickIfThere(axF.getByRole('button', { name: '✎ Bereiche bearbeiten' }));
  const axFUp = await clickIfThere(
    axF.locator('[data-section="kontakte"] [aria-label="Nach oben"]').first(),
  );
  const axFAfter = await until(
    () => axStored(S('/projects/3')),
    (v) => (v?.length ?? 0) > 3,
    8000,
  );
  check(
    'eine einzige Bewegung schreibt die ganze zusammengeführte Liste fest — „Dokumente“ hinten und die zwei ausgeblendeten Einblicke dazu, obwohl keiner der drei angefasst wurde',
    axFOn &&
      axFUp &&
      axFBefore !== null &&
      axFBefore.join(' ') === 'aufgaben:full termine:half kontakte:half' &&
      axFAfter !== null &&
      axFAfter.join(' ') ===
        'aufgaben:full kontakte:half termine:half links:half stats:full·versteckt aufmerksamkeit:full·versteckt',
    `Modus ${axFOn}, ▲ ${axFUp} | vorher ${axFBefore?.join(' ') ?? 'kein eigenes Layout'} | nachher ${axFAfter?.join(' ') ?? 'kein eigenes Layout'}`,
  );
  await axF.close().catch(() => {});
}
