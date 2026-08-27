/**
 * Regression guard for the paths that only exist once a browser has laid the page out — the
 * class of defect `npm run typecheck`, `check:unit` and the three API gates all structurally
 * cannot see. It boots the real stack against the demo dataset and drives it with Chromium.
 *
 *   npm run check:browser
 *
 * It is deliberately **not** part of `npm run check`: that must stay runnable on any machine at
 * any moment, and this needs a browser binary plus a free :5317. CI runs it as its own `browser`
 * job on every pull request, the way `check:package` runs in the build job.
 *
 * Two halves, both lifted from work that was previously verified from a throwaway scratchpad:
 * the two-window season matrix (a window is a *page in one context* — BroadcastChannel is
 * partitioned per context, season pins live in per-page sessionStorage), and the core paths the
 * manual Windows hour walks anyway (create and complete a task, show and hide a column, save the
 * editor). WP-64a added the record delete with its Papierkorb and undo, and reordering by the ⠿
 * (I–K); WP-64b the two pure render assurances that had no automated check at all (L–N2) — the
 * smallest window the app allows, and the print sheets, which are asserted against the bytes of
 * `page.pdf()` because their defects exist only on paper.
 *
 * **The proof that this gate bites**: revert `client/src/main.tsx`'s focus listener to
 * `handleFocus(true)` (the #54 latch) and case A must fail. That case asserts the *second* focus
 * refetches, because the defect's failure mode is silence — a check that watches the first focus
 * passes against the bug.
 *
 * Every wait and selector in `check-browser/` is a trap out of `docs/VERIFYING.md`; each produced
 * a wrong verification result at least once. That file stays the specification — a new trap is
 * written down there first and encoded here second.
 *
 * Two things it does to the working tree, both by design: it **rebuilds `.demo`** (so whatever
 * you were looking at is gone), and it refuses to start while :5317 or :4325 are taken, since a
 * running `npm run demo` would otherwise have its database replaced underneath it.
 *
 * **Where things are.** This file is the runner and nothing else: the port refusal, the stack, the
 * fixture seasons every area works in, the ordered list of areas, the summary and the teardown.
 * Everything it drives lives beside it, and the order below is the order of the run.
 *
 *   check-browser/config.mjs     the ports, the run tag, the three waits that are decisions
 *   check-browser/report.mjs     one `check()` for all fifteen files, so one total comes out
 *   check-browser/stack.mjs      the demo stack and the JSON round trip to it
 *   check-browser/browser.mjs    Chromium, its windows, and every locator helper
 *   check-browser/bridge.mjs     the preload bridge, stubbed to record instead of act
 *   check-browser/probes.mjs     what a case asks the page about itself
 *   check-browser/pdf.mjs        reading a `page.pdf()` back
 *   check-browser/fixtures.mjs   the type of what crosses a scenario file's boundary
 *   check-browser/cases/*.mjs    the assertions — fifteen files, one per surface, covering areas A–AX
 *
 * The split is a pure move (2026-08-24): no assertion was added, removed, reworded or reordered,
 * and every scenario body is byte-identical to its slice of the file this replaced.
 */
import { requireFreePorts } from './lib/ports.mjs';
import { FIXTURE, PORT, RUN } from './check-browser/config.mjs';
import { check, count, pin } from './check-browser/report.mjs';
import { api, assertDemo, scoped, send, shutdown, stackLog, startStack, waitForStack } from './check-browser/stack.mjs';
import { launch, reloadedSurfaces, reopenedPopovers } from './check-browser/browser.mjs';
import { runSeasons } from './check-browser/cases/seasons.mjs';
import { runTasks } from './check-browser/cases/tasks.mjs';
import { runRecords } from './check-browser/cases/records.mjs';
import { runRender } from './check-browser/cases/render.mjs';
import { runSettings } from './check-browser/cases/settings.mjs';
import { runKeyboard } from './check-browser/cases/keyboard.mjs';
import { runElectron } from './check-browser/cases/electron.mjs';
import { runAnnouncements } from './check-browser/cases/announcements.mjs';
import { runSubtasks } from './check-browser/cases/subtasks.mjs';
import { runToolbox } from './check-browser/cases/toolbox.mjs';
import { runImages } from './check-browser/cases/images.mjs';
import { runArchive } from './check-browser/cases/archive.mjs';
import { runColumns } from './check-browser/cases/columns.mjs';
import { runLanding } from './check-browser/cases/landing.mjs';
import { runReorder } from './check-browser/cases/reorder.mjs';

/**
 * Every assertion a green run makes, exactly. The total is quoted in prose (`check-boot.mjs`'s
 * header, CLAUDE.md, decision records), and prose cannot be typechecked — so the run pins it.
 * Adding or removing a case moves this number too, deliberately.
 */
const EXPECTED_CHECKS = 657;

// ---------------------------------------------------------------------------- the run

/*
 * Refuse to run while anything holds either port — **before the stack is spawned**, because
 * spawning it is already the destructive act: `demo.mjs`'s first move is `demo:seed`, which
 * `rmSync`s `.demo`. A guard that runs afterwards only races the rebuild it exists to prevent.
 *
 * Not politeness: this rebuilds `.demo` from nothing, so starting beside a running `npm run demo`
 * would leave that session's server answering from a deleted inode — the trap `docs/VERIFYING.md`
 * records as costing a full verification run. And the second stack would not even be the one under
 * test: Vite's port is `strictPort`, so it exits rather than sliding to 5318 where every write
 * would 403 on the origin check.
 *
 * Both address families, because that is where the trap is: Vite binds `[::1]` and only that, so
 * an IPv4-only probe reports :5317 free while a dev server is running on it (see `lib/ports.mjs`).
 */
await requireFreePorts(
  [PORT, 5317],
  (port, host) =>
    `FAIL  Port ${port} ist belegt (${host}) — vermutlich ein laufendes \`npm run demo\` oder\n` +
    `      ein übrig gebliebener Server. Dieser Lauf würde dessen Datenbank neu aufbauen.\n` +
    `      Beenden mit:  lsof -ti tcp:4325 -ti tcp:5317 | xargs kill\n` +
    `      (das -i muss wiederholt werden — macOS' lsof liest das zweite tcp: sonst als Datei)`,
);
startStack();
await waitForStack();
const registry = await assertDemo();
const HOME = registry.activeId; // the demo's own default season; every case returns to it

console.log(`\ndemo auf :${PORT}, Saison ${HOME} — ${registry.seasons.length} Saisons\n`);

/** @type {import('playwright-core').Browser | null} */
let browser = null;

/**
 * Every request a case has parked, so `finally` can let them go before the browser closes.
 *
 * A handler awaiting a gate that is never resolved outlives the assertion that was supposed to
 * release it — and an assertion between the hold and the release throwing is exactly the state
 * where nobody does. Resolving a settled promise is a no-op, so this is safe to run over holds
 * that were released normally.
 * @type {Array<{ release: (v?: unknown) => void }>}
 */
const heldRoutes = [];

async function makeSeason(what, copy = false) {
  const body = { label: `${FIXTURE} ${RUN} ${what}` };
  if (copy) {
    Object.assign(body, {
      copyFrom: HOME,
      includeArtists: true,
      includeContacts: true,
      includeEvents: true,
      includeProjects: true,
      includeTasks: true,
      includeColumns: true,
      includeSettings: true,
    });
  }
  const { status, body: season } = await send('POST', '/seasons', body);
  if (status !== 201) throw new Error(`Saison „${what}“ nicht angelegt: ${JSON.stringify(season)}`);
  return season;
}

/**
 * How many tasks the first status group starts with, and the lengths case N2 tries around it.
 *
 * The offsets are symmetric, and that is the point: the boundary can drift in **either**
 * direction — a Chromium that changes a metric, or one line more or less of sheet chrome — and a
 * search that only ever grows the list would report „keine Wirkung" on a perfectly good build,
 * reading exactly like the regression it guards. Nearest first, so the normal run stops at 0.
 */
const PAGE_BREAK_FIRST = 56;
const PAGE_BREAK_TRIES = [0, 1, -1, 2, -2, 3, -3];

/**
 * The project sheet's page-break fixture: one project whose open tasks fall into two status
 * groups, the first sized so the second group's header lands on a page boundary.
 *
 * Built over the API into a fresh season rather than into `server/src/demo.ts`, for two reasons.
 * Sixty-odd rows named „Aufgabe 07" are not a fixture anybody wants to scroll past on every
 * `npm run demo`, and — more to the point — the sheet's geometry has to be *predictable* for the
 * boundary to sit where it does: no description, no contacts, no events, nothing that wraps. Every
 * line height on this sheet is an explicit Tailwind value, so the page a row lands on is the same
 * on a runner with different fonts, which is what lets a tuned count survive CI at all.
 *
 * The project deliberately carries **no status**: `ProjectStatusPill` would then paint the header
 * in the same shade as the „In Progress" group heading, and the case finds that heading in the PDF
 * by its colour.
 */
async function fillPageBreakFixture(seasonId) {
  const q = scoped(seasonId);
  // Never the literals: the group headings, their colours and the values a task must carry are
  // all the Status column's options, which the user may rename or reorder.
  const columns = await api(q('/custom-columns'));
  const status = columns.find((c) => c.kind === 'builtin' && c.key === 'status');
  const open = JSON.parse(status?.options ?? '[]').filter((o) => !o.done);
  if (open.length < 2) throw new Error(`Statusspalte hat keine zwei offenen Optionen: ${status?.options}`);

  const artist = (await send('POST', q('/artists'), { name: 'Druckbogen', color: '#0b5fe9' })).body;
  const project = (
    await send('POST', q('/projects'), { artist_id: artist.id, code: 'DB1', name: 'Seitenumbruch' })
  ).body;
  const add = (title, value) => send('POST', q('/tasks'), { project_id: project.id, title, status: value });
  /** @type {number[]} */
  const firstGroup = [];
  for (let i = 0; i < PAGE_BREAK_FIRST; i++) {
    firstGroup.push((await add(`Aufgabe ${String(i + 1).padStart(2, '0')}`, open[0].value)).body.id);
  }
  // The second group is the one under test, and it is small: a header stranded above six rows is
  // the shape the customer met, and a long group would be split by the page break anyway.
  for (let i = 0; i < 6; i++) await add(`Nachlauf ${i + 1}`, open[1].value);

  /**
   * Take the first group to exactly `n` rows, in whichever direction that is. Shrinking is a soft
   * delete, which is what the sheet's own query filters on, so it is the same fixture either way.
   */
  const resize = async (n) => {
    while (firstGroup.length > n) {
      await send('DELETE', q(`/tasks/${firstGroup.pop()}`));
    }
    while (firstGroup.length < n) {
      firstGroup.push((await add(`Aufgabe ${String(firstGroup.length + 1).padStart(2, '0')}`, open[0].value)).body.id);
    }
    return firstGroup.length;
  };
  return { seasonId, project, resize };
}

try {
  const { browser: chrome, context } = await launch();
  browser = chrome;

  const data = await makeSeason('Daten', true);
  // Copied **here**, before any case has written anything, though they are not used until I and
  // J. The delete case asserts on the dependent counts docs/VERIFYING.md pins („3 Aufgaben" for
  // project 2, „14 Aufgaben" for artist 3), and case F creates a task on project 2 of the demo's
  // own season while case H edits that project's description — a copy taken afterwards inherits
  // both and reads „4 Aufgaben", which is the fixture drifting, not a defect.
  const trash = await makeSeason('Löschen', true);
  const sorted = await makeSeason('Reihenfolge', true);
  // Case N prints demo rows and needs one of them changed (project 1 loses its status pill, see
  // there), so it gets a copy like the cases above — taken here, before anything has written.
  const sheets = await makeSeason('Bögen', true);
  // Case N2's page-break fixture is the one season that is **not** a copy: its whole point is a
  // task list of a tuned length, and a copy would bring the demo's along. Built here with the
  // others all the same, so a season this run created is never a season an earlier case wrote to.
  const printed = await makeSeason('Druck');
  // Cases O–R2 *rewrite* settings — the sort hierarchy, the option lists, the two windows — so they
  // work in a copy of their own rather than in the demo every other case reads. Taken here with the
  // rest: the assertions below start from the seeded values („eine Regel: Status", four event
  // types), and a copy taken later would carry whatever an earlier case had left behind.
  const config = await makeSeason('Einstellungen', true);
  // Cases X–Z create, complete and delete inside the demo's own subtask tree, so they need a copy
  // like the cases above — taken here, before anything has written, because the counts they assert
  // („1/3" live children, „4 Unteraufgaben" including the archived one) are fixture facts of the
  // demo as seeded. Case W needs no copy: folding a group writes nothing at all.
  const subtree = await makeSeason('Unteraufgaben', true);
  // Cases AA–AC type into two notes and save them — project 2's description and task 30's
  // comment, the two the demo plants for exactly this (`docs/VERIFYING.md`, „a short, plain note
  // to colour and un-colour"). A copy for the same reason as the others, and taken here: case H
  // edits that very description in the demo's own season, so a copy made later would start from
  // its „Nachtrag" and the assertions below would be reading an earlier case's fixture.
  const toolbox = await makeSeason('Werkzeugleiste', true);
  // Cases AD–AG put a picture into project 2's description, paste two more beside it, save artist
  // 1's note and bin a project — so, like the copies above, a season of their own, taken before
  // anything has written. It has to be a *different* one from `toolbox`: AA–AC grow their runs in
  // the same short note, and a picture in it would move every offset they count.
  const pictures = await makeSeason('Bilder', true);
  // Cases AJ–AK build three tasks around the archive cutoff, and this season is deliberately **not**
  // a copy: the boundary is only legible when the whole task list is those three rows, and a copy
  // would bring the demo's five archived ones along. Created here with the rest all the same.
  const agedSeason = await makeSeason('Grenze');
  // Cases AL–AO build four project-scoped columns of their own on project 2, write values into
  // them and then hide three of the demo's global ones on that page — so a copy of their own,
  // taken here before anything has written, like every other one. Project 2 is the page that makes
  // the polls below honest: three open tasks, no subtasks, and `custom_values` empty on all three,
  // so nothing a case waits for can be satisfied by a value the demo already planted.
  const columnsSeason = await makeSeason('Typen', true);
  // Cases AP and AS work on `#/`, whose *content* is cross-season and therefore cannot be copied
  // into a fixture at all — Notizen, Dokumente and Bereiche live in `seasons.json`, one blob for
  // the whole app. What a season of its own does buy is the two things on that page that are per
  // season: a card to edit (AP writes its Zeitraum and takes it back) and a `labels` array to
  // rename two headings in (AS), neither of which then disturbs the demo's own three cards. Not a
  // copy, deliberately: an empty season is the „0 Künstler · 0 Projekte · Noch keine Termine" card,
  // which is the state AP's fallback assertions need.
  const landingSeason = await makeSeason('Startseite');
  const pageBreak = await fillPageBreakFixture(printed.id);

  /**
   * Everything that crosses a scenario file's boundary, in one object.
   *
   * The fifteen files below run in this order and only ever hand *forwards*: the fixture seasons
   * and the two browser handles this prologue built, plus the handful of helpers one area builds
   * and a later one reuses (see `Object.assign` at the foot of `records`, `subtasks`, `toolbox`
   * and `archive`). Nothing here is read before the area that writes it has run, which is what
   * lets the order stay exactly the order the single file had.
   */
  const fixtures = {
    registry,
    browser,
    chrome,
    context,
    HOME,
    heldRoutes,
    makeSeason,
    PAGE_BREAK_FIRST,
    PAGE_BREAK_TRIES,
    data,
    trash,
    sorted,
    sheets,
    printed,
    config,
    subtree,
    toolbox,
    pictures,
    agedSeason,
    columnsSeason,
    landingSeason,
    pageBreak,
  };

  // The run, in order — and the order is load-bearing, not alphabetical. It is the order the
  // single file this replaced had, A through AW: `records` builds the scope `reorder` works in,
  // `toolbox` the note helpers `images` reuses, `archive` the row reader `columns` reuses, and
  // several areas read a page an earlier one wrote. Moving a line here is changing the gate.
  await runSeasons(fixtures);
  await runTasks(fixtures);
  await runRecords(fixtures);
  await runRender(fixtures);
  await runSettings(fixtures);
  await runKeyboard(fixtures);
  await runElectron(fixtures);
  await runAnnouncements(fixtures);
  await runSubtasks(fixtures);
  await runToolbox(fixtures);
  await runImages(fixtures);
  await runArchive(fixtures);
  await runColumns(fixtures);
  await runLanding(fixtures);
  await runReorder(fixtures);

  // Only on a green run: a failed `check()` may have short-circuited a case's remaining
  // assertions, and that run is red already — the pin guards the green ones.
  if (count.failures === 0) pin(EXPECTED_CHECKS);

  console.log(
    `\n${count.failures ? `✗ ${count.failures} Fehler` : '✓ alles ok'} (${count.checks} Prüfungen)` +
      (reloadedSurfaces
        ? ` — ${reloadedSurfaces}× neu geladen, weil ein Editor nicht zuging (siehe ⚠ oben)`
        : '') +
      (reopenedPopovers
        ? ` — ${reopenedPopovers}× ein Pillenmenü erneut geöffnet, weil ein Scroll es zuschlug (siehe ⚠ oben)`
        : ''),
  );
} catch (err) {
  check('run completed', false, err instanceof Error ? err.message : String(err));
  if (stackLog.read()) console.error(`\n--- Stack-Ausgabe (Ende) ---\n${stackLog.read().slice(-2000)}`);
} finally {
  for (const held of heldRoutes) held.release();
  if (browser) await browser.close();
  // Sweep every fixture season, including leftovers of a killed earlier run.
  const reg = await api('/seasons').catch(() => ({ seasons: [] }));
  for (const s of reg.seasons ?? []) {
    if (s.label?.startsWith(FIXTURE) && s.id !== reg.activeId) {
      await send('DELETE', `/seasons/${s.id}`).catch(() => {});
    }
  }
}

await shutdown(count.failures === 0 ? 0 : 1);