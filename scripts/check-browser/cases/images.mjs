/** AD–AG · images in the text */

import { sleep } from '../../lib/wait.mjs';
import { clickIfThere, open, pin, ready, shown, until } from '../browser.mjs';
import { API, RUN, UI } from '../config.mjs';
import { handedOver } from '../fixtures.mjs';
import { check } from '../report.mjs';
import { api, scoped, send } from '../stack.mjs';

/** @param {import('../fixtures.mjs').Fixtures} fixtures */
export async function runImages(fixtures) {
  const { context, pictures } = fixtures;
  /** Five from `toolbox`, which runs immediately before this file, and `textOf` from `subtasks`. */
  const { boxOf, caretIn, openNote, saveNote, textOf, toolbarBtn } = handedOver(fixtures, [
    'boxOf',
    'caretIn',
    'openNote',
    'saveNote',
    'textOf',
    'toolbarBtn',
  ]);
  // ======================================================================== AD–AG · images in the text
  //
  // WP-37 put pictures into the database and into the editor, and case N asserts the far end of
  // that pipe — a note's image reaches the printed PDF as an embedded object of its stored size.
  // Nothing drove the near end: the button that puts one in, the clipboard that must not, the note
  // that has to give both back unchanged, and the Papierkorb that has to leave the bytes alone.
  //
  // **The decision table stays with `npm run check:markdown`**, which runs the same `parseHTML`
  // rules over nine clipboard payloads in jsdom and is where „is this `<img>` admitted" is settled.
  // AE's three foreign payloads *are* three of those nine rows, deliberately: what it adds is the
  // half jsdom cannot have an opinion about — that the rule is reached at all when the HTML comes
  // off the real clipboard through a real keystroke, over routes that hand the editor different
  // HTML than `insertContent` does (three of them, three different answers, all in
  // `docs/VERIFYING.md`), and that the text beside the refused picture lands, which is what tells
  // „refused" from „the keystroke reached nothing". Everything else below has no counterpart there
  // at all: whether the bytes come back, and whether the picture on screen survives a save.
  //
  // In a copy from the first line: three of the four write.

  const PIC = scoped(pictures.id);
  /** The one path images are served from, and the shape `imageRef.ts` validates. */
  const IMAGE_REF = /\/api\/images\/([0-9a-f]{32})/;
  /** A token nothing was ever stored under — „a note pasted in from another season". */
  const STALE_TOKEN = 'a'.repeat(32);

  /** Every picture in the note being read, as the reader draws it. */
  const notePictures = (page) =>
    page.evaluate(() => {
      // The **first** `.prose-md:not(.rte-content)`: an artist's note lives in the header card
      // rather than in a `[data-section]`, and every project card below it renders its own
      // description — page-wide there are four `<img>` on `#/artist/1` where the note has two.
      const note = document.querySelector('.prose-md:not(.rte-content)');
      return Array.from(note?.querySelectorAll('img') ?? []).map((i) => ({
        src: i.getAttribute('src'),
        width: i.getAttribute('width'),
        align: i.getAttribute('align'),
        float: getComputedStyle(i).float,
        inLink: !!i.closest('a'),
        inQuote: !!i.closest('blockquote'),
        // `complete` alone is true for an image that failed, so the pair is what „it loaded" means.
        loaded: /** @type {HTMLImageElement} */ (i).complete && /** @type {HTMLImageElement} */ (i).naturalWidth > 0,
      }));
    });

  // ======================================================================== AD · a picture goes in
  console.log('\nAD · Ein Bild kommt in die Notiz');
  const pic = await open(context, '/dashboard');
  await pin(pic, pictures.id, '/project/2');

  const picReader = pic.locator('.prose-md:not(.rte-content)').first();
  const picEditorImg = pic.locator('.rte-content img:not(.ProseMirror-separator)');
  /** Project 2's description as the demo seeds it — the short plain note AD and AE grow. */
  const PIC_NOTE = String((await api(PIC('/projects/2'))).description ?? '');

  /**
   * The source file, built by the page itself.
   *
   * No dependency, no binary in the repository, and the dimensions are whatever the case needs:
   * 1400×900 so the client's 1200 px resize really has something to do, **transparent** on the left
   * so the white fill JPEG needs (CCL-10) is readable in the bytes that come back, and a flat
   * colour on the right so „it is the right picture" has an answer.
   */
  const sourcePng = Buffer.from(
    (
      await pic.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 1400;
        c.height = 900;
        const ctx = c.getContext('2d');
        if (!ctx) return '';
        ctx.clearRect(0, 0, 1400, 900);
        ctx.fillStyle = '#0b5fe9';
        ctx.fillRect(700, 0, 700, 900);
        return c.toDataURL('image/png');
      })
    ).split(',')[1] ?? '',
    'base64',
  );
  check('die Quelldatei entsteht im Browser: 1400×900 PNG, halb durchsichtig', sourcePng.length > 1000, `${sourcePng.length} Bytes`);

  await openNote(pic);
  const wideBar = await pic
    .locator('.rte-root button[title]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('title')))
    .catch(() => []);
  // The other side of AC's pair: the compact bar must *not* have this button, the document-sized
  // one must — otherwise „no Bild einfügen in a comment" is also true of a build that lost it
  // everywhere.
  check('die dokumentgroße Leiste trägt „Bild einfügen“', wideBar.includes('Bild einfügen'), wideBar.join(' | ') || 'keine Leiste');

  /** Every upload this page triggers. „Nothing was inserted" needs this beside the image count. */
  /** @type {number[]} */
  const uploads = [];
  pic.on('response', (r) => {
    if (r.request().method() === 'POST' && r.url().includes('/api/images')) uploads.push(r.status());
  });

  // Onto a line of its own, which is where a hall plan goes — and which keeps a paragraph of plain
  // text in the note for later: `InlineNotes` opens on a click, a click lands at the element's
  // centre, and a 384 px picture sharing the paragraph *is* that centre (docs/VERIFYING.md).
  await pic.keyboard.press('End');
  await pic.keyboard.press('Enter');

  // Through the button and the panel it opens, never by feeding the hidden `<input type="file">`:
  // the button sets `pickingImage` *before* the panel opens, which is what stops the editor's blur
  // guard committing the note mid-insert (RTE-02), and going around it drives a path nobody has.
  const [chooser] = await Promise.all([
    pic.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
    clickIfThere(toolbarBtn(pic, 'Bild einfügen')),
  ]);
  check('„Bild einfügen“ öffnet die Dateiauswahl', !!chooser);
  if (chooser) {
    await chooser
      .setFiles({ name: 'Saalplan [Probe].png', mimeType: 'image/png', buffer: sourcePng })
      .catch(() => {});
  }

  /** The inserted node, and whether its bytes have arrived — the assertions below need both. */
  const insertedImage = () =>
    pic
      .evaluate(() => {
        const all = document.querySelectorAll('.rte-content img:not(.ProseMirror-separator)');
        const i = /** @type {HTMLImageElement | null} */ (all[0] ?? null);
        return {
          n: all.length,
          src: i?.getAttribute('src') ?? null,
          width: i?.getAttribute('width') ?? null,
          natural: i?.naturalWidth ?? 0,
        };
      })
      .catch(() => ({ n: -1, src: null, width: null, natural: 0 }));

  // The node **and** its bytes. The upload resolves a tick before the `<img>` reaches the document,
  // and the browser has never seen this URL, so a poll that stops at „one image is there" is a round
  // trip ahead of `naturalWidth` — the two assertions below would then read 0 px on a good build.
  const placed = await until(insertedImage, (p) => p.n === 1 && p.natural > 0, 15_000);
  const arrived = placed.n;
  check(
    'die gewählte Datei geht hoch und steht als Bild im Text',
    arrived === 1 && uploads.join('|') === '201',
    `${arrived} Bild(er), POST /api/images → ${uploads.join('|') || 'keiner'}`,
  );
  // A 1200 px plan at full column width shoves everything under it out of view, so a fresh insert
  // starts at „Mittel" — unless the picture is naturally smaller, which this one is not.
  check('…in der Größe „Mittel“, nicht in voller Spaltenbreite', placed?.width === '384', JSON.stringify(placed));
  check('…verkleinert auf 1200 px, bevor irgendetwas hochgeladen wurde', placed?.natural === 1200, `${placed?.natural ?? '—'} px`);
  // The pin is added when the picture is *drawn* and never stored (`resolveSrc`), and the editor
  // needs it as much as the reader: without it the `<img>` inside the editor resolves the registry
  // default and shows nothing, while the stored note looks perfectly correct.
  check(
    '…und der Pin am gezeichneten `src` holt die Bytes auch im Editor',
    new RegExp(`\\?season=${pictures.id}$`).test(placed?.src ?? '') && (placed?.natural ?? 0) > 0,
    placed?.src ?? 'kein Bild',
  );

  await saveNote(pic, picReader);
  const storedPic = await until(
    () => api(PIC('/projects/2')).then((p) => String(p.description ?? '')),
    (d) => IMAGE_REF.test(d),
    8000,
  );
  const token = IMAGE_REF.exec(storedPic)?.[1] ?? '';
  check(
    'die gespeicherte Notiz nennt es saisonfrei und mit seiner Breite',
    !!token && storedPic.includes(`](/api/images/${token}?w=384)`) && !storedPic.includes('season='),
    storedPic.slice(PIC_NOTE.length).trim() || storedPic,
  );
  // The file name is the alt fallback, and file names really do carry brackets („Saalplan
  // [Entwurf].jpg") — unescaped, the `![…]` closes early and the rest of the name becomes text.
  check(
    '…und der Dateiname trägt seine Klammern escaped hinein (IMG-06)',
    storedPic.includes('![Saalplan \\[Probe\\].png]'),
    storedPic.slice(PIC_NOTE.length).trim() || storedPic,
  );

  // Loaded, not merely present: this is the one URL in the run the browser has never fetched, so the
  // reader's `<img>` is a round trip behind the element the count sees.
  const drawn = await until(() => notePictures(pic), (p) => p.length === 1 && p.every((x) => x.loaded), 8000);
  check(
    'der Lesezustand zeichnet es in 384 px, aus denselben Bytes',
    drawn.length === 1 && drawn[0]?.width === '384' && drawn[0]?.loaded === true,
    JSON.stringify(drawn),
  );

  // --- the round trip, read off the wire ---
  const imageUrl = `${API}/images/${token}`;
  const served = await fetch(`${imageUrl}?season=${pictures.id}`);
  const servedHeaders = {
    ct: served.headers.get('content-type'),
    etag: served.headers.get('etag'),
    cc: served.headers.get('cache-control'),
    nosniff: served.headers.get('x-content-type-options'),
    csp: served.headers.get('content-security-policy'),
  };
  const servedBytes = Buffer.from(await served.arrayBuffer());
  check(
    'der Server liefert die Bytes mit den Kopfzeilen, die `immutable` erst ehrlich machen',
    served.status === 200 &&
      servedHeaders.ct === 'image/jpeg' &&
      servedHeaders.etag === `"${token}"` &&
      /immutable/.test(servedHeaders.cc ?? '') &&
      servedHeaders.nosniff === 'nosniff' &&
      /default-src 'none'/.test(servedHeaders.csp ?? '') &&
      servedBytes.length > 0,
    `HTTP ${served.status}, ${servedBytes.length} Bytes, ${JSON.stringify(servedHeaders)}`,
  );
  // `'cache-control': ''` on purpose: undici adds `no-cache` to every request it sends and
  // Express's `fresh` honours it, so the obvious conditional request reads 200 and the route looks
  // like it is ignoring the ETag it just set. A browser revalidating an `<img>` sends no such
  // header, so this is the faithful simulation rather than a workaround.
  const revalidated = await fetch(`${imageUrl}?season=${pictures.id}`, {
    headers: { 'if-none-match': `"${token}"`, 'cache-control': '' },
  });
  check('…und beantwortet einen bedingten Abruf mit 304', revalidated.status === 304, `HTTP ${revalidated.status}`);
  // The pin's own proof, and it needs a token that exists **only** here: the demo's hall plan is in
  // the demo season and in every copy of it, so a request with no pin would find that one anyway.
  const unpinned = (await fetch(imageUrl)).status;
  check('ohne Pin findet dieselbe URL nichts — das ist es, was der Pin tut', unpinned === 404, `HTTP ${unpinned}`);
  const unknown = (await fetch(`${API}/images/${'f'.repeat(32)}?season=${pictures.id}`)).status;
  const malformed = (await fetch(`${API}/images/nicht-hex?season=${pictures.id}`)).status;
  // A stale reference inside prose is not a client error worth distinguishing: 400 would read as an
  // app bug when the honest answer is „that picture is not in this season".
  check('…und ein unbekanntes wie ein unförmiges Token sind 404, nicht 400', unknown === 404 && malformed === 404, `${unknown} / ${malformed}`);

  // The bytes, read back as pixels rather than as a status code. Same-origin through Vite's proxy,
  // so the canvas is not tainted — and this is the only way to see the white fill: JPEG has no
  // alpha channel, so the transparent half of the source must come back **white**. Onto a fresh
  // canvas it would be black, which is CCL-10 and which a byte count cannot tell from the fix.
  const pixels = await pic.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      return null;
    }
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
    return { w: img.naturalWidth, h: img.naturalHeight, links: at(20, 20), rechts: at(img.naturalWidth - 20, 20) };
  }, `/api/images/${token}?season=${pictures.id}`);
  const near = (rgb, want) => !!rgb && rgb.every((v, i) => Math.abs(v - want[i]) <= 12);
  check(
    'die zurückgelesenen Pixel sind wirklich dieses Bild',
    pixels?.w === 1200 && pixels?.h === 771 && near(pixels?.rechts, [11, 95, 233]),
    JSON.stringify(pixels),
  );
  check(
    '…und die durchsichtige Hälfte kam weiß zurück, nicht schwarz (CCL-10)',
    near(pixels?.links, [255, 255, 255]),
    JSON.stringify(pixels?.links),
  );

  // ======================================================================== AE · the clipboard
  //
  // Three routes onto the clipboard and three different answers, which is the whole reason this
  // case is in a browser at all (docs/VERIFYING.md, „Bilder im Text"). `navigator.clipboard.write`
  // resolves every relative URL against the document, so it can only ever present an **absolute**
  // src — right for the foreign half, useless for our own. A genuine in-editor ⌘C does not:
  // ProseMirror writes the clipboard synchronously from the `copy` event, so the reference stays
  // relative and the gate lets it through. Both are driven below; the synthetic `ClipboardEvent`,
  // which admits anything, is deliberately not used for a rule.
  console.log('\nAE · Was die Zwischenablage hereinlässt');
  // A *context* permission, and case U2 already granted these two — repeated because a case must
  // not depend on an earlier one's grant, and the write needs the document focused besides.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: UI });
  await pic.bringToFront();
  await openNote(pic);

  // Reported rather than counted: „no image node" and „no editor" are different defects and this
  // is the line that has to tell them apart for everything below it.
  const picked = await pic
    .evaluate(() => {
      const node = document.querySelector('.rte-content');
      const ed = /** @type {any} */ (node)?.editor;
      if (!ed) return { n: -1, was: node ? 'Knoten ohne Editor' : 'kein Editor offen' };
      /** @type {number[]} */
      const at = [];
      ed.state.doc.descendants((n, pos) => {
        if (n.type.name === 'image') at.push(pos);
      });
      if (!at.length) return { n: 0, was: ed.state.doc.textContent.slice(0, 60) };
      ed.commands.setNodeSelection(at[0]);
      return { n: at.length, was: '' };
    })
    .catch((err) => ({ n: -2, was: String(err).slice(0, 90) }));
  check('das eingefügte Bild lässt sich als Knoten auswählen', picked.n === 1, `${picked.n} Bildknoten ${picked.was}`);
  await pic.keyboard.press('ControlOrMeta+c');
  await sleep(250);
  // Collapsed deliberately. `End` here would run against the caret the editor had *before* the
  // node selection (`DOMObserver` flushes on a ~20 ms timer), the paste would replace the selection
  // with itself, and the image count would not move — which reads as „the paste inserted nothing".
  await pic.evaluate(() => /** @type {any} */ (document.querySelector('.rte-content'))?.editor.commands.focus('end')).catch(() => {});
  await sleep(150);
  await pic.keyboard.press('ControlOrMeta+v');
  const copied = await until(() => picEditorImg.count(), (n) => n === 2, 6000);
  check('⌘C/⌘V im Editor bringt eine zweite Kopie — über die echte Zwischenablage', copied === 2, `${copied} Bilder`);

  /**
   * Put HTML on the **real** clipboard and paste it with the keyboard.
   *
   * Two things are handed back rather than swallowed. The write can reject — it needs the document
   * focused, and this page is one of a dozen the run has opened — and a rejection leaves whatever
   * an *earlier* case copied lying on the clipboard, so the ⌘V then pastes that: a failure that
   * reads as „the paste gate let something through". And the plain text rides along so the
   * assertion can say the paste happened at all; „no picture arrived" is also true of a keystroke
   * that reached nothing.
   */
  const pasteHtml = async (html, text) => {
    const wrote = await pic
      .evaluate(async ([h, t]) => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([h], { type: 'text/html' }),
              'text/plain': new Blob([t], { type: 'text/plain' }),
            }),
          ]);
          return '';
        } catch (err) {
          return String(err).slice(0, 90);
        }
      }, [html, text])
      .catch((err) => String(err).slice(0, 90));
    await pic.keyboard.press('ControlOrMeta+v');
    await sleep(400);
    return wrote;
  };

  for (const [what, src] of [
    ['ein `https:`-Bild aus einer Webseite', 'https://example.com/saalplan.jpg'],
    ['ein `data:`-Bild aus einer Webseite', 'data:image/png;base64,iVBORw0KGgo='],
    ['ein `file:`-Bild aus dem Dateisystem', 'file:///Users/x/saalplan.jpg'],
  ]) {
    const marker = `Fremd-${src.split(':')[0]}`;
    const wrote = await pasteHtml(`<p>${marker} <img src="${src}" alt="fremd"></p>`, marker);
    const landed = await picEditorImg.count();
    const textLanded = (await textOf(pic.locator('.rte-content'))).includes(marker);
    check(
      `${what} kommt nicht mit — der Text daneben schon`,
      landed === 2 && textLanded && wrote === '',
      `${landed} Bilder, Text „${marker}“ ${textLanded ? 'da' : 'fehlt'}${wrote ? `, Zwischenablage: ${wrote}` : ''}`,
    );
  }

  const beforeShot = uploads.length;
  // Reported like `pasteHtml`'s, and for the same reason: a rejected write leaves whatever the run
  // copied earlier lying on the clipboard, the ⌘V then pastes *that*, and „no picture arrived" is
  // true for a reason that has nothing to do with the promise under test.
  const wroteShot = await pic
    .evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      const ctx = c.getContext('2d');
      if (!ctx) return 'kein Canvas';
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(0, 0, 8, 8);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      if (!blob) return 'kein Blob';
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return '';
      } catch (err) {
        return String(err).slice(0, 90);
      }
    })
    .catch((err) => String(err).slice(0, 90));
  await pic.keyboard.press('ControlOrMeta+v');
  await sleep(700);
  // „Paste and drag-and-drop are deliberately not wired" (DECISIONS.md) — an accidentally pasted
  // screenshot must not land in the database, so the upload count is asserted beside the picture.
  const afterShot = await picEditorImg.count();
  check(
    'ein eingefügter Screenshot landet weder im Text noch in der Datenbank',
    afterShot === 2 && uploads.length === beforeShot && wroteShot === '',
    `${afterShot} Bilder, ${uploads.length - beforeShot} Uploads${wroteShot ? `, Zwischenablage: ${wroteShot}` : ''}`,
  );

  /**
   * Drop something on the editor. Returns whether anybody called `preventDefault` — which is how
   * „the editor refused it" is told apart from „the event never arrived".
   */
  const dropOnEditor = (kind, html) =>
    pic
      .evaluate(async ([k, h]) => {
        const dt = new DataTransfer();
        if (k === 'file') {
          const c = document.createElement('canvas');
          c.width = 8;
          c.height = 8;
          c.getContext('2d')?.fillRect(0, 0, 8, 8);
          const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
          if (blob) dt.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
        } else {
          dt.setData('text/html', h);
          dt.setData('text/plain', 'abgelegt');
        }
        const el = document.querySelector('.rte-content');
        if (!el) return { files: dt.files.length, handled: false, was: 'kein Editor offen' };
        const r = el.getBoundingClientRect();
        const init = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: Math.round(r.x + 20), clientY: Math.round(r.y + 8) };
        el.dispatchEvent(new DragEvent('dragenter', init));
        el.dispatchEvent(new DragEvent('dragover', init));
        return { files: dt.files.length, handled: !el.dispatchEvent(new DragEvent('drop', init)), was: '' };
      }, [kind, html])
      .catch((err) => ({ files: -1, handled: false, was: String(err).slice(0, 90) }));

  const beforeDrop = uploads.length;
  const droppedFile = await dropOnEditor('file', '');
  await sleep(500);
  const afterFileDrop = await picEditorImg.count();
  check(
    'eine abgelegte Bilddatei ebenso wenig: der Editor lässt das Ereignis unbeantwortet',
    droppedFile.files === 1 && droppedFile.handled === false && afterFileDrop === 2 && uploads.length === beforeDrop,
    `${JSON.stringify(droppedFile)}, ${afterFileDrop} Bilder, ${uploads.length - beforeDrop} Uploads`,
  );
  // The control, and without it the line above passes on a drop that never reached ProseMirror:
  // the *same* gesture carrying one of our own references is taken.
  const droppedRef = await dropOnEditor('html', `<p><img src="/api/images/${token}" alt="Abgelegt"></p>`);
  const afterDrop = await until(() => picEditorImg.count(), (n) => n === 3, 6000);
  check(
    '…während dieselbe Geste mit einer eigenen Referenz ankommt — sonst prüfte die Zeile darüber nichts',
    droppedRef.handled === true && afterDrop === 3,
    `${JSON.stringify(droppedRef)}, ${afterDrop} Bilder`,
  );

  await saveNote(pic, picReader);
  const storedPastes = await until(
    () => api(PIC('/projects/2')).then((p) => String(p.description ?? '')),
    (d) => (d.match(/\/api\/images\//g) ?? []).length === 3,
    8000,
  );
  const refs = storedPastes.match(/\/api\/images\/[0-9a-f]{32}[^)\s"]*/g) ?? [];
  check(
    'die drei Bilder stehen als drei Referenzen auf dasselbe Token in der Notiz',
    refs.length === 3 && refs.every((r) => r.startsWith(`/api/images/${token}`)),
    refs.join(' ') || 'keine Referenz',
  );
  // What is drawn is not what is stored: the pin would be wrong in every other season, and a copy
  // made inside the editor is exactly how it would get in.
  check('…keine davon mit Saison-Pin', !storedPastes.includes('season='), storedPastes.slice(-160));
  check(
    '…und die Kopie hat die Breite des Originals mitgenommen, die abgelegte keine',
    refs.filter((r) => r.endsWith('?w=384')).length === 2 && refs.filter((r) => !r.includes('?')).length === 1,
    refs.join(' '),
  );

  // ======================================================================== AF · what a note gives back
  //
  // Artist 1's note is the fixture: an imported raw `<img … width="120" align="right">` inside a
  // quote and a linked plan at natural size (WP-37). Before the image node existed both came back
  // out of the editor as the bare word „Saalplan" — the URL gone, no warning, the renderer still
  // drawing the picture from the *stored* text until somebody edited the note. That is the failure
  // this case exists for, and it is only reachable through the app's own door: the editor is built
  // with `useEditor({ content })`, which validates nothing, where `setContent` would repair.
  //
  // The assertion is the **picture list**, not the stored string. Saving rewrites the raw tag into
  // the Markdown spelling (`![…](…?w=120&a=right)`) and `check:markdown` guarantees render-equality
  // rather than byte-identity, so a text diff reports „the editor rewrote my note" against working
  // code. What must hold byte-for-byte is narrower: the same tokens, and no pin.
  console.log('\nAF · Was eine Notiz mit ihren Bildern macht');
  await pic.goto(`${UI}/#/artist/1`);
  await pic.reload();
  await ready(pic);

  const beforeSave = await until(() => notePictures(pic), (p) => p.length === 2 && p.every((x) => x.loaded), 10_000);
  check(
    'die Künstlernotiz zeichnet beide Bilder, und beide sind wirklich geladen',
    beforeSave.length === 2 && beforeSave.every((p) => p.loaded),
    JSON.stringify(beforeSave),
  );
  check(
    '…das importierte 120 px breit rechts im Zitat, das verlinkte in Originalgröße (IMG-08)',
    beforeSave[0]?.width === '120' &&
      beforeSave[0]?.align === 'right' &&
      beforeSave[0]?.float === 'right' &&
      beforeSave[0]?.inQuote === true &&
      beforeSave[1]?.width === null &&
      beforeSave[1]?.inLink === true,
    JSON.stringify(beforeSave),
  );

  const notesBefore = String((await api(PIC('/artists/1'))).notes ?? '');
  await openNote(pic);
  const inEditor = await pic.evaluate(() =>
    Array.from(document.querySelectorAll('.rte-content img:not(.ProseMirror-separator)')).map((i) => ({
      width: i.getAttribute('width'),
      float: getComputedStyle(i).float,
      loaded: /** @type {HTMLImageElement} */ (i).complete && /** @type {HTMLImageElement} */ (i).naturalWidth > 0,
    })),
  );
  check(
    'der Editor zeigt dieselben zwei, geladen und mit ihrer Ausrichtung',
    inEditor.length === 2 && inEditor.every((p) => p.loaded) && inEditor[0]?.width === '120' && inEditor[0]?.float === 'right',
    JSON.stringify(inEditor),
  );

  await pic.keyboard.press('End');
  await pic.keyboard.type(` Nachtrag ${RUN}.`);
  await saveNote(pic, picReader);
  const notesAfter = await until(
    () => api(PIC('/artists/1')).then((a) => String(a.notes ?? '')),
    (n) => n.includes(`Nachtrag ${RUN}`),
    8000,
  );
  // The reader has to be showing the **saved** note before its pictures are read: the API answering
  // is one thing and the re-render another, and in that gap the old elements are still on screen —
  // so a save that ate both images would be compared against the version that still had them.
  const readerSaved = await until(() => textOf(picReader), (t) => t.includes(`Nachtrag ${RUN}`), 8000);
  const afterSave = await until(() => notePictures(pic), (p) => p.length === 2 && p.every((x) => x.loaded), 10_000);
  check(
    'nach dem Speichern zeichnet der Leser genau dieselben Bilder — Größe, Ausrichtung, Zitat, Link',
    readerSaved.includes(`Nachtrag ${RUN}`) && JSON.stringify(afterSave) === JSON.stringify(beforeSave),
    JSON.stringify(afterSave),
  );
  const tokensIn = (s) => (s.match(/\/api\/images\/[0-9a-f]{32}/g) ?? []).join(' ');
  check(
    '…und die gespeicherte Fassung nennt beide Token weiter, keins mit Pin',
    tokensIn(notesAfter) === tokensIn(notesBefore) && tokensIn(notesAfter) !== '' && !notesAfter.includes('season='),
    tokensIn(notesAfter) || 'keine Referenz mehr',
  );

  // A reference whose image did not travel — a note pasted in from another season. Written with
  // the **stale one first**, which is what the second half below needs.
  await send('PATCH', PIC('/projects/3'), {
    description: `![Verlorener Plan](/api/images/${STALE_TOKEN})\n\n![Guter Plan](/api/images/${token}?w=192)`,
  });
  await pic.goto(`${UI}/#/project/3`);
  await pic.reload();
  await ready(pic);
  /** What the note being read shows: the pictures that arrived, and the places that say one did not. */
  const noteState = () =>
    pic.evaluate(() => {
      const note = document.querySelector('.prose-md:not(.rte-content)');
      return {
        drawn: Array.from(note?.querySelectorAll('img') ?? []).map(
          (i) => /** @type {HTMLImageElement} */ (i).complete && /** @type {HTMLImageElement} */ (i).naturalWidth > 0,
        ),
        missing: Array.from(note?.querySelectorAll('span') ?? [])
          .map((s) => (s.textContent ?? '').trim())
          .filter((t) => t.startsWith('Bild nicht gefunden')),
      };
    });
  // Both halves in the predicate. „A message is on screen" becomes true the instant the stale
  // reference's 404 re-renders, which is concurrent with the good picture's own load — so a poll on
  // the message alone hands the pair assertion below a picture that has not arrived yet.
  const mixed = await until(noteState, (m) => m.missing.length > 0 && m.drawn.every((d) => d), 8000);
  check(
    'eine Referenz ohne Bild sagt es im Text, mit ihrem Alt-Text',
    mixed.missing.join(' | ') === 'Bild nicht gefunden: Verlorener Plan',
    mixed.missing.join(' | ') || 'keine Meldung',
  );
  // The pair: a fallback that draws over everything is indistinguishable from this one when only
  // the failing side is read.
  check(
    '…und das Bild daneben wird trotzdem gezeichnet',
    mixed.drawn.length === 1 && mixed.drawn[0] === true,
    JSON.stringify(mixed.drawn),
  );

  // …and the *next* note in that place gets its picture. React reuses this component — same route,
  // same position in the tree, `Markdown`'s `useMemo` rebuilding the elements without remounting —
  // so a boolean „it failed" latched on the first 404 drew „Bild nicht gefunden" over the next good
  // picture until the window was reloaded (IMG-05).
  //
  // **A navigation cannot show that and a reload certainly cannot**: both remount the note, the
  // second one through the loading state a fetch for another row goes through. Measured against the
  // reverted fix, a hash navigation to a second project draws the picture perfectly while this does
  // not. So the note is replaced *under* the component: the row is patched out of band and the
  // window is asked to refresh itself, which keeps the tree standing.
  //
  // Focus is dispatched from inside the poll rather than once: `staleTime` is 5 s, so a focus
  // sooner than that refetches nothing at all, and the wait then ends as early as it can instead of
  // on a fixed sleep. The predicate counts *nodes* — the note above renders two, a picture and a
  // message, and the one below renders one — so it cannot resolve on the pre-write note.
  await send('PATCH', PIC('/projects/3'), { description: `![Anderer Plan](/api/images/${token}?w=128)` });
  const next = await until(
    async () => {
      await pic.evaluate(() => window.dispatchEvent(new Event('focus'))).catch(() => {});
      return noteState();
    },
    (m) => m.drawn.length + m.missing.length === 1,
    12_000,
  );
  check(
    '…und die nächste Notiz an derselben Stelle zeigt ihres, statt die Meldung zu erben (IMG-05)',
    next.drawn.length === 1 && next.drawn[0] === true && next.missing.length === 0,
    JSON.stringify(next),
  );

  // ======================================================================== AG · a cell, and the bin
  console.log('\nAG · Das Bild in der Zelle, und was der Papierkorb damit macht');
  await send('PATCH', PIC('/tasks/30'), { comment: `Saalplan: ![Zellbild](/api/images/${token}?w=96)` });
  await pic.goto(`${UI}/#/project/7`);
  await pic.reload();
  await ready(pic);
  const cellRow = pic.locator('[data-task-id="30"]');
  await cellRow.scrollIntoViewIfNeeded().catch(() => {}); // a missing row must report AG, not abort the run
  const cellReader = cellRow.locator('.prose-md:not(.rte-content)').first();
  const cellPicture = await until(
    () =>
      cellRow
        .locator('img')
        .first()
        .evaluate((i) => ({
          src: i.getAttribute('src'),
          width: i.getAttribute('width'),
          box: Math.round(i.getBoundingClientRect().width),
          loaded: /** @type {HTMLImageElement} */ (i).complete && /** @type {HTMLImageElement} */ (i).naturalWidth > 0,
        }))
        .catch(() => null),
    (p) => !!p?.loaded,
    8000,
  );
  check(
    'ein Bild in einer Kommentarzelle wird gezeichnet, in der Breite, die dort steht',
    cellPicture?.width === '96' && cellPicture?.box === 96 && cellPicture?.loaded === true,
    JSON.stringify(cellPicture),
  );

  // A *double* click: `CommentCell` binds `onDoubleClick` where `InlineNotes` binds `onClick`.
  const cellBox = await boxOf(cellReader);
  if (cellBox) await pic.mouse.dblclick(cellBox.x + 20, cellBox.y + 8);
  const cellOpen = await shown(pic.locator('.rte-content.ProseMirror-focused'), 8000);
  await sleep(200);
  await pic.keyboard.press('End');
  // What is asserted is that the caret is **collapsed**, not where it is: a double click leaves a
  // word selected and typing into a selection replaces it, which on a one-line comment can be the
  // picture. Where it ends up is the click's own position — `End` runs against the selection the
  // editor had before the click, through `DOMObserver`'s ~20 ms flush — and that does not matter
  // to anything below.
  const cellCaret = await until(() => caretIn(pic), (s) => !!s && s.from === s.to, 4000);
  check(
    'die schmale Zelle öffnet sich mit dem Bild darin und einem leeren Cursor',
    cellOpen && (await picEditorImg.count()) === 1 && !!cellCaret && cellCaret.from === cellCaret.to,
    `${await picEditorImg.count()} Bilder, Auswahl ${cellCaret?.from}–${cellCaret?.to}`,
  );
  await pic.keyboard.type(' Nachtrag.');
  // `CommentCell` unmounts *before* it commits, so „the editor is gone" says nothing here — poll
  // the API for a value only the write can produce.
  await pic.keyboard.press('ControlOrMeta+Enter');
  const storedCell = await until(
    () => api(PIC('/tasks/30')).then((t2) => String(t2.comment ?? '')),
    (c) => c.includes('Nachtrag.'),
    8000,
  );
  check(
    '…und gibt das Bild beim Speichern wieder her, statt es zu seinem Alt-Text zu machen',
    storedCell.includes(`![Zellbild](/api/images/${token}?w=96)`),
    storedCell,
  );

  // Images are deliberately outside the cascade: `CHILD_EDGES`, `DELETE_ORDER` and `TABLE_TYPE` are
  // generated from the foreign-key graph, and an image reference lives inside a TEXT column no
  // foreign key describes — so `purgeExpired`, which walks `DELETE_ORDER`, can never reach a row
  // here. Adding the table there would read as a tidy-up and behave as data loss. What the customer
  // meets is this: a note that spent a while in the Papierkorb still has its pictures.
  const trashed = await send('DELETE', PIC('/projects/3'));
  check(
    'das Projekt mit der Bildnotiz liegt im Papierkorb',
    trashed.status === 200 && (await send('GET', PIC('/projects/3'))).status === 404,
    `HTTP ${trashed.status}`,
  );
  // An invariant guard rather than a regression detector, and worth knowing before writing a canary
  // for it: the change this line forbids is putting `images` into `DELETE_ORDER`, and a *soft* delete
  // never walks that list — so no plausible revert takes it red on its own. What bites AG is the
  // season pin (the cell, and the restored note) and the width the cell has to give back.
  const stillServed = (await fetch(`${imageUrl}?season=${pictures.id}`)).status;
  check(
    '…und seine Bytes werden weiter ausgeliefert: Bilder hängen nicht an der Kaskade',
    stillServed === 200,
    `HTTP ${stillServed}`,
  );
  const restored = await send('POST', PIC('/deleted/project/3/restore'));
  check('das Wiederherstellen holt den Eintrag zurück', restored.status === 200 && (await send('GET', PIC('/projects/3'))).status === 200, `HTTP ${restored.status}`);
  await pic.goto(`${UI}/#/project/3`);
  await pic.reload();
  await ready(pic);
  // One `<img>`: the IMG-05 step above patched this description down to a single reference, so the
  // stale one is long gone — the count is right for that reason and not because a second picture is
  // failing somewhere. And the wait is on **loaded**, not on the element: a `reload()` revalidates
  // every `<img>` over the network (see the 304 above), so „the node is there" resolves a round trip
  // before the bytes do, and the assertion under it would read `loaded: false` on a good build.
  const afterRestore = await until(
    () => notePictures(pic),
    (p) => p.length === 1 && p.every((x) => x.loaded),
    10_000,
  );
  check(
    '…und die Notiz zeichnet ihr Bild wieder, aus derselben URL',
    afterRestore.length === 1 &&
      afterRestore[0]?.loaded === true &&
      afterRestore[0]?.src === `/api/images/${token}?season=${pictures.id}`,
    JSON.stringify(afterRestore),
  );
}
