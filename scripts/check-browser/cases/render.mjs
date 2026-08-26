/** L–N4 · the two pure render assurances: the smallest window, and paper */

import { stubElectron } from '../bridge.mjs';
import { NARROW, PLACEHOLDER_SELECT_PX, cardWith, clickIfThere, open, pin, ready, shown, until, windowContext } from '../browser.mjs';
import { UI } from '../config.mjs';
import { painted, paintedAt, paintedTimes, printPdf, sheet, where, withoutPrintRule } from '../pdf.mjs';
import { overflowReport, sweepWithProbe } from '../probes.mjs';
import { check } from '../report.mjs';
import { api, scoped, send } from '../stack.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runRender(fixtures) {
  const { PAGE_BREAK_FIRST, PAGE_BREAK_TRIES, chrome, context, pageBreak, sheets } = fixtures;
  // ======================================================================== L · the smallest window
  //
  // WP-55 took the window minimum from 1024×680 to 624×560 so two of them fit side by side, and
  // shipped that promise with nothing checking it: not one case above sets a viewport, and
  // Playwright's default is 1280×720.
  //
  // **The viewport is not the window.** `useContentSize` is false, so `MINIMUM` is the outer size
  // and the frame comes off before the renderer sees anything — driving at 624×560 checks a
  // window nobody has. The real pair is the two `NARROW` viewports above. Both are under
  // Tailwind's `sm:`, which is exactly 640, so both stay in the one-column layout; they are still
  // checked separately, because 14 px of width and 34 of height is what a wrap decision is made
  // of.
  //
  // What the two assertions per page are, and why neither is enough alone, is on
  // `overflowReport`. They are followed here by a control that injects an overhanging element and
  // requires the sweep to see it — otherwise „no offenders" is also what a sweep that silently
  // matches nothing reports, which is the failure mode the whole file exists to avoid.
  console.log('\nL · Das kleinste Fenster (WP-55)');
  // Every page the WP-55 pass covered: the header search and the season switcher are on all of
  // them, the task table is on three, and „Archiv" is where `SectionTitle` meets a w-64 search box.
  //
  // `#/einstellungen` joined the list in WP-64c, together with the fix that made it pass: the add
  // row of `TaskSortEditor` is a `<select>` beside „+ Hinzufügen", and a `<select>`'s automatic
  // minimum width is its longest option — 465 px here — so as a flex item it refused to shrink and
  // pushed the button 7 px past a 610 px window. `min-w-0` lets it shrink again. Why the overhang
  // looked intermittent (WP-64b measured it 2 in 12), and what this page therefore needs before it
  // can be measured at all, is on the precondition below.
  const NARROW_PAGES = ['/dashboard', '/', '/artist/1', '/project/1', '/archiv', '/einstellungen'];
  const WITH_TABLE = new Set(['/dashboard', '/artist/1', '/project/1']);

  for (const vp of NARROW) {
    const ctx = await windowContext(chrome, vp);
    const n = await open(ctx, NARROW_PAGES[0]);
    for (const hash of NARROW_PAGES) {
      if (hash !== NARROW_PAGES[0]) {
        await n.goto(`${UI}/#${hash}`);
        await n.reload(); // a `goto` to a different hash keeps data-app-ready — see `ready`
        await ready(n);
      }
      // Measured only once a row is laid out. `data-app-ready` also arrives from BootReady's
      // unconditional 700 ms budget, and a table measured in that window reports a *narrower*
      // preferred width than the one the user sees — the same run gave 758 and 1347 for
      // `#/project/1`.
      /** Geometry of the sort editor's add row — filled in below, on the one page that has one. */
      let addRule = { options: 0, rowRight: 0, cardRight: 0 };
      if (WITH_TABLE.has(hash)) {
        check(
          `${hash} hat eine Aufgabentabelle, bevor gemessen wird`,
          await shown(n.locator('div.overflow-x-auto table tbody tr')),
        );
      }
      // The same rule for the same reason, one layer down — and with a twist that is the whole
      // reason this page looked flaky. The sort editor's `<select>` is `PLACEHOLDER_SELECT_PX` wide
      // while it holds nothing but „Spalte wählen…", and **Chromium does not re-measure it when
      // React fills the options in**: the width is decided at the select's first layout and then
      // simply stays, whichever value it took. Waiting for the options is therefore not enough —
      // measured after a `reload()` the box is 181 px in six loads out of six, and the page is
      // clean whatever the CSS says. What does re-run the intrinsic sizing is a `change` on the
      // select, i.e. the thing a user does before pressing „+ Hinzufügen": 24 of 24 (WP-64c).
      //
      // Everything here is scoped to the sort card. A page-wide `select` is one element today and
      // a strict-mode violation the day this tab grows a second one — thrown from inside the
      // check, past `check()` (which does not throw) and into the outer catch, i.e. every case
      // after L silently skipped.
      if (hash === '/einstellungen') {
        const sortRow = cardWith(n, 'Automatische Aufgaben-Sortierung').locator('select');
        const options = await until(() => sortRow.locator('option').count(), (c) => c > 1);
        // Guarded, because `check` does not throw and `selectOption` does: a page that no longer
        // renders this editor at all would abort the whole run instead of failing one assertion.
        let sized = 0;
        if (options > 1) {
          await sortRow.selectOption({ index: 1 });
          // „It grew past the placeholder", not „it is at least N px": the healthy width is a
          // layout number (412 px at 610, 424 at 624) and would have to be re-tuned by anyone who
          // changes the card's padding, while the invariant under test is only that the box
          // re-measured itself at all.
          sized = await until(
            () => sortRow.evaluate((el) => Math.round(el.getBoundingClientRect().width)),
            (w) => w > PLACEHOLDER_SELECT_PX + 50,
            5000,
          );
          addRule = await sortRow.evaluate((el) => {
            const select = /** @type {HTMLSelectElement} */ (el);
            const button = select.parentElement?.querySelector('button') ?? null;
            const card = select.closest('div.rounded-2xl');
            return {
              options: select.options.length,
              rowRight: Math.round(button?.getBoundingClientRect().right ?? 0),
              cardRight: Math.round(card?.getBoundingClientRect().right ?? 0),
            };
          });
        }
        check(
          `${hash}: die Spaltenauswahl ist gefüllt und vermessen, bevor die Seite gemessen wird`,
          options > 1 && sized > PLACEHOLDER_SELECT_PX + 50,
          `${options} Optionen, Auswahl ${sized} px breit`,
        );
      }
      const m = await n.evaluate(overflowReport);
      const at = `${vp.label} ${vp.width}×${vp.height} ${hash}`;
      check(
        `${at}: das Dokument ist nicht breiter als das Fenster`,
        m.scrollWidth <= m.clientWidth,
        `scrollWidth ${m.scrollWidth}, clientWidth ${m.clientWidth}`,
      );
      check(
        `${at}: nichts ragt außerhalb eines Scroll-Containers hinaus`,
        m.offenders.length === 0,
        m.offenders.slice(0, 4).join(' · '),
      );
      // …and the same row against its *card* rather than against the window, because the window
      // question is only asked in one of the two: without `min-w-0` the row ends at 617 px in
      // **both** — 7 px past a 610 px viewport, where the sweep reports it, and 7 px inside a
      // 624 px one, where the sweep has nothing to say while the row still overhangs its card
      // (600 px) by 17. The card is where the content is actually cut off, so this is the
      // assertion that bites at both widths (WP-64c).
      if (hash === '/einstellungen') {
        check(
          `${at}: die Sortier-Regel-Zeile endet in ihrer Karte`,
          addRule.rowRight > 0 && addRule.rowRight <= addRule.cardRight + 1,
          `„+ Hinzufügen“ bis ${addRule.rowRight}, Karte bis ${addRule.cardRight}, ${addRule.options} Optionen`,
        );
      }
    }

    // WP-55's third fix, and the one a width sweep cannot see: the add row and the `<table>` sit
    // in one `min-w-min` box, so „Neue Aufgabe" and its bottom border are as wide as the table
    // instead of ending in mid-air as soon as the table is scrolled. `offsetWidth`, never
    // `scrollWidth` — the add row's content is short, and the question is how wide its *box* is.
    await n.goto(`${UI}/#/project/1`);
    await n.reload();
    await ready(n);
    await shown(n.locator('div.overflow-x-auto table tbody tr'));
    const box = await n.evaluate(() => {
      const scroller = /** @type {HTMLElement | null} */ (document.querySelector('div.overflow-x-auto'));
      const table = /** @type {HTMLElement | null} */ (scroller?.querySelector('table') ?? null);
      const addRow = /** @type {HTMLElement | null} */ (scroller?.querySelector('div.flex.items-center') ?? null);
      return {
        addRow: addRow?.offsetWidth ?? 0,
        table: table?.offsetWidth ?? 0,
        client: scroller?.clientWidth ?? 0,
        scroll: scroller?.scrollWidth ?? 0,
      };
    });
    check(
      `${vp.label}: die Neue-Aufgabe-Zeile ist so breit wie die Tabelle`,
      box.addRow > 0 && box.addRow === box.table,
      `Zeile ${box.addRow}, Tabelle ${box.table}`,
    );
    // …and the case is not vacuous: at this width the table really does overhang its container,
    // which is what makes the sweep's exemption above load-bearing rather than theoretical.
    check(
      `${vp.label}: die Tabelle scrollt wirklich in ihrem Container`,
      box.scroll > box.client + 1,
      `${box.scroll} in ${box.client}`,
    );
    await n.close();
    await ctx.close();
  }

  // The sweep's own control, one probe per verdict it has to reach — „0 offenders" is also what a
  // sweep that has quietly stopped matching anything reports.
  const probe = await windowContext(chrome, NARROW[0]);
  const g = await open(probe, '/dashboard');

  const wide = await sweepWithProbe(g, '<div id="probe-weit" style="width:3000px;height:8px"></div>');
  check(
    'das breite Kontrollelement wächst das Dokument über den Viewport',
    wide.scrollWidth > wide.clientWidth,
    `${wide.scrollWidth} bei ${wide.clientWidth}`,
  );
  check(
    '…und der Sweep meldet es',
    wide.offenders.some((o) => o.includes('probe-weit')),
    wide.offenders.join(' · '),
  );

  // The second one is the case the first half structurally cannot see, and the reason the sweep
  // reports a `hidden` ancestor rather than exempting it: content cut off by a clipping box never
  // grows the document, so `scrollWidth` stays exactly at the viewport while a row of a card is
  // out of reach.
  const cut = await sweepWithProbe(
    g,
    '<div style="overflow:hidden;width:100px"><div id="probe-abgeschnitten" style="width:3000px;height:8px"></div></div>',
  );
  check(
    'ein abgeschnittenes Kontrollelement wächst das Dokument gerade nicht',
    cut.scrollWidth <= cut.clientWidth,
    `${cut.scrollWidth} bei ${cut.clientWidth}`,
  );
  check(
    '…und genau deshalb muss der Sweep es melden',
    cut.offenders.some((o) => o.includes('probe-abgeschnitten')),
    cut.offenders.join(' · '),
  );

  // The season switcher is the one popover that does not go through `useAnchoredPopover`, which
  // is what flips and caps the others against the viewport. It hangs off the *sticky* header, so
  // an overlong list cannot be reached by scrolling the document either — in the smallest window
  // its last entries were simply unreachable before WP-55 capped and scrolled it.
  await g.locator('button[title$="wechseln"]').first().click();
  const menu = g.locator('div.absolute.z-40').first();
  check('der Saison-Umschalter öffnet im schmalen Fenster', await shown(menu));
  const cap = await menu.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      overflowY: cs.overflowY,
      maxHeight: parseFloat(cs.maxHeight),
      bottom: Math.round(el.getBoundingClientRect().bottom),
      inner: window.innerHeight,
    };
  });
  check('…seine Liste scrollt', cap.overflowY === 'auto', cap.overflowY);
  check(
    '…seine Höhe ist gegen den Viewport gedeckelt',
    cap.maxHeight <= cap.inner * 0.7 + 1,
    `max-height ${cap.maxHeight} bei ${cap.inner}`,
  );
  check('…und sie endet im Fenster', cap.bottom <= cap.inner, `Unterkante ${cap.bottom} bei ${cap.inner}`);
  await g.keyboard.press('Escape');
  await g.close();
  await probe.close();

  // ======================================================================== M · a done row
  //
  // WP-58: a done task was only half marked as done. `text-neutral-400` on the `<tr>` is pure
  // inheritance, so every cell carrying a `text-*` of its own stayed black, and `line-through` on
  // the `<tr>` reaches no cell at all — text-decoration does not propagate into atomic inline
  // boxes, and nearly every leaf here is a `<button>` or an `inline-flex`.
  //
  // Which is why the naive assertion — read `text-decoration-line` off the `<p>` the Markdown
  // renderer emits — fails against working code. The property is not inherited: the decoration
  // propagates *visually* into in-flow block boxes while the computed value on every one of them
  // stays `none`. So the strike is asserted on the element that carries the class, and the
  // *precondition* that propagation relies on — `display: block`, `float: none`,
  // `position: static` on the descendant — is asserted separately. An `inline-block` there would
  // silently stop the strike.
  //
  // The colour half is WP-62's pair, and it has to be a pair: on the done row alone „grey wins"
  // also passes on a build that never paints the colour at all.
  console.log('\nM · Erledigte Zeilen: Strich, Grau und Farbe (WP-58, WP-62)');
  const statusCol = (await api('/custom-columns')).find((c) => c.kind === 'builtin' && c.key === 'status');
  const done = JSON.parse(statusCol?.options ?? '[]').find((o) => o.done)?.value ?? 'done';
  const seven = await api('/tasks?project_id=7');
  // Picked by their fixture properties rather than by id, so a renumbered demo fails loudly here
  // instead of asserting about whatever row happens to carry that number.
  const doneRow = seven.find((t) => t.status === done && (t.comment ?? '').includes('tc-'));
  const openRow = seven.find((t) => t.status !== done && (t.comment ?? '').includes('tc-'));
  const emptyRow = seven.find((t) => t.status === done && !t.due_date);
  check(
    'die Fixture-Zeilen stehen auf #/project/7 (WP-58)',
    !!doneRow && !!openRow && !!emptyRow,
    `erledigt ${doneRow?.id}, offen ${openRow?.id}, ohne Datum ${emptyRow?.id}`,
  );
  // Nothing below dereferences those rows, and the reason is that `check` does not throw: a demo
  // whose fixture has drifted would raise a TypeError here, the outer catch would swallow it as
  // one opaque „run completed" failure, and N/N2 would never run at all. Missing ids fall through
  // to selectors that match nothing, so every assertion below reports what it really found.
  const doneId = doneRow?.id ?? 0;
  const doneTitle = doneRow?.title ?? '';

  const h = await open(context, '/project/7');
  await shown(h.locator('div.overflow-x-auto table tbody tr'));
  // One evaluate for every reading: two round trips can straddle a background refetch's
  // re-render and compare styles from different commits.
  const marks = await h.evaluate(
    ([dId, oId, eId, title]) => {
      const row = (id) => document.querySelector(`[data-task-id="${id}"]`);
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const titleBtn = Array.from(row(dId)?.querySelectorAll('button') ?? []).find(
        (b) => b.textContent?.trim() === title,
      );
      const commentBox = row(dId)?.querySelector('div.cursor-text');
      const para = commentBox?.querySelector('.prose-md p');
      const quote = commentBox?.querySelector('.prose-md blockquote');
      const doneSpan = commentBox?.querySelector('[class*="tc-"]');
      const openSpan = row(oId)?.querySelector('div.cursor-text [class*="tc-"]');
      const pill = row(dId)?.querySelector('button[aria-haspopup="listbox"]');
      const dashes = Array.from(row(eId)?.querySelectorAll('td span') ?? [])
        .filter((s) => s.textContent?.trim() === '—')
        .map((s) => cs(s)?.textDecorationLine);
      return {
        title: { found: !!titleBtn, deco: cs(titleBtn)?.textDecorationLine },
        box: { deco: cs(commentBox)?.textDecorationLine, color: cs(commentBox)?.color },
        para: {
          deco: cs(para)?.textDecorationLine,
          display: cs(para)?.display,
          float: cs(para)?.float,
          position: cs(para)?.position,
        },
        quote: quote ? cs(quote)?.color : null,
        doneSpan: doneSpan ? cs(doneSpan)?.color : null,
        openSpan: openSpan ? cs(openSpan)?.color : null,
        openColour: cs(row(oId)?.querySelector('div.cursor-text'))?.color,
        pill: pill ? { filter: cs(pill)?.filter, opacity: cs(pill)?.opacity } : null,
        dashes,
      };
    },
    [doneId, openRow?.id ?? 0, emptyRow?.id ?? 0, doneTitle],
  );

  check('der Titel der erledigten Zeile ist durchgestrichen', marks.title.found && marks.title.deco === 'line-through', String(marks.title.deco));
  check('ihr Kommentar auch', marks.box.deco === 'line-through', String(marks.box.deco));
  check(
    '…und das gerenderte <p> darunter meldet erwartungsgemäß „none“',
    marks.para.deco === 'none',
    String(marks.para.deco),
  );
  check(
    '…weil der Strich per Blockfluss dorthin wandert — die Bedingung dafür steht',
    marks.para.display === 'block' && marks.para.float === 'none' && marks.para.position === 'static',
    `${marks.para.display} / ${marks.para.float} / ${marks.para.position}`,
  );
  // `.prose-md blockquote` sets a colour of its own, so a Zitat in einem erledigten Kommentar sat
  // visibly darker than the rest of the row until `.prose-md--done` beat that rule.
  check(
    'das Zitat im erledigten Kommentar nimmt das Grau der Zeile',
    marks.quote === marks.box.color,
    `Zitat ${marks.quote}, Zelle ${marks.box.color}`,
  );
  // Tailwind v4 serialises `text-neutral-400` as `oklch(0.708 0 none)`, so the honest assertion is
  // the comparison itself and never a hardcoded rgb.
  check(
    'der farbige Lauf der erledigten Zeile ebenso (WP-62)',
    marks.doneSpan === marks.box.color,
    `Lauf ${marks.doneSpan}, Zelle ${marks.box.color}`,
  );
  check(
    '…und der der offenen Zeile bleibt rot — das Paar ist die Zusicherung',
    marks.openSpan === 'rgb(185, 28, 28)' && marks.openSpan !== marks.openColour,
    String(marks.openSpan),
  );
  check(
    'die Status-Pille ist entfärbt statt durchgestrichen',
    !!marks.pill && /grayscale/.test(marks.pill.filter ?? '') && Number(marks.pill.opacity) < 1,
    JSON.stringify(marks.pill),
  );
  // A line through an em dash reads as a second dash, which is what `doneCell`'s `filled`
  // argument exists for.
  check(
    'die „—“-Platzhalter der erledigten Zeile bleiben ungestrichen',
    marks.dashes.length > 0 && marks.dashes.every((d) => d === 'none'),
    marks.dashes.join(' | '),
  );
  await h.close();

  // ======================================================================== N · the print sheets
  //
  // Everything here is asserted against the PDF's bytes rather than against the DOM, because the
  // defects only exist on paper. `page.pdf()`'s default `printBackground: false` **is** the
  // SHL-11 repro — Chromium's „Hintergrundgrafiken" is off by default in the browser and in
  // Electron's `window.print()` — and a screenshot can never show it, because screenshots always
  // paint backgrounds. The fix was `print-color-adjust: exact` scoped to `.print-page`.
  //
  // So the case takes a second PDF with that property overridden back to `economy` and requires
  // the group headings to vanish from it. Without that control the case would also pass on a
  // Chromium that simply prints backgrounds regardless — i.e. it would assert nothing about the
  // fix. Measured: the `.print-page` colours are 19 with the fix and 18 without.
  //
  // Two things decide *which* colour may carry that assertion, and both rule out the obvious one.
  // The project-code badge is out because the header's `border-b-4` carries the same accent and a
  // border prints under `economy` too. And the status-group pills are only unambiguous once the
  // project has **no status**: `ProjectStatusPill` paints „In Progress" in exactly the shade its
  // group heading uses (`DEFAULT_STATUS_OPTIONS`), and demo project 1 carries that status — so on
  // the demo, half of this assertion is satisfiable by a pill in the header while the group
  // heading prints white on white. Hence the copied season and the one PATCH: in it each group
  // colour is painted **exactly once**, which pins the fill to the heading rather than merely
  // finding it somewhere on the sheet.
  console.log('\nN · Druckbögen als PDF (SHL-11, WP-62)');
  const P = scoped(sheets.id);
  const stripped = await send('PATCH', P('/projects/1'), { status: null });
  check('das Fixture-Projekt trägt keine Status-Pille mehr', stripped.body?.status === null, `HTTP ${stripped.status}`);

  const p1 = await open(context, '/dashboard');
  await pin(p1, sheets.id, '/print/project/1');
  await p1.locator('.print-group-head').first().waitFor({ timeout: 10_000 });
  const ink = await p1.evaluate(() => ({
    groups: Array.from(document.querySelectorAll('.print-group-head span')).map(
      (s) => getComputedStyle(s).backgroundColor,
    ),
    // Optional-chained on purpose: a fixture that lost its coloured runs must fail the one check
    // written for it, not throw out of the case and take N2 with it.
    rot: document.querySelector('.print-page .tc-rot')
      ? getComputedStyle(document.querySelector('.print-page .tc-rot')).color
      : '',
    gruen: document.querySelector('.print-page .tc-gruen')
      ? getComputedStyle(document.querySelector('.print-page .tc-gruen')).color
      : '',
    statusPill: document.querySelectorAll('.print-page header .rounded-full').length,
  }));
  check(
    'der Projektbogen hat zwei Statusgruppen und farbigen Text',
    ink.groups.length === 2 && !!ink.rot && !!ink.gruen && ink.statusPill === 0,
    JSON.stringify(ink),
  );

  const paper = sheet(await printPdf(p1));
  check('der Bogen wird zu einem PDF', paper.pages.length > 0, `${paper.pages.length} Seiten`);
  check(
    'die Hintergründe der Gruppenköpfe stehen auf dem Papier — je genau einmal (SHL-11)',
    ink.groups.length > 0 && ink.groups.every((c) => paintedTimes(paper, c) === 1),
    ink.groups.map((c) => `${c} ×${paintedTimes(paper, c)}`).join(' | '),
  );
  // WP-62's document-sized fixture is project 1's description: a `tc-gruen` list item and a
  // `**<u><span class="tc-rot">…</span></u>**` run, i.e. the nesting the serializer produces.
  check('die Schriftfarben auch (WP-62)', painted(paper, ink.rot) && painted(paper, ink.gruen), `${ink.rot} / ${ink.gruen}`);

  const economy = await withoutPrintRule(
    p1,
    '.print-page { -webkit-print-color-adjust: economy !important; print-color-adjust: economy !important; }',
  );
  check(
    '…und ohne print-color-adjust: exact wären sie weg — die Zusicherung ist nicht vakuum',
    ink.groups.every((c) => !painted(economy, c)),
    ink.groups.filter((c) => painted(economy, c)).join(' | '),
  );
  check(
    '…während die Schriftfarbe bleibt: Vordergrund druckt Chromium ohnehin',
    painted(economy, ink.rot),
  );
  await p1.close();

  // The artist sheet's image, which is **not** an avatar: no demo artist sets `artists.image`, so
  // what prints here are the two pictures in artist 1's note (WP-37 — one in a Zitat, one wrapped
  // in a link), rendered inside `<header>` because `PrintHeader` takes the note as its children.
  //
  // „It printed" is asserted as an image XObject of the *stored* dimensions plus a `Do` that draws
  // it. Both halves are needed and neither may be loosened: a bare `/Subtype /Image` count is 4 on
  // a sheet with **no** picture at all, because Skia embeds colour emoji as bitmaps (📍 in the
  // events, 🚐 in the note), and `DCTDecode` would pin the assertion to this fixture being a JPEG.
  // The dimensions come from the DOM, so the check follows the fixture rather than repeating it.
  const p2 = await open(context, '/print/artist/1');
  await p2.locator('.print-page table').first().waitFor({ timeout: 10_000 });
  // An `<img>` that has not arrived yet leaves the layout intact and the paper empty, and
  // `printToPDF` will happily snapshot that — the one-run-in-ten failure mode this gate must not
  // have. Wait for the bytes, not for the element.
  const loaded = await p2
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll('.print-page img')).every(
          (i) => /** @type {HTMLImageElement} */ (i).complete && /** @type {HTMLImageElement} */ (i).naturalWidth > 0,
        ),
      { timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false);
  const shot = await p2.evaluate(() => {
    const img = /** @type {HTMLImageElement | null} */ (document.querySelector('.print-page img'));
    return img ? { w: img.naturalWidth, h: img.naturalHeight, inHeader: !!img.closest('header') } : null;
  });
  const artistPaper = sheet(await printPdf(p2));
  check('das Bild aus der Notiz ist geladen, bevor gedruckt wird', loaded && !!shot, JSON.stringify(shot));
  check(
    '…und es steht mit seinen Maßen im PDF (WP-37)',
    !!shot &&
      new RegExp(`/Subtype\\s*/Image\\s*/Width ${shot.w}\\s*/Height ${shot.h}\\b`).test(
        artistPaper.buf.toString('latin1'),
      ) &&
      artistPaper.pages.some((c) => /\/X\d+ Do/.test(c)),
    shot ? `${shot.w}×${shot.h}, ${artistPaper.pages.length} Seiten` : 'kein Bild',
  );
  await p2.close();

  // Both sheets omit done tasks and say so in the heading, which is the reason WP-58's strike is
  // asserted on the table above and not here: a done row never reaches paper at all. Read from the
  // same copied season the sheet is pinned to, so the count and the sheet cannot disagree about
  // which database they are describing.
  const p3 = await open(context, '/dashboard');
  await pin(p3, sheets.id, '/print/project/7');
  await p3.locator('.print-page table').first().waitFor({ timeout: 10_000 });
  // Section headings are CSS-uppercased, so `innerText` says „AUFGABEN (1 OFFEN)" — a
  // case-sensitive match here finds nothing on a sheet that is counting correctly.
  const sheetText = (await p3.locator('.print-page').innerText()).toLowerCase();
  const openCount = (await api(P('/tasks?project_id=7'))).filter((t) => t.status !== done).length;
  check(
    `der Bogen zählt „(${openCount} offen)“`,
    sheetText.includes(`(${openCount} offen)`),
    sheetText.split('\n').find((l) => l.includes('offen)')) ?? '',
  );
  check(
    '…und die erledigte Aufgabe steht nicht darauf',
    !!doneTitle && !sheetText.includes(doneTitle.toLowerCase()),
    doneTitle || 'kein Fixture',
  );
  await p3.close();

  // ======================================================================== N2 · a group header at a page break
  //
  // `.print-group-head` is a `<tr><td colSpan>`, so neither `tr { break-inside: avoid }` nor the
  // heading rule beside it reached it, and „In Arbeit (7)" could print alone as the last line of a
  // page. `break-after: avoid` on that class is the fix.
  //
  // The fixture is tuned to a page boundary and neighbouring counts silently miss it, which is
  // exactly how this case would come to assert nothing. So it does not trust the number: it takes
  // a second PDF with the rule overridden and requires the two to *differ*. If a runner's metrics
  // move the boundary, the list is resized around the tuned length — three rows either way,
  // nearest first — until they do; and with the rule gone from index.css no length differs at all,
  // which is what makes this a gate rather than a fixture.
  //
  // The heading is found in the PDF by the colour of its own pill, and „is it stranded" is read as
  // paint order: content is emitted in DOM order, so „nothing before it on its page" means it
  // heads that page, and „n text runs after it" is how much of its group came along.
  console.log('\nN2 · Der Gruppenkopf am Seitenumbruch');
  const p4 = await open(context, '/dashboard');
  await pin(p4, pageBreak.seasonId, `/print/project/${pageBreak.project.id}`);
  await p4.locator('.print-group-head').first().waitFor({ timeout: 10_000 });
  const heads = await p4.evaluate(() =>
    Array.from(document.querySelectorAll('.print-group-head span')).map((s) => ({
      text: s.textContent ?? '',
      colour: getComputedStyle(s).backgroundColor,
    })),
  );
  check(
    `das Fixture hat zwei Gruppen, die erste mit ${PAGE_BREAK_FIRST} Aufgaben`,
    heads.length === 2 && heads[0].text.includes(String(PAGE_BREAK_FIRST)),
    heads.map((x) => x.text).join(' | '),
  );

  let boundary = null;
  let last = null;
  for (const offset of PAGE_BREAK_TRIES) {
    if (boundary) break;
    const rows = PAGE_BREAK_FIRST + offset;
    if (offset !== 0) {
      await pageBreak.resize(rows);
      await p4.reload();
      await ready(p4);
      await p4.locator('.print-group-head').first().waitFor({ timeout: 10_000 });
    }
    const kept = paintedAt(sheet(await printPdf(p4)), heads[1]?.colour ?? '');
    const split = paintedAt(
      await withoutPrintRule(p4, '.print-group-head { break-after: auto !important; }'),
      heads[1]?.colour ?? '',
    );
    last = { kept, split };
    console.log(`      ${rows} Aufgaben — mit Regel: ${where(kept)} | ohne: ${where(split)}`);
    if (kept.page > split.page) boundary = { rows, kept, split };
  }

  // Read the pill's colour back out of the PDF before anything is concluded from where it sits:
  // „not found" and „found on page 1" are the same zero otherwise.
  check('der Gruppenkopf ist im PDF wiederzufinden', (last?.kept.page ?? 0) > 0, where(last?.kept ?? { page: 0, pages: 0, before: 0, after: 0 }));
  check(
    'break-after: avoid schiebt den Gruppenkopf über den Umbruch',
    !!boundary,
    boundary ? `bei ${boundary.rows} Aufgaben` : `in ${PAGE_BREAK_TRIES.length} Längen keine Wirkung`,
  );
  if (boundary) {
    check('…er steht dann als Erstes auf seiner Seite', boundary.kept.before === 0, where(boundary.kept));
    check(
      '…und nimmt mehr von seiner Gruppe mit als ohne die Regel',
      boundary.kept.after > boundary.split.after,
      `${boundary.kept.after} statt ${boundary.split.after}`,
    );
  }
  await p4.close();

  // ======================================================================== N3 · off the sheet again
  //
  // WP-71, and a customer's own words: „einmal im Ein-Pager kann ich nur noch ‚Als PDF speichern /
  // Drucken' drücken und komme nicht mehr raus. Ich kann nur Auftakt komplett schließen." The
  // print routes live outside `Layout`, so the sheet has no header, no Breadcrumbs and no season
  // switcher, and the packaged app has neither browser chrome nor a „Zurück" in its menu — the
  // sheet really was a one-way door.
  //
  // **Why N and N2 could not see it.** Both `pin()` a window straight onto `#/print/…` and then
  // read the bytes; nothing in this file had ever walked *in* through the link on the page or
  // tried to walk out again. So this case is the walk, in both directions and on both sheets, and
  // the assertion is the URL on the other side: the page the sheet belongs to, never the start
  // page — `PrintFallback`'s „Zur Startseite" is the error case and stays what it is.
  //
  // The paper half is the other property the control has to keep: it is `no-print`, and a button
  // printed onto a handout is exactly what that class exists to prevent. Asserted by *marking*
  // the two controls with a colour nothing else on the sheet paints, rather than by their own
  // Tailwind shades — `bg-neutral-900` is also the sheet's body text, so „is it in the bytes"
  // would be answered by every line of it.
  console.log('\nN3 · Der Weg auf den Bogen und wieder herunter (WP-71)');
  const p5 = await open(context, '/project/1');
  await clickIfThere(p5.getByRole('link', { name: /Ein-Pager/ }));
  const onProjectSheet = await until(() => p5.url(), (u) => u.endsWith('#/print/project/1'), 8000);
  const projectSheet = await shown(p5.locator('.print-page'));
  check(
    'die Projektseite führt über ihren eigenen Link auf den Bogen',
    onProjectSheet.endsWith('#/print/project/1') && projectSheet,
    onProjectSheet,
  );
  const backLink = p5.getByRole('link', { name: /^Zurück/ });
  check('der Bogen trägt einen Weg zurück', await shown(backLink));
  await clickIfThere(backLink);
  const backOnProject = await until(() => p5.url(), (u) => u.endsWith('#/project/1'), 8000);
  // The table, not just the URL: a hash that changed while nothing rendered is the shape a broken
  // back link would have, and this page is one of the three that has a task table (case L).
  const projectPage = await shown(p5.locator('div.overflow-x-auto table tbody tr'));
  check(
    '…und er führt auf das Projekt zurück, nicht auf die Startseite',
    backOnProject.endsWith('#/project/1') && projectPage,
    backOnProject,
  );

  await p5.goto(`${UI}/#/artist/1`);
  await p5.reload();
  await ready(p5);
  await clickIfThere(p5.getByRole('link', { name: /Ein-Pager/ }));
  const onArtistSheet = await until(() => p5.url(), (u) => u.endsWith('#/print/artist/1'), 8000);
  check(
    'der Künstlerbogen ist genauso zu erreichen',
    onArtistSheet.endsWith('#/print/artist/1') && (await shown(p5.locator('.print-page'))),
    onArtistSheet,
  );
  await clickIfThere(p5.getByRole('link', { name: /^Zurück/ }));
  const backOnArtist = await until(() => p5.url(), (u) => u.endsWith('#/artist/1'), 8000);
  check(
    '…und genauso wieder zu verlassen',
    backOnArtist.endsWith('#/artist/1') && (await shown(p5.locator('div.overflow-x-auto table tbody tr'))),
    backOnArtist,
  );

  // Marked on the elements themselves, not on the row: both carry a `text-*` class of their own,
  // so a colour set on the container would be inherited by neither.
  const MARK = 'rgb(1, 254, 3)';
  await p5.goto(`${UI}/#/print/artist/1`);
  await p5.reload();
  await ready(p5);
  await p5.locator('.print-page table').first().waitFor({ timeout: 10_000 });
  const marked = await p5.evaluate((colour) => {
    const controls = document.querySelectorAll('.print-page .no-print a, .print-page .no-print button');
    for (const el of controls) {
      if (el instanceof HTMLElement) el.style.color = colour;
    }
    return controls.length;
  }, MARK);
  check('der Bogen trägt seine beiden Bedienelemente über dem Blatt', marked === 2, `${marked} Elemente`);
  const handout = sheet(await printPdf(p5));
  check('…und keines davon steht auf dem Papier', !painted(handout, MARK), `${paintedTimes(handout, MARK)}×`);
  // The control, like everywhere else in this section: without `.no-print` the marked colour is in
  // the bytes, so the assertion above is about the rule and not about Chromium's own reticence.
  const printedChrome = await withoutPrintRule(p5, '.no-print { display: flex !important; }');
  check(
    '…ohne die no-print-Regel stünde es dort — die Zusicherung ist nicht vakuum',
    painted(printedChrome, MARK),
    `${paintedTimes(printedChrome, MARK)}×`,
  );
  await p5.close();

  // ======================================================================== N4 · saving the sheet
  //
  // The other half of the same report, and a decision taken over it (2026-08-26): „Als PDF
  // speichern / Drucken" was one button doing whatever `window.print()` does, and on Windows that
  // is the *printer* list — „Als PDF speichern" is not honestly on offer there, it is one entry
  // among the machine's real printers. The button is a save now, and only a save: under Electron
  // it hands the sheet's title to `savePdf`, and main renders this window with `printToPDF` into
  // the file its save dialog names.
  //
  // Driven at the recording bridge and never at the real one, like U and U2 — the real member
  // opens a dialog on the machine running this and then writes a PDF wherever it is pointed.
  //
  // **Two observables, and the pair is the assertion.** The recorder holds the title, and
  // `window.print` was *not* called — overridden here, because a real call in headless Chromium
  // leaves nothing to read. Without the second half the case also passes on a build that hands the
  // bridge a title and opens the printer dialog beside it, which is the defect itself.
  console.log('\nN4 · „Als PDF speichern“ am Bridge-Stub (WP-71)');
  const watchPrint = (page) =>
    page.addInitScript(() => {
      const w = /** @type {any} */ (window);
      w.__printed = 0;
      w.print = () => {
        w.__printed++;
      };
    });
  const printCount = (page) => page.evaluate(() => /** @type {any} */ (window).__printed);
  const p6 = await open(context, '/project/1', async (page) => {
    await stubElectron(page);
    await watchPrint(page);
  });
  await clickIfThere(p6.getByRole('link', { name: /Ein-Pager/ }));
  await shown(p6.locator('.print-page'));
  await clickIfThere(p6.getByRole('button', { name: 'Als PDF speichern' }));
  const pdfs = await until(
    () => p6.evaluate(() => /** @type {any} */ (window).__pdfs),
    (v) => v.length > 0,
    5000,
  );
  // Read back from the API rather than written down here: the title *is* the proposed file name,
  // so it has to be this project's own, and a renamed fixture must redden this line instead of
  // being what the expectation was copied from.
  const printedProject = await api('/projects/1');
  const named = [printedProject.code, printedProject.name].filter(Boolean).join(' ');
  check(
    '„Als PDF speichern“ reicht den Titel des Bogens an die Bridge',
    pdfs.length === 1 && pdfs[0] === named,
    `${pdfs.join(' | ') || 'nichts aufgezeichnet'} — erwartet „${named}“`,
  );
  check('…und öffnet dabei keinen Druckdialog mehr', (await printCount(p6)) === 0, `${await printCount(p6)}×`);
  await p6.close();

  // Without a bridge the same button is the browser's own print preview, whose default destination
  // is „Als PDF speichern" — the degradation every bridge call in this app makes, and what keeps
  // the one label honest in both environments. No stub at all here, which is the state every other
  // case in this gate runs in.
  const p7 = await open(context, '/print/project/1', watchPrint);
  const controls = (await p7.locator('.print-page .no-print').innerText()).replace(/\s+/g, ' ').trim();
  check(
    'die Leiste des Bogens trägt genau „Zurück“ und „Als PDF speichern“ — „Drucken“ nicht mehr',
    controls === 'Zurück Als PDF speichern',
    controls,
  );
  await clickIfThere(p7.getByRole('button', { name: 'Als PDF speichern' }));
  const printed = await until(() => printCount(p7), (n) => n > 0, 5000);
  check('ohne Bridge bleibt der Druckdialog des Browsers die Rückfallebene', printed === 1, `${printed}×`);
  await p7.close();
}
