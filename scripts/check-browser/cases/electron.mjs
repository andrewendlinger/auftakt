/** U–U2 · the two Electron surfaces, against a recording bridge stub */

import { stubElectron } from '../bridge.mjs';
import { cardWith, clickIfThere, open, ready, shown, toast, topDialog, until } from '../browser.mjs';
import { UI } from '../config.mjs';
import { tabStop } from '../probes.mjs';
import { check } from '../report.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runElectron(fixtures) {
  const { context } = fixtures;
  // ======================================================================== U · the update card
  //
  // Everything below runs against the recording bridge and never against the real one — see
  // `stubElectron`. Three prerequisites decide whether this card is reachable at all, and each
  // one fails silently on its own: it lives at **`#/einstellungen/hilfe`** and nowhere else
  // (`#/einstellungen` lands on „Aufgaben & Übersicht", where every selector here matches nothing),
  // `checkForUpdates` has to answer `updateAvailable`, and the in-app install only exists with
  // `canInstall` — on the stub's defaults the button is simply not in the DOM.
  //
  // What WP-60 added is the *progress*, and the reason the percentage is pushed rather than
  // polled is also the reason a naive stub proves nothing here: with no subscriber the card sits
  // in its first frame for ever, which is exactly what the defect looked like.
  console.log('\nU · Die Update-Karte am Bridge-Stub (WP-60)');
  const u = await open(context, '/einstellungen/hilfe', (page) =>
    stubElectron(page, {
      platform: 'win32',
      silent: { current: '0.0.0-test', latest: '9.9.9', url: 'https://example.invalid/releases', updateAvailable: true, canInstall: true },
      manual: { current: '0.0.0-test', latest: '9.9.9', url: 'https://example.invalid/releases', updateAvailable: true, canInstall: false },
    }),
  );
  const updateCard = cardWith(u, 'Version & Updates');
  check('die Karte, die es ohne Bridge nicht gibt (Fall O), steht hier', await shown(updateCard));
  const version = await until(() => updateCard.innerText(), (t) => t.includes('0.0.0-test'), 5000);
  check(
    'sie nennt die Version aus der Bridge',
    version.includes('0.0.0-test'),
    version.split('\n').find((l) => l.includes('Installierte')) ?? '',
  );
  // Mounting reads the *cached silent* check, so an available update is on screen without anyone
  // having clicked „Nach Updates suchen".
  check('…und die stille Startprüfung steht ohne Klick da', await shown(updateCard.getByText('Version 9.9.9 ist verfügbar.')));

  const progress = () =>
    u.evaluate(() => {
      const box = document.querySelector('.rounded-lg.bg-neutral-50');
      const track = box?.querySelector('span.inline-block.overflow-hidden') ?? null;
      const fill = track?.firstElementChild ?? null;
      return {
        text: (box?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        pulsing: !!track && track.className.includes('animate-pulse'),
        width: fill instanceof HTMLElement ? fill.style.width : '',
      };
    });
  await updateCard.getByRole('button', { name: 'Herunterladen & installieren' }).click();
  const started = await until(progress, (d) => d.text.includes('heruntergeladen'), 5000);
  check(
    'vor dem ersten Datenpaket zeigt der Balken die ehrliche Unbekannte statt einer Null',
    started.pulsing && !started.text.includes('%'),
    JSON.stringify(started),
  );
  check(
    '…und der Hinweis auf den Neustart steht daneben (WP-60)',
    /Danach fragt Auftakt, ob es zum Installieren neu starten soll/.test(started.text),
    started.text,
  );
  await u.evaluate(() => /** @type {any} */ (window).__updateProgress(42));
  const at42 = await until(progress, (d) => d.width === '42%', 5000);
  check('ein gemeldeter Fortschritt erreicht Balken und Beschriftung', at42.width === '42%' && at42.text.includes('42 %') && !at42.pulsing, JSON.stringify(at42));
  // The clamp sits at the boundary rather than inside `ProgressBar`, because electron-updater has
  // been seen to overshoot on the last chunk — a clamp that only reaches the bar leaves the label
  // beside it reading „103 %".
  await u.evaluate(() => /** @type {any} */ (window).__updateProgress(103));
  const over = await until(progress, (d) => d.text.includes('100'), 5000);
  check('ein Überlauf wird an der Grenze gekappt, nicht erst im Balken', over.text.includes('100 %') && over.width === '100%', JSON.stringify(over));

  await u.evaluate(() => /** @type {any} */ (window).__finishUpdate());
  const availableAgain = await until(() => updateCard.innerText(), (t) => t.includes('Herunterladen & installieren'), 8000);
  check(
    'nach dem Abschluss steht die Karte wieder auf „verfügbar“',
    availableAgain.includes('Version 9.9.9 ist verfügbar.'),
    availableAgain.replace(/\n/g, ' | '),
  );

  // The manual check is the other door, and it answers with the *other* branch: without
  // `canInstall` the card sends the user to the Releases page over `openExternal` — the mac path,
  // and the only observable a fire-and-forget bridge call has.
  await updateCard.getByRole('button', { name: 'Nach Updates suchen' }).click();
  check('„Nach Updates suchen“ holt die zweite Antwort', await shown(updateCard.getByRole('button', { name: 'Zur Releases-Seite' })));
  await updateCard.getByRole('button', { name: 'Zur Releases-Seite' }).click();
  const externals = await until(() => u.evaluate(() => /** @type {any} */ (window).__external), (v) => v.length > 0, 5000);
  check('…und der Knopf reicht die URL an die Bridge weiter', externals[0] === 'https://example.invalid/releases', externals.join(' '));

  // The other half of case R's backup card: with a bridge the buttons are live and the browser
  // note is gone, which is what makes R's „nur in der Desktop-App" assertion about the branch
  // rather than about the wording.
  await u.goto(`${UI}/#/einstellungen/daten`);
  await u.reload();
  await ready(u);
  const stubbedBackup = cardWith(u, 'Datenbank & Backups');
  check('mit Bridge ist der Backup-Ordner wählbar', await stubbedBackup.getByRole('button', { name: 'Wählen…' }).isEnabled());
  const backupText = await stubbedBackup.innerText();
  check('…die Browser-Warnung ist weg', !/nur in der Desktop-App/.test(backupText));
  check('…und ohne gewählten Ordner warnt die Karte, dass nichts gesichert wird', /Ohne Backup-Ordner/.test(backupText), backupText.replace(/\n/g, ' | ').slice(0, 120));

  // ======================================================================== U2 · the feedback dialog
  //
  // A `mailto:` is fire-and-forget, so the dialog produces no app state to assert on: the URL
  // handed to `openExternal` is the whole of its output, and the real one opens a mail client on
  // the machine running this. The file is worse — the real `saveDiagnostics` writes to the desktop
  // (WP-54) — so the recording stub is not convenience here, it is the only way this case may
  // exist at all.
  //
  // **What WP-75 made this case about is the click count.** The flow used to ask which kind of
  // thing this was, which area it was in and for a required answer, then hand over three things to
  // copy; it now opens, saves and is done, with the text box optional. So the run below is driven
  // in that order — the *default* path first, with nothing typed at all, because that is the path
  // the feature now exists for and the one a re-added question would break first.
  //
  // Three properties outlive the reshape and each is asserted where it can fail. The reference is
  // one thing in three places: the recorded file name, the mail's subject and the body's attach
  // line. **Nothing opens by itself** (WP-66) — the recorder has to still be empty when the
  // handover is fully on screen, and only the optional link may fill it. And a *second* save out
  // of the same dialog is a second file: main's `uniqueBundleName` calls it `…-2.txt`, so the
  // handover may not open until main has said the name, which is what `__holdSave` makes visible.
  //
  // The clipboard is real, not stubbed: „Adresse kopieren" is `navigator.clipboard`, so the
  // context is granted both permissions and the assertion reads the clipboard back. `bringToFront`
  // because a clipboard write needs the document focused and earlier cases left pages open.
  console.log('\nU2 · Der Feedback-Dialog am Bridge-Stub (WP-54, WP-66, WP-75)');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: UI });
  await u.bringToFront();
  await u.goto(`${UI}/#/einstellungen/hilfe`);
  await u.reload();
  await ready(u);
  await u.getByRole('button', { name: 'Feedback senden…' }).click();
  // Waited for by the dialog's own first control, not by its heading: the card behind it carries
  // the *same* words in an `<h2>`, so `getByRole('heading', { name: 'Feedback & Diagnose' })` is
  // two elements and a strict-mode violation.
  await topDialog(u).getByRole('button', { name: 'Bericht speichern' }).waitFor({ timeout: 8000 });
  // The whole point of WP-75, as two counts: one box, and nothing in front of it. The picker rows
  // („Fehler"/„Wunsch", then five areas) were nine clicks' worth of question before the customer
  // could say anything, and a regression here would put them back.
  check(
    'der Dialog fragt nichts — ein Feld, und keine Vorfragen davor',
    (await u.locator('textarea').count()) === 1 &&
      (await topDialog(u).getByRole('button', { name: /^Fehler|^Wunsch/ }).count()) === 0,
    `${await u.locator('textarea').count()} Felder`,
  );
  check(
    '…das Feld ist als freiwillig ausgewiesen',
    /Was ist passiert\? \(optional\)/.test(await topDialog(u).innerText()),
  );
  check(
    '…und „Bericht speichern“ ist ohne einen Tastendruck scharf (WP-75)',
    await topDialog(u).getByRole('button', { name: 'Bericht speichern' }).isEnabled(),
  );
  // Opening the dialog must not be the thing that writes: somebody who looks and closes again
  // leaves no file on their desktop. It is also what makes the click count honest — the save is
  // a click, not a side effect of another one.
  check(
    '…und bis dahin liegt nichts auf dem Schreibtisch',
    (await u.evaluate(() => /** @type {any} */ (window).__saved)).length === 0,
  );
  // Focus in the box, not on a button: the WP-42 rule, and the one thing a person who *does* want
  // to write something can start doing without reaching for the mouse.
  const onOpen = await until(() => tabStop(u), (v) => v.at >= 0, 5000);
  check('der Fokus steht im freiwilligen Feld', onOpen.tag === 'TEXTAREA', JSON.stringify(onOpen));

  // The promise the file itself opens with, made before it is written. Clicked open rather than
  // read out of the collapsed `<details>`: `innerText` skips what is not rendered.
  await topDialog(u).getByText('Was steht im Bericht?').click();
  const opened = await until(() => topDialog(u).innerText(), (t) => t.includes('Keine Termine'), 5000);
  check(
    '„Was steht im Bericht?“ nennt, was nicht mitgeht',
    /Keine Termine, Künstler, Kontakte oder Notizen/.test(opened),
  );
  check('…und zeigt die Startdiagnose, die die Bridge liefert', /Startdiagnose — 2 Einträge/.test(opened));

  // ---- the default path: one click, nothing typed. That is the flow WP-75 exists for.
  await topDialog(u).getByRole('button', { name: 'Bericht speichern' }).click();
  const saved = await until(() => u.evaluate(() => /** @type {any} */ (window).__saved), (v) => v.length > 0, 8000);
  const ref = String(saved[0]?.ref ?? '');
  const file = `Auftakt-Diagnose-${ref}.txt`;
  check('ein Klick schreibt die Diagnosedatei über die Bridge', /^AF-\d{10}$/.test(ref), ref || 'nichts geschrieben');
  // An empty „Meldung" would read as a file that lost the customer's words. It says instead that
  // there are none — the same voice `CRASH_REPORT_TEXT` uses for the other bundle nobody wrote.
  check(
    '…und die Meldung sagt, dass niemand etwas dazugeschrieben hat',
    String(saved[0]?.report ?? '').startsWith('Ohne eigenen Text gespeichert'),
    String(saved[0]?.report ?? '').split('\n')[0] ?? '(leer)',
  );
  // The whole of WP-66 in one line. Before it, this same click revealed the file in the Finder
  // and launched a mail client; a recorder that stays empty is the only way to hold that shut.
  check(
    '…und öffnet dabei nichts (WP-66)',
    (await u.evaluate(() => /** @type {any} */ (window).__external)).length === 0,
    (await u.evaluate(() => /** @type {any} */ (window).__external)).join(' '),
  );
  const handover = await until(() => topDialog(u).innerText(), (t) => t.includes(file), 8000);
  check('die Übergabe nennt die Datei, die main wirklich geschrieben hat', handover.includes(file), file);
  check('…und sagt in einem Satz, was zu tun ist', /Häng die Datei an eine E-Mail an diese Adresse/.test(handover));
  check('…mit der Zusicherung aus dem Absturzdialog', /keine Termine, Künstler, Kontakte oder Notizen/i.test(handover));
  // One dialog in two states, not two stacked ones (WP-75): the handover *replaces* the form,
  // because a step that covers the previous one is a step nobody can tell they have finished.
  check('…und bleibt dabei ein einziger Dialog', (await u.locator('.fixed.inset-0').count()) === 1);
  // Focus is *not* in the footer here: WP-42's rule is „the footer's safe answer when the body has
  // nothing to focus", and this body's first stop is the first thing the customer has to do. The
  // `Modal` places focus only when it opens, so this state has to place its own.
  const steps = await until(() => tabStop(u), (v) => v.at >= 0, 5000);
  check(
    'der Fokus liegt auf dem ersten Schritt, nicht im Fuß (WP-42/75)',
    steps.at === 1 && steps.text === 'Adresse kopieren',
    JSON.stringify(steps),
  );

  // The one copy button that is left. Read back out of the real clipboard, which is what the
  // customer pastes.
  //
  // `click()` returns when the event was dispatched, not when the handler's `writeText` settled,
  // so the read is a `until` on a shape the *previous* content does not have. Reading once
  // straight after the click passes or fails on timing.
  //
  // Bounded and swallowed, like `clickIfThere`: the label swaps to „Kopiert ✓" for 2.5 s after a
  // successful copy, so a slow runner can be looking for a button that is wearing another name —
  // and an unguarded `click()` there ends the *run* 30 s later instead of reddening this line.
  // It has happened once. The sentinel below fails every `shape` and names the stage it failed at.
  const copy = async (name, shape) => {
    if (!(await clickIfThere(topDialog(u).getByRole('button', { name }), 8000))) {
      return `„${name}“ war nicht anklickbar`;
    }
    return until(
      () => u.evaluate(() => navigator.clipboard.readText()).catch(() => ''),
      shape,
      5000,
    );
  };
  const address = await copy('Adresse kopieren', (t) => t === 'auftakt@e-mail.de');
  check('„Adresse kopieren“ legt die Support-Adresse in die Zwischenablage', address === 'auftakt@e-mail.de', address);
  check('ein geglückter Kopiervorgang sagt es am Knopf', await shown(topDialog(u).getByRole('button', { name: 'Kopiert ✓' })));

  // The `mailto:` is the one optional shortcut, a link and not a button, and the *only* thing on
  // this path that ever reaches `openExternal`.
  await topDialog(u).getByRole('link', { name: 'E-Mail-Programm öffnen' }).click();
  const mails = await until(() => u.evaluate(() => /** @type {any} */ (window).__external), (v) => v.length > 0, 8000);
  const mail = new URL(mails[0] ?? 'mailto:');
  const params = new URLSearchParams(mail.search);
  check('erst der optionale Link reicht eine Mail an die Bridge', mails.length === 1 && mail.pathname === 'auftakt@e-mail.de', mails.join(' ').slice(0, 60));
  check(
    '…ihr Betreff trägt Kennung und Version',
    params.get('subject') === `[${ref}] Auftakt-Feedback (v0.0.0-test)`,
    params.get('subject') ?? '',
  );
  check(
    '…ihre erste Zeile ist die eine Sache, die niemand für den Kunden tun kann',
    (params.get('body') ?? '').split('\n')[0] === `!! BITTE NOCH ANHÄNGEN: ${file}`,
    (params.get('body') ?? '').split('\n')[0],
  );
  check('…und der Dialog bleibt dabei stehen', (await u.locator('.fixed.inset-0').count()) === 1);

  // ---- the optional text, and with it the second bundle. „Text ergänzen" is the only way back,
  // and a save from there *must* write a second file: attaching the version without the sentence
  // they just added is worse than a stray text file. `uniqueBundleName` calls it `…-2.txt`, and
  // the handover may not open until main has said so — held on purpose, which is the only way to
  // see the wait at all.
  await topDialog(u).getByRole('button', { name: 'Text ergänzen' }).click();
  const backToForm = await until(() => u.locator('textarea').count(), (n) => n === 1, 5000);
  check('„Text ergänzen“ bringt das Feld zurück, leer wie es war', backToForm === 1 && (await u.locator('textarea').nth(0).inputValue()) === '');
  await u.locator('textarea').nth(0).fill('Der Druckbogen bleibt leer — auch nach einem Neustart.');
  await u.evaluate(() => {
    /** @type {any} */ (window).__holdSave = true;
  });
  await topDialog(u).getByRole('button', { name: 'Bericht speichern' }).click();
  const held = await until(() => u.evaluate(() => /** @type {any} */ (window).__saved), (v) => v.length > 1, 8000);
  // Read positively: „does not contain the attach line" is also true of an empty string, which is
  // what a broken report would hand the bridge. The bundle writes the reference and the machine
  // around this text, so the renderer sends the words and nothing else.
  check(
    'ein ergänzter Text schreibt eine zweite Datei, die genau ihn trägt',
    held.length === 2 && held[1].report === 'Der Druckbogen bleibt leer — auch nach einem Neustart.',
    `${held.length} Dateien · ${String(held[1]?.report ?? '').slice(0, 40)}`,
  );
  // The button says so rather than only greying out: the write races a 2 s GPU timeout, and the
  // person waiting is the one already reporting a fault. Note that this is also why a script may
  // not address „Bericht speichern" by name across a held save — for that moment it is not
  // called that.
  check(
    '…und die Übergabe wartet darauf, statt einen Namen zu raten',
    (await u.locator('textarea').count()) === 1 &&
      (await topDialog(u).getByRole('button', { name: 'Speichert…' }).isDisabled()),
  );
  await u.evaluate(() => /** @type {any} */ (window).__finishSave());
  const file2 = `Auftakt-Diagnose-${ref}-2.txt`;
  const renamed = await until(() => topDialog(u).innerText(), (t) => t.includes(file2), 8000);
  // `file` is not a substring of `file2` — `…AF-….txt` against `…AF-…-2.txt` — so „the first one
  // is not mentioned" is a real assertion rather than one the second name satisfies anyway.
  check('dann nennt sie die zweite Datei, nicht die erste', renamed.includes(file2) && !renamed.includes(file), file2);
  await topDialog(u).getByRole('link', { name: 'E-Mail-Programm öffnen' }).click();
  const mails2 = await until(() => u.evaluate(() => /** @type {any} */ (window).__external), (v) => v.length > 1, 8000);
  const body2 = new URLSearchParams(new URL(mails2[mails2.length - 1]).search).get('body') ?? '';
  check(
    '…und die Mail hängt dieselbe zweite Datei an, mit dem Text darunter',
    body2.split('\n')[0] === `!! BITTE NOCH ANHÄNGEN: ${file2}` && body2.includes('--- Meldung'),
    body2.split('\n')[0],
  );

  // Taking the text back again is the one step a prediction cannot pass: `written` is keyed by
  // the report text, so a text already on the desktop is a *lookup* — the first bundle holds
  // exactly it, under the „ohne eigenen Text" stand-in — and naming it is not the same as
  // guessing the first name, because the guess for this save would be `…-3.txt`.
  await topDialog(u).getByRole('button', { name: 'Text ergänzen' }).click();
  await u.locator('textarea').nth(0).fill('');
  await topDialog(u).getByRole('button', { name: 'Bericht speichern' }).click();
  const reverted = await until(() => topDialog(u).innerText(), (t) => t.includes(file), 8000);
  check(
    'ein zurückgenommener Text nennt wieder die erste Datei und schreibt keine dritte',
    reverted.includes(file) && !reverted.includes(file2) && (await u.evaluate(() => /** @type {any} */ (window).__saved)).length === 2,
    file,
  );

  await topDialog(u).getByRole('button', { name: 'Fertig' }).click();
  check('der Hinweis nennt die Datei beim Namen', await shown(toast(u, new RegExp(file))));
  await u.close();
}
