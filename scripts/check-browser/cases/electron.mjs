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
  // Two assertions, and WP-66 added the second. The first is that the four places the reference
  // appears agree: the recorded file name, the subject, the body's attach line and its stamp —
  // that is what a customer's mail is *for*. The second is what the handover no longer does:
  // „Weiter" writes the file and **opens nothing**, so `window.__external` has to still be empty
  // when the dialog is fully on screen, and only the optional link may fill it. A recorder is the
  // right instrument for a call that must not happen.
  //
  // The clipboard is real, not stubbed: the three copy buttons are `navigator.clipboard`, so the
  // context is granted both permissions and the assertions read the clipboard back. `bringToFront`
  // because a clipboard write needs the document focused and earlier cases left pages open.
  console.log('\nU2 · Der Feedback-Dialog am Bridge-Stub (WP-54, WP-66)');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: UI });
  await u.bringToFront();
  await u.goto(`${UI}/#/einstellungen/hilfe`);
  await u.reload();
  await ready(u);
  await u.getByRole('button', { name: 'Feedback senden…' }).click();
  // Waited for by the dialog's own first control, not by its heading: the card behind it carries
  // the *same* words in an `<h2>`, so `getByRole('heading', { name: 'Feedback & Diagnose' })` is
  // two elements and a strict-mode violation.
  await topDialog(u).getByRole('button', { name: /^Fehler/ }).waitFor({ timeout: 8000 });
  check('der Dialog fragt nichts, bevor eine Art gewählt ist', (await u.locator('textarea').count()) === 0);
  check('…und sagt im Fuß, woran es liegt', /Bitte zuerst Fehler oder Wunsch wählen/.test(await topDialog(u).innerText()));
  check('…„Weiter“ ist so lange stumpf', !(await topDialog(u).getByRole('button', { name: 'Weiter' }).isEnabled()));

  await topDialog(u).getByRole('button', { name: /^Fehler/ }).click();
  check('nach der Art wird der Bereich gefragt, noch keine Texte', (await u.locator('textarea').count()) === 0 && (await shown(topDialog(u).getByRole('button', { name: 'Allgemein', exact: true }))));
  await topDialog(u).getByRole('button', { name: 'Allgemein', exact: true }).click();
  const asked = await until(() => u.locator('textarea').count(), (n) => n === 3, 5000);
  check('…und erst dann die drei Fehlerfragen', asked === 3, `${asked} Felder`);
  // „Was ist passiert?" exists only under Fehler — under Wunsch the same first box asks something
  // else, which is why the two branches are driven separately below.
  check('die erste Frage ist die des Fehlers', /Was ist passiert\?/.test(await topDialog(u).innerText()));

  await u.locator('textarea').nth(0).fill('Der Druckbogen bleibt leer.');
  const ready2 = await until(() => topDialog(u).getByRole('button', { name: 'Weiter' }).isEnabled(), (v) => v === true, 5000);
  check('mit der Pflichtantwort wird „Weiter“ scharf', ready2 === true);

  // „Weiter" *opens* a dialog rather than closing one — and since WP-66 it is also the click that
  // writes the file, because the customer leaves for their mail in the middle of the handover and
  // attaches it before coming back. The handover then waits for the write: it is composed from
  // the name main returns, and that name is only guessable for the first bundle (held case below).
  await topDialog(u).getByRole('button', { name: 'Weiter' }).click();
  const stacked = await until(() => u.locator('.fixed.inset-0').count(), (n) => n === 2, 5000);
  check('„Weiter“ stapelt die Übergabe auf das Formular', stacked === 2, `${stacked} Dialoge`);
  const saved = await until(() => u.evaluate(() => /** @type {any} */ (window).__saved), (v) => v.length > 0, 8000);
  const ref = String(saved[0]?.ref ?? '');
  const file = `Auftakt-Diagnose-${ref}.txt`;
  check('ein Fehler schreibt die Diagnosedatei über die Bridge', /^AF-\d{10}$/.test(ref), ref || 'nichts geschrieben');
  // The whole of WP-66 in one line. Before it, this same click revealed the file in the Finder
  // and launched a mail client; a recorder that stays empty is the only way to hold that shut.
  check(
    '…und öffnet dabei nichts (WP-66)',
    (await u.evaluate(() => /** @type {any} */ (window).__external)).length === 0,
    (await u.evaluate(() => /** @type {any} */ (window).__external)).join(' '),
  );
  const handover = await until(() => topDialog(u).innerText(), (t) => t.includes(file), 5000);
  check('die Übergabe nennt die Datei, die main wirklich geschrieben hat', handover.includes(file), file);
  check('…und sagt, dass das Anhängen niemand für den Kunden übernehmen kann', /Das Anhängen kann kein Programm für dich übernehmen/.test(handover));
  // Focus is *not* on „Zurück" here: WP-42's rule is „the footer's safe answer when the body has
  // nothing to focus", and this body's first stop is the first thing the customer has to do.
  const steps = await until(() => tabStop(u), (v) => v.at >= 0, 5000);
  check(
    'der Fokus liegt auf dem ersten Schritt, nicht im Fuß (WP-42/66)',
    steps.at === 1 && steps.text === 'Adresse kopieren',
    JSON.stringify(steps),
  );
  await u.keyboard.press('Escape');
  const peeled = await until(() => u.locator('.fixed.inset-0').count(), (n) => n === 1, 5000);
  check('Escape schält nur sie ab, das Formular bleibt stehen', peeled === 1 && (await u.locator('textarea').nth(0).inputValue()) === 'Der Druckbogen bleibt leer.', await u.locator('textarea').nth(0).inputValue());

  await topDialog(u).getByRole('button', { name: 'Weiter' }).click();
  await topDialog(u).getByRole('button', { name: 'Adresse kopieren' }).waitFor({ timeout: 8000 });
  check(
    'zurück und wieder vor schreibt dieselbe Datei nicht zweimal',
    (await u.evaluate(() => /** @type {any} */ (window).__saved)).length === 1,
  );

  // The three copy buttons are the path now: address, subject, body — the order a compose window
  // asks for them in. Read back out of the real clipboard, which is what the customer pastes.
  //
  // `click()` returns when the event was dispatched, not when the handler's `writeText` settled,
  // so every read is a `until` on a shape the *previous* content does not have. Reading once
  // straight after the click passes or fails on timing.
  //
  // Bounded and swallowed, like `clickIfThere`: the labels swap to „Kopiert ✓" for 2.5 s after a
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
  const subject = await copy('Betreff kopieren', (t) => t.startsWith('['));
  check(
    'ihr Betreff trägt Kennung, Art, Bereich und Version',
    subject === `[${ref}] Auftakt-Fehler: Allgemein (v0.0.0-test)`,
    subject,
  );
  const body = await copy('Text kopieren', (t) => t.startsWith('!!'));
  check(
    'die erste Zeile des Textes ist die eine Sache, die niemand für den Kunden tun kann',
    body.split('\n')[0] === `!! BITTE NOCH ANHÄNGEN: ${file}`,
    body.split('\n')[0],
  );
  check('…und der technische Block nennt dieselbe Kennung', body.includes(`Fehler · Allgemein · Kennung: ${ref}`), body.split('\n').find((l) => l.includes('Kennung')) ?? '');
  check('ein geglückter Kopiervorgang sagt es am Knopf', await shown(topDialog(u).getByRole('button', { name: 'Kopiert ✓' })));

  // The report is read positively first: „it does not contain X" is also true of an empty string,
  // and an empty one is what a broken `feedbackBody` would hand the bridge.
  const report = String(saved[0]?.report ?? '');
  check(
    'die Datei trägt, was der Kunde geschrieben hat',
    report.includes('Der Druckbogen bleibt leer.') && report.includes(ref),
    report.split('\n')[0] ?? '',
  );
  check(
    '…aber weder die Anhangzeile noch die Zusammenfassung — beides stünde darin doppelt',
    !/BITTE NOCH ANHÄNGEN/.test(report) && !/Startdiagnose/.test(report),
  );

  // The `mailto:` is the one optional shortcut, a link and not a button, and the *only* thing on
  // this path that ever reaches `openExternal`.
  await topDialog(u).getByRole('link', { name: 'E-Mail-Programm öffnen' }).click();
  const mails = await until(() => u.evaluate(() => /** @type {any} */ (window).__external), (v) => v.length > 0, 8000);
  const mail = new URL(mails[0] ?? 'mailto:');
  check('erst der optionale Link reicht eine Mail an die Bridge', mails.length === 1 && mail.pathname === 'auftakt@e-mail.de', mails.join(' ').slice(0, 60));
  check(
    '…mit demselben Betreff, den der Knopf kopiert hat',
    new URLSearchParams(mail.search).get('subject') === subject,
    new URLSearchParams(mail.search).get('subject') ?? '',
  );
  check('…und der Dialog bleibt dabei stehen', (await u.locator('.fixed.inset-0').count()) === 2);

  // A Wunsch is the other branch and writes nothing at all: startup timings say nothing about it,
  // so no file, no attach line, no summary — and the budget goes to the person's own words.
  //
  // Driven by switching the kind **inside the dialog that has already written a bundle**, which
  // is the only place the defect lives: a fresh dialog has nothing to inherit, so a Wunsch driven
  // from one passes whether or not the write's answer is cleared on the way through.
  await topDialog(u).getByRole('button', { name: 'Zurück' }).click();
  await topDialog(u).getByRole('button', { name: /^Wunsch/ }).click();
  await until(() => u.locator('textarea').count(), (n) => n === 3, 5000);
  check('der Wunsch fragt etwas anderes', /Was möchtest du tun können\?/.test(await topDialog(u).innerText()));
  await u.locator('textarea').nth(0).fill('Die Künstlerliste nach Land sortieren.');
  await topDialog(u).getByRole('button', { name: 'Weiter' }).click();
  const wishBody = await copy('Text kopieren', (t) => t.startsWith('---'));
  const wishSubject = await copy('Betreff kopieren', (t) => t.startsWith('['));
  check('…und schreibt dafür keine Datei', (await u.evaluate(() => /** @type {any} */ (window).__saved)).length === 1);
  const wishText = await topDialog(u).innerText();
  check('…und erbt auch keine: kein Anhang, keine Diagnose-Datei aus dem Fehler davor', !/anhängen/i.test(wishText) && !/Diagnose-Datei/.test(wishText), wishText.replace(/\n/g, ' | ').slice(0, 100));
  check('sein Betreff sagt „Wunsch“', /Auftakt-Wunsch: Allgemein/.test(wishSubject), wishSubject);
  check('…und sein Text beginnt ohne Anhangzeile', wishBody.split('\n')[0] === '--- Was ich tun können möchte', wishBody.split('\n')[0]);
  await topDialog(u).getByRole('link', { name: 'E-Mail-Programm öffnen' }).click();
  const wishMails = await until(() => u.evaluate(() => /** @type {any} */ (window).__external), (v) => v.length > 1, 8000);
  check(
    '…und auch seine Mail trägt keine Anhangzeile',
    !/BITTE NOCH ANH/.test(new URLSearchParams(new URL(wishMails[wishMails.length - 1]).search).get('body') ?? ''),
    (new URLSearchParams(new URL(wishMails[wishMails.length - 1]).search).get('body') ?? '').split('\n')[0],
  );

  // Back to the Fehler, unedited: the answers of both kinds survive a switch (they are keyed per
  // field), so the report text is the one already on the desktop and it must name *that* bundle
  // rather than write a second one.
  await topDialog(u).getByRole('button', { name: 'Zurück' }).click();
  await topDialog(u).getByRole('button', { name: /^Fehler/ }).click();
  await topDialog(u).getByRole('button', { name: 'Weiter' }).click();
  const backAgain = await until(() => topDialog(u).innerText(), (t) => /Diagnose/.test(t), 5000);
  check(
    'zurück zum Fehler nennt wieder dieselbe Datei und schreibt keine zweite',
    backAgain.includes(file) && (await u.evaluate(() => /** @type {any} */ (window).__saved)).length === 1,
    file,
  );

  // A corrected answer *must* write a second bundle — and the handover may not open until main
  // has said what it is called, because `uniqueBundleName` makes it `…-2.txt` and every line in
  // the handover names the file. Held open on purpose, which is the only way to see the wait.
  await topDialog(u).getByRole('button', { name: 'Zurück' }).click();
  await u.locator('textarea').nth(0).fill('Der Druckbogen bleibt leer — auch nach einem Neustart.');
  await u.evaluate(() => {
    /** @type {any} */ (window).__holdSave = true;
  });
  await topDialog(u).getByRole('button', { name: 'Weiter' }).click();
  const held = await until(() => u.evaluate(() => /** @type {any} */ (window).__saved), (v) => v.length > 1, 8000);
  check('ein korrigierter Text schreibt eine zweite Datei', held.length === 2 && held[1].report.includes('auch nach einem Neustart'), `${held.length} Dateien`);
  // The button says so rather than only greying out: the write races a 2 s GPU timeout, and the
  // person waiting is the one already reporting a fault. Note that this is also why a script may
  // not address „Weiter" by name across a held save — for that moment it is not called that.
  check(
    '…und die Übergabe wartet darauf, statt einen Namen zu raten',
    (await u.locator('.fixed.inset-0').count()) === 1 &&
      (await topDialog(u).getByRole('button', { name: 'Speichert…' }).isDisabled()),
  );
  await u.evaluate(() => /** @type {any} */ (window).__finishSave());
  const file2 = `Auftakt-Diagnose-${ref}-2.txt`;
  const renamed = await until(() => topDialog(u).innerText(), (t) => t.includes(file2), 8000);
  // `file` is not a substring of `file2` — `…AF-….txt` against `…AF-…-2.txt` — so „the first one
  // is not mentioned" is a real assertion rather than one the second name satisfies anyway.
  check('dann nennt sie die zweite Datei, nicht die erste', renamed.includes(file2) && !renamed.includes(file), file2);
  const body2 = await copy('Text kopieren', (t) => t.includes('-2.txt'));
  check(
    '…und der kopierte Text hängt dieselbe zweite Datei an',
    body2.split('\n')[0] === `!! BITTE NOCH ANHÄNGEN: ${file2}`,
    body2.split('\n')[0],
  );

  // Taking the correction back is the one step a single remembered text cannot pass: `written`
  // is keyed by the report text, so a text already on the desktop is a *lookup* — the first
  // bundle holds exactly it — and the earlier cache hits do not prove that, because there the
  // remembered name and the predictable one are the same string. Here they differ, and a third
  // write would also still be held: the handover would simply never open.
  await topDialog(u).getByRole('button', { name: 'Zurück' }).click();
  await u.locator('textarea').nth(0).fill('Der Druckbogen bleibt leer.');
  await topDialog(u).getByRole('button', { name: 'Weiter' }).click();
  const reverted = await until(() => topDialog(u).innerText(), (t) => t.includes(file), 8000);
  check(
    'ein zurückgenommener Text nennt wieder die erste Datei und schreibt keine dritte',
    reverted.includes(file) && !reverted.includes(file2) && (await u.evaluate(() => /** @type {any} */ (window).__saved)).length === 2,
    file,
  );
  const bodyBack = await copy('Text kopieren', (t) => t.startsWith('!!') && !t.includes('-2.txt'));
  check('…und der kopierte Text hängt sie an, nicht die zweite', bodyBack.split('\n')[0] === `!! BITTE NOCH ANHÄNGEN: ${file}`, bodyBack.split('\n')[0]);

  await topDialog(u).getByRole('button', { name: 'Fertig' }).click();
  check('der Hinweis nennt die Datei beim Namen', await shown(toast(u, new RegExp(file))));
  await u.close();
}
