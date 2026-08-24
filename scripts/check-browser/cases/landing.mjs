/** AP–AS · the landing page and its two conflicting blobs */

import { sleep } from '../../lib/wait.mjs';
import { stubElectron } from '../bridge.mjs';
import { clickIfThere, open, pin, ready, seasonPin, surfaceSettled, toast, topDialog, until, windows } from '../browser.mjs';
import { EDITOR_GONE_MS, FIXTURE, NO_MATCH, RUN, SETTLED_MS } from '../config.mjs';
import { check } from '../report.mjs';
import { api, jsonOr, scoped, send } from '../stack.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runLanding(fixtures) {
  const { context, heldRoutes, landingSeason } = fixtures;
  // ======================================================================== AP · the landing page
  //
  // `#/` is not `#/dashboard`: no task tiles and no „Nächste Termine", but a card per registry
  // entry and, under them, the content that belongs to no season at all — Notizen, Dokumente and
  // the user's own Bereiche, one blob in `seasons.json`. Case D lands here after a season death
  // and asserts the toast and the dropped pin; this is the page itself.
  //
  // The bridge stub is not decoration here. A landing document's label is a `<button>` handing its
  // URL to `openExternal`, and with no `window.auftakt` that falls through to `window.open` — a
  // real tab, from whoever runs this. The recorder is also the only instrument that can watch
  // `normalizeUrl` run on the way *out* (CCL-09).
  console.log('\nAP · Die Startseite: Karten, Kennzahlen und die zwei Dokumentenlisten');
  const lp = await open(context, '/', (page) => stubElectron(page));

  /** The landing blob as the server has it. Every expectation below is computed from this. */
  const lpBlob = () => api('/landing');
  /** „2026-08-24 11:14:39" → „24.08.2026" — `formatDate`'s output, spelled out rather than
   *  imported: this file may not reach into `client/src`, and a literal date would go stale. */
  const lpDay = (iso) => String(iso ?? '').slice(0, 10).split('-').reverse().join('.');

  /**
   * Every `[data-section]` cell with the width the arranger gave it. Both attributes are stamped
   * outside „anordnen" mode as well, which is what makes the arrangement readable without
   * entering it.
   */
  const lpSections = (page) =>
    page
      .locator('[data-section]')
      .evaluateAll((els) =>
        els.map((el) => `${el.getAttribute('data-section')}:${el.getAttribute('data-width')}`),
      );

  /**
   * One season card, taken apart. Read in a single `evaluateAll` so every field of a card comes
   * from one layout — and addressed by structure rather than by position in the grid, because the
   * grid is the whole registry and this run has put a dozen fixture seasons in it.
   *
   * `button[title^="Bearbeiten"]` is `EditableFallbackText`, and a card has exactly two: the
   * subtitle line and the Zeitraum line, in that order. `div.rounded-xl` is `Stat`'s tile —
   * `Card` itself is `rounded-2xl`.
   */
  const lpCards = (page) =>
    page.locator('[role="button"][aria-label$="öffnen"]').evaluateAll((els) =>
      els.map((el) => {
        const auto = [...el.querySelectorAll('button[title^="Bearbeiten"]')].map((b) =>
          (b.textContent ?? '').trim(),
        );
        return {
          aria: el.getAttribute('aria-label') ?? '',
          title: (el.querySelector('h3')?.textContent ?? '').trim(),
          aktiv: [...el.querySelectorAll('span')].some((s) => (s.textContent ?? '').trim() === 'Aktiv'),
          stats: [...el.querySelectorAll('div.rounded-xl')].map((d) =>
            (d.firstElementChild?.textContent ?? '').trim(),
          ),
          subtitle: auto[0] ?? '',
          period: auto[1] ?? '',
        };
      }),
    );

  /**
   * The rows of one document list. `openable` is the row's *text-carrying* buttons: the ✎ and 🗑
   * are icons with no text at all, so a row whose label appears here is one whose label is a
   * button — which is exactly the distinction a missing URL makes.
   */
  const lpRows = (page, key) =>
    page.locator(`[data-section="${key}"] li`).evaluateAll((els) =>
      els.map((el) => ({
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        openable: [...el.querySelectorAll('button')]
          .map((b) => (b.textContent ?? '').trim())
          .filter(Boolean),
      })),
    );

  const lpStart = await lpBlob();
  const lpTextSection = lpStart.sections.find((s) => s.type === 'text');
  const lpLinkSection = lpStart.sections.find((s) => s.type === 'links');
  // A precondition, not a detector: every assertion below is computed from `lpStart`, and this is
  // what says the blob it was computed from is the demo's own rather than an earlier case's
  // leftovers. The landing content is the one store no fixture season can isolate.
  check(
    'Vorbedingung: die Ablage der Startseite ist die der Demo — drei Dokumente, zwei Bereiche, keine gespeicherte Anordnung',
    lpStart.documents.length === 3 &&
      lpStart.documents.filter((d) => d.url === null).length === 1 &&
      lpStart.sections.length === 2 &&
      !!lpTextSection &&
      !!lpLinkSection &&
      lpStart.layout.length === 0,
    `${lpStart.documents.length} Dokumente, ${lpStart.sections.length} Bereiche, layout ${JSON.stringify(lpStart.layout)}, rev ${lpStart.rev}`,
  );

  const lpLaid = await until(() => lpSections(lp), (s) => s.length >= 5, 8000);
  check(
    'ohne gespeicherte Anordnung steht die Vorgabe da — und die beiden eigenen Bereiche dahinter',
    lpLaid.join(' ') ===
      `saisons:full notizen:half dokumente:half lt${lpTextSection?.id}:full lt${lpLinkSection?.id}:full`,
    lpLaid.join(' ') || 'kein Bereich',
  );

  const lpRegistry = await api('/seasons');
  const lpStats = await api('/seasons/stats');
  // The predicate carries the tiles as well as the count: `Stat` renders „–" until `seasonStats`
  // has answered, and a card read in that state reports three dashes for a season that has rows.
  const lpAllCards = await until(
    () => lpCards(lp),
    (c) => c.length === lpRegistry.seasons.length && c.every((x) => !x.stats.includes('–')),
    12_000,
  );
  // The detail names the *first* disagreement rather than all sixteen labels: this run has put a
  // dozen fixture seasons into the registry, and a line that prints them all is unreadable in
  // exactly the moment it matters.
  const lpOffBy = lpRegistry.seasons.findIndex((s, i) => lpAllCards[i]?.title !== s.label);
  check(
    'die Karten sind die ganze Registry, in ihrer Reihenfolge — die Saisons dieses Laufs eingeschlossen',
    lpAllCards.length === lpRegistry.seasons.length && lpOffBy === -1,
    `${lpAllCards.length} Karten von ${lpRegistry.seasons.length}` +
      (lpOffBy === -1
        ? ', in der Reihenfolge der Registry'
        : `, ab Position ${lpOffBy}: „${lpAllCards[lpOffBy]?.title ?? '—'}“ statt „${lpRegistry.seasons[lpOffBy].label}“`),
  );
  // „this window's season" is `useCurrentSeasonId`'s rule spelled out — the pin if there is one,
  // the registry default otherwise — and not the registry default alone, which would agree with
  // it here and stop agreeing the moment a case leaves a pinned window on this page.
  const lpMineId = Number((await seasonPin(lp)) ?? lpRegistry.activeId);
  check(
    '„Aktiv“ trägt genau die Karte, auf der dieses Fenster steht',
    lpAllCards.filter((c) => c.aktiv).length === 1 &&
      lpAllCards.find((c) => c.aktiv)?.title ===
        lpRegistry.seasons.find((s) => s.id === lpMineId)?.label,
    `${lpAllCards.filter((c) => c.aktiv).map((c) => c.title).join(' | ') || 'keine'} bei Saison ${lpMineId}`,
  );

  // The demo's own three — „not a fixture of this run" is the only handle that survives the run
  // creating a dozen more — and each of them taken by the property that makes it the fixture it
  // is, never by its position in the registry: the copy that carries both overrides, the one with
  // no events at all, and the full original as the one that is neither.
  const lpDemoSeasons = lpRegistry.seasons.filter((s) => !s.label.startsWith(FIXTURE));
  const lpS2 = lpDemoSeasons.find((s) => s.subtitle && s.period);
  const lpS3 = lpDemoSeasons.find((s) => lpStats[s.id]?.firstEvent === null);
  const lpS1 = lpDemoSeasons.find((s) => s.id !== lpS2?.id && s.id !== lpS3?.id);
  const lpTrio = [lpS1, lpS2, lpS3];
  const lpTrioCards = lpTrio.map((s) => lpAllCards.find((c) => c.aria.includes(s?.label ?? NO_MATCH)));
  const [lpC1, lpC2, lpC3] = lpTrioCards;
  // A precondition rather than a detector, like the blob check above: it is what says the three
  // roles below really are three different seasons, and every card assertion after it depends on
  // that. No revert of an existing fix takes it red on its own.
  check(
    'die drei Saisons der Demo sind drei verschiedene Rollen und haben je eine Karte',
    lpDemoSeasons.length === 3 &&
      new Set(lpTrio.map((s) => s?.id)).size === 3 &&
      lpTrioCards.every(Boolean),
    `voll ${lpS1?.label}, mit Überschreibungen ${lpS2?.label}, ohne Termine ${lpS3?.label}`,
  );
  check(
    'jede Karte nennt die Kennzahlen ihrer eigenen Saison',
    lpTrio.every(
      (s, i) =>
        lpTrioCards[i]?.stats.join('/') ===
        `${lpStats[s?.id]?.artists}/${lpStats[s?.id]?.projects}/${lpStats[s?.id]?.openTasks}`,
    ),
    lpTrio.map((s, i) => `${s?.label}: ${lpTrioCards[i]?.stats.join('/')}`).join(' | '),
  );
  // The discriminator: 2027 was copied from 2026 *without* tasks, so the two cards agree on the
  // first two numbers and differ on the third. A check against 2028 alone — where all three are 0
  // — would also pass on a build that renders one season's numbers on every card.
  check(
    'die kopierte Saison zeigt dieselben Künstler und Projekte und keine einzige offene Aufgabe',
    lpC1?.stats[0] === lpC2?.stats[0] &&
      lpC1?.stats[1] === lpC2?.stats[1] &&
      lpC1?.stats[2] !== '0' &&
      lpC2?.stats[2] === '0',
    `${lpC1?.stats.join('/')} gegen ${lpC2?.stats.join('/')} gegen ${lpC3?.stats.join('/')}`,
  );
  check(
    'wo ein eigener Untertitel steht, steht er — sonst „Angelegt am“ mit dem Datum des Servers',
    lpC2?.subtitle === lpS2?.subtitle &&
      lpC1?.subtitle === `Angelegt am ${lpDay(lpS1?.createdAt)}` &&
      lpC3?.subtitle === `Angelegt am ${lpDay(lpS3?.createdAt)}`,
    `${lpC1?.subtitle} | ${lpC2?.subtitle} | ${lpC3?.subtitle}`,
  );
  // The pair that makes „der eingetragene schlägt den automatischen" mean something: 2027's copied
  // events give it *exactly* 2026's range, so the two cards would read alike if the override were
  // ignored. Against 2028, which has no events at all, the same line passes either way.
  check(
    'der eingetragene Zeitraum schlägt den automatischen, obwohl es einen gäbe',
    lpC2?.period === lpS2?.period &&
      lpStats[lpS1?.id]?.firstEvent === lpStats[lpS2?.id]?.firstEvent &&
      lpStats[lpS1?.id]?.lastEvent === lpStats[lpS2?.id]?.lastEvent &&
      lpC1?.period === `${lpDay(lpStats[lpS1?.id]?.firstEvent)} – ${lpDay(lpStats[lpS1?.id]?.lastEvent)}` &&
      lpC1?.period !== lpC2?.period,
    `${lpC1?.period} gegen ${lpC2?.period} (beide ${lpStats[lpS1?.id]?.firstEvent}–${lpStats[lpS1?.id]?.lastEvent})`,
  );
  check(
    '…und ohne einen einzigen Termin steht dort „Noch keine Termine“, nicht ein leerer Zeitraum',
    lpC3?.period === 'Noch keine Termine' && lpStats[lpS3?.id]?.firstEvent === null,
    `${lpC3?.period} bei firstEvent ${JSON.stringify(lpStats[lpS3?.id]?.firstEvent)}`,
  );

  const lpDocRows = await until(
    () => lpRows(lp, 'dokumente'),
    (r) => r.length === lpStart.documents.length,
    8000,
  );
  // This one compares the DOM against the server's *own* array, so it is blind to a server-side
  // list bug by construction — which is the right contract for a list (its job is to render what
  // it was given) and the reason it is an invariant guard rather than a regression detector. The
  // stored list is AQ's and AR's ground.
  check(
    'die Dokumente-Liste zeigt genau die gespeicherten Zeilen, in ihrer Reihenfolge',
    lpDocRows.length === lpStart.documents.length &&
      lpStart.documents.every((d, i) => lpDocRows[i]?.text.includes(d.label)),
    lpDocRows.map((r) => r.text).join(' | ') || 'keine Zeile',
  );
  check(
    'die Zeile ohne Adresse ist kein Knopf — und sagt daneben, warum',
    lpStart.documents.every((d, i) =>
      d.url
        ? lpDocRows[i]?.openable.includes(d.label) && !lpDocRows[i]?.text.includes('kein Link')
        : !lpDocRows[i]?.openable.includes(d.label) &&
          lpDocRows[i]?.text.includes('(kein Link hinterlegt)'),
    ),
    lpDocRows.map((r) => `${r.text} → ${JSON.stringify(r.openable)}`).join(' | '),
  );

  const lpLtRows = await until(
    () => lpRows(lp, `lt${lpLinkSection?.id}`),
    (r) => r.length === (lpLinkSection?.documents ?? []).length,
    8000,
  );
  // An invariant guard too, and the thing it forbids is the two lenses being wired to one array:
  // the builtin list writes `landing.documents`, a custom Dokumente-Bereich writes the `documents`
  // inside its own section row, and nothing may render the other's rows. Same for the two lines
  // below it — a Textfeld showing its stored text, a Notiz rendered rather than printed as source.
  check(
    'der eigene Dokumente-Bereich führt seine eigenen Zeilen — und die beiden Listen mischen sich nicht',
    lpLtRows.length === (lpLinkSection?.documents ?? []).length &&
      (lpLinkSection?.documents ?? []).every((d, i) => lpLtRows[i]?.text.includes(d.label)) &&
      (lpLinkSection?.documents ?? []).every((d) => !lpDocRows.some((r) => r.text.includes(d.label))) &&
      lpStart.documents.every((d) => !lpLtRows.some((r) => r.text.includes(d.label))),
    `${lpLtRows.map((r) => r.text).join(' | ')} neben ${lpDocRows.map((r) => r.text).join(' | ')}`,
  );

  const lpTextCard = await lp
    .locator(`[data-section="lt${lpTextSection?.id}"]`)
    .innerText()
    .catch(() => '');
  check(
    'das eigene Textfeld steht unter seiner eigenen Überschrift',
    lpTextCard.includes(lpTextSection?.value ?? NO_MATCH) &&
      lpTextCard.toUpperCase().includes((lpTextSection?.name ?? NO_MATCH).toUpperCase()),
    lpTextCard.replace(/\s+/g, ' ').slice(0, 90) || 'leer',
  );
  const lpNotesHtml = await lp
    .locator('[data-section="notizen"] .prose-md')
    .first()
    .innerHTML()
    .catch(() => '');
  check(
    'die Notiz steht als Markdown auf der Seite, nicht als Quelltext',
    lpNotesHtml.includes('<strong>') &&
      /<a [^>]*href="https:\/\/[^"]+"/.test(lpNotesHtml) &&
      !lpNotesHtml.includes('**') &&
      !lpNotesHtml.includes(']('),
    lpNotesHtml.replace(/\s+/g, ' ').slice(0, 110) || 'keine Notiz',
  );

  // The one thing the demo cannot show: every stored URL already carries a scheme, so „normalised
  // on the way out" (CCL-09) needs a row written without one. Straight to the API — an omitted
  // `rev` writes unconditionally by design — and then a real `reload()`, because a hash navigation
  // does not refetch what was changed behind the page's back.
  const lpBare = { label: `Ohne Schema ${RUN}`, url: `example.org/${RUN}.pdf` };
  await send('PATCH', '/landing', { documents: [...lpStart.documents, lpBare] });
  await lp.reload();
  await ready(lp);
  const lpRecorded = () => lp.evaluate(() => /** @type {any} */ (window).__external ?? []);
  const lpBareRow = lp
    .locator('[data-section="dokumente"] li')
    .filter({ hasText: lpBare.label })
    .first();
  const lpBareClicked = await clickIfThere(lpBareRow.getByRole('button', { name: lpBare.label }));
  const lpOpened = await until(lpRecorded, (u) => u.length > 0, 6000);
  check(
    'ein Klick auf eine Zeile reicht die Adresse mit Schema an die Brücke — auch wo keins gespeichert ist (CCL-09)',
    lpBareClicked && lpOpened.length === 1 && lpOpened[0] === `https://${lpBare.url}`,
    `geklickt ${lpBareClicked}, ${JSON.stringify(lpOpened)} bei gespeichertem „${lpBare.url}“`,
  );
  // The other half of the pair. Clicking the *label* of the row that has no URL, not the row —
  // the ✎ and 🗑 sit at the row's right edge and `click()` aims at its centre, and a row whose
  // label really did become a button has no `span.font-medium` left to aim at either, which is
  // what canary 19 reads back as `geklickt false`.
  const lpNoUrl = lpStart.documents.find((d) => d.url === null);
  const lpBlankClicked = await clickIfThere(
    lp
      .locator('[data-section="dokumente"] li')
      .filter({ hasText: lpNoUrl?.label ?? NO_MATCH })
      .first()
      .locator('span.font-medium'),
  );
  await sleep(500); // „nothing was handed over" cannot be waited *for*; a beat and then a read
  const lpStillOpened = await lpRecorded();
  // The count is asserted as **one**, not as „unchanged": `0 === 0` is what the poll above leaves
  // behind when the row with an address handed over nothing either, and a pair that compares the
  // two readings to each other is then green in exactly the state its partner is red in. Canary 10
  // is that state, and this line stayed green through it.
  check(
    '…und die Zeile ohne Adresse reicht nichts weiter, weil dort kein Knopf ist',
    lpBlankClicked && lpOpened.length === 1 && lpStillOpened.length === 1,
    `geklickt ${lpBlankClicked}, ${JSON.stringify(lpStillOpened)} (vorher ${lpOpened.length})`,
  );

  // The card's own editors. `EditableFallbackText` shows the automatic line until an override is
  // stored and treats an *emptied* field as taking the override back — the reset semantics, not an
  // empty string. Driven on this run's own empty season so the demo's three cards stay as asserted
  // above; anchored on the text each button currently shows rather than on its position.
  const lpOwnCard = () =>
    lpCards(lp).then((c) => c.find((x) => x.aria.includes(landingSeason.label)));
  const lpOwnBefore = await until(lpOwnCard, (c) => !!c && !c.stats.includes('–'), 10_000);
  const lpOwnSeason = lpRegistry.seasons.find((s) => s.id === landingSeason.id);
  check(
    'die leere Saison dieses Laufs startet auf beiden Ersatztexten',
    lpOwnBefore?.subtitle === `Angelegt am ${lpDay(lpOwnSeason?.createdAt)}` &&
      lpOwnBefore?.period === 'Noch keine Termine' &&
      lpOwnBefore?.stats.join('/') === '0/0/0',
    `${lpOwnBefore?.subtitle} · ${lpOwnBefore?.period} · ${lpOwnBefore?.stats.join('/')}`,
  );
  const lpCardEl = lp
    .locator('[role="button"][aria-label$="öffnen"]')
    .filter({ hasText: landingSeason.label })
    .first();
  /**
   * Open the card's Zeitraum editor, type, commit — and **wait for the editor to go away**.
   *
   * That last step is the whole point (`EDITOR_GONE_MS`, see there). While the `InlineInput` is
   * open the card has no „Bearbeiten" button to read the line off, so `lpOwnCard().period` is `''`
   * and a poll on the expected text simply runs out — for as long as the write's blanket
   * `invalidate()` takes, which is not a property of this page at all.
   */
  const lpPeriodEdit = async (shows, type) => {
    const opened = await clickIfThere(
      lpCardEl.locator('button[title^="Bearbeiten"]').filter({ hasText: shows }),
    );
    const box = lpCardEl.locator('input').first();
    await box.fill(type).catch(() => {});
    await box.press('Enter').catch(() => {});
    const closed = await surfaceSettled(lp, lpCardEl.locator('input'));
    return { opened, closed, ok: opened && closed !== 'offen' };
  };
  const lpTyped = `Sommer ${RUN}`;
  // Not `null`: an unpinned window adopts the season the server echoed on its first request
  // (`pinFromResponse`), so „no switch happened" is this pin *unchanged*, not the absence of one.
  const lpPinBefore = await seasonPin(lp);
  const lpEdit = await lpPeriodEdit('Noch keine Termine', lpTyped);
  const lpStored = await until(
    () => api('/seasons').then((r) => r.seasons.find((s) => s.id === landingSeason.id)?.period),
    (v) => v === lpTyped,
    SETTLED_MS,
  );
  const lpOwnAfter = await until(lpOwnCard, (c) => c?.period === lpTyped, SETTLED_MS);
  check(
    'der Zeitraum lässt sich auf der Karte selbst eintragen und steht dann statt des automatischen Textes',
    lpEdit.ok && lpStored === lpTyped && lpOwnAfter?.period === lpTyped,
    `geöffnet ${lpEdit.opened}, Editor ${lpEdit.closed}, gespeichert ${JSON.stringify(lpStored)}, Karte „${lpOwnAfter?.period}“`,
  );
  // The editors stop the click from reaching the card, which is a `role="button"` that opens the
  // season — and opening one is `switchSeason`: a repin to *this* card's season plus a document
  // reload onto `#/dashboard`. So the pair is the hash and the pin, and the pin discriminates.
  // An invariant guard (nothing may start propagating), but not a theoretical one: the first draft
  // of this case asserted the pin was `null` and this line is what found `pinFromResponse`.
  const lpHashAfter = await lp.evaluate(() => location.hash);
  const lpPinAfter = await seasonPin(lp);
  check(
    '…ohne dass die Karte darunter die Saison geöffnet hätte',
    lpHashAfter === '#/' && lpPinAfter === lpPinBefore && lpPinAfter !== String(landingSeason.id),
    `${lpHashAfter}, Pin ${JSON.stringify(lpPinBefore)} → ${JSON.stringify(lpPinAfter)} (Karte ${landingSeason.id})`,
  );
  const lpClear = await lpPeriodEdit(lpTyped, '');
  const lpCleared = await until(
    () => api('/seasons').then((r) => r.seasons.find((s) => s.id === landingSeason.id)?.period),
    (v) => v == null,
    SETTLED_MS,
  );
  const lpOwnBack = await until(lpOwnCard, (c) => c?.period === 'Noch keine Termine', SETTLED_MS);
  check(
    'leer lassen ist eine Rücknahme, kein leerer Eintrag: der automatische Text kommt zurück',
    lpClear.ok && lpCleared == null && lpOwnBack?.period === 'Noch keine Termine',
    `geöffnet ${lpClear.opened}, Editor ${lpClear.closed}, gespeichert ${JSON.stringify(lpCleared)}, Karte „${lpOwnBack?.period}“`,
  );

  // Closed here, and the same at the foot of AQ, AR and AS. Every open page refetches on every
  // broadcast, and a page on `#/` refetches `seasonStats`, which opens **all sixteen** season
  // files — so a landing window left behind makes the next landing case's writes slower for no
  // reason. Nothing below reads `lp` again.
  await lp.close().catch(() => {});

  // ======================================================================== AQ · the 409, merged
  //
  // A landing PATCH replaces whole arrays, so every mutation is computed from a read — and two
  // windows computing from the *same* read used to destroy each other's rows, with no Papierkorb
  // behind `seasons.json`. The server stamps a generation and refuses a patch built on a
  // superseded one; `useLanding().update` re-applies the *intent* to what the 409 handed back
  // (WP-53). `check:api` owns that exchange as an exchange; this is the half a browser has to
  // answer for — that the app's own write paths really are intents, and that the user sees both
  // changes and no complaint.
  //
  // The staging is the trap out of docs/VERIFYING.md: hold the losing window's **write**, never
  // its read (a held GET is superseded by the invalidate the other window broadcasts, and the run
  // measures zero conflicts). And hold it with a gate rather than a sleep, so the winner's write is
  // *known* to have landed — and only the first attempt, or the retry pays the hold too.
  console.log('\nAQ · Zwei Fenster, eine Ablage: der Konflikt wird nachgerechnet (WP-53)');
  const [lq1, lq2] = await windows(context, 2, '/');

  /** @type {Array<{ rev?: number, body?: string, status?: number }>} */
  const lqLog = [];
  // Never `await` inside these: a response handler that parses its body first reports out of
  // order, and the order request → answer → request is what the assertions below read.
  lq1.on('request', (r) => {
    if (r.url().includes('/api/landing') && r.method() === 'PATCH') {
      const body = r.postData() ?? '{}';
      lqLog.push({ rev: jsonOr(body).rev, body });
    }
  });
  lq1.on('response', (r) => {
    if (r.url().includes('/api/landing') && r.request().method() === 'PATCH') {
      lqLog.push({ status: r.status() });
    }
  });
  const lqSent = () => lqLog.filter((e) => e.body !== undefined);
  const lqGot = () => lqLog.filter((e) => e.status !== undefined);

  /**
   * Remember every toast this page ever showed, rather than reading the stack at the end.
   *
   * „The conflict was re-applied and said nothing" is an assertion about the whole round, and the
   * end of the round is exactly where it cannot be made: toasts dismiss themselves after six
   * seconds, and a round that goes wrong is a round that spends its time in poll timeouts — so a
   * complaint really was raised, and it had expired by the time anyone looked. An observer records
   * it while it is up. Installed after the page is open, which a `MutationObserver` allows and an
   * init script does not.
   */
  const lqWatchToasts = (page) =>
    page.evaluate(() => {
      const w = /** @type {any} */ (window);
      w.__toasts = [];
      const sweep = () => {
        for (const el of document.querySelectorAll('.pointer-events-auto')) {
          const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (text && !w.__toasts.includes(text)) w.__toasts.push(text);
        }
      };
      new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true });
      sweep();
    });
  const lqToastsSeen = (page) => page.evaluate(() => /** @type {any} */ (window).__toasts ?? []);
  await lqWatchToasts(lq1);
  await lqWatchToasts(lq2);

  /**
   * Park the next landing PATCH from `page` until the returned `release()` is called. One shot:
   * the retry has to run at full speed, or the case measures its own hold twice and reports a
   * timeout for a mechanism that worked.
   */
  const lqHoldPatch = (page, path) => {
    /** @type {{ held: boolean, release: (v?: unknown) => void }} */
    const state = { held: false, release: () => {} };
    const gate = new Promise((r) => {
      state.release = r;
    });
    heldRoutes.push(state);
    return page
      .route(path, async (route) => {
        if (route.request().method() === 'PATCH' && !state.held) {
          state.held = true;
          await gate;
        }
        // Guarded: a handler still parked when its `unroute` runs rejects with „Route is already
        // handled", and a route callback is outside this file's try — that rejection ends the
        // whole process instead of failing one line (docs/VERIFYING.md).
        await route.continue().catch(() => {});
      })
      .then(() => state);
  };

  const lpAddDoc = async (page, key, label) => {
    const opened = await clickIfThere(
      page.locator(`[data-section="${key}"]`).getByRole('button', { name: '+ Dokument' }),
    );
    const dlg = topDialog(page);
    await dlg.getByPlaceholder('z. B. Fördervertrag').fill(label).catch(() => {});
    const saved = await clickIfThere(dlg.getByRole('button', { name: 'Speichern' }));
    return opened && saved;
  };

  const lqBase = await lpBlob();
  const lqA = `Aus Fenster A ${RUN}`;
  const lqB = `Aus Fenster B ${RUN}`;
  const lqHold = await lqHoldPatch(lq1, '**/api/landing');
  const lqAAdded = await lpAddDoc(lq1, 'dokumente', lqA);
  await until(async () => lqHold.held, (v) => v === true, SETTLED_MS);
  // The two lines around the release are the staging, not the finding: they say the race was
  // really set up — the dialog was driven, the write is parked, the other window wrote in the
  // same generation — so that everything after them is about the conflict rather than about a
  // click that never landed. Neither is a regression detector on its own.
  check(
    'das erste Fenster hängt an seinem eigenen Schreibvorgang',
    lqAAdded && lqHold.held,
    `Dialog bedient ${lqAAdded}, gehalten ${lqHold.held}`,
  );
  const lqBAdded = await lpAddDoc(lq2, 'dokumente', lqB);
  const lqAfterB = await until(lpBlob, (l) => l.documents.some((d) => d.label === lqB), SETTLED_MS);
  check(
    '…während das zweite in derselben Generation schreibt und sie damit weiterdreht',
    lqBAdded &&
      lqAfterB.rev === lqBase.rev + 1 &&
      lqAfterB.documents.some((d) => d.label === lqB) &&
      !lqAfterB.documents.some((d) => d.label === lqA),
    `rev ${lqBase.rev} → ${lqAfterB.rev}: ${lqAfterB.documents.map((d) => d.label).join(' | ')}`,
  );
  lqHold.release();
  const lqMerged = await until(lpBlob, (l) => l.documents.some((d) => d.label === lqA), SETTLED_MS);
  await lq1.unroute('**/api/landing');
  // Everything below reads the DOM, which works through a backdrop — and these two windows keep
  // one. See the second half for why it is never waited for.

  check(
    'der erste Versuch trägt die Generation, die beide Fenster gelesen hatten — und wird abgelehnt',
    lqSent()[0]?.rev === lqBase.rev && lqGot()[0]?.status === 409,
    `rev ${lqSent()[0]?.rev} (gelesen ${lqBase.rev}) → ${lqGot()[0]?.status}`,
  );
  check(
    'der zweite trägt die des Gewinners und wird genommen — zwei Versuche, kein dritter',
    lqSent().length === 2 && lqSent()[1]?.rev === lqAfterB.rev && lqGot()[1]?.status === 200,
    `${lqSent().map((s) => s.rev).join(' → ')} beantwortet mit ${lqGot().map((g) => g.status).join('/')}`,
  );
  // The line that tells „the conflict was re-applied" from „the timing slipped and there was
  // none": the two request bodies. An intent recomputed over the winner's list carries the
  // winner's row; a snapshot replayed would be the first body again (which is what case AQ's
  // second half asserts of the one landing write that really is a snapshot).
  const lqFirstDocs = jsonOr(lqSent()[0]?.body).documents?.map((d) => d.label) ?? [];
  const lqRetryDocs = jsonOr(lqSent()[1]?.body).documents?.map((d) => d.label) ?? [];
  check(
    'der zweite Rumpf ist nicht der erste noch einmal: die Absicht wurde auf die Liste des Gewinners neu angewandt',
    !lqFirstDocs.includes(lqB) &&
      lqRetryDocs.includes(lqB) &&
      lqRetryDocs[lqRetryDocs.length - 1] === lqA &&
      lqRetryDocs.length === lqFirstDocs.length + 1,
    `${lqFirstDocs.join(' / ')}  →  ${lqRetryDocs.join(' / ')}`,
  );
  check(
    'beide Zeilen stehen am Ende in der Ablage, in der Reihenfolge, in der sie geschrieben wurden',
    lqMerged.documents.map((d) => d.label).join('|') ===
      [...lqBase.documents.map((d) => d.label), lqB, lqA].join('|'),
    lqMerged.documents.map((d) => d.label).join(' | '),
  );
  const lqOnScreen = await until(
    () => lpRows(lq1, 'dokumente'),
    (r) => r.some((x) => x.text.includes(lqA)) && r.some((x) => x.text.includes(lqB)),
    SETTLED_MS,
  );
  check(
    '…und beide auf dem Schirm des Fensters, dessen Schreibvorgang abgelehnt worden war',
    lqOnScreen.some((r) => r.text.includes(lqA)) && lqOnScreen.some((r) => r.text.includes(lqB)),
    lqOnScreen.map((r) => r.text).join(' | ') || 'keine Zeile',
  );
  // „Nothing was said" cannot be waited *for*, so it is a beat and then a read — of the recorder
  // above, which has been watching since before the first click. Case AR shows the same wording
  // being raised for real when the budget runs out.
  await sleep(700);
  const lqToasts = [...(await lqToastsSeen(lq1)), ...(await lqToastsSeen(lq2))];
  check(
    'ein nachgerechneter Konflikt sagt dem Benutzer in keinem der beiden Fenster etwas',
    lqToasts.length === 0,
    lqToasts.join(' | ') || 'kein Hinweis',
  );

  // The second half: the one landing write that stays a *snapshot*, and deliberately so —
  // `SectionArranger` computes the whole array from what it rendered, so there is no „apply my
  // change to yours" to express. Routing it through `update` all the same is what keeps its patch
  // to `layout` alone: last-one-wins for the arrangement, while the other window's document rides
  // through untouched. Before WP-53 that write carried a stale `documents` array with it (SHL-01).
  //
  // This drives the arranger's width toggle and nothing else — the ⠿ inside it, like the one in
  // the document lists, is #109's ground.
  //
  // **Two fresh windows, not the two above.** The dialog the first pair opened closes only when
  // its write's promise resolves, and that promise awaits a blanket `invalidate()` whose refetches
  // — fanned out over every window this gate has open, on one Express process — can stay pending
  // for minutes on a slow runner: measured on CI as *still open after sixty seconds*, with no
  // error toast, i.e. not a refused write but an unsettled one. A backdrop eats the arrange click,
  // and the whole second half then fails for a reason that has nothing to do with it — which is
  // exactly how this case failed on `main`. A conflict between two windows does not care *which*
  // two, so it gets a pair with nothing in flight instead of a longer wait.
  //
  // Closed **before** the new pair opens, not after the case: this file's own rule is that a window
  // left open costs every later case, and `lq1` is precisely the window holding a pending blanket
  // `invalidate()` at this moment — the starvation the round below is being protected from. Nothing
  // reads either of them after the toast line above.
  //
  // Closing a page mid-flight aborts its in-flight refetches, and `page.on('pageerror')` is still
  // attached: believed silent, because an aborted fetch surfaces inside React Query's own retry
  // path and, for the write, inside `useGuardedAction`'s catch — neither reaches `window.onerror`.
  // Written down rather than assumed, so a future teardown flake finds its diagnosis here.
  for (const page of [lq1, lq2]) await page.close().catch(() => {});
  const [lq3, lq4] = await windows(context, 2, '/');
  /** @type {Array<{ rev?: number, body?: string, status?: number }>} */
  const lqLog2 = [];
  lq3.on('request', (r) => {
    if (r.url().includes('/api/landing') && r.method() === 'PATCH') {
      const body = r.postData() ?? '{}';
      lqLog2.push({ rev: jsonOr(body).rev, body });
    }
  });
  lq3.on('response', (r) => {
    if (r.url().includes('/api/landing') && r.request().method() === 'PATCH') {
      lqLog2.push({ status: r.status() });
    }
  });
  const lqArrangeOpen = await clickIfThere(
    lq3.getByRole('button', { name: '✎ Bereiche bearbeiten' }),
    SETTLED_MS,
  );
  // Scoped to the strip itself — the grey control row the arranger puts *above* each section while
  // it is arranging — and not to the section. `saisons` contains the whole card grid, so a
  // `[data-section] button` read there is fifty pencils long and answers the wrong question.
  // `disabled` is read with the name, because on this page the ▲▼ are *present and dead*: the
  // season grid is `toolbarAfterKey`, so `anchorIdx` is its index and both arrows fall into
  // `SectionArranger`'s anchor rule. A check that only asks whether the button exists says the
  // opposite of what is true.
  const lqStrip = await until(
    () =>
      lq3.locator('[data-section]').evaluateAll((els) =>
        els.map((el) => ({
          key: el.getAttribute('data-section'),
          btns: [...(el.querySelector(':scope > div.rounded-lg.bg-neutral-100')?.querySelectorAll('button') ?? [])].map(
            (b) => ({
              name: b.getAttribute('title') ?? b.getAttribute('aria-label') ?? '',
              disabled: /** @type {HTMLButtonElement} */ (b).disabled,
            }),
          ),
        })),
      ),
    (s) => s.some((x) => x.btns.some((b) => b.name === 'Breite umschalten')),
    SETTLED_MS,
  );
  const lqSaisonsStrip = lqStrip.find((x) => x.key === 'saisons');
  const lqNotizenStrip = lqStrip.find((x) => x.key === 'notizen');
  /** One strip's controls as „Name" / „Name (aus)" — short enough to read on a failure line. */
  const lqStripText = (s) =>
    (s?.btns ?? []).map((b) => `${b.name}${b.disabled ? ' (aus)' : ''}`).join(' · ') || 'keine';
  const lqCtl = (s, name) => (s?.btns ?? []).find((b) => b.name === name);
  // The whole anchor rule in one line, and the Notizen half is what makes it discriminate: the
  // section directly below the anchor cannot go *up* either („nothing may pass it"), while
  // everything else it offers is live.
  check(
    'die Saison-Kachel ist der feste Anker: nicht verschiebbar, nicht schmal, nicht zu entfernen',
    lqArrangeOpen &&
      !!lqSaisonsStrip &&
      lqCtl(lqSaisonsStrip, 'Nach oben')?.disabled === true &&
      lqCtl(lqSaisonsStrip, 'Nach unten')?.disabled === true &&
      !lqCtl(lqSaisonsStrip, 'Breite umschalten') &&
      !lqCtl(lqSaisonsStrip, 'Bereich entfernen') &&
      !!lqNotizenStrip &&
      lqCtl(lqNotizenStrip, 'Nach oben')?.disabled === true &&
      lqCtl(lqNotizenStrip, 'Nach unten')?.disabled === false &&
      lqCtl(lqNotizenStrip, 'Breite umschalten')?.disabled === false &&
      lqCtl(lqNotizenStrip, 'Bereich entfernen')?.disabled === false,
    `Modus an ${lqArrangeOpen} — ` +
      `saisons: ${lqStripText(lqSaisonsStrip)} / notizen: ${lqStripText(lqNotizenStrip)}`,
  );

  const lqBefore2 = await lpBlob();
  const lqHold2 = await lqHoldPatch(lq3, '**/api/landing');
  const lqWidthClicked = await clickIfThere(
    lq3.locator('[data-section="notizen"] button[title="Breite umschalten"]'),
    SETTLED_MS,
  );
  await until(async () => lqHold2.held, (v) => v === true, SETTLED_MS);
  const lqC = `Während des Umbaus ${RUN}`;
  const lqCAdded = await lpAddDoc(lq4, 'dokumente', lqC);
  const lqAfterC = await until(lpBlob, (l) => l.documents.some((d) => d.label === lqC), SETTLED_MS);
  lqHold2.release();
  const lqArranged = await until(lpBlob, (l) => l.layout.length > 0, SETTLED_MS);
  await lq3.unroute('**/api/landing');

  // Its own window's log, so there is no offset to keep: the arrangement half sends exactly these
  // two requests and receives exactly these two answers.
  const lqSent2 = lqLog2.filter((e) => e.body !== undefined);
  const lqGot2 = lqLog2.filter((e) => e.status !== undefined);
  check(
    'auch die Anordnung wird abgelehnt und ein zweites Mal geschickt',
    lqWidthClicked &&
      lqCAdded &&
      lqSent2.length === 2 &&
      lqGot2[0]?.status === 409 &&
      lqGot2[1]?.status === 200 &&
      lqSent2[0]?.rev === lqBefore2.rev &&
      lqSent2[1]?.rev === lqAfterC.rev,
    `${lqSent2.map((s) => s.rev).join(' → ')} beantwortet mit ${lqGot2.map((g) => g.status).join('/')}`,
  );
  const lqLayout1 = jsonOr(lqSent2[0]?.body).layout;
  const lqLayout2 = jsonOr(lqSent2[1]?.body).layout;
  check(
    '…aber hier ist der zweite Rumpf der erste noch einmal: eine Momentaufnahme wird nicht nachgerechnet',
    Array.isArray(lqLayout1) &&
      JSON.stringify(lqLayout1) === JSON.stringify(lqLayout2) &&
      // …and it names `layout` alone. That is the whole reason a snapshot is safe here: the
      // documents the other window added are not in this request at all.
      jsonOr(lqSent2[1]?.body).documents === undefined,
    `${JSON.stringify(lqLayout1)} / ${JSON.stringify(lqLayout2)}`,
  );
  check(
    'die Anordnung gewinnt zuletzt — und nimmt das Dokument des anderen Fensters nicht mit (SHL-01)',
    lqArranged.layout.find((e) => e.key === 'notizen')?.width === 'full' &&
      lqArranged.layout.length === lpLaid.length &&
      lqArranged.documents.some((d) => d.label === lqC) &&
      lqArranged.documents.length === lqAfterC.documents.length,
    `${JSON.stringify(lqArranged.layout.map((e) => `${e.key}:${e.width}`))} bei ${lqArranged.documents.length} Dokumenten`,
  );

  for (const page of [lq3, lq4]) await page.close().catch(() => {});

  // ======================================================================== AR · the budget spent
  //
  // Three attempts is `MAX_CONFLICT_ATTEMPTS`, and what happens after them is the only part of
  // this mechanism the user ever meets. Provoked rather than stubbed: the route handler performs
  // a real, unconditional `PATCH /api/landing` from outside the browser before letting each
  // attempt through, so every one of them is stale by the time it arrives and the 409 under test
  // is still the server's own. Firing writes from a second window cannot be lined up with retries.
  //
  // An *edit* rather than an add, deliberately: `landingUpdate` publishes into the cache before
  // awaiting, but only when every row already carries an id — a new document is id-less, so only a
  // rename can show that the published value does not outlive a refused write.
  console.log('\nAR · Drei Versuche, dann sagt es die App');
  const lr = await open(context, '/');
  // The GETs go into the same list, in order, and this is the one case where they can be read:
  // the writes that steal the generation come from *outside* the browser, so they broadcast no
  // invalidate and this window issues no landing GET of its own except the ones the write path
  // asks for. In AQ the other window's write does broadcast, and a GET may land anywhere.
  /** @type {Array<{ rev?: number, body?: string, status?: number, get?: boolean }>} */
  const lrLog = [];
  lr.on('request', (r) => {
    if (!r.url().includes('/api/landing')) return;
    if (r.method() === 'GET') lrLog.push({ get: true });
    if (r.method() === 'PATCH') {
      const body = r.postData() ?? '{}';
      lrLog.push({ rev: jsonOr(body).rev, body });
    }
  });
  lr.on('response', (r) => {
    if (r.url().includes('/api/landing') && r.request().method() === 'PATCH') {
      lrLog.push({ status: r.status() });
    }
  });
  let lrSteals = 0;
  await lr.route('**/api/landing', async (route) => {
    if (route.request().method() === 'PATCH') {
      lrSteals++;
      await send('PATCH', '/landing', { notes: `Fremdschreiben ${lrSteals} ${RUN}` }).catch(() => {});
    }
    await route.continue().catch(() => {}); // see the guard in AQ
  });

  const lrBase = await lpBlob();
  // Any stored row will do — this one is only „the first" so that AQ's additions cannot change
  // which it is; from here on it is addressed by its own label and its own id, never by position.
  const lrTarget = lrBase.documents[0];
  const lrTyped = `Umbenannt ${RUN}`;
  const lrRow = lr
    .locator('[data-section="dokumente"] li')
    .filter({ hasText: lrTarget?.label ?? NO_MATCH })
    .first();
  await lrRow.hover().catch(() => {});
  const lrOpened = await clickIfThere(lrRow.locator('button[title="Bearbeiten"]'));
  const lrDlg = topDialog(lr);
  await lrDlg.getByPlaceholder('z. B. Fördervertrag').fill(lrTyped).catch(() => {});
  const lrSaved = await clickIfThere(lrDlg.getByRole('button', { name: 'Speichern' }));
  // The toast is raised by `guard`'s catch, which runs *after* `landingUpdate`'s `finally
  // { await invalidate() }` — so it too waits out the refetch storm (`EDITOR_GONE_MS`).
  const lrToast = await until(
    () => toast(lr, /fehlgeschlagen/).allInnerTexts(),
    (t) => t.length > 0,
    EDITOR_GONE_MS,
  );
  await sleep(400); // let the third answer's log entry land before the counts are read
  await lr.unroute('**/api/landing');

  const lrSent = lrLog.filter((e) => e.body !== undefined);
  const lrGot = lrLog.filter((e) => e.status !== undefined);
  check(
    'drei Versuche und kein vierter — das ist ein Budget, keine Schleife',
    lrSteals === 3 && lrSent.length === 3 && lrGot.length === 3 && lrGot.every((g) => g.status === 409),
    `${lrSteals} Fremdschreiben, ${lrSent.length} PATCH, Antworten ${lrGot.map((g) => g.status).join('/') || 'keine'}`,
  );
  check(
    'jeder Versuch liest die Generation des Gewinners aus der Absage und steigt mit ihr',
    lrSent[0]?.rev === lrBase.rev && lrSent.every((s, i) => i === 0 || s.rev === lrSent[i - 1].rev + 1),
    `${lrSent.map((s) => s.rev).join(' → ')} ab ${lrBase.rev}`,
  );
  // …*out of the refusal*, and that is the half the revs alone cannot show: a retry that fetched
  // the blob again would arrive at the same generation. Between the first attempt and the last
  // there is no `GET /api/landing` at all — the 409 carried the content, so the retry costs no
  // round trip. The window is only meaningful with three attempts in it, which the line above
  // establishes and this one restates.
  const lrIsPatch = lrLog.map((e) => e.body !== undefined);
  const lrBetween = lrLog
    .slice(lrIsPatch.indexOf(true), lrIsPatch.lastIndexOf(true))
    .filter((e) => e.get).length;
  check(
    '…und zwar aus der Absage selbst: zwischen den drei Versuchen wird kein einziges Mal neu gelesen',
    lrSent.length === 3 && lrBetween === 0,
    `${lrBetween} GET zwischen Versuch 1 und 3 (${lrLog.map((e) => (e.get ? 'GET' : e.body !== undefined ? `PATCH@${e.rev}` : `→${e.status}`)).join(' ')})`,
  );
  const lrStolen = await lpBlob();
  check(
    'die drei Fremdschreiben sind wirklich angekommen — der Konflikt war keiner auf Verdacht',
    lrStolen.notes === `Fremdschreiben 3 ${RUN}` && lrStolen.rev === lrBase.rev + 3,
    `notes „${lrStolen.notes}“, rev ${lrBase.rev} → ${lrStolen.rev}`,
  );
  check(
    'der Benutzer bekommt den Satz der Oberfläche und dahinter den des Servers',
    lrToast.some(
      (t) =>
        t.includes('Speichern fehlgeschlagen.') &&
        t.includes('Ein anderes Fenster hat inzwischen gespeichert.'),
    ),
    lrToast.join(' | ') || 'kein Hinweis',
  );
  const lrField = await lrDlg
    .getByPlaceholder('z. B. Fördervertrag')
    .inputValue()
    .catch(() => 'kein Dialog');
  check(
    '…und der Dialog bleibt stehen, mit dem Getippten darin: verloren ist nichts',
    lrOpened && lrSaved && lrField === lrTyped,
    `geöffnet ${lrOpened}, gespeichert geklickt ${lrSaved}, Feld „${lrField}“`,
  );
  const lrAfter = await lpBlob();
  check(
    'geschrieben wurde nichts: die Zeile trägt weiter ihren gespeicherten Namen',
    lrAfter.documents.find((d) => d.id === lrTarget?.id)?.label === lrTarget?.label &&
      !lrAfter.documents.some((d) => d.label === lrTyped),
    lrAfter.documents.map((d) => d.label).join(' | '),
  );
  // The predicate carries both halves the assertion reads: the stored name is back *and* the
  // optimistically published one is gone. Polling for the first alone would be satisfied while the
  // refused value was still on screen beside it.
  const lrRows = await until(
    () => lpRows(lr, 'dokumente'),
    (r) =>
      r.some((x) => x.text.includes(lrTarget?.label ?? NO_MATCH)) &&
      !r.some((x) => x.text.includes(lrTyped)),
    SETTLED_MS,
  );
  check(
    'auf dem Schirm steht wieder der gespeicherte Name: der vorab veröffentlichte überlebt die Absage nicht',
    lrRows.some((x) => x.text.includes(lrTarget?.label ?? NO_MATCH)) &&
      !lrRows.some((x) => x.text.includes(lrTyped)),
    lrRows.map((r) => r.text).join(' | ') || 'keine Zeile',
  );

  await lr.close().catch(() => {});

  // ======================================================================== AS · the other blob
  //
  // The same page refuses a write for two different reasons. Everything above is `landing.rev` in
  // `seasons.json`; the two *headings* over those cards are `labels` in the window's own season
  // settings, with a generation of their own (`settings.rev`, WP-R5) — and `useRenameLabel` is the
  // only caller in the app on `useSettingsArray.update`, i.e. the only settings write that sends a
  // generation at all. Which makes this page the one place both mechanisms are reachable side by
  // side, and renaming a heading the one way to drive the second.
  //
  // Both windows pinned to the *same* season: `labels` is per season, so two windows on two
  // seasons write two files and never collide, however hard the case tries.
  console.log('\nAS · Dieselbe Mechanik, andere Ablage: die zwei Überschriften (WP-R5)');
  const [ls1, ls2] = await windows(context, 2, '/');
  await pin(ls1, landingSeason.id, '/');
  await pin(ls2, landingSeason.id, '/');
  const lsQ = scoped(landingSeason.id);
  const lsSettings = () => api(lsQ('/settings'));

  /** @type {Array<{ rev?: number, body?: string, status?: number }>} */
  const lsLog = [];
  ls1.on('request', (r) => {
    if (r.url().includes('/api/settings') && r.method() === 'PATCH') {
      const body = r.postData() ?? '{}';
      lsLog.push({ rev: jsonOr(body).rev, body });
    }
  });
  ls1.on('response', (r) => {
    if (r.url().includes('/api/settings') && r.request().method() === 'PATCH') {
      lsLog.push({ status: r.status() });
    }
  });

  /** The pencil's accessible name is the heading's *current* text, German quotes included. */
  const lpRename = async (page, key, from, to) => {
    const label = page.locator(`[data-label="${key}"]`);
    await label.hover().catch(() => {});
    const opened = await clickIfThere(label.getByRole('button', { name: `„${from}“ umbenennen` }));
    const box = label.locator('input').first();
    await box.fill(to).catch(() => {});
    await box.press('Enter').catch(() => {});
    return opened;
  };

  const lsBase = await lsSettings();
  // A precondition: with an override already stored, „both headings kept their new name" could be
  // satisfied by one write that changed nothing.
  check(
    'Vorbedingung: diese Saison hat noch keine umbenannte Überschrift',
    !Array.isArray(lsBase.labels) || lsBase.labels.length === 0,
    JSON.stringify(lsBase.labels ?? null),
  );
  const lsNotes = `Merkzettel ${RUN}`;
  const lsDocs = `Ablage ${RUN}`;
  // `#/` issues no other settings write at all, so the first PATCH out of this window is the
  // rename — nothing else can be caught by the hold.
  const lsHold = await lqHoldPatch(ls1, '**/api/settings');
  const lsAOpened = await lpRename(ls1, 'landing.notizen', 'Notizen', lsNotes);
  await until(async () => lsHold.held, (v) => v === true, SETTLED_MS);
  const lsBOpened = await lpRename(ls2, 'landing.dokumente', 'Dokumente', lsDocs);
  const lsAfterB = await until(
    lsSettings,
    (s) => (s.labels ?? []).some((r) => r.label === lsDocs),
    SETTLED_MS,
  );
  // The staging line, like AQ's pair: both pencils were opened, the write is parked, and the other
  // window's rename moved the generation by exactly one.
  check(
    'das erste Fenster hängt an seiner Umbenennung, das zweite benennt die andere Überschrift um und gewinnt',
    lsAOpened &&
      lsBOpened &&
      lsHold.held &&
      lsAfterB.rev === lsBase.rev + 1 &&
      (lsAfterB.labels ?? []).length === 1,
    `rev ${lsBase.rev} → ${lsAfterB.rev}: ${JSON.stringify(lsAfterB.labels ?? null)}`,
  );
  lsHold.release();
  const lsMerged = await until(
    lsSettings,
    (s) => (s.labels ?? []).some((r) => r.label === lsNotes),
    SETTLED_MS,
  );
  await ls1.unroute('**/api/settings');
  // …and then the editors, which is the half the server cannot answer for. `EditableLabel` swaps
  // the heading text out for an `InlineInput` while it is editing, so `[data-label]`'s textContent
  // is the *input's* — empty — until `onDone` runs, and `onDone` runs when the write's promise
  // resolves, i.e. after its blanket `invalidate()` (`EDITOR_GONE_MS`). Polling the heading text
  // for that is polling a refetch storm; the editor going away is the signal, and it is the one
  // both windows have to give, since both renamed.
  const lsEditor1 = await surfaceSettled(ls1, ls1.locator('[data-label] input'));
  const lsEditor2 = await surfaceSettled(ls2, ls2.locator('[data-label] input'));
  const lsEditorsGone = lsEditor1 !== 'offen' && lsEditor2 !== 'offen';

  const lsSent = lsLog.filter((e) => e.body !== undefined);
  const lsGot = lsLog.filter((e) => e.status !== undefined);
  check(
    'der erste Versuch trägt die gelesene Generation und wird abgelehnt, der zweite die des Gewinners',
    lsSent.length === 2 &&
      lsSent[0]?.rev === lsBase.rev &&
      lsGot[0]?.status === 409 &&
      lsSent[1]?.rev === lsAfterB.rev &&
      lsGot[1]?.status === 200,
    `${lsSent.map((s) => s.rev).join(' → ')} beantwortet mit ${lsGot.map((g) => g.status).join('/') || 'keine'}`,
  );
  const lsFirst = jsonOr(lsSent[0]?.body).labels ?? [];
  const lsRetry = jsonOr(lsSent[1]?.body).labels ?? [];
  check(
    'auch hier wird die Absicht neu angewandt: „dieser Schlüssel, dieser Text, alles andere wie es steht“',
    lsFirst.length === 1 &&
      lsFirst[0]?.key === 'landing.notizen' &&
      lsRetry.length === 2 &&
      lsRetry.some((r) => r.key === 'landing.dokumente' && r.label === lsDocs) &&
      lsRetry.some((r) => r.key === 'landing.notizen' && r.label === lsNotes),
    `${JSON.stringify(lsFirst)}  →  ${JSON.stringify(lsRetry)}`,
  );
  check(
    'am Ende trägt jede der beiden Überschriften ihren neuen Namen',
    (lsMerged.labels ?? []).length === 2 &&
      (lsMerged.labels ?? []).some((r) => r.key === 'landing.notizen' && r.label === lsNotes) &&
      (lsMerged.labels ?? []).some((r) => r.key === 'landing.dokumente' && r.label === lsDocs),
    JSON.stringify(lsMerged.labels ?? null),
  );
  // Uppercased in CSS, so the comparison is case-folded — and read in *both* windows, because the
  // one that lost the race is the one whose screen the merge has to reach.
  const lsHeadings = (page) =>
    page
      .locator('[data-label]')
      .evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim().toUpperCase()));
  const lsShown1 = await until(
    () => lsHeadings(ls1),
    (h) => h.includes(lsNotes.toUpperCase()) && h.includes(lsDocs.toUpperCase()),
    SETTLED_MS,
  );
  const lsShown2 = await until(
    () => lsHeadings(ls2),
    (h) => h.includes(lsNotes.toUpperCase()) && h.includes(lsDocs.toUpperCase()),
    SETTLED_MS,
  );
  check(
    '…und beide Fenster zeigen beide Namen',
    lsEditorsGone &&
      lsShown1.join('|') === `${lsNotes.toUpperCase()}|${lsDocs.toUpperCase()}` &&
      lsShown2.join('|') === lsShown1.join('|'),
    `Editoren ${lsEditor1} / ${lsEditor2} — ${lsShown1.join(' / ')} gegen ${lsShown2.join(' / ')}`,
  );
  // The blob under those headings never moved. Two generations on one page, two stores: a rename
  // that had gone through the registry — or a landing write that had bumped `settings` — shows up
  // as the counter that was not supposed to change.
  const lsLandingAfter = await lpBlob();
  check(
    'die Ablage darunter hat sich dabei nicht bewegt — zwei Generationen, zwei Ablagen',
    lsLandingAfter.rev === lrAfter.rev && lsMerged.rev === lsBase.rev + 2,
    `landing rev ${lrAfter.rev} → ${lsLandingAfter.rev}, settings rev ${lsBase.rev} → ${lsMerged.rev}`,
  );

  await ls1.close().catch(() => {});
  await ls2.close().catch(() => {});
}
