/** O–R2 · the four Einstellungen tabs and what they write */

import { cardWith, gone, open, pin, ready, shown, toast, topDialog, until } from '../browser.mjs';
import { RUN, UI } from '../config.mjs';
import { tabStop } from '../probes.mjs';
import { check } from '../report.mjs';
import { api, scoped } from '../stack.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runSettings(fixtures) {
  const { HOME, config, context, makeSeason, registry } = fixtures;
  // ======================================================================== O · the four tabs
  //
  // Einstellungen is four *routes*, each behind a `NavLink`, and not four buttons — so
  // `getByRole('button', { name: 'Kategorien' })` waits out its timeout against a page that is
  // working perfectly (docs/VERIFYING.md). The slugs are the half that survives: WP-54 renamed all
  // four labels and moved two cards between the tabs, and every script keyed on a slug came
  // through that untouched while every script keyed on a label did not.
  //
  // Each tab is then asserted by a card only that tab renders. „The link marks itself current" on
  // its own is satisfied by a router that changed the URL and rendered nothing into the `<Outlet>`.
  console.log('\nO · Die vier Reiter der Einstellungen');
  const C = scoped(config.id);
  const tabLink = (page, slug) => page.locator(`a[href="#/einstellungen/${slug}"]`);

  const s = await open(context, '/dashboard');
  await pin(s, config.id, '/einstellungen/kategorien');
  // The redirect is asserted as a navigation, not as „the URL is this after a reload": `#/einstellungen`
  // has no page of its own, it is an index route that sends the window on to the first tab.
  await s.goto(`${UI}/#/einstellungen`);
  const landed = await s
    .waitForURL(/#\/einstellungen\/aufgaben$/, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  check('#/einstellungen leitet auf „Aufgaben & Übersicht“ weiter', landed, await s.evaluate(() => location.hash));

  const tabs = s.locator('a[href^="#/einstellungen/"]');
  check(
    'die vier Reiter sind Links',
    (await shown(tabs)) && (await tabs.count()) === 4,
    `${await tabs.count()} Links`,
  );
  check(
    '…und keine Buttons — genau daran wartet sich ein `getByRole("button")` tot',
    (await s.getByRole('button', { name: 'Programm & Hilfe' }).count()) === 0,
  );

  for (const tab of [
    { slug: 'aufgaben', card: 'Automatische Aufgaben-Sortierung' },
    { slug: 'kategorien', card: 'Dokument-Kategorien' },
    { slug: 'daten', card: 'Datenbank & Backups' },
    { slug: 'hilfe', card: 'Feedback & Diagnose' },
  ]) {
    await tabLink(s, tab.slug).click();
    await s.waitForURL(new RegExp(`#/einstellungen/${tab.slug}$`), { timeout: 10_000 });
    // `aria-current` is set on render, which is a commit later than the URL change.
    const current = await until(() => tabLink(s, tab.slug).getAttribute('aria-current'), (v) => v === 'page', 5000);
    check(`„${tab.slug}“ markiert sich als aktiver Reiter`, current === 'page', String(current));
    check(`…und rendert „${tab.card}“`, await shown(cardWith(s, tab.card)));
  }
  // „Programm & Hilfe" is the one tab whose contents depend on there being an Electron bridge, and
  // this window has none: `UpdateCard` sits behind `hasElectron` while the feedback card
  // deliberately does not (a `mailto:` needs no bridge, and a card that vanished in browser mode
  // would be a card no driving script could ever see). Case U asserts the other half against the
  // stub — the pair is the assertion, „the card is there" alone says nothing about the branch.
  check(
    'ohne Bridge fehlt die Update-Karte auf diesem Reiter',
    (await cardWith(s, 'Version & Updates').count()) === 0,
  );

  // ======================================================================== P · the editors write
  //
  // Three editors share „Aufgaben & Übersicht" and all three write through the same guarded PATCH,
  // so the assertion that means anything for each of them is the **stored** value: an editor that
  // renders its change and never sends it looks identical on screen, which is exactly the state
  // PGS-09 left the user in.
  //
  // `TaskSortEditor` has no „Speichern" — it writes on every interaction — so each step is polled
  // for rather than slept on. The two „Zeitfenster" fields are asserted as a *pair*: they have sat
  // on one tab since WP-54, they look alike, and each has to write its own key. „Both cards save"
  // is also true of a page that writes one key twice.
  console.log('\nP · Die Editoren auf „Aufgaben & Übersicht“ schreiben wirklich');
  await tabLink(s, 'aufgaben').click();
  await s.waitForURL(/#\/einstellungen\/aufgaben$/, { timeout: 10_000 });

  const sortCard = cardWith(s, 'Automatische Aufgaben-Sortierung');
  const rules = () => api(C('/settings')).then((v) => v.task_sort ?? []);
  const ruleText = (v) => v.map((r) => `${r.id}:${r.dir}`).join(' | ');
  // The option list arrives with the columns query; „Fällig" is not selectable before it does.
  const options = await until(() => sortCard.locator('select option').count(), (c) => c > 1);
  check('die Spaltenauswahl ist gefüllt', options > 1, `${options} Optionen`);
  const rulesBefore = await rules();
  check('die Saison startet mit genau einer Regel', ruleText(rulesBefore) === 'status:asc', ruleText(rulesBefore));

  await sortCard.locator('select').selectOption('due');
  await sortCard.getByRole('button', { name: '+ Hinzufügen' }).click();
  const added = await until(rules, (v) => v.length === 2);
  check('eine hinzugefügte Regel steht in den Einstellungen', ruleText(added) === 'status:asc | due:asc', ruleText(added));

  const secondRule = sortCard.locator('[data-rule-row]').nth(1);
  await secondRule.getByRole('button', { name: 'Absteigend' }).click();
  const turned = await until(rules, (v) => v[1]?.dir === 'desc');
  check('…die Richtung wird mitgeschrieben', ruleText(turned) === 'status:asc | due:desc', ruleText(turned));

  await secondRule.locator('[data-arrow="up"]').click();
  const reordered = await until(rules, (v) => v[0]?.id === 'due');
  check('…und ▲ schreibt die neue Reihenfolge', ruleText(reordered) === 'due:desc | status:asc', ruleText(reordered));
  // RTE-14: the focus goes with the rule, or the second ↑ undoes the first — focus would sit on
  // the position the rule left, which now holds the rule it swapped with. The restore runs off the
  // *server* array, so it lands a render after the write; polled for that reason (docs/VERIFYING.md).
  const carried = await until(
    () =>
      s.evaluate(() => {
        const row = document.activeElement?.closest('[data-rule-row]');
        return {
          row: row ? Array.from(document.querySelectorAll('[data-rule-row]')).indexOf(row) : -1,
          arrow: document.activeElement?.getAttribute('data-arrow') ?? '',
        };
      }),
    (v) => v.row === 0,
    5000,
  );
  check('der Fokus wandert mit der verschobenen Regel (RTE-14)', carried.row === 0 && !!carried.arrow, JSON.stringify(carried));

  await sortCard.locator('[data-rule-row]').first().getByRole('button', { name: 'Entfernen' }).click();
  const dropped = await until(rules, (v) => v.length === 1);
  check('…und ✕ nimmt sie wieder heraus', ruleText(dropped) === 'status:asc', ruleText(dropped));

  // Both „Zeitfenster" boxes are `type="number"` on this one tab since WP-54, which is why every
  // selector here is scoped to its card — a bare `input[type="number"]` is ambiguous and so is
  // „Speichern".
  //
  // The gesture is „leeren, dann tippen", and that is the whole point of it: the draft is a
  // *string*, clamped on blur and on save rather than per keystroke, because clamping each
  // keystroke wrote the empty field back as a 1 and the next digits appended to it — so emptying
  // the box and typing 60 stored 160, with no validation message (PGS-04). Select-all-and-type
  // never empties the field and passes against that defect.
  const attentionCard = cardWith(s, 'Aufgaben-Übersicht');
  const eventCard = cardWith(s, 'Termine in der Übersicht');
  check('beide Zeitfenster-Felder liegen auf diesem Reiter (WP-54)', (await s.locator('input[type="number"]').count()) === 2);

  await attentionCard.getByRole('button', { name: 'Bald fällig' }).click();
  const attentionBox = attentionCard.locator('input[type="number"]');
  await attentionBox.click();
  await attentionBox.press('ControlOrMeta+a');
  await attentionBox.press('Backspace');
  await attentionBox.type('60');
  await attentionCard.getByRole('button', { name: 'Speichern' }).click();
  const savedWindow = await until(() => api(C('/settings')), (v) => v.attention_window_days === '60', 8000);
  check(
    'die Übersichts-Karte schreibt Fenster und Kennzahlen in einem Zug',
    savedWindow.attention_window_days === '60' && JSON.stringify(savedWindow.task_stats ?? []).includes('baldfaellig'),
    `${savedWindow.attention_window_days} Tage, ${JSON.stringify(savedWindow.task_stats ?? [])}`,
  );
  check('…und der Knopf ist danach wieder stumpf', !(await attentionCard.getByRole('button', { name: 'Speichern' }).isEnabled()));

  const eventBox = eventCard.locator('input[type="number"]');
  await eventBox.click();
  await eventBox.press('ControlOrMeta+a');
  await eventBox.press('Backspace');
  await eventBox.type('21');
  await eventCard.getByRole('button', { name: 'Speichern' }).click();
  const both = await until(() => api(C('/settings')), (v) => v.event_window_days === '21', 8000);
  check(
    '…die Termin-Karte schreibt ihren eigenen Schlüssel und lässt den anderen stehen',
    both.event_window_days === '21' && both.attention_window_days === '60',
    `Termine ${both.event_window_days}, Aufmerksamkeit ${both.attention_window_days}`,
  );

  // ======================================================================== Q · the option lists
  //
  // „Kategorien" is three `OptionsEditor`s over one settings key each. The interesting half is not
  // that a save lands but that a *refused* one does not: `validateOptions` is shared with the
  // column manager because the invariants belong to the option list rather than to the screen
  // editing it — bolted onto one call site, the other silently discarded the row (RTE-12).
  console.log('\nQ · Die Optionslisten auf „Kategorien“');
  await tabLink(s, 'kategorien').click();
  await s.waitForURL(/#\/einstellungen\/kategorien$/, { timeout: 10_000 });
  // Reloaded before anything is typed, and again after the save below. Every write on this page
  // ends in a blanket invalidate, each refetch of `['settings']` reseeds this editor's draft, and
  // more than one refetch can be in flight — case P has just made two writes. A reload starts a
  // fresh cache with nothing pending, which is the only way this case can be sure the draft it
  // types into is the draft it saves.
  await s.reload();
  await ready(s);

  const typeCard = cardWith(s, 'Termin-Typen');
  const types = () => api(C('/settings')).then((v) => v.event_types ?? []);
  const typeText = (v) => v.map((o) => o.label).join(' | ');
  check('alle drei Listen stehen auf dem Reiter', (await shown(typeCard)) && (await s.locator('div.rounded-2xl:has([data-option-row])').count()) === 3);
  const typesBefore = await types();
  check('die Termin-Typen der Demo stehen darin', typesBefore.length === 4, typeText(typesBefore));

  // Everything below reads the draft's own labels off the inputs (`el.value`, a *property* — React
  // never writes the attribute) rather than trusting a position, and checks them **before** every
  // save. The reason is the reseed: `OptionsEditor` re-seeds its draft from the server list on any
  // `['settings']` refetch, so a row that is being typed can vanish under the script — and „the
  // last row" is then a *demo* category, which a save would rename or delete for real. Read as
  // assertions these are „what the user typed is in the draft and nothing else moved"; read as
  // guards they are what keeps a red check from becoming a damaged fixture.
  const optionRows = typeCard.locator('[data-option-row]');
  const draftLabels = () =>
    typeCard
      .locator('[data-option-label]')
      .evaluateAll((els) => els.map((el) => /** @type {HTMLInputElement} */ (el).value));
  const demoLabels = typeText(typesBefore);
  const newType = `Probe ${RUN}`;
  const saveTypes = typeCard.getByRole('button', { name: 'Speichern' });
  /**
   * Click „Speichern", bounded. The button is `disabled` while the draft equals the stored list,
   * so a reseed landing between the read above and this click leaves a dead button — and the
   * default 30 s actionability wait would end the *run* rather than the case. The message travels
   * into the next check's detail instead.
   */
  const saveTypesNow = () =>
    saveTypes
      .click({ timeout: 8000 })
      .then(() => '')
      .catch((e) => ` — Speichern: ${String(e.message).split('\n')[0]}`);

  // A row with no name is refused *before* it can be saved, and the refusal is the button rather
  // than a message afterwards: `normalizeOptions` ends in `.filter(o => o.label)`, so a blank row
  // saved would be silently dropped and read as a failed save (RTE-12).
  await typeCard.getByRole('button', { name: '+ Typ' }).click();
  await until(draftLabels, (v) => v.length === 5, 5000);
  const problem = await until(() => typeCard.locator('.text-amber-700').innerText().catch(() => ''), (t) => t.length > 0, 5000);
  check('eine namenlose Zeile wird benannt statt gespeichert', /keine Bezeichnung/.test(problem), problem.replace(/\n/g, ' '));
  check('…und „Speichern“ ist so lange stumpf', !(await saveTypes.isEnabled()));

  await typeCard.locator('[data-option-label]').last().fill(newType);
  const named = await until(draftLabels, (v) => v[4] === newType, 5000);
  const namedOk = named.length === 5 && named[4] === newType && named.slice(0, 4).join(' | ') === demoLabels;
  check('die getippte Zeile steht neben den unveränderten Demo-Kategorien', namedOk, named.join(' | '));
  const savedAdd = namedOk ? await saveTypesNow() : ' — nicht gespeichert';
  const typesAfter = await until(types, (v) => v.some((o) => o.label === newType), 8000);
  check(
    'ein benannter Typ wird gespeichert',
    typesAfter.some((o) => o.label === newType),
    `${typeText(typesAfter)}${savedAdd}`,
  );
  await s.reload();
  await ready(s);
  const seeded = await until(draftLabels, (v) => v.length === 5 && v[4] === newType, 8000);
  check('…und steht nach einem Neuladen im Editor', seeded.join(' | ') === `${demoLabels} | ${newType}`, seeded.join(' | '));

  // One row, one click: the rows are keyed by index, so two clicks on „das letzte ✕" inside one
  // render address the same position twice — and the second would take a demo category with it.
  await optionRows.last().getByRole('button', { name: 'Entfernen' }).click();
  const shrunk = await until(draftLabels, (v) => v.length === 4, 5000);
  check('…und ✕ nimmt sie wieder heraus', shrunk.join(' | ') === demoLabels, shrunk.join(' | '));
  const savedRemoval = shrunk.join(' | ') === demoLabels ? await saveTypesNow() : ' — nicht gespeichert';
  const typesRestored = await until(types, (v) => v.length === 4, 8000);
  check(
    'die gespeicherte Liste steht wieder wie zuvor',
    typeText(typesRestored) === demoLabels,
    `${typeText(typesRestored)}${savedRemoval}`,
  );
  // Removing a category *nothing uses* saves straight away; the reassignment dialog belongs to the
  // other branch. Asserted rather than assumed, and cleared if it is there — its backdrop would
  // otherwise swallow the next case's clicks and turn one red check into an aborted run.
  const openDialogs = await s.locator('.fixed.inset-0').count();
  check('ein unbenutzter Typ geht ohne Zuordnungs-Dialog', openDialogs === 0, `${openDialogs} Dialoge`);
  if (openDialogs > 0) {
    await s.keyboard.press('Escape');
    await gone(s.locator('.fixed.inset-0'));
  }

  // ======================================================================== R · seasons and backups
  //
  // The data tab holds the only *irreversible* delete in the app — a season is a file, not a row:
  // no `deleted_at`, no Papierkorb, no undo (DECISIONS.md) — and the backup card, which is the
  // one card that renders differently for having no Electron bridge. This page has none, so the
  // browser half is asserted here and its stubbed twin in case U.
  console.log('\nR · Saisons löschen und die Backup-Karte ohne Bridge');
  await tabLink(s, 'daten').click();
  await s.waitForURL(/#\/einstellungen\/daten$/, { timeout: 10_000 });

  const backupCard = cardWith(s, 'Datenbank & Backups');
  check('ohne Bridge ist der Backup-Ordner nicht wählbar', !(await backupCard.getByRole('button', { name: 'Wählen…' }).isEnabled()));
  check('…und die Karte sagt, warum', /nur in der Desktop-App/.test(await backupCard.innerText()));

  // Scoped to the season card by the sentence only it carries: `li` is a page-wide selector, and
  // the day anything else on this tab renders a list the rows below stop being the seasons.
  const homeLabel = registry.seasons.find((x) => x.id === HOME)?.label ?? '';
  const seasonRows = cardWith(s, 'Anlegen und Umbenennen').locator('li');
  const defaultRow = seasonRows.filter({ hasText: 'Standard' });
  check(
    'die Standard-Saison ist als solche markiert',
    (await shown(defaultRow)) && (await defaultRow.innerText()).includes(homeLabel),
    (await defaultRow.count()) ? (await defaultRow.innerText()).replace(/\n/g, ' ') : 'keine Zeile',
  );
  check('…und trägt keinen Löschknopf, weil der Server sie ohnehin verweigert', (await defaultRow.locator('button[title="Löschen"]').count()) === 0);

  // Reloaded rather than waited for: a season created over the API broadcasts nothing, so this
  // window keeps rendering the list it has (docs/VERIFYING.md). That is a fact about the script's
  // own fixture, not a promise of the app — `refetchOnWindowFocus` is on, so „it is not on screen
  // yet" is a state a stray focus event may end at any moment, and asserting it would be asserting
  // cache staleness as if it were an invariant.
  const doomedSeason = await makeSeason('Löschziel');
  await s.reload();
  await ready(s);
  const doomedRow = seasonRows.filter({ hasText: doomedSeason.label });
  check('eine neu angelegte Saison steht nach dem Neuladen in der Liste', await shown(doomedRow));

  await doomedRow.locator('button[title="Löschen"]').click();
  await s.getByRole('heading', { name: /endgültig löschen$/ }).waitFor({ timeout: 8000 });
  const confirmText = await topDialog(s).innerText();
  check(
    'die Rückfrage nennt die Saison und sagt, dass es keinen Weg zurück gibt',
    confirmText.includes(doomedSeason.label) && /nicht rückgängig/.test(confirmText),
    confirmText.replace(/\n/g, ' | '),
  );
  // WP-42: a confirm dialog has no tabbable in its body, so the focus effect falls through to the
  // footer's first button — and that is „Abbrechen". The keystroke that reaches the question
  // answers it, and the safe answer is the one it lands on.
  // Polled, like every other transition here: `Modal` places focus from a passive effect, so a
  // one-shot read taken the moment the heading is on screen can precede it.
  const confirmFocus = await until(() => tabStop(s), (v) => v.at >= 0, 5000);
  check('der Fokus liegt auf „Abbrechen“ (WP-42)', confirmFocus.text === 'Abbrechen', JSON.stringify(confirmFocus));
  await s.keyboard.press('Enter');
  const afterEnter = await gone(s.locator('.fixed.inset-0'));
  check('Enter beantwortet sie damit — der Dialog geht zu', afterEnter, `${await s.locator('.fixed.inset-0').count()} Dialoge`);
  check('…und die Saison steht noch da', (await api('/seasons')).seasons.some((x) => x.id === doomedSeason.id));
  // Leave nothing standing if that assertion failed: the delete below clicks the same 🗑, and a
  // confirm still up would turn one red check into an aborted run that never reaches R2 or S.
  if ((await s.locator('.fixed.inset-0').count()) > 0) {
    await s.keyboard.press('Escape');
    await gone(s.locator('.fixed.inset-0'));
  }

  await doomedRow.locator('button[title="Löschen"]').click();
  await topDialog(s).getByRole('button', { name: 'Endgültig löschen' }).click();
  const remaining = await until(
    () => api('/seasons').then((r) => (r.seasons ?? []).map((x) => x.id)),
    (ids) => !ids.includes(doomedSeason.id),
  );
  check('„Endgültig löschen“ löscht sie wirklich', !remaining.includes(doomedSeason.id), `${remaining.length} Saisons übrig`);
  check('…und der Hinweis nennt sie', await shown(toast(s, new RegExp(doomedSeason.label))));

  // ======================================================================== R2 · the term
  //
  // „Saison" is a word the user owns: it is stored registry-wide in seasons.json, not per season,
  // and every screen composes its headings from it. The tab's own label is the shortest proof that
  // the word travels — `SettingsPage` builds it from `useSeasonTerm`, so a card that saved into
  // the wrong store would leave the tab reading „Saison & Daten" beside a renamed everything else.
  console.log('\nR2 · Die Bezeichnung trägt bis in den Reiter');
  const termCard = cardWith(s, 'Bezeichnung');
  await termCard.locator('input').nth(0).fill('Festival');
  await termCard.locator('input').nth(1).fill('Festivals');
  await termCard.getByRole('button', { name: 'Speichern' }).click();
  const terms = await until(() => api('/seasons').then((r) => r.terms ?? {}), (t) => t.season === 'Festival', 8000);
  check('die Bezeichnung wird registryweit gespeichert', terms.season === 'Festival' && terms.seasonPlural === 'Festivals', JSON.stringify(terms));
  const renamedTab = await until(() => tabLink(s, 'daten').innerText(), (t) => t.includes('Festival'), 5000);
  check('…und der Reiter heißt danach', renamedTab.trim() === 'Festival & Daten', renamedTab.trim());

  await termCard.locator('input').nth(0).fill('');
  await termCard.locator('input').nth(1).fill('');
  await termCard.getByRole('button', { name: 'Speichern' }).click();
  const reset = await until(() => api('/seasons').then((r) => r.terms ?? {}), (t) => !t.season, 8000);
  check('leer lassen setzt sie zurück', !reset.season, JSON.stringify(reset));
  const plainTab = await until(() => tabLink(s, 'daten').innerText(), (t) => t.includes('Saison'), 5000);
  check('…und der Reiter heißt wieder wie ab Werk', plainTab.trim() === 'Saison & Daten', plainTab.trim());
  await s.close();
}
