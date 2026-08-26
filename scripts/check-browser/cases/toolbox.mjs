/** AA–AC · the rich-text toolbar */

import { sleep } from '../../lib/wait.mjs';
import { clickIfThere, gone, open, pin, ready, scrollSettled, shown, until, windowContext } from '../browser.mjs';
import { UI } from '../config.mjs';
import { check } from '../report.mjs';
import { api, scoped, send } from '../stack.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runToolbox(fixtures) {
  const { browser, context, textOf, toolbox } = fixtures;
  // ======================================================================== AA–AC · the toolbox
  //
  // What sits in front of case H. That one asserts a note *saves* — on blur, and through the door
  // React's delegated `onBlur` cannot see; these three are the buttons above the text: the marks
  // the toolbar writes, the closed colour palette (WP-62) and the trimmed bar a task comment gets.
  //
  // The Markdown round-trip itself is **not** re-asserted here. `npm run check:markdown` drives
  // the same dialect in jsdom over a corpus of some seventy constructs, which is where a
  // serializer question belongs. What is asserted below is the other half of that boundary, and
  // the half no headless editor can answer: that pressing a button really produces the mark, that
  // pressing it again really takes it back, and that what the toolbar produced is what the
  // *server* ends up holding.
  //
  // In a copy from the first line — all three type into a note and save it.

  const BOX = scoped(toolbox.id);
  /** The eight tones, in the order `TEXT_COLORS` offers them. */
  const PALETTE = ['Rot', 'Orange', 'Bernstein', 'Grün', 'Türkis', 'Blau', 'Violett', 'Pink'];
  /** What `.tc-blau` and `.tc-tuerkis` paint — hand-written hex in `index.css`, so a plain `rgb()`. */
  const BLAU = 'rgb(29, 78, 216)';
  const TUERKIS = 'rgb(15, 118, 110)';

  /** A box, or `null` — `boundingBox()` on a locator that matches nothing throws like the rest. */
  const boxOf = (locator) =>
    locator
      .first()
      .boundingBox()
      .catch(() => null);

  const toolbarBtn = (page, title) => page.locator(`.rte-root button[title="${title}"]`);
  /** The trigger's tooltip carries the platform's own spelling of the chord — anchor with `^=`. */
  const colorTrigger = (page) => page.locator('.rte-root button[title^="Schriftfarbe"]');
  const palette = (page) => page.locator('[role="dialog"][aria-label="Schriftfarbe"]');
  /**
   * Leave nothing open behind a failed assertion. The palette has no backdrop, so an open one does
   * not block a click — but it does own the ⌘⇧F chord and it does sit over the text, and a case
   * that fails halfway through a pick would otherwise hand the next one a menu it never opened.
   */
  const closePalette = async (page) => {
    if ((await palette(page).count()) === 0) return;
    await page.keyboard.press('Escape');
    await gone(palette(page), 4000);
  };

  /**
   * The editor's own selection, straight off the view's DOM node.
   *
   * ProseMirror stamps the TipTap instance onto `.rte-content`, so this is the whole handle — no
   * marker character typed and read back. Returned rather than asserted, because every caller
   * below wants the range in its failure detail.
   */
  const caretIn = (page) =>
    page
      .evaluate(() => {
        const ed = /** @type {any} */ (document.querySelector('.rte-content'))?.editor;
        if (!ed) return null;
        const { from, to } = ed.state.selection;
        return { from, to, text: ed.state.doc.textBetween(from, to, ' ') };
      })
      .catch(() => null);

  /**
   * Select the last `n` characters of the note — and poll until the editor agrees that is what is
   * selected.
   *
   * Both halves are load-bearing. `End` pressed straight after a click runs against the caret the
   * editor had *before* it (`DOMObserver` flushes on a ~20 ms timer), so the arrows start from the
   * wrong place: measured here, click → `End` → nine `Shift+ArrowLeft` left a **five**-character
   * range and „Standard" then un-coloured half the run, which reads as „removing a colour is
   * broken". And a mark applied to an *empty* selection changes nothing at all, so every
   * assertion after it fails for a reason that is not the one under test. The caller asserts the
   * range it got back.
   */
  const selectTail = async (page, n) => {
    await page.keyboard.press('End');
    for (let i = 0; i < n; i++) await page.keyboard.press('Shift+ArrowLeft');
    return until(() => caretIn(page), (s) => !!s && s.to - s.from === n, 4000);
  };

  /**
   * Open an `InlineNotes` reader: a text run, never the box — its centre may be a link or an image.
   *
   * `:not(.rte-content)` because `.prose-md` is *both* surfaces (see `saveNote`): the bare selector
   * would happily „open" an editor that is already open and report success.
   */
  const openNote = async (page) => {
    const reader = page.locator('.prose-md:not(.rte-content)').first();
    if (!(await shown(reader, 8000))) return false;
    await clickIfThere(reader.locator('p'));
    // Not `open`: that is this file's „open a page" helper, and shadowing it here would be a trap
    // of its own the next time somebody needs a second page inside this block.
    const editing = await shown(page.locator('.rte-content.ProseMirror-focused'), 8000);
    await sleep(150); // TipTap's focus lands a frame late, and `End` would run against the old caret
    return editing;
  };

  /**
   * ⌘↵ / Ctrl+↵ is the editor's own save: it blurs itself, and blur is what commits (WP-49).
   *
   * The wait is on the **editor going away**, not on the reader arriving, and that is not a
   * preference: the editable node's own class list is `prose-md prose-md--roomy rte-content …`,
   * so `.prose-md` matches the editor as happily as the reading view and waiting for it is
   * satisfied by the surface that is already there. `InlineNotes` leaves edit mode only once the
   * write resolved (RTE-01), which is what makes `.rte-root` detaching the signal — and a
   * `openNote` that runs into the gap clicks the editor's own paragraph, sees it re-focus, and is
   * then unmounted mid-case. It cost this case's first run.
   *
   * **`CommentCell` is the exception, so this says „the editor is gone" and not „the write
   * landed".** Its `onBlur` runs `setEditing(false)` *before* `onCommit`, where `InlineNotes`
   * awaits — so for a comment the detach happens while the PATCH is still in flight, and the
   * caller has to poll the API for a value only the write can produce (AC does; a predicate the
   * pre-write row already satisfies is a coin toss).
   */
  const saveNote = async (page, reader) => {
    await page.keyboard.press('ControlOrMeta+Enter');
    await gone(page.locator('.rte-root'), 10_000);
    return shown(reader, 8000);
  };

  // ======================================================================== AA · marks
  console.log('\nAA · Die Werkzeugleiste zeichnet aus und nimmt zurück');
  const t = await open(context, '/dashboard');
  await pin(t, toolbox.id, '/project/2');

  const noteReader = t.locator('.prose-md:not(.rte-content)').first();
  /** Project 2's description, as the demo seeds it — the short plain note this case grows. */
  const PLAIN_NOTE = String((await api(BOX('/projects/2'))).description ?? '');
  const MARK_WORD = 'Fettprobe';
  const COLOR_WORD = 'Farbprobe';

  // The pair every „the toolbar is there" assertion needs: counted on its own, „no Fett button"
  // is also true of a page whose card has not rendered yet, which is the emptiest possible pass.
  check(
    'im Lesezustand steht die Notiz da und keine Leiste darüber',
    PLAIN_NOTE.length > 0 && (await shown(noteReader)) && (await toolbarBtn(t, 'Fett').count()) === 0,
    PLAIN_NOTE || 'leere Notiz',
  );

  await openNote(t);
  check(
    'ein Klick in den Text bringt sie — samt „Zitat“, denn dies ist ein dokumentgroßes Feld',
    (await toolbarBtn(t, 'Fett').count()) === 1 && (await toolbarBtn(t, 'Zitat').count()) === 1,
  );

  await t.keyboard.press('End');
  await t.keyboard.type(` ${MARK_WORD}`);
  const markedRun = await selectTail(t, MARK_WORD.length);
  check(
    'ein getippter Lauf ist ausgewählt — genau er, nicht der Satz davor',
    markedRun?.text === MARK_WORD,
    markedRun ? `${markedRun.from}–${markedRun.to} „${markedRun.text}“` : 'keine Auswahl',
  );

  /** `aria-pressed` is the only thing that says „the toolbar noticed", so it is read on both sides. */
  const pressed = (title) => toolbarBtn(t, title).getAttribute('aria-pressed').catch(() => null);
  check('„Fett“ meldet sich vorher als nicht gesetzt', (await pressed('Fett')) === 'false', String(await pressed('Fett')));
  await clickIfThere(toolbarBtn(t, 'Fett'));
  const boldOn = await until(() => pressed('Fett'), (v) => v === 'true', 4000);
  check('…und nach dem Klick als gesetzt', boldOn === 'true', String(boldOn));

  const strong = t.locator('.rte-content strong');
  const em = t.locator('.rte-content em');
  const underlined = t.locator('.rte-content u');
  check(
    '…und der Lauf steht wirklich fett im Text, und nur er',
    (await strong.count()) === 1 && (await textOf(strong)) === MARK_WORD,
    `${await strong.count()}× fett: „${await textOf(strong)}“`,
  );

  await clickIfThere(toolbarBtn(t, 'Unterstrichen'));
  await clickIfThere(toolbarBtn(t, 'Kursiv'));
  const italicOn = await until(() => pressed('Kursiv'), (v) => v === 'true', 4000);
  check(
    'drei Auszeichnungen stapeln sich auf demselben Lauf',
    italicOn === 'true' && (await em.count()) === 1 && (await underlined.count()) === 1,
    `${await em.count()}× kursiv, ${await underlined.count()}× unterstrichen`,
  );

  await clickIfThere(toolbarBtn(t, 'Kursiv'));
  const italicOff = await until(() => pressed('Kursiv'), (v) => v === 'false', 4000);
  check('ein zweiter Klick nimmt genau eine davon zurück', italicOff === 'false' && (await em.count()) === 0, `${italicOff}, ${await em.count()}× kursiv`);
  check(
    '…und lässt die beiden anderen stehen — sonst wäre „zurücknehmen“ nur „alles wegwerfen“',
    (await strong.count()) === 1 && (await underlined.count()) === 1 && (await pressed('Fett')) === 'true',
    `${await strong.count()}× fett, ${await underlined.count()}× unterstrichen`,
  );

  await saveNote(t, noteReader);
  const storedMarks = await until(
    () => api(BOX('/projects/2')).then((p) => String(p.description ?? '')),
    (d) => d.includes(MARK_WORD),
    8000,
  );
  check('die Auszeichnung landet so in der gespeicherten Fassung', storedMarks.includes(`**<u>${MARK_WORD}</u>**`), storedMarks);
  check(
    '…und nur auf ihrem Lauf: der Satz davor ist unausgezeichnet geblieben',
    storedMarks.startsWith(PLAIN_NOTE) &&
      (await noteReader.locator('strong').count()) === 1 &&
      (await noteReader.locator('em').count()) === 0,
    `${await noteReader.locator('strong').count()}× fett, ${await noteReader.locator('em').count()}× kursiv`,
  );

  // …and the other direction through the same door. A mark that comes back on the next save is
  // the failure a customer meets a day later, and „it is gone from the screen" cannot see it.
  await openNote(t);
  const reselected = await selectTail(t, MARK_WORD.length);
  check('der gespeicherte Lauf lässt sich wieder auswählen', reselected?.text === MARK_WORD, reselected ? `„${reselected.text}“` : 'keine Auswahl');
  const boldRead = await until(() => pressed('Fett'), (v) => v === 'true', 4000);
  check('…und die Leiste liest ab, was auf ihm liegt', boldRead === 'true', String(boldRead));
  await clickIfThere(toolbarBtn(t, 'Fett'));
  await saveNote(t, noteReader);
  const clearedMarks = await until(
    () => api(BOX('/projects/2')).then((p) => String(p.description ?? '')),
    (d) => !d.includes('**'),
    8000,
  );
  check('das Zurücknehmen wird genauso gespeichert', !clearedMarks.includes('**') && (await noteReader.locator('strong').count()) === 0, clearedMarks);
  check('…und nimmt die Unterstreichung nicht mit', clearedMarks.includes(`<u>${MARK_WORD}</u>`), clearedMarks);

  // ======================================================================== AB · the colour palette
  //
  // Back to the plain note first: this case grows its own run, and starting on the previous one's
  // would make „the sentence beside it stayed uncoloured" a statement about `<u>` instead.
  console.log('\nAB · Die Schriftfarbe: Palette, Klick daneben, Zurücknehmen, Kundenfenster');
  await send('PATCH', BOX('/projects/2'), { description: PLAIN_NOTE });
  await t.reload();
  await ready(t);

  const trigger = colorTrigger(t);
  const colorMenu = palette(t);
  const layers = () => t.locator('.fixed.inset-0').count();
  const glyph = () => trigger.locator('span').first().getAttribute('class').catch(() => '');

  await openNote(t);
  await t.keyboard.press('End');
  await t.keyboard.type(` ${COLOR_WORD}`);
  const toPaint = await selectTail(t, COLOR_WORD.length);
  check('ein Lauf ist ausgewählt, auf den eine Farbe passt', toPaint?.text === COLOR_WORD, toPaint ? `„${toPaint.text}“` : 'keine Auswahl');

  const layersClosed = await layers();
  check(
    'geschlossen: keine Palette, und der Knopf sagt es auch',
    (await colorMenu.count()) === 0 && (await trigger.getAttribute('aria-expanded').catch(() => null)) === 'false',
    String(await trigger.getAttribute('aria-expanded').catch(() => null)),
  );

  await clickIfThere(trigger);
  const openedByClick = await shown(colorMenu, 4000);
  check(
    'der Schriftfarben-Knopf öffnet sie',
    openedByClick && (await trigger.getAttribute('aria-expanded').catch(() => null)) === 'true',
    String(await trigger.getAttribute('aria-expanded').catch(() => null)),
  );
  // The one thing this colorMenu does *not* have, and the reason: a portalled backdrop would take the
  // click, and the editor treats a click landing outside `.rte-root` as „the user left" — it would
  // commit and unmount the note under the open colorMenu (RTE-02). Every other popover in the app does
  // hang one off `document.body`, `ColorSwatchPicker` (the task row's „Farbe wählen") included, so
  // „the colour picker's click-away layer is a second `.fixed.inset-0`" is true of that one and
  // false of this one. Asserted as a count rather than argued, because `topDialog` depends on it.
  check(
    '…ohne eine Klickfangschicht darüber: `topDialog` bleibt, was es war',
    (await layers()) === layersClosed,
    `${layersClosed} → ${await layers()}`,
  );
  check(
    '…denn sie hängt im Editor selbst, nicht am Dokument',
    await colorMenu.evaluate((el) => !!el.closest('.rte-root')).catch(() => false),
  );
  const swatches = await colorMenu
    .locator('[data-roving]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    .catch(() => []);
  check(
    'die Palette ist geschlossen: acht Töne und „Standard“',
    swatches.join(' ') === PALETTE.join(' ') && (await colorMenu.getByRole('button', { name: 'Standard', exact: true }).count()) === 1,
    swatches.join(' ') || 'keine Felder',
  );
  // What „acht Töne" does *not* say, and what the customer's report was really about (WP-74): a
  // 13 px „A" inks 6.3 % of its cell, so eight of them are eight ~94 % white squares whose
  // integrated colours all sit under ΔE00 4 — „ich sehe nur sechs Farben" is that palette read
  // correctly. Four questions in one line, because each is a different way back to a letter:
  // eight chips exist, none of them carries text, the eight fills are eight *different* colours
  // (a chip that lost `bg-current` makes them all `rgba(0, 0, 0, 0)`), and one of them is exactly
  // the hex `index.css` holds — which is what keeps the fill the rule it is about to apply.
  const chips = await colorMenu
    .locator('[data-roving]')
    .evaluateAll((els) =>
      els.map((e) => ({
        id: e.getAttribute('data-color'),
        text: (e.textContent ?? '').trim(),
        fill: e.firstElementChild ? getComputedStyle(e.firstElementChild).backgroundColor : 'ohne Fläche',
      })),
    )
    .catch(() => []);
  check(
    '…und jedes Feld ist eine gefüllte Fläche in seiner Farbe, kein dünner Buchstabe (WP-74)',
    chips.length === 8 &&
      chips.every((c) => c.text === '') &&
      new Set(chips.map((c) => c.fill)).size === 8 &&
      chips.find((c) => c.id === 'blau')?.fill === BLAU,
    chips.map((c) => `${c.id} ${c.fill}${c.text ? ` „${c.text}“` : ''}`).join(' · ') || 'keine Felder',
  );

  await clickIfThere(colorMenu.getByRole('button', { name: 'Blau', exact: true }));
  check('ein Griff in die Palette schließt sie wieder', await gone(colorMenu, 4000));
  await closePalette(t);
  const blau = t.locator('.rte-content span.tc-blau');
  const paintedColor = await blau.first().evaluate((el) => getComputedStyle(el).color).catch(() => 'kein Lauf');
  const plainColor = await t.locator('.rte-content p').first().evaluate((el) => getComputedStyle(el).color).catch(() => 'kein Absatz');
  check(
    '…und färbt genau den ausgewählten Lauf',
    (await blau.count()) === 1 && (await textOf(blau)) === COLOR_WORD && paintedColor === BLAU,
    `${await blau.count()}× „${await textOf(blau)}“ in ${paintedColor}`,
  );
  // The other half: a colour read off the coloured run says nothing until the text beside it has
  // been read *un*coloured — a stylesheet that paints everything #1d4ed8 looks the same from here.
  check('…und nur ihn: der Satz daneben behält die Textfarbe', plainColor !== BLAU, plainColor);
  const glyphShut = await until(glyph, (c) => /\btc-/.test(c), 4000);
  check('der Knopf zeigt danach die Farbe, in der der Cursor steht', /\btc-blau\b/.test(glyphShut), glyphShut);
  // …on the bar and nowhere else (WP-74). A letter painted in the colour *with* a rule under it in
  // the same colour is exactly how „farbig unterstrichen" is drawn — which is what the customer
  // read it as, sitting one button along from „Unterstrichen". The wrapper keeps the class (the
  // line above reads it); the letter carries its own ink. Not an equality on the letter: a
  // Tailwind neutral computes to `oklch(…)` while the hand-written `tc-` hexes compute to `rgb(…)`,
  // so the two are not comparable as strings — „not the palette colour" is the honest form.
  const preview = await trigger
    .evaluate((el) => {
      const spans = el.querySelectorAll('span'); // wrapper, letter, bar
      return {
        letter: spans[1] ? getComputedStyle(spans[1]).color : 'kein Buchstabe',
        bar: spans[2] ? getComputedStyle(spans[2]).backgroundColor : 'kein Balken',
      };
    })
    .catch(() => null);
  check(
    '…und färbt dabei nur den Balken, nicht den Buchstaben',
    preview?.bar === BLAU && preview?.letter !== BLAU,
    preview ? `Buchstabe ${preview.letter} · Balken ${preview.bar}` : 'kein Knopf',
  );

  await clickIfThere(trigger);
  await shown(colorMenu, 4000);
  const active = await colorMenu
    .locator('[data-roving]')
    .evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.getAttribute('data-color')))
    .catch(() => []);
  check('wieder geöffnet ist genau der eine Ton markiert', active.join(' ') === 'blau', active.join(' ') || 'keiner');
  // The other half of the preview, and it belongs **here** rather than at the first open: with no
  // colour applied yet `color` is null, so the class is absent whatever `open` does and the
  // assertion is satisfied by a build that previews while open as well as by one that never
  // previews at all. The caret is in the blue run now, so the line above holds `tc-blau` on a
  // closed trigger and this one requires it gone while the menu is up — a #1d4ed8 „A" on the
  // #262626 the open trigger paints is not a preview of anything.
  const glyphOpen = await glyph();
  check('…und der Knopf lässt seine Vorschau fallen, solange sie offen steht', !/\btc-/.test(glyphOpen), glyphOpen);

  const caretBefore = await caretIn(t);
  const paraBox = await boxOf(t.locator('.rte-content p'));
  if (paraBox) await t.mouse.click(paraBox.x + 12, paraBox.y + paraBox.height / 2);
  check('ein Klick in den Text schließt die Palette', await gone(colorMenu, 4000));
  // …and the same click *lands*, which is the whole reason there is no backdrop — and the only
  // thing that tells the two designs apart, since a swallowed click closes the colorMenu just as well.
  const caretAfter = await until(() => caretIn(t), (s) => !!s && s.from !== caretBefore?.from, 4000);
  check(
    '…und setzt dabei den Cursor, statt geschluckt zu werden',
    !!caretAfter && caretAfter.from !== caretBefore?.from,
    `${caretBefore?.from} → ${caretAfter?.from}`,
  );
  check('…während die Notiz im Bearbeitungsmodus bleibt', (await t.locator('.rte-content').count()) === 1);
  const glyphMoved = await until(glyph, (c) => !/\btc-/.test(c), 4000);
  check('…was der Knopf mitbekommt: dort, wo er jetzt steht, ist keine Farbe', !/\btc-/.test(glyphMoved), glyphMoved);

  // Whatever the click-away did, the chord below has to start from a closed palette — otherwise
  // a broken click-away turns „⌘⇧F opens it“ into „⌘⇧F closes it“ and the case reports the
  // wrong defect.
  await closePalette(t);

  // The keyboard route, and why it exists at all: every toolbar button is `tabIndex={-1}` (WP-43),
  // so this is the only way in without a mouse. It used to reach `GlobalSearch`'s ⌘F listener
  // instead, which takes focus *outside* `.rte-root` — i.e. it committed the note and unmounted
  // the editor, picker and all. Pressing it twice is exactly the shape that used to do that.
  await selectTail(t, COLOR_WORD.length);
  await t.keyboard.press('ControlOrMeta+Shift+F');
  const openedByKey = await shown(colorMenu, 4000);
  const grabbed = await t.evaluate(() => document.activeElement?.getAttribute('data-color') ?? null);
  check('⌘⇧F öffnet sie und setzt den Fokus auf den Ton, der schon gilt', openedByKey && grabbed === 'blau', String(grabbed));
  await t.keyboard.press('ControlOrMeta+Shift+F');
  check('…ein zweites Mal schließt sie wieder', await gone(colorMenu, 4000));
  check('…ohne die Notiz zu speichern und den Editor abzuräumen', (await t.locator('.rte-content').count()) === 1);
  check(
    '…und gibt den Cursor zurück in den Text',
    await t
      .waitForFunction(() => !!document.querySelector('.rte-content')?.contains(document.activeElement), null, { timeout: 4000 })
      .then(() => true)
      .catch(() => false),
  );
  await closePalette(t);

  // „Standard" needs the run *selected*: over an empty selection `unsetMark` only drops the stored
  // mark and the span on screen keeps its colour — while the trigger previews it and the swatch
  // reads `aria-pressed="true"`, so everything on screen says it should have worked.
  const toClear = await selectTail(t, COLOR_WORD.length);
  check(
    'vor dem Zurücknehmen liegt die Auswahl auf dem gefärbten Lauf',
    toClear?.text === COLOR_WORD && (await blau.count()) === 1,
    `„${toClear?.text ?? ''}“, ${await blau.count()}× gefärbt`,
  );
  await clickIfThere(trigger);
  await shown(colorMenu, 4000);
  await clickIfThere(colorMenu.getByRole('button', { name: 'Standard', exact: true }));
  await gone(colorMenu, 4000);
  await closePalette(t);
  check('„Standard“ nimmt die Farbe zurück', (await until(() => blau.count(), (n) => n === 0, 4000)) === 0);
  check('…und lässt den Text stehen, statt ihn mitzunehmen', (await textOf(t.locator('.rte-content p'))).includes(COLOR_WORD));

  // Both directions through the save, because a colour that lives only until the note is closed
  // is not a colour the customer has.
  await selectTail(t, COLOR_WORD.length);
  await clickIfThere(trigger);
  await shown(colorMenu, 4000);
  await clickIfThere(colorMenu.getByRole('button', { name: 'Türkis', exact: true }));
  await gone(colorMenu, 4000);
  await closePalette(t);
  await saveNote(t, noteReader);
  const storedColor = await until(
    () => api(BOX('/projects/2')).then((p) => String(p.description ?? '')),
    (d) => d.includes('tc-'),
    8000,
  );
  check('die Farbe steht als Klasse in der gespeicherten Fassung', storedColor.includes(`<span class="tc-tuerkis">${COLOR_WORD}</span>`), storedColor);
  check(
    '…und die gelesene Fassung malt sie wirklich',
    (await noteReader.locator('span.tc-tuerkis').first().evaluate((el) => getComputedStyle(el).color).catch(() => 'kein Lauf')) === TUERKIS,
    await noteReader.locator('span.tc-tuerkis').first().evaluate((el) => getComputedStyle(el).color).catch(() => 'kein Lauf'),
  );

  await openNote(t);
  await selectTail(t, COLOR_WORD.length);
  await clickIfThere(trigger);
  await shown(colorMenu, 4000);
  await clickIfThere(colorMenu.getByRole('button', { name: 'Standard', exact: true }));
  await gone(colorMenu, 4000);
  await closePalette(t);
  await saveNote(t, noteReader);
  const clearedColor = await until(
    () => api(BOX('/projects/2')).then((p) => String(p.description ?? '')),
    (d) => !d.includes('tc-'),
    8000,
  );
  check('…und das Zurücknehmen wird ebenso gespeichert', !clearedColor.includes('tc-') && clearedColor.includes(COLOR_WORD), clearedColor);

  // The customer's own window, and the one shape the „nur sechs Farben" report could have been
  // about (WP-74): 1536×767 at 125 %, i.e. ~1229×614 DIP, with as little room under the toolbar as
  // the app offers. A **count** is not the assertion — `count() === 8` above passed against the
  // report the whole time — so this one is geometric: each swatch inside the window, inside the
  // menu's own scroll port, and really the topmost thing at its own centre. The arithmetic says it
  // can never fail above a ~248 px viewport (docs/VERIFYING.md has it worked out), and that is
  // precisely why it is worth pinning: the day `useAnchoredPopover`'s cap, its flip or the menu's
  // own height changes, this is the line that says the palette stopped fitting.
  //
  // A context of its own, never `setViewportSize`: a page laid out at 1400 measures a reflow
  // rather than a first layout, which is not a state any window is in.
  //
  // The **Termin dialog's** Notizen and not a page note, and that is not a detail: a description
  // card sits at the top of its page, so scrolling can only carry it *up* and out — the obvious
  // drive („push the toolbar to the bottom edge") moves nothing and measures the roomiest anchor
  // there is, 306 px below. A centred dialog puts the same toolbar 405 px into a 614 px window
  // with 173 px under it — and its body scrolls, which is the clipping RTE-13 fixed with
  // `position: fixed` in the first place.
  const customer = await windowContext(browser, { width: 1229, height: 614 });
  try {
    const c = await open(customer, '/dashboard');
    await pin(c, toolbox.id, '/artist/1');
    // Scope to the section: contact, link and document rows are `li.group` with a
    // `[title="Bearbeiten"]` on them too, so an unscoped selector picks whichever card comes first.
    await clickIfThere(c.locator('[data-section="termine"] li.group [title="Bearbeiten"]'));
    // The dialog's Notizen is a mounted `RichTextEditor` (it is in the tab order), so the click
    // only places the caret — there is no reader to open first.
    const noteOpen = await shown(c.locator('.rte-content'), 8000);
    await clickIfThere(c.locator('.rte-content'));
    await scrollSettled(c);
    await clickIfThere(colorTrigger(c));
    const upSmall = await shown(palette(c), 4000);
    const fit = await c
      .evaluate(() => {
        const menu = document.querySelector('[role="dialog"][aria-label="Schriftfarbe"]');
        const anchor = document.querySelector('.rte-root button[title^="Schriftfarbe"]');
        if (!menu || !anchor) return null;
        const m = menu.getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        const swatches = [...menu.querySelectorAll('[data-roving]')].map((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
          return {
            id: el.getAttribute('data-color'),
            whole:
              r.top >= 0 &&
              r.left >= 0 &&
              r.bottom <= window.innerHeight &&
              r.right <= window.innerWidth &&
              r.top >= m.top - 0.5 &&
              r.bottom <= m.bottom + 0.5 &&
              !!hit &&
              el.contains(hit),
          };
        });
        return {
          below: Math.round(window.innerHeight - a.bottom - 8),
          above: Math.round(a.top - 8),
          box: `${Math.round(m.width)}×${Math.round(m.height)}`,
          scrolls: menu.scrollHeight > menu.clientHeight,
          whole: swatches.filter((x) => x.whole).length,
          cut: swatches.filter((x) => !x.whole).map((x) => x.id),
        };
      })
      .catch(() => null);
    // The staging line, asserted rather than assumed: „acht sichtbar" over a toolbar that never
    // left the top of the window is the emptiest possible pass, so the state this case needs says
    // so on its own line — the way `check:boot` asserts every injected cause.
    check(
      'bei 1229×614 sitzt die Leiste des Termin-Dialogs tief im Fenster',
      noteOpen && upSmall && !!fit && fit.below < 250 && fit.below < fit.above,
      fit ? `Platz unter dem Knopf: ${fit.below} px, darüber ${fit.above} px` : 'keine Palette',
    );
    check(
      '…und dort stehen alle acht Felder vollständig da, nicht sechs (WP-74)',
      fit?.whole === 8,
      fit ? `${fit.whole}/8 ganz sichtbar${fit.cut.length ? `, angeschnitten: ${fit.cut.join(' ')}` : ''}` : 'keine Palette',
    );
    check(
      '…ohne dass die Palette dafür scrollen muss — auch „Standard“ steht ganz da',
      fit?.scrolls === false,
      fit ? `${fit.box}${fit.scrolls ? ' scrollt' : ''}` : 'keine Palette',
    );
  } finally {
    // Closed whatever happened: the window holds an editor that was never saved, and a context
    // left open would keep refetching into every invalidate the rest of the run broadcasts.
    await customer.close().catch(() => {});
  }

  // ======================================================================== AC · the compact bar
  //
  // The same toolbox, trimmed. `compact` is one prop and nothing checks that it *stays* trimmed —
  // a task comment is a cell in a table, and „Tabelle einfügen" or „Bild einfügen" in there is how
  // a Saalplan ends up inside a row. So the case is a pair: the seven buttons that must be there,
  // and the document-sized ones that must not. The palette is deliberately *not* behind that gate
  // — a colour is inline formatting like B/I/U — so it is driven here all the way to the cell's
  // own stored value.
  console.log('\nAC · Die schmale Leiste im Kommentar');
  await t.goto(`${UI}/#/project/7`);
  await t.reload();
  await ready(t);
  const commented = t.locator('[data-task-id="30"]');
  const commentReader = commented.locator('.prose-md:not(.rte-content)').first();
  check(
    'die Demo pflanzt einen gefärbten Kommentar in Aufgabe 30',
    (await shown(commentReader)) && (await commentReader.locator('span[class^="tc-"]').count()) === 1,
    await textOf(commentReader),
  );
  await commented.scrollIntoViewIfNeeded().catch(() => {}); // a missing row must report AC, not abort the run

  // A *double* click: `CommentCell` binds `onDoubleClick` where `InlineNotes` binds `onClick`, so
  // the recipe that opens a description opens nothing here — and „no compact toolbar" is what a
  // real `compact` regression would look like too.
  const commentBox = await boxOf(commentReader);
  if (commentBox) await t.mouse.dblclick(commentBox.x + 20, commentBox.y + 8);
  const compactOpen = await shown(t.locator('.rte-content.ProseMirror-focused'), 8000);
  const bar = await t
    .locator('.rte-root button[title]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('title')))
    .catch(() => []);
  check(
    'ein Doppelklick öffnet die schmale Leiste: B/I/U, Schriftfarbe, Liste, Link, Emoji',
    compactOpen &&
      bar.length === 7 &&
      ['Fett', 'Kursiv', 'Unterstrichen', 'Aufzählung', 'Link einfügen', 'Emoji'].every((x) => bar.includes(x)) &&
      bar.some((x) => x.startsWith('Schriftfarbe')),
    bar.join(' | ') || 'keine Leiste',
  );
  check(
    '…und nichts Dokumentgroßes daneben: keine Überschrift, kein Zitat, keine Tabelle, kein Bild',
    compactOpen && !bar.some((x) => /^(Überschrift|Zitat|Tabelle einfügen|Bild|Nummerierte Liste|Einrücken|Ausrücken)/.test(x)),
    bar.join(' | ') || 'keine Leiste',
  );

  await t.keyboard.press('ControlOrMeta+a');
  const wholeComment = await until(() => caretIn(t), (s) => !!s && s.text.includes('Absprache'), 4000);
  check('der ganze Kommentar ist ausgewählt', !!wholeComment && wholeComment.text.includes('Reihe 1'), wholeComment?.text ?? 'keine Auswahl');
  await clickIfThere(colorTrigger(t));
  await shown(palette(t), 4000);
  await clickIfThere(palette(t).getByRole('button', { name: 'Grün', exact: true }));
  await gone(palette(t), 4000);
  await closePalette(t);
  check(
    'auch die schmale Leiste färbt',
    (await until(() => t.locator('.rte-content span.tc-gruen').count(), (n) => n === 1, 4000)) === 1,
  );
  await saveNote(t, commentReader);
  // `tc-gruen`, never a bare `tc-` — the demo seeds this very comment with a `tc-rot` run, so the
  // loose predicate resolves on the *pre-write* value on its first read and the assertions below
  // are then a coin toss against the PATCH. Doubly so here: `saveNote`'s „the editor is gone" is
  // not a write-resolved signal for a comment, since `CommentCell.onBlur` unmounts first and
  // commits afterwards, where `InlineNotes.commit` awaits the write before it leaves edit mode.
  const storedComment = await until(
    () => api(BOX('/tasks/30')).then((r) => String(r.comment ?? '')),
    (c) => c.includes('tc-gruen'),
    8000,
  );
  check('…und die Zelle speichert, was sie geschrieben hat', storedComment.includes('<span class="tc-gruen">'), storedComment);
  check('…die vorher darin liegende Farbe ist ersetzt, nicht danebengelegt', !storedComment.includes('tc-rot'), storedComment);

  // Handed forward to `images`, `archive`, which reuse them unchanged.
  Object.assign(fixtures, { boxOf, caretIn, openNote, saveNote, toolbarBtn });
}
