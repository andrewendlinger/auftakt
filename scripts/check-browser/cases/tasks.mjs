/** F–H · the three core paths: a task, a column, the editor */

import { sleep } from '../../lib/wait.mjs';
import { gone, open, ready, topDialog } from '../browser.mjs';
import { RUN, UI } from '../config.mjs';
import { check } from '../report.mjs';
import { api } from '../stack.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runTasks(fixtures) {
  const { context } = fixtures;
  // ======================================================================== F · a task
  console.log('\nF · Aufgabe anlegen und erledigen');
  const d = await open(context, '/project/2');
  const title = `Aufgabe ${RUN}`;
  // `input[placeholder*="Aufgabe"]` matches the global search box first, and it comes earlier in
  // the DOM — so `.first()` types into the header and the table never changes.
  await d.locator('input[placeholder^="Neue Aufgabe"]').fill(title);
  await d.locator('input[placeholder^="Neue Aufgabe"]').press('Enter');
  await d.locator('td', { hasText: title }).first().waitFor({ timeout: 8000 });

  const tasksAfter = await api('/tasks?project_id=2');
  const created = tasksAfter.find((t) => t.title === title);
  check('the task exists server-side', !!created, created ? `#${created.id}` : 'nicht gefunden');
  // A new row is stamped one below its list's minimum so it lands on top. Assert the relative
  // order, never a literal ordinal.
  check(
    'and it sorts to the top of its list',
    !!created && Math.min(...tasksAfter.map((t) => t.sort_order)) === created.sort_order,
  );

  // „Erledigt" is not a literal anywhere: the done value is whichever Status option carries the
  // `done` flag, which is what greys the row out, sinks it and eventually archives it.
  const columns = await api('/custom-columns');
  const status = columns.find((c) => c.kind === 'builtin' && c.key === 'status');
  const doneValue = JSON.parse(status?.options ?? '[]').find((o) => o.done)?.value ?? 'done';
  const row = d.locator(`[data-task-id="${created.id}"]`);
  // Two `listbox` triggers per row (Status and Bereich); the first is Status.
  const statusCell = row.locator('button[aria-haspopup="listbox"]').first();
  await statusCell.scrollIntoViewIfNeeded(); // useAnchoredPopover closes on an outside scroll
  await statusCell.click();
  const doneOption = d.locator(`[role="option"][data-value="${doneValue}"]`).first();
  await doneOption.waitFor({ timeout: 5000 });
  await doneOption.click();

  // A status change re-sorts the table, so `.first()` addresses a different row afterwards:
  // assert the write, not the label.
  await sleep(600);
  const reread = (await api('/tasks?project_id=2')).find((t) => t.id === created.id);
  check('the task is done server-side', reread?.status === doneValue, String(reread?.status));

  // ======================================================================== G · a column
  console.log('\nG · Spalte ein- und ausblenden');
  await d.goto(`${UI}/#/artist/1`);
  await d.reload(); // `goto` to a different hash keeps data-app-ready — it says nothing about the route
  await ready(d);

  const before = (await api('/artists/1')).task_columns;
  const headers = () =>
    d.locator('table thead th').allInnerTexts().then((t) => t.join('|').toLowerCase());
  check('the season default is in force on this page', before === null, String(before));
  check('…and Fällig is on screen', (await headers()).includes('fällig'));

  await d.getByRole('button', { name: /Spalten/ }).first().click();
  // Scoped to the topmost dialog for the reason `topDialog` gives — and this page in particular
  // has tasks on it, so page-wide button selectors are ambiguous here.
  const dialog = topDialog(d);
  // Two `[data-column-row]` lists live in this dialog since WP-59: „Globale Spalten" first, then
  // this page's own scope. The attribute carries no id, so address the row by its name — and not
  // the first row either, which is the locked Status column and has no toggle at all.
  const faellig = dialog.locator('[data-column-row]').filter({ hasText: 'Fällig' }).first();
  await faellig.locator('button[title="Ausblenden"]').click();
  await sleep(800);
  const after = JSON.parse((await api('/artists/1')).task_columns ?? 'null');
  check('hiding a global column here writes the page, not the column', after?.due === false, JSON.stringify(after));
  check('…and the header is gone', !(await headers()).includes('fällig'));
  check(
    'the column itself stays enabled for everyone else',
    (await api('/custom-columns')).find((c) => c.key === 'due')?.enabled === 1,
  );

  await faellig.locator('button[title="Einblenden"]').click();
  await sleep(800);
  check(
    'showing it again drops the override rather than storing a true',
    (await api('/artists/1')).task_columns === before,
    String((await api('/artists/1')).task_columns),
  );
  await d.keyboard.press('Escape');

  // ======================================================================== H · the editor
  console.log('\nH · Der Editor speichert');
  await d.goto(`${UI}/#/project/2`);
  await d.reload();
  await ready(d);

  const note = d.locator('.prose-md').first();
  await note.waitFor({ timeout: 8000 });
  // Click a text run, never the box: its centre may be a link or an image. And opening and
  // closing stores nothing — `commit` returns early when the draft equals the prop — so the
  // case needs a real keystroke.
  await note.locator('p').first().click();
  await d.locator('.rte-content.ProseMirror-focused').waitFor({ timeout: 8000 });
  const suffix = ` Nachtrag ${RUN}.`;
  await d.keyboard.press('End');
  await d.keyboard.type(suffix);
  // ⌘↵ / Ctrl+↵ is the editor's own save: it blurs itself, and blur is what commits (WP-49).
  // Clicking some neutral spot instead would make the case depend on what that spot is.
  await d.keyboard.press('ControlOrMeta+Enter');
  // The commit is asynchronous, and the wait has to be on the **editor going away** — the
  // editable node's own class list carries `prose-md`, so waiting for that is satisfied by the
  // surface already on screen and the read below races a PATCH that has not been sent yet.
  // `InlineNotes` leaves edit mode only once the write resolved (RTE-01), which is what makes
  // `.rte-root` detaching the honest signal here. The comment half below cannot use it:
  // `CommentCell` unmounts first and commits afterwards.
  await gone(d.locator('.rte-root'), 10_000);
  check(
    'a typed note is persisted on blur',
    String((await api('/projects/2')).description ?? '').includes(suffix.trim()),
  );

  // …and once more through the door React's delegated onBlur cannot see: an editor whose node is
  // already detached never receives that event, so the task table's Kommentar rides an unmount
  // effect instead (TTU-38). Navigating away mid-edit is how a user reaches it. `InlineNotes`
  // above deliberately has no such effect — its draft is meant to survive a *failed save*, not a
  // navigation — so this case belongs on the cell that does.
  const comment = `Kommentar ${RUN}`;
  const commentRow = d.locator(`[data-task-id="${created.id}"]`);
  await commentRow.scrollIntoViewIfNeeded();
  await commentRow.locator('button', { hasText: '+ Kommentar' }).first().click();
  await d.locator('.rte-content.ProseMirror-focused').waitFor({ timeout: 8000 });
  await d.keyboard.type(comment);
  await d.goto(`${UI}/#/dashboard`); // a hash navigation unmounts the editor without a reload
  await ready(d);
  await sleep(800);
  check(
    'a comment left by navigating away still commits',
    String((await api(`/tasks/${created.id}`)).comment ?? '').includes(comment),
  );
}
