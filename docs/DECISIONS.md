# Decisions

Things that were considered and **deliberately not done**, with the reasoning that made them
decisions rather than oversights. Most came out of the 2026-07 full-codebase review, where several
were raised more than once by different passes — which is exactly why they are written down.

If you are about to re-raise one of these, the bar is new information, not a fresh opinion.

---

## Zwei Klicks bis zum Bericht — die Fragen sind gestrichen (2026-08-26, WP-75)

Instigated by Andre, in his own words: „the 'send feedback' workflow is too complicated. it should
be 2-3 mandatory clicks max. manually writing should be optional. by default only the complete log
/ debug report should be saved to desktop and clear, short instructions + email adress (copy&paste)
should be provided."

**What it cost before.** „Feedback senden…" opened a dialog that asked which kind of thing this was
(Fehler/Wunsch), then which of five areas it was in, then made the person write an answer that was
required before the primary button became live — three text boxes, every keystroke measured against
a `mailto:` budget — and only then wrote the file and stacked a second dialog offering an address, a
subject and a body to copy. Seven to nine clicks and a paragraph of typing before anything was on
the desktop. Every one of those steps had a reason (they are the entries below this one) and the sum
of them was a feature the customer it exists for does not get to the end of.

**What ships.** Open · „Bericht speichern" · „Fertig". The report is written on the second click
whether or not a word was typed, and the state that follows is the file's name, the address on one
copy button and two sentences: attach it and send it, it contains no private or confidential
data (Andre, 2026-08-26: the plain promise, never the enumeration — the same phrasing in the
crash dialog and the bundle header). The optional box above the button is the only thing left
of the form.

- **The kind and the area are gone.** They fed a subject line — the thing an inbox sorts on — and
  cost two mandatory clicks to fill it in. What they answered is answerable from the report
  itself: the bundle names the version, the machine and every boot, and the person's own sentence
  says which of the two it is far better than a radio button does. One maintainer, no intake
  service, and a reply is threaded on the reference, not on the filing.
- **The text is optional, and the file is written without it.** That is the whole of Andre's
  „by default only the complete log". A report with no words in it is still the log, the version,
  the OS and the screen — the four things every support answer starts by asking for — and a
  required box is what turns „I'll report this" into „not now". The bundle's „Meldung" section then
  carries `FEEDBACK_NO_NOTE` rather than nothing, in the same voice as the crash bundle's
  `CRASH_REPORT_TEXT`: a section where the person's words go, saying that there are none and asking
  for one sentence in the mail.
- **Only the address is copyable now.** The mail is the customer's to write — in webmail, in their
  own words — and what it has to carry is one attachment. A subject and a body to copy were two
  more decisions on a screen whose whole job is to have none, and both of them are in the file.
- **The two steps are one dialog in two states**, not two stacked ones. The handover *replaces* the
  form, which is what a step is; the form is one optional box, so there is nothing behind it worth
  keeping on screen, and „Escape peels the top layer" stops being a rule anybody has to know. The
  `Modal` places focus when it opens, so the second state places its own („Adresse kopieren").
- **„Text ergänzen" is the way back**, and it is the only path that writes a second bundle. Named
  rather than „Zurück" because the only reason to go back is to say something.

**What stands, unchanged.** WP-66's contract below is untouched: nothing on this path opens
anything the customer did not click, the `mailto:` survives as one optional link, and „Fertig"
claims nothing. The file is still written to the desktop on the way *into* the handover and the
handover still waits for main's answer, because a second save is `…-2.txt` and every line names the
file. The dialog still remembers report text → name, so a text already on the desktop is named
rather than written again.

**What went with it in `client/src/lib/feedbackMail.ts`.** `FEEDBACK_KINDS` and its questions,
`requiredField`, the area list, and — because the note's home is the file rather than a URL —
`FEEDBACK_FIELD_MAX`, `feedbackHeadroom` and `fitFeedbackAnswer`, with the composer's four-rung
ladder down to two: drop the boot digest, then clip the note and mark it. The renderer's own
`diagnosticsFileName` went too: nothing in the app names a file before main has written it, so the
prediction and the cross-module assertion that held it to `electron/diagnostics.ts` are gone. The
two entries below that decided the questions and the keystroke budget are reversed by this one.

---

## „Ein Weg, keine Auswahl" — REVERSED: the feedback path opens nothing by itself (decided 2026-08-14 WP-54, reversed 2026-08-17 WP-66)

**What WP-54 decided.** One button and one path. „Text kopieren" was removed on 2026-08-14 as a
hedge — „two buttons of equal weight, and the customer deciding which situation they are in
before they know they are in one" — and „Diagnoseordner öffnen" went with it once the bundle was
written for them. What was left was „E-Mail öffnen": one click that wrote
`Auftakt-Diagnose-<ref>.txt` to the desktop, revealed it with `shell.showItemInFolder`, and
launched the customer's mail client on a prepared `mailto:`, in that order, „so the compose
window is what ends up in front". The fallback for a machine without a mail client was one
sentence of plain text under „Was wird mitgeschickt?".

**Why it is reversed.** The entry that removed „Text kopieren" already named the failing case —
„a machine with no mail handler clicks „E-Mail öffnen", nothing opens, and the app then holds no
address anywhere" — and answered it with a sentence, because that machine was priced as the edge
case. It is not the edge case. The customers this feature exists for read their mail in Gmail in a
browser; the local client is either absent or the one they abandoned, and a `mailto:` on such a
machine opens nothing, or opens the wrong thing. Instigated by Andre on 2026-08-17 out of the
macOS pass, on his own device, in his own words: „works but is too much opening happening at once
— DO NOT OPEN A MAIL PROGRAM OR FINDER."

Two windows also arrived *before* anything had been read. The Finder window and the compose
window landed on one click, and the one step the app genuinely cannot take — attaching the file —
was explained in a dialog that was by then behind both of them.

**The new contract.** „Weiter" writes the diagnostics file to the desktop and shows the handover;
after that every step is the customer's own click, and the app opens nothing on its own.

> **WP-75 (2026-08-26) kept that contract and cut the flow around it** — see the entry above. The
> button is „Bericht speichern", the handover is the same dialog rather than a second one, and the
> three copy rows are one („Adresse kopieren"). What is *not* touched is the sentence this entry
> exists for: nothing on this path opens anything the customer did not click.

- **The file is still written, and still to the desktop.** That half of WP-54 stands unchanged:
  a `mailto:` cannot attach, so the file exists to be attached by hand. Only the reveal is gone —
  `shell.showItemInFolder` now appears nowhere in the app.
- **It is written on „Weiter", not on the last button — and the handover waits for it.** The
  customer leaves for their mail in the middle of the handover and attaches the file before coming
  back, so a step telling them to attach a file main has not written yet is the one instruction
  the dialog must not give. Waiting is the other half of the same sentence: every line of the
  handover names the file — the attach step, the body „Text kopieren" hands over, the `mailto:`,
  the toast — and the name is predictable exactly once. Going „Zurück", correcting an answer and
  pressing „Weiter" again writes a *second* bundle, because attaching the first version of what
  they wrote is worse than a stray text file, and `uniqueBundleName` calls that one `…-2.txt`. A
  handover opened on the prediction would send them to the file holding the draft they had just
  replaced, so „Weiter" is disabled for the length of the write instead. The dialog remembers
  report text → name, so a text that is already on the desktop — an unchanged one, or an edit
  taken back — names *that* bundle rather than writing a third.
- ~~**The handover is the mail, field by field**: An, Betreff, Text — the order the compose window
  asks for them in — each with its own copy button. This is the „Text kopieren" WP-54 removed, and
  it comes back for the opposite reason to the one it left with: it is no longer a second path
  competing with a first, it *is* the path. The Betreff is shown in full because it is what the
  inbox sorts on; the Text is described rather than printed, since it is on screen in full one
  dialog back under „Was wird mitgeschickt?".~~ **Cut to the address alone on 2026-08-26 (WP-75):**
  the mail is the customer's to write and the report is the file, so a subject and a body to copy
  were two decisions on a screen that should have none.
- **The `mailto:` survives as one optional link**, last and small, for whoever does have a client
  set up. A link rather than a button, and never the primary: on the machines this feature is for,
  an offer that opens nothing is worse than no offer.
- **The no-mail-client sentence under „Was wird mitgeschickt?" is dropped.** It existed because
  the address appeared nowhere else when nothing opened; the address is now the first row of the
  handover, on both branches, and a second telling is a second thing to keep true.
- **What „Fertig" may claim is unchanged, for WP-54's reason.** The app cannot learn whether a
  mail was sent, so nothing says „gesendet"; the toast names the file, because the file is the
  only thing that outlives the dialog.

**What did not come back.** „Diagnoseordner öffnen" stays removed, and no button anywhere routes
the customer into `userData` — that decision was about a folder full of Chromium caches and
nothing above bears on it.

---

## Das Browser-Gate bringt seinen Browser selbst mit und steht neben `npm run check` (2026-08-17, WP-R6, #7)

The client had no automated coverage that ever lays a page out. `check:unit` reaches pure
modules, the three boot-the-server gates are server and persistence — and everything in between
was a person, on two operating systems, remembering the traps in `docs/VERIFYING.md` before every
release. „No test framework — REVERSED" above says why that stops being enough; this is the half
of it that was still missing.

**Why `playwright-core` and not `playwright`.** PR #56 declined a dependency for a concrete
reason: `playwright`'s postinstall downloads the browsers, so adding it puts half a gigabyte in
front of every `npm ci` — the `checks` job's, the `build` matrix's and anyone else's, none of
which drive a browser. `playwright-core` is the same API with **no install script at all**; the
browser is fetched explicitly, once, by the one job that needs it. Pinned exact (`1.62.1`, no
caret) because a browser build is pinned with it: that version maps to chromium `1234`, which is
what the machine this is developed on already has cached, so the new dependency downloads nothing
locally and CI pays for it once per lockfile change.

**The two runtimes are now separate questions, deliberately.** `~/.claude/tools/playwright`
remains the local convention for throwaway driving scripts, guarded by a hook that denies fresh
installs — it is a *machine* convention, and CI never had it. The committed gate resolves its
runtime out of the repository instead, so nothing in a public repo points at a path outside it.
The cost is that `scripts/check-browser.mjs` re-implements ~60 lines of that shared library
(`launch`, `ready`, `open`, `windows`, the dialog scoping). Recorded here so the duplication is
not later „fixed" by importing across the boundary: the repository may not depend on one
developer's home directory, and that library may not be vendored without becoming a second thing
to maintain.

**It is not in `npm run check`, and that is not about runtime.** `check` has to stay runnable on
any machine at any moment — no browser binary, no free port. The gate needs both: it drives Vite
on **5317**, and 5317 cannot move, because `ALLOWED_ORIGINS` is derived from `CLIENT_DEV_PORT` and
a client on any other port gets a bare 403 that reads exactly like a broken feature. So it refuses
to start beside a running `npm run demo` rather than working around it — it rebuilds `.demo`, and
a rebuild under a live server is the deleted-inode trap `VERIFYING.md` already records.

**But it runs on every pull request**, unlike `check:package`, which is the other gate outside
`check`. That one inspects a build and only a tag produces one. This one guards behaviour that
changes on ordinary days, and a regression in the two-window matrix found at release time is the
cadence problem the reversal was about. Its own job, parallel to `checks`, so it costs wall clock
only when it fails.

**Against the dev server, not a built bundle.** `VERIFYING.md`'s recipes are written for
`npm run demo`; the boot overlay does not exist there at all (`'%PROD%' !== 'true'`), and
`reducedMotion: 'reduce'` removes it in a build anyway. Driving a build would mean adding a
`vite build` to a job that does not build, in exchange for the one surface this gate deliberately
does not cover.

**What the gate is, and what it is not.** Two halves: the two-window season matrix that WP-R2 only
ever drove from a scratchpad since deleted (focus refetch, the broadcast and its negative control,
the window-local switch, the 410 recovery, the export under a dead pin) and the core paths the
manual Windows hour walks anyway (create and complete a task, hide and show a column, save the
editor). It is **not** issue #7, which stays open: print sheets, drag reordering, the settings
tabs and the narrow-window sweep are not in it.

**Its proof is a fixed one.** Revert `client/src/main.tsx`'s focus listener to `handleFocus(true)`
— the #54 latch — and case A must fail. It does: the first focus still refetches (12 requests) and
the second refetches nothing, every other case staying green. That shape is the point. #54's
failure mode is *silence*, so a case that watches the first focus passes against the defect, and
a gate that cannot fail is worse than no gate.

**The fixtures move, so the assertions are relative.** `server/src/demo.ts` builds its dates from
the seed day on purpose. The gate rebuilds `.demo` at every run and asserts relatively throughout
— never an absolute date, never a literal `sort_order`, never a hardcoded season id. Fixture
seasons carry a run-unique label and are swept in `finally`, including leftovers of a killed run.

---

## Der Changelog wird geschrieben, nicht generiert (2026-08-16)

`generate_release_notes: true` in `.github/workflows/build.yml` has written every release body
since `v0.6.1`. What it produces is a list of PR titles: Dependabot bumps inline with features,
and the `Release X.Y.Z` bump PR describing itself. `v0.9.2`'s entire body is two lines, one of
them that bump PR. `v0.5.0` and `v0.6.0` read completely differently — German, benefit-first,
bold lead-ins — because a person wrote them. Nothing changed in 0.6.1 except that nobody did.

**So it becomes a step rather than a habit**, in the release skill (2 and 6) and in a `changelog`
skill that holds the editorial rules. The rules are worth separating from the pipeline: they are
long, they are about writing rather than about `gh`, and „was hat sich geändert" is a question
worth answering outside a release too.

**Committed as `CHANGELOG.md`, German, and filtered hard.** The reader runs a festival office;
they know Künstler, Saison and Papierkorb, and they must never be asked to care what a work
package or a lockfile is. Every commit lands in one of three buckets — a bullet, one collective
`Außerdem` line, or silence — and most of any range is silence. Capped at five bullets, because
a patch release honestly described is short and that is information too.

**`generate_release_notes` stays on.** Now that the body is overwritten before publishing, the
generated text costs nothing and is the one mechanical check that no PR was overlooked: read it
as a checklist, then replace it. Switching it off would trade a free completeness guard for
tidiness in a workflow that is otherwise not worth touching.

**The entry ships in the commit the tag names.** The packaged app carries the file it was built
from, so an entry written after tagging is invisible to exactly the users running that version.
That constraint exists for a surface that does not exist yet — the what's-new popup on the first
cold launch after an update (`WP-63`) — and it is cheap to honour now and impossible to honour
retroactively. It is also why `## X.Y.Z` is a bare version number: that heading is the anchor the
popup will split the file on.

**Download instructions stay out of the file.** The `xattr` and SmartScreen paragraphs belong to
the release page, which additionally answers „wie installiere ich das". `CHANGELOG.md` answers
only „was hat sich geändert", which is what keeps it short enough to show in a dialog.

---

## Schriftfarbe ist eine geschlossene Palette als Klasse, kein `style` (2026-08-16, WP-62)

The report was one sentence — „der user moechte text gerne farbig machen" — and the scope was cut
before any code was written (2026-08-15): **font colour only**, no highlighter. One mark, one
toolbar button, the smallest thing that answers it. A background would need its own contrast rules,
its own print behaviour (Chromium prints foreground colour by default and backgrounds not at all)
and a second axis in the same menu; nothing in the report asks for it.

**Markdown has no colour, and Markdown is what is stored.** The precedent is underlining: it
serializes to a raw `<u>` and the reader whitelists the tag. So the colour serializes to
`<span class="tc-rot">…</span>`, and the sanitize schema — GitHub's default, minus `code`/`pre`
(WP-49), plus `u` — gains exactly one attribute: a `className` on `span` matching
`TEXT_COLOR_CLASS`. `hast-util-sanitize` takes a RegExp in a value allowlist, the form the schema
already used for `code: [['className', {}]]`.

**`style` was the obvious alternative and is deliberately refused.** It is what
`@tiptap/extension-text-style` + `@tiptap/extension-color` store — two dependencies that would have
had to be bent anyway — and freeing it in the schema means arbitrary CSS in stored text. That text
is not only ours: it arrives from a CSV import, from a restored backup and from a Notion export, so
the schema is a boundary against files nobody in this repository wrote. A `tc-` class cannot be a
CSS surface: the worst an unknown one can do is render in the default colour, because the only
thing that paints is a rule in our own stylesheet. `check-markdown.ts` gained a fifth suite-wide
assertion for it — no case may render a `style` attribute — because render-equality compares two
runs of the same renderer and would not notice either half of that regression.

**Two consequences, stated so they are not reported as bugs later.** A Notion export carrying
`style="color:…"` loses its colour at the sanitizer — the text survives, the colour does not, and
re-colouring it is two clicks. And the **.xlsx export writes the stored Markdown verbatim**
(`server/src/routes/export.ts`, the `comment` column), so the colour does not quietly vanish there
— the tag itself lands in the cell, `<span class="tc-rot">final</span>` around one word. That is
what `**fett**` and `[Text](https://…)` have always done in that sheet; a colour is simply the
longest of them. Not changed here: the export is a data handover rather than a rendering, and
teaching it to strip Markdown is a decision about every column that carries prose — starting with
what „strip" should mean for a link.

**The palette is not `ColorSwatchPicker`'s.** Those sixteen colour a *dot* beside a list entry,
where lightness is decoration; as text on white its yellow reads at 1.9:1 and cannot be read at
all. Eight darker tones instead, every one ≥ 4.5:1 against white, pinned by `textColor.test.ts` —
which also pins the split that keeps them honest: the ids live in `lib/textColor.ts`, the hex
values *only* in `index.css`, and the picker paints its own swatches with the rule it is about to
apply, so no colour is written down twice. What is borrowed from that component is the mechanism
(`useAnchoredPopover`, `rovingItem`/`useRovingFocus`), not the list.

**No „eigene Farbe".** It follows from the closed palette rather than being a separate judgement: a
free colour can only be spelled as a `style`. It also removes the reason the swatch picker holds a
draft until it closes (RTE-08, the native colour wheel firing per frame) — nothing in this menu
fires more than once.

**A done task's grey outranks the colour, and that ordering is the reason WP-58 came first.** A
colour class inside a finished task's comment would otherwise sit red on a row that is grey and
struck — „erledigt, aber immer noch dringend" — which is the same failure `.prose-md blockquote`
produced one package earlier and is fixed in the same place: `.prose-md--done` hands the colour
back to the row. That it *can* be handed back is the point of a class; against `PillSelect`'s
inline `style` no Tailwind class wins, which is why that one needs a filter instead.

**Inside a raw-HTML mark, the content is Markdown — because that is what the reader reads there.**
The colour is the innermost mark whenever it *can* be: mark registration order puts it inside `**`
and `<u>`, so „ein Wort einfärben" stores `**<u><span class="tc-rot">…</span></u>**`. But it cannot
always be, and the gesture that proves it is the most natural one in the feature — select the whole
paragraph, then pick a colour. A mark that outlives the marks inside it has to open outside them
(`getMarksToOpenForSerialization`), so that is stored as
`<span class="tc-rot">aaa **bbb** ccc</span>`: Markdown inside a raw tag.

That string is *correct* — remark parses inline HTML as a tag and its content as Markdown, so the
reader draws exactly what the editor did. The editor was the half that disagreed: `MarkdownManager`
hands raw inline HTML to `generateJSON`, i.e. reads the content as HTML, so `**bbb**` came back as
four literal asterisks and the next save escaped them to `\*\*bbb\*\*`. One save and the bold was
decoration; two and the reader showed the backslashes. Links went the same way, and ordinary
punctuation (`Preis_pro_Person`, `[ca. 5000]`) grew a backslash per save, without limit.

**So the read side follows the reader**, rather than the serializer being taught to split runs
around their children: a tokenizer on this module's own `Marked` instance claims `<u>…</u>` and
`<span class="tc-…">…</span>` and lexes what is between the tags as inline Markdown (`MdRawMark`,
`lib/richtext.ts`). It is one rule for both tags because it is one question, and it repairs `<u>`,
which has had the identical flaw since WP-Q and no gesture common enough to expose it. Eight corpus
entries hold it; seven of them fail on the unfixed code, and idempotence is the assertion that
bites, because the *first* save was always right.

**Whatever the HTML parser did, the tokenizer has to do**, and the first thing it does is decode
character references: the path this replaces ran an HTML parser, and `&nbsp;` is what every Notion
export, CSV import and restored backup is made of. Reading it as literal text wrote `&amp;nbsp;`
back on the next save, and from there the reader was wrong too — the same trust boundary this whole
entry is about, walked from the other side. Four of the references are left encoded on purpose
(`&amp; &lt; &gt; &quot;`): the manager decodes those itself after lexing, so skipping them is what
makes each exactly one decode and keeps `&amp;nbsp;` the literal text it says it is. A reference
that decodes *into* Markdown syntax (`&ast;`) is escaped, because it was text to the HTML parser
and must not become emphasis on the lexer pass that follows. The stored text is therefore
normalised on the first save — the entity becomes the character — while the rendered HTML does not
move at all.

**⌘⇧F opens the picker, and `GlobalSearch` stopped swallowing it.** Every toolbar button carries
`tabIndex={-1}` (WP-43), which is only defensible because each has another keyboard route, and a
popover has no natural one. ⌘F/⌘K reach the search field from anywhere — deliberately including
from inside a text field — and that listener matched „f" with any modifier combination, so ⌘⇧F
opened the picker *and* pulled focus out of the note, committing it mid-edit. It now ignores a key
whose `defaultPrevented` says a layer below already answered it, which is the rule `Modal`'s Escape
has always followed.

**…and the shortcut toggles, from both sides of the focus boundary.** `defaultPrevented` only
speaks for keys ProseMirror actually saw, and the second press of ⌘⇧F is not one of them: by then
the menu owns focus, the keymap is out of reach, nothing marks the key, and the global listener
took it — the same commit-and-unmount the paragraph above is about, reached by pressing the
shortcut twice. So the menu answers for itself and stops the key dead, while the editor-side
handler closes an open picker instead of re-opening it. A shortcut that opens something has to
close it too; anything else is a trap for the hand that pressed it once too often.

## Sichtbarkeit wird lokal, alles andere an der Spalte bleibt global (2026-08-16, WP-59)

The customer reported the split as the defect: „zurzeit lassen sich Aufgabenspalten teilweise in
Einstellungen, teilweise in der App selbst bearbeiten (quasi global vs. local). Das ist aber nicht
sehr intuitiv. Alle Spalten sollten ‚local' bearbeitbar sein — z. B. ein Projekt sollte ‚Fällig'
haben können und ein anderes nicht." Until now `enabled` was a property of the *column*, so the
entity page could only render the globals as read-only pills under „Globale Spalten (in
Einstellungen verwalten)" — the inconsistency, literally on screen.

**„Alle Spalten lokal bearbeitbar" is answered as visibility, not as everything.** What a page
shows is now the pair (column, page): `artists.task_columns` / `projects.task_columns` hold that
page's departures from `custom_columns.enabled`. Name, options, order and scope stay season-wide,
and each for its own reason. A **name** per page would make one column read „Fällig" here and
„Deadline" there while `task_sort` and the .xlsx name a third thing. **Order** per page would
replace TTU-21's reasoning outright: `compareColumns` sorts scope-first *because* each scope group
renumbers from 0, so a per-page ordinal needs a different total order, on every consumer, for a
gesture nobody asked for. And the **scope** is what WP-51 built. Visibility is the whole of what
the raw note actually names, and it is the only one of the four whose per-page answer costs
nothing anywhere else.

**Form A, because the pattern already existed.** `artists.layout` (WP-25/WP-31) is the same „per
entity, with a season-wide template" shape: `NULL` follows the template, the migration is a plain
`ensureColumn` with no table rebuild, and `useEntityLayout` was the finished hook to copy. The
alternative — a join table of (column, entity, visible) — buys a query per page for a value that is
never listed, aggregated or filtered on, and would have needed a cascade edge, a Papierkorb
sublabel and a season-copy group of its own.

**The map is sparse, and an override that agrees with the default is deleted.** A dense map („these
are my columns") freezes the page: a column created in Einstellungen afterwards would never reach
any page that had ever been configured — the same failure a stored `layout` avoids by treating an
*absent* key as „this build added a section", not as „hidden". And pruning is what makes toggling a
column back the way back: without it a page that had been set and unset keeps a `task_columns` of
its own, looks untouched, and quietly stops following Einstellungen. `withColumnVisible` returns
`null` for an emptied map, which is the same „give the state back, not the picture" that WP-45's
removal undo answers with `resetToDefault()`.

**Status and Titel stay unhideable, everywhere.** `deletable === 0` already said so;
`doneValueOf`/`useDoneValue` drive graying, sinking, the statistics and archiving off the Status
column, and a page with no title cell has no way to edit a task at all.

**The .xlsx now filters the custom block and still not the fixed one.** The export filtered
*nothing* before — a column hidden in Einstellungen landed in the sheet anyway, which
`PrintProject` already did not do — and once visibility became per page, exporting a column the
project deliberately hides is the reported inconsistency one layer down. So the sheet follows the
page it was exported from (`project_id`, or `resolved_artist_id` for an artist sheet, PGS-31).
The fixed block — Aufgabe · Künstler · Projekt · Priorität · Status · Fällig · Erledigt am ·
Kommentar — is deliberately **not** filtered, exactly as on the print sheet: it is the sheet's
identity, two projects' exports have to stay comparable column for column, and „Erledigt am" has
no column row to be hidden by in the first place. The consequence, stated so it is not reported as
a bug later: a project that hides the built-in **Fällig** still has a Fällig column in its .xlsx
and on its Ein-Pager. Filtering that one is not merely more work, it has no correct answer on the
sheets that span pages — an artist export covers that artist's projects, each with an override of
its own, so a built-in dropped by the artist page's map would take the column away from rows whose
project shows it. „This project has these columns" lives in the custom block, and that is the half
that moves. The rule is asserted in `check:api` by reading the workbook back, in both directions.

**A season copy carries the override for free, with one benign exposure.** `task_columns` rides
`COPY_COLS` with its entity. Its keys are `colId`s, so built-ins survive the copy's match-by-`key`
step; a *custom* column whose id collides in the target is remapped, and the stale
`custom:<old id>` key is then simply never consulted — the column falls back to the season default
rather than pointing at the wrong one, because `custom:<id>` can only ever resolve to a custom
column and the collision is always against a built-in's id. Same exposure `task_sort` has carried
since it started naming customs, and the same shrug.

**`SCHEMA_VERSION` is not bumped for it.** The stamp refuses a file a *newer* build has migrated,
and an older build opening one of these reads every column it knows and ignores this one: the page
shows the season default, which is what it showed before. Nothing is misread. Only a season copy
taken by that older build would drop the overrides — exactly what would have happened to `layout`
before WP-25, and not a corruption.

**This extends WP-51, it does not reverse it.** „No inheritance" there was about *scoped* columns
raining down onto sub-pages — an artist's column appearing on that artist's projects, which would
have made `compareColumns` order three groups and the export join through `projects.artist_id`.
Nothing of that changes: an artist column still appears on exactly one page. What travels here is
the opposite direction, global → page, and only as a boolean per page.

**And no, a column still cannot change its scope.** The question gets more natural once pages can
show and hide freely, so it is worth saying why the answer did not move: a move needs a warning
(values appear and disappear elsewhere), a re-stamped `sort_order` in the target group, and a
decision about the pages that had an override for it. WP-59 also removes most of the pressure —
the common „I made it in the wrong place" is a global column that should only show up on one page,
and that is now two clicks rather than a move. Delete and re-create remains the answer; the values
are keyed by column id, so nothing a move would have preserved is lost.

## Only the first window's bounds are remembered (2026-08-14, WP-55)

Lowering the minimum window size so two windows fit side by side is worth nothing if the next
launch throws the arrangement away, so bounds are now saved — but exactly one rectangle, applied
to exactly one window.

Restoring *every* window was the obvious larger version and it does not work: a window is a season
(`sessionStorage`, `windowSeason()`), so reopening three windows means deciding which season goes
in which rectangle, and the file would have to hold pins that the registry already owns and can
contradict — a deleted season, an imported database, a `.db` that moved. Bounds do not know any of
that. One rectangle needs no such answer, and secondary windows keep cascading, which is the
behaviour that was already tested.

**Bounds live in `window-bounds.json` in `userData`, not in `seasons.json`.** The registry is
exported, imported and written into every backup; a monitor layout that travels with somebody's
data restores a window onto a screen the receiving machine does not have. `usableBounds()` refuses
that case anyway, but the right fix is for the geometry not to travel at all.

**The refusal is one-sided, like the size clamp.** A rectangle that no longer overlaps *any*
attached work area is dropped and the launch falls back to `fittedSize` + Electron's centring —
the failure it exists for is a window saved on an external monitor and reopened without it, where
faithful restoration produces an app that appears not to start. Everything short of that is
clamped instead: dragging a window half off the bottom edge is deliberate, and answering it by
re-centring would be more surprising than pulling it back on.

**No decision was reversed here.** There was no prior decision against persisting window
geometry — it had simply never been built (`setBounds` appears nowhere before this).

## Feedback leaves by `mailto:`, not through an endpoint (2026-08-14, WP-54)

The raw note asked whether the app could send the mail itself. It could — with a mail service, an
account, credentials shipped inside a source-available binary, and a network connection, in an app
whose whole point is that it works offline and keeps a festival's contact data on one machine. That
trade is not close.

`mailto:` also buys something an endpoint would have to build: a review step. The composed body
opens in the customer's own client, under „Was wird mitgeschickt?" *before* that, and nothing is
sent until they press send. The diagnostic block is timings, a version and a viewport — but
„technische Angaben" is not a thing to ask anyone to take on trust, least of all in an app holding
personal data.

What it costs is knowing. A `mailto:` is fire-and-forget: the app cannot learn whether the mail was
sent, so nothing anywhere on this path says „gesendet" — the toast asks them to send it, and since
WP-66 the customer closes the dialog themselves.

The `mailto:` itself stands. What was decided *around* it — one button, no choice, the client
opened for them — was **reversed on 2026-08-17 (WP-66)**; see „The feedback path opens nothing by
itself" at the top of this file. The two paragraphs below are the record of what it reversed.

~~**„Text kopieren" was removed on 2026-08-14**, and with it the reasoning that a machine with no
mail client needs a second button. It was a hedge: two buttons of equal weight, and the customer
deciding which situation they are in before they know they are in one. The path that matters is the
one that works, and the fallback survives as a sentence — the address in plain text under „Was wird
mitgeschickt?", where somebody actually stuck will look. One button, no branch to choose.~~

~~That sentence is **unconditional**, which it was not when it shipped: it sat in the `else` of the
attachment note, so the packaged app reporting a *Fehler* — the main path — showed it to nobody. The
branch that hides it is exactly the branch that needs it. A machine with no mail handler clicks
„E-Mail öffnen", nothing opens, and the app then holds no address anywhere.~~ That last sentence is
the one WP-66 took seriously: it is not an aside about an unusual machine, it is the customer.

## „Diagnoseordner öffnen" was removed once the file was written for them (2026-08-14, WP-54)

It shipped as the route to `boot-log.jsonl`, and the diagnostics bundle replaced it the same week:
a button that opens a folder full of Chromium caches is not a better answer than a named file
already lying on the desktop. Two routes to the same evidence is one route more than the feature
needs, and the one being kept is the one that ends with the file attached.

The `reveal-diagnostics` channel went with it rather than staying behind as an unused handler.
~~`shell.showItemInFolder` itself stays, in `save-diagnostics` and nowhere else
(`electron/main.ts`): it reveals the bundle it has just written, on a path the renderer cannot aim
— the removed thing is the standalone button and the channel that let a renderer ask for a folder,
not the reveal.~~ **The reveal went too, on 2026-08-17 (WP-66)**, and `shell.showItemInFolder` now
appears nowhere in the app: a Finder window arriving on a click the customer thought was about a
mail is the same surprise as the folder button, one call further down. If a bundle cannot be
written, the mail carries the five-line summary instead; nothing routes the customer into
`userData` again, and this half of the decision is unaffected.

## A `mailto:` cannot attach, so the app writes the file instead (2026-08-14, WP-54)

The obvious follow-up to the decision above was: if the mail only carries five folded boot entries
and the rest sits in a folder, why not send the whole log, or attach it automatically?

Neither is available. RFC 6068 limits which headers a `mailto:` client may honour; `attach=` was a
Thunderbird extension and was disabled precisely because a URL naming a local file is an
exfiltration primitive. Apple Mail, Outlook and web handlers ignore it, `shell.openExternal` hands
the URL to the OS with nothing in between, and Electron has no cross-platform compose-with-
attachment API. Putting the log in the body fails on size rather than on policy: the file keeps up
to 100 records, ~35 KB, and even one folded line per boot is ~12 KB against a budget of 1900
*encoded* characters. Five is what is left after three German fields, not timidity.

So the file is made attachable instead of the mail made bigger. `save-diagnostics` writes one
`Auftakt-Diagnose-<ref>.txt` ~~and reveals it selected~~ (the reveal removed by WP-66), and the
mail names that filename.

- **The desktop, not beside the log in userData.** The file exists to be dragged into a mail. A
  folder they already have open beats one they have to be sent into, and `boot-log.jsonl` sits
  among `Cache/`, `Code Cache/`, `GPUCache/` and `blob_storage/`. It is also plainly theirs to
  delete afterwards, which a file in `AppData` is not.
- **`.txt`, not a copy of the `.jsonl`.** A `.jsonl` does not open on double-click on Windows, and
  the person carrying the file is the one who should be able to read it before they send it.
- **It carries more than the log**, because the questions that follow a startup report are always
  the same ones: which Windows build, how the screen is scaled, whether GPU compositing is on. That
  is the WP-61 shortlist, and none of it is guessable from timings.
- **Home paths are redacted to `~`.** It is mail, not a local file: `C:\Users\<name>\AppData\…`
  names the customer, and the shape of the path is the half that has ever explained a fault. The
  scrub runs over the finished text, so a path the person typed into the report is covered too.

What it costs is one manual step — the attaching — and that is the floor, not a shortfall.
~~„E-Mail öffnen" reveals the file first and opens the client second, so the compose window is what
ends up in front.~~ Since WP-66 nothing is opened at all: the primary button — „Weiter" then,
„Bericht speichern" since WP-75 — writes the file, and the handover names it.

Because that step is the floor, it is where the words go, and **the words fill the dialog rather
than sit in a card in it (2026-08-14).** The steps were first written as a numbered card above the
send button, which put the one thing the customer has to do at the bottom of a scrolling form under
three text boxes — the easiest place in the feature to skip. They became a second, stacked dialog
carrying those steps and nothing else, and since WP-75 they are the dialog's own second state,
which is the same rule one layer cheaper: what is on screen at that point is the instruction, not
the instruction under a form. A card is scrolled past; a screen is answered. It also settled what
the button may claim: „E-Mail schreiben" promised a mail that click did not write, and
„verschicken" would have promised a send that is not this app's to make — and „E-Mail öffnen"
itself went the same way in WP-66, having promised an opening that on the customer's machine does
not happen. The step ends in „Fertig", which claims nothing.

The draft then opens on the instruction to attach the file, on the first line, because a mail
client shows the first line and not the signature. Kind, area and reference used to sit above it
and then sat in the technical block — kind and area are gone entirely since WP-75, and the
reference is what is left of the filing stamp. The instruction is addressed to the
customer rather than the maintainer, and „(bitte stehen lassen)" heads the block that is not theirs
to tidy — every sentence asking the reader to decide something is a sentence that can be decided
wrong. The copy written *into* the bundle drops both the instruction and the summary: a file
telling its reader to attach that same file is nonsense, and the log it would digest is printed in
full two sections below.

The body's headings are `--- ` and the attach block is `!!` for a reason that outlives taste:
`encodeURIComponent` leaves `!` and `-` alone, spends three characters on `=` or `#` and nine on a
box-drawing rule, and the budget below is measured in encoded characters. Structure that reads as
free in an editor is not free in a `mailto:`.

## No menu entry for feedback (2026-08-14, WP-54)

„Dauerhaft sichtbar" was the alternative to a settings entry, and a Hilfe menu was the obvious
shape for it. It would need main to tell a renderer to open a dialog — a second `webContents.send`,
against the uniqueness `docs/ARCHITECTURE.md` documents and `preload.ts` leans on, for an entry
point that already exists two clicks away. Revisit only if the settings entry proves undiscoverable
in use, and then by moving it, not by adding a second door.

## The boot summary is triage, not analysis (2026-08-14, WP-54)

Five entries, and `outcome/why` is the one clause never dropped — it is the field that separates
WP-61's three candidate causes. `warm` and `quick` are left out and the timings are rounded to
whole milliseconds, because a support mail is read by a person deciding what to look at.

Since the bundle exists the summary is the *fallback*, not the default: a mail that carries the
file carries no digest at all. It was the same data twice, and the half in the mail was the
truncated half.

The order is oldest-first for a mechanical reason, not a stylistic one: the composer's truncation
ladder drops entries from the top when the `mailto:` is too long, so the boot that prompted the
report is the last thing to go. Below that, the whole block is replaced by a pointer at the reveal
button rather than by silence, and only then does the person's own text get cut — marked.

> **The ladder is two rungs since WP-75 (2026-08-26)**, and this order is what survived of it: the
> block goes whole, then the note is clipped and marked. Dropping entries one at a time was worth
> its code while three required fields and a digest fought over the same 1900 characters; with one
> optional note it is a rung nothing lands on. The arithmetic in the two paragraphs below was
> measured on those three fields and no longer describes anything shipped — what `check:unit` holds
> now is that a report-sized note rides beside the attach instruction untouched, and that no input
> at all can put the URL over the ceiling.

Once the diagnostics file exists, that middle rung goes the other way: the block is dropped
outright rather than replaced. The line above it already names the file the log is in, and a
sentence under it saying so costs 140 encoded characters to repeat what the reader just read. The
budget is not abstract — three fields at the dialog's own `maxLength` plus a reference, a machine
clause and an attachment line come to 1931 encoded characters against a ceiling of 1900, and
`check:unit` holds that arithmetic. What gets spent at that size is the summary, never a word the
person wrote, because the summary's 100 entries are in the attachment in full.

That ceiling is also what any re-wording of the body has to be measured against, and it has almost
no slack: the same worst case *without* the summary measured 1897 of 1900 in the layout this
feature shipped with. The restructure on 2026-08-14 paid for its headings by taking the duplicated
`Art: … · Bereich: …` line out of the head — 1873 — so the structure cost nothing the person could
have spent on words. `feedbackMail.test.ts` asserts the whole shape fits with no `[…]` in it, which
is the only reason the arithmetic is discovered before a customer's report arrives truncated.

**The dialog's `maxLength` cannot be that guarantee (2026-08-14, WP-54) — moot since WP-75
(2026-08-26).** The paragraph below is right about what it measures and no longer describes
anything shipped: the person's words travel in the *file*, which takes 4096 characters and needs no
encoding, so the box's cap is sized against that and the mail is the derived copy. What the budget
still decides is how much of the note the optional `mailto:` can carry, and that is settled by
clipping the mail's copy and marking it — in front of the customer, in their own compose window —
rather than by measuring every keystroke. `feedbackHeadroom` and `fitFeedbackAnswer` are gone with
the required field they were written for. The original reasoning stands as follows.

The cap was written as the guarantee — 300 characters per field, „sized so three full fields of ordinary German prose still fit" — and the
1873 above is what that claim was measured on: prose carrying one umlaut per 62 characters. Real
German carries three to six. An umlaut costs six encoded characters against one for a letter, so
about thirteen of them across three full fields is the whole 27 of slack, and past that every
answer is halved by the ladder's last rung and marked `[…]` — a customer's report arriving cut,
discovered by the maintainer reading it. A character count cannot express an encoded budget in any
sizing: the cap that would hold the true worst case (300 umlauts encode to 1800 on their own) is
about a hundred characters, which is not a report anybody could write.

So the enforcement moved to where the budget can actually be measured. `feedbackHeadroom` composes
the finished URL and reports what is left after the diagnostics have been spent, and
`fitFeedbackAnswer` bisects the longest prefix that still fits; the dialog puts every keystroke
through it. What the box holds is then always what the mail carries — a blocked keystroke leaves
the text as it was, a pasted overflow lands cut in front of the person — and the ladder's last rung
is left to what it is for: a mail that grew *after* it was typed, which is the failed-bundle-write
case putting the summary back. `FEEDBACK_FIELD_MAX` stays as the shape of an answer, not as the
budget. Ten URL compositions per keystroke is the cost, against a re-render that costs more.

~~A wish carries no summary at all. Startup timings say nothing about a feature request, and the
budget they would spend is better spent on what was actually asked for.~~ **Moot since WP-75:**
nothing asks whether this is a wish, so every report carries the same bundle. What that costs a
feature request is a text file on the desktop it did not need; what it saves is the click that
would have decided, and the version and machine it names are worth having under a wish too.

`why` is read back out under the same distrust it was written with. `bootLogLine` caps the payload
as a whole and never inspects the fields inside it, so a literal newline in `why` would forge an
extra report line in a support mail and a long one would eat the mailto budget. Every string
lifted out of the log is flattened and sliced.

## The kind is asked first, and it rewrites the questions — REVERSED (2026-08-14 WP-54, reversed 2026-08-26 WP-75)

**Both questions are gone.** They were two mandatory clicks in front of a feature whose value is the
file behind them, and the reasoning below priced that at nothing. What replaced them is one optional
box; the record of why is „Zwei Klicks bis zum Bericht" at the top of this file. The paragraphs
below stand as what they reversed — in particular, a report *is* still filed under something, and
what it is filed under is now the person's own sentence rather than a picked label.

The first version asked „Was ist passiert?" of everyone, which is the only sentence a wish can then
be filed under — so feature requests arrive phrased as faults, and the first reply is spent working
out which one it was. Fehler and Wunsch are asked before anything else, and each brings its own
three questions and its own required field.

Two kinds, not three. „Frage" was the candidate for a third; a question about how something works
is a report that the thing is not discoverable, which is a Wunsch, and a third row would have to
earn a permanent place in the first thing anyone sees.

The questions live in one table (`FEEDBACK_KINDS`), which the dialog renders from and the mail
composes from. They used to be written twice — as questions in the form, as statements in the body —
with nothing keeping them in step.

## The report carries its own reference (2026-08-14, WP-54)

Every mail out of the dialog used to have the same subject, so an inbox of them could not be sorted
and a reply could not say which one it answered. `AF-` plus `YYMMDDHHMM` in naive local time (the
convention `shared/time.ts` sets) leads the subject, repeats in the body — a subject is the first
thing a forward rewrites — and names the diagnostics file, which is what lets a mail and a loose
attachment on a desktop find each other.

Minute resolution, not seconds: it is read aloud and typed into replies. Two reports inside one
minute from one person is not the collision worth designing against — in the *reference*. In the
*file* it is, and the two are separable. Somebody who sends a report, spots a typo and sends
another inside the minute is not a rare user; they are the one taking it seriously, and a second
bundle written straight over the first leaves one file on a desktop that two mails ask for. So
`uniqueBundleName` suffixes `-2`, `-3` on collision and main returns the name it wrote, which is
the name that mail carries. Both mails still say the same reference, because they are two attempts
at the same report.

---

## Windows Authenticode signing — deferred (2026-07-31)

The NSIS installer is unsigned, so SmartScreen warns about an unknown publisher and the in-app
updater cannot verify a signature on the package it downloads. A real fix needs a paid
code-signing certificate.

What stands in for it: the sha512 published in `latest.yml`, fetched over HTTPS, plus the build
provenance attestation carried by the installers from v0.5.0 onward and by *every* published file
— blockmaps and `latest.yml` included — from v0.6.0 onward (attestation needs a public repository,
so it was skipped while this repo was private). Documented as a known limitation in `SECURITY.md`
rather than hidden. Revisit if a certificate is bought.

**`win.publisherName` stays unset (2026-08-04, WP-27).** It is the obvious-looking follow-up when
naming the publisher, and it is the wrong knob. Nothing user-visible reads it while the installer
is unsigned — the name in the file properties and in „Apps & Features" comes from `author` in
`package.json` — but `verifyUpdateCodeSignature` defaults to true, so electron-builder copies it
into `app-update.yml`, and `NsisUpdater.verifySignature` skips its check *only* while that key is
absent. Setting it would turn every in-app update into `ERR_UPDATER_INVALID_SIGNATURE`. It becomes
correct on the same day a certificate is bought, and not before.

## Pre-seed snapshot — declined (2026-07-31)

`npm run seed` is unconditionally destructive: `clearTables()` runs before the CSV/sample branch,
so seeding with an empty import dir replaces a real database. Snapshotting via `VACUUM INTO` before
the wipe was offered and declined — it would leave an unpruned `pre-seed-*.db` in the data dir on
every run.

The single transaction already makes every *failed* seed harmless. A *successful* one is meant to
be destructive; that is what the command is for, and it is documented.

## UNC / network shares as a backup target — unsupported (2026-08-01)

They are refused in the folder picker with a German message rather than silently failing at
startup. The LEG-01 rationale stands: on Windows an outbound SMB write to an attacker-supplied
share leaks the NTLMv2 hash, and `backup_dir` reaches the privileged Electron main process.

Revisit only if a real Windows/NAS user asks.

## Dragging is off while a header-click sort is active (2026-08-02, TTU-04)

Renumbering `sort_order` against a temporary view is what destroyed hand-curated orders. The
alternative — single-row insert semantics on the server — was rejected because „put X where Y is"
has no meaning when the display is not the manual order.

`DragHandle` has a `disabled` variant (dimmed, `cursor-not-allowed`, reason in the `title`) for
this state. Use it rather than hiding a handle.

## The drag handle is visible at rest, on every drag surface (2026-08-11, WP-35)

`DragHandle` was `opacity-0` until its row was hovered. The customer then reported a link list as
„kann ich nicht mehr verschieben" — it had been reorderable since v0.5.0. An affordance that only
appears once you happen to be over it is one most people never find, and there is nothing else in
the UI that says a list can be reordered.

It now rests at `opacity-40` and goes to full on `group-hover`. **One resting state for every drag
surface**, not per list: a handle that shows in one list and hides in the next teaches that the
other list cannot be reordered, which is the same wrong lesson in a new place. The cost is
accepted — a faint ⠿ column down a long task table — and it was weighed against a task table with
no visible reordering at all.

The `disabled` variant above stays *below* the live resting opacity (`opacity-20`, barely lifting
on hover) so „inert" is legible without hovering to compare.

Not part of this: a second affordance. `ReorderArrows` exists for the settings editors, where rows
are short and keyboard reachable; cards and content lists keep the drag alone until keyboard
reordering is designed as a whole (WP-43's territory).

## Links reorder inside their category (2026-08-11, WP-35)

A link list is grouped by category, but `sort_order` is a single sequence across the whole list, so
a drop into a foreign group would park a row under a heading that contradicts its own category.
`LinkList`'s `canDrop` therefore refuses cross-group pairings — and the whole list, not the group,
is what gets renumbered, which is what leaves the other groups where they are.

The alternative — a cross-group drop that rewrites `category` on the way — was declined: one
gesture would then perform two writes of different kinds, and the category half is deliberately not
on the undo stack (see „Category reassignment stays off the undo stack"). Changing a category stays
the ✎ dialog's job, where it is one visible, undoable edit.

What *did* have to change is that the rule was invisible: a refused drop simply did nothing, which
is indistinguishable from broken. While a drag runs, the other groups dim, and the handle's tooltip
names the limit.

## Category reassignment stays off the undo stack (2026-08-02, reaffirmed 2026-08-04)

Moving N tasks or events onto a replacement category is a bulk write carrying **one distinct old
value per row**, which `useUndoableDelete`'s single inverse does not express. It would need its own
entry shape on the stack.

Raised by FIX-03, deferred by FIX-08, and confirmed again at the review closeout. The counted
confirmation dialog remains the safety net, as it is for „Endgültig löschen". `POST /api/usage/reassign`
also rewrites trashed rows, which no other route does.

## Cascading the soft-delete — deferred (2026-08-02)

Stamping `deleted_at` on the whole descendant closure at delete time — and un-stamping it on
`/restore` — would make the trash internally consistent and let the guarded purge drain completely,
instead of parking every parent that still has live children.

It is the real cure, but it rewrites delete/restore/undo semantics across both tiers. Deferred
twice: FIX-01 handed it to FIX-08, which handed it on again once `DELETE /tasks/:id/tree` covered
the case that actually hurt. Until then the guarded purge parks such parents, which is safe — it
can never destroy data the user never trashed — merely untidy.

## ~~Foreign layout entries are retained, not position-stable~~ — SUPERSEDED (2026-08-04, landed 2026-08-05)

**The decision below was taken on 2026-08-03, reversed on 2026-08-04 and replaced on 2026-08-05.**
Layouts are now **per-artist and per-project** — `artists.layout` / `projects.layout`, with the
settings array demoted to the *template* a page inherits while its column is `NULL` (`WP-25`, see
[ARCHITECTURE.md](ARCHITECTURE.md)). The shared array this rested on is gone, so the trade-off
below no longer arises: no entry in a layout belongs to another page. Leave the entry here rather
than deleting it — it records why the sharing existed, which the `NULL` fallback preserves for
every page that never gets arranged.

> `artist_layout` and `project_layout` are single settings arrays shared by every artist and every
> project. Moving a section steps over invisible `cs<id>` entries belonging to other entities, so
> their position *relative to* the moved section changes on a page nobody touched.
>
> Accepted: built-in order is global by design, so the other page is rearranged either way, and
> pinning would add a second ordering rule for a case that is not wrong.
>
> The alternative — putting widget placement on the `custom_sections` row, which already carries a
> `sort_order`, leaving the settings array to the built-ins — was rejected here as a schema +
> migration change, **not as a bad idea**. Do not re-raise without that decision.

The reversal came from the other end: a user request to „save a layout as a draft and apply it to
a new artist", which turned out to describe behaviour that already existed — and surfaced that the
*global* arrangement was the actual complaint, not the missing draft feature.

## The saved layout is a second store, not the standard (2026-08-05)

WP-25 folded „save a draft" and „what new pages inherit" into one settings array, on the grounds
that a second storage location was not worth it. **That was wrong in use, and WP-31 split them.**
With one array, saving a layout to apply later also silently changed what every not-yet-arranged
page showed — two different intentions writing the same slot. The keys are now
`artist_layout` / `project_layout` (the standard) and `artist_layout_saved` /
`project_layout_saved` (the one applied by hand).

The trigger was not a defect report but a question — „where can I apply this now?" — asked after
WP-25 shipped. The mechanism had been right and the *vocabulary* had hidden it: the apply action
was labelled „↺ Vorlage" and worded as a reset, so nothing on screen said the feature existed.
A rename alone would have fixed the reading; splitting the store is what made the two actions
independently useful. Both now live in one named `LayoutMenu` that states which page type it acts
on and whether this page follows the standard or has its own arrangement.

## `linkify` is e-mail-only; no `tel:` (2026-08-03)

Phone numbers render as plain text — which is what they always rendered, since the pattern never
matched one. A `tel:` branch would mean widening `openExternal`'s allowlist, which stays
http/https/mailto and remains the single place that decides what may open.

## No test framework — REVERSED (decided ~2026-07-31, reversed 2026-08-06)

This entry was cited by `CLAUDE.md`, `CONTRIBUTING.md` and `.github/workflows/build.yml` for a
week before it existed. Three files said "there is no test framework and no linter — that is a
decision, see `docs/DECISIONS.md`", and the reasoning was never written down here. It is
reconstructed below, then reversed, because a decision nobody recorded is not one anybody can
weigh.

**The original reasoning, as the code shows it.** A framework was never the point; the four
`check:*` scripts are. Each boots the real server and drives the real API, and nearly every one
of their ~153 assertions names a finding ID from the 2026-07 review — they are regression guards
for defects that actually happened, not coverage for its own sake. A framework would have added a
dependency, a config file and a watch mode without adding an assertion. The browser-free rule was
narrower still and had a specific cause: `docs/VERIFYING.md` lists thirteen Playwright traps, each
of which produced a *wrong* result at least once — a check that passed against a defect, or failed
against working code. Committing a suite built on that footing would have institutionalised
false confidence. Verifying by hand against `npm run demo` was the honest option.

**The new information: the product is going commercial.** `docs/DECISIONS.md` asks for new
information rather than a fresh opinion, and this clears that bar in two ways the original
reasoning could not have priced.

The first is exposure. The check scripts are 100% server and persistence layer. `client/src` is
15,002 lines across 75 files with no automated coverage at all beyond the Markdown round-trip,
and `electron/` has none. That was survivable when the only user was the developer and a wrong
render cost a re-render. It is not survivable when a stranger's festival data is behind it and
the feedback path is a support request.

The second is that hand-verification does not survive contact with a release cadence. It is a
person, on two operating systems, before every release, remembering thirteen traps. It worked
because releases were rare and the person who wrote the traps was the one running them.

**What changes.** Vitest over the pure modules — `client/src/lib/{taskSort,taskTree,taskStats,
dragReorder,sections,colors,arrays,url,routeParams,selectOptions}.ts` and `shared/time.ts` —
plus a committed Playwright suite in CI. `docs/VERIFYING.md` stops being a field guide for
throwaway scripts and becomes the specification for the committed ones: its traps are the list of
assertions that would otherwise be wrong.

**What does not change.** The four `check:*` scripts stay exactly as they are. They are the best
thing in the repository and nothing here replaces them; Vitest covers what they structurally
cannot reach, and does not re-cover what they already hold. The no-linter half of the original
decision also stands — it was always a separate question, and nothing above bears on it.

**The trap that comes with this.** `server/src/demo.ts` builds its dates relative to today, on
purpose, so the demo never goes stale. That is right for eyeballing and wrong for assertions. An
e2e suite must pin a clock or assert only relatively; absolute-date expectations will pass for
some weeks and then fail for reasons that have nothing to do with the code.

---

## ~~react-router GHSA-qwww-vcr4-c8h2 — not applicable, not upgradable~~ — RESOLVED (2026-08-06, resolved 2026-08-11)

`npm audit` reports a **high** on `react-router` in `client/`, and it will keep reporting it. It
is not being fixed, for two independent reasons.

**The vulnerability cannot occur here.** It is an RSC-mode CSRF bypass: a React Server Components
request can execute a server action before the framework returns its 400. Auftakt imports
`HashRouter`, `Routes`, `Route`, `Navigate`, `Link`, `NavLink`, `Outlet` and `useNavigate` — that
is all of it, across `client/src/main.tsx` and about ten components. There is no RSC, no data
router, no `loader` or `action`, and no server rendering; the client is a static Vite bundle that
talks to Express over REST. The vulnerable code path is not reachable, and adopting it would be a
deliberate architecture change, not an accident.

**There is no upgrade to take.** The patched `react-router` has no corresponding `react-router-dom`
release yet, so the only path npm can resolve downgrades `react-router-dom` from 7.18.2 to 0.0.0.
Dependabot tried twice on 2026-08-06 and failed both times with exactly that. Forcing it via
`npm audit fix --force` would install `react-router-dom@7.11.0` — a real, breaking downgrade of the
router in exchange for closing a hole the app does not have.

So: `react-router` was ignored for `/client` in `.github/dependabot.yml`, which stopped the
failing security update from re-running. `npm audit` was unaffected and kept reporting it — that
was deliberate, and harmless, because the audit step in `.github/workflows/build.yml` was
`continue-on-error: true` at the time and reported without gating the build.

**Resolved on 2026-08-11, and not by an upgrade.** The advisory itself was revised: its
`first_patched_version` for the 7.x line is now **7.18.2**, which is the version `client/` was
already pinned to the whole time. `npm audit` reports zero for `/client`, and the repository has
no react-router alert at all — 28 fixed, 2 open, none of them this one. The removal condition
written above was therefore met without anything moving, so the `ignore:` entry is gone; left in,
it would have suppressed genuine future react-router updates.

Worth keeping the reasoning rather than deleting the entry: the *first* half still stands on its
own. A revised advisory is the second time this dependency produced a high that was not a problem
here, and the argument for why — HashRouter, no RSC, no data router — is what makes the next one
quick to assess.

## uuid GHSA-w5hq-g745-h8pq — unreachable, and not upgradable (2026-08-11)

`npm audit` reports a **moderate** on `uuid` in `server/`, and it will keep reporting it. The
alert (Dependabot #65, CVE-2026-41907) is a missing buffer bounds check in `uuid`'s `v3`, `v5` and
`v6` generators when the optional `buf` argument is supplied.

**The vulnerable code is not reachable — twice over.** `uuid` is not a direct dependency; it
arrives only through `exceljs@4.4.0`, which pins `uuid@8.3.2`. exceljs touches it in exactly one
file, `lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`, which does
`const {v4: uuidv4} = require('uuid')` and calls `uuidv4()` at two sites. So the affected
generators are never imported, and no call anywhere passes a `buf`. Either fact alone closes it.

**There is no upgrade to take.** exceljs 4.4.0 is the current release, and the only fix npm can
resolve is `exceljs@3.4.0` — a major *downgrade* of the library the Excel export is built on, in
exchange for closing a hole that does not exist. An `overrides` pin to `uuid@11` would close the
alert honestly, but it would change what exceljs runs against, and the export path has no test
coverage to catch a regression. Not worth it for an unreachable finding.

So: alert #65 is dismissed on GitHub as `not_used`. `npm audit` still
reports it, along with the moderate on exceljs itself — that is deliberate and harmless, because
the audit step in `.github/workflows/build.yml` runs at `--audit-level=high`. Note the asymmetry
with the react-router entry above: there is no `ignore:` in `.github/dependabot.yml` for this one,
because there is no failing security update to stop from re-running. Adding one would only hide a
future exceljs release that fixes it.

**Revisit when** exceljs ships a release that moves off `uuid@8`, or when the Excel export is
rewritten onto something else. At that point this becomes an ordinary bump.

## CodeQL's `js/missing-rate-limiting` is filtered out — until the server leaves loopback (2026-08-10)

CodeQL flags every route handler that touches the database as vulnerable to denial of service for
want of a rate limiter. Here that is *all* of them: 18 open alerts across `server/src/lib/crud.ts`,
`routes/entities.ts`, `deleted.ts`, `search.ts`, `export.ts`, `settings.ts`, `usage.ts` and
`dashboard.ts`. `.github/codeql/codeql-config.yml` excludes the query.

**The vector is closed one layer up.** `server/src/index.ts` binds `127.0.0.1` — not `0.0.0.0` —
and the X-01 middleware 403s any request whose `Host` is not a loopback name or whose `Origin` is
off the allowlist, before a handler runs. The threat model there is a hostile page in the user's
browser; the flood CodeQL describes has no way in, and the only caller that reaches a handler is
the user's own UI. A handler is not exposed merely because it is a handler.

**The alerts were noise with a cost.** The finding is per-handler, so any PR touching any handler
re-reports a pre-existing alert as „new in code changed by this pull request" — PR 36 hit exactly
that by editing four lines inside `POST /tasks/:id/move`, which had carried alert #14 since
2026-08-06. Left alone, the check is red on essentially every PR forever, which is how a check
stops being read: a signal that always fires is not a signal. The audit step in `build.yml` was
carrying `continue-on-error: true` for the same reason at the time; that one was resolved on
2026-08-11 the way this note implies it should be — by clearing the backlog until a failure meant
something, then removing the escape hatch. This query has no equivalent backlog to clear, because
the alerts are not findings that can be worked down.

**`express-rate-limit` was declined, not deferred.** It would close the alerts legitimately and it
is cheap — the check scripts issue ~65 requests and the client does not poll, so no gate would
notice. It is still the wrong thing twice over. On the desktop app every request arrives from
`127.0.0.1`, so the default per-IP keying is one bucket for the whole application, and a limiter
that ever fires presents to the user as an app that has frozen — a self-inflicted outage
protecting against nothing. And it would not be the middleware a shared deployment needs anyway:
that wants a shared store rather than the in-memory one, plus `trust proxy` so the key is the
caller and not the reverse proxy. Rate limiting is also the *smallest* item on that list, well
behind auth, sessions, per-tenant database routing and TLS. Installing it now would buy a green
check, not a head start.

**Scoped to that one query.** `js/http-to-file-access` (alert #19, the `writeFileSync` in
`saveRegistry`, `server/src/db.ts`) stays on: untrusted data reaching a file write is live for an
app that takes season labels over HTTP and imports user-supplied `.db` and CSV files.

**Remove the filter when** the server binds anything but loopback, or serves more than one user.
That is the change that makes the finding real — and at that point it is the least of what has to
be built.

## The event dialog derives its mode; the checkboxes do not come back (2026-08-10, WP-40)

„Mit Uhrzeit" and „Datum offen (TBD)" are gone, and neither is a candidate for restoration. Both
described a state the fields already carried: an empty date field wrote `start_at = NULL` long
before the TBD box existed (`forStorage('')` returned `null`), and „ganztägig" is simply the
absence of a clock time. The boxes were a second way to say the same thing, and being able to
disagree with the fields is the only thing they added.

What replaced them is a **live summary** under the date rows, rendered from the payload
„Speichern" would send through the same `formatEventWhen` the list and the print sheets use. It
cannot describe something other than what gets stored, which is what a label above a checkbox
could never promise.

The derivation lives in `client/src/lib/eventTime.ts`, not in `EventEditor` — the component has no
test and the client has no browser-level coverage yet (issue #7), so the part that can actually be
wrong sits where `check:unit` reaches it.

**Three inputs are refused rather than interpreted**, all of them states the old single
`datetime-local` could not express. Each is input that would otherwise be discarded on save with
the boxes still showing it — the split fields make it much easier to leave one of them behind:

- *Anything next to an empty start date.* „Datum offen" stores `NULL` and nothing else, so an end
  date, an end time or a start time typed there does not survive Speichern.
- *One clock time without the other.* `end_at` is NULL or sixteen characters and nothing between,
  so an end date without an end time would mean inventing a time or silently discarding the date
  the user just typed.
- *An end before its start.* Split fields plus an end date that inherits the start's make this far
  easier to produce than the old control did, and every reader would render the nonsense
  faithfully. An end *equal* to the start stays legal — a zero-length marker is not a mistake.

An end time **earlier in the clock** than the start is not that third case: with no explicit end
date, `23:00–01:00` inherits the day *after* the start. A festival's late-night events are the
common case, and refusing them as „end before start" pointed at a date box the user had left
empty on purpose. That inherited date comes back in the Ende box on the next open, so moving the
event carries it along (`withStartDate`) — an end on the start's own day, or the one rolled past
midnight, follows „Beginn — Datum". Without that, a shape the dialog had just derived became one
it refused. A range dated by hand on **both** ends is a decision rather than a derivation and
stays where it is.

„Datum offen" survives as an *action*, not a mode: one button, next to the summary, that empties
all four boxes. The state it names is those empty boxes — nothing is stored for it and nothing
reads it back — but emptying them one at a time passes through „Ein Ende ohne Beginn kann nicht
gespeichert werden", a refusal about a box the user had not reached yet. The button is the one
gesture the checkbox used to be, without being a second place the mode can be stated.

The storage form is untouched: `NULL` / 10 characters / 16 characters, `all_day` still `1` for the
date-only shape. `all_day` and a NULL `start_at` remain orthogonal, as before; nothing reads the
flag in that state — the derivation writes the `0` that `demo.ts` and the CSV importer already
store there, so that a date-less row is not rewritten just for being opened.

**A row whose four boxes were never touched is written back verbatim, not derived.** The boxes
describe what the *dialog* can express, which is less than the table holds: the CSV importer
leaves seconds on a timestamp (`toIsoLocal` only swaps the space for a `T`) and reads `all_day`
off the start cell alone, so an imported start and end can disagree about carrying a clock time.
Deriving over such a row rewrites data nobody touched, and refusing it — the rule above would —
locks the user out of the title and the notes for a shape they did not create and cannot see.
Reading a value back unchanged cannot be wrong, so in that state there is nothing to refuse
either. Repair happens when the user edits the times, not when they open the dialog.

---

## The Übersicht shows every upcoming event (2026-08-10, WP-33)

The dashboard used to ask for two lists — the next 14 days, plus the first six events beyond that —
and render the second one only in the `else` of „the first is empty". The customer read it as a
limit of six; it was worse than a limit, because one event this week hid every later one. Four
things were decided in fixing it, and each is easy to undo by accident later.

**Past events stay off this list.** It answers „was kommt". The full history is on the artist and
project pages, which list every event of their parent, and the print sheets take it from there.
Putting the past back here is a decision to re-make, not an oversight to fix. The one thing that
must keep working is the *running* multi-day event: `upcomingEvents` tests
`COALESCE(end_at, start_at)`, not `start_at`, and a client-side `daysUntil >= 0` filter added on
top of that would delete exactly those rows.

**Nothing is capped server-side, ever again.** `LIMIT 6` was the reported bug: the app withheld
data the user had entered, with nothing on screen to say so. The only shortening left is
`PREVIEW_ROWS`, which all three blocks pass to `UpcomingList`, and it exists only because it is
paired with „+ N weitere anzeigen". A cap without an affordance that opens it is data loss with
extra steps. The response is therefore unbounded in the event dimension — as it already was for
`tasks` — and that is the intended shape, not an oversight awaiting a `LIMIT`.

„Danach" was capped first because it was the obvious offender, but the argument was never specific
to it: „Datum offen" sits at the *top* of the section, where a Notion import with 40 undated events
pushes „Aufgaben" and „Braucht Aufmerksamkeit" off the first screen, and the near block becomes the
same list once `event_window_days` is raised — 365 is legal, and the window then holds the season.
`UpcomingList`'s `cap` is required rather than optional so that a fourth block cannot be added
uncapped by leaving the prop off.

**Unbounded in rows is not unbounded in columns.** `upcomingEvents` carries its own column list
rather than `EVENT_SELECT`'s `e.*`, because `notes` is rich-text HTML this list never renders and
`useInvalidateAll` refetches the dashboard after every write — a season of long notes turned each
task edit into a several-hundred-KB round trip. That is not the `LIMIT` coming back: no row is
withheld and nothing on screen changes, which is the whole difference. The cost is a contract in
two places — the query and `UpcomingEvent` in `client/src/api/types.ts` — so `check:api` asserts
both halves, `notes` gone and every rendered column present. `typecheck` cannot: the query returns
`unknown[]`, so restoring `e.*` would compile.

**The window is split client-side**, in `client/src/lib/eventGroups.ts`, for the reason the WP-40
entry above gives for `eventTime.ts`: `check:unit` reaches `lib/`, and nothing reaches the page.
The consequence is deliberate and worth stating, because it looks like lost coverage — the +14
edge is no longer a `check:dates` property. The *today* edge still is, and that is where SDL-10
actually sits: a bare `date('now')` gets it wrong in both directions, which is what the two
25-hours-apart zones exist to catch.

**The window is a setting; the heading default is not.** `event_window_days` follows
`attention_window_days` exactly — scalar string, clamped on the client, one line of server
allowlist. `'dash.events'` drops „· 14 Tage" so that a default heading cannot contradict a setting,
and so that it cannot claim a boundary that no longer withholds anything. Renamed headings are
overrides and survive untouched.

---

## A column you cannot see does not order the table (2026-08-10, WP-32)

The complaint was that a new task lands at position 2 or 3 instead of on top. The reason was
invisible: `task_sort` shipped `[status, priority, due]` while the Priorität and Fällig columns ship
`enabled: 0`, so the table was ordered by two columns that render nowhere.

**The general rule replaces the specific fix.** A sort rule is in effect only while its column is
visible — hidden *or* deleted makes it inert (`activeSortRules`, `client/src/lib/taskSort.ts`).
`manual` is exempt; it is `sort_order`, not a column.

That is what makes the shipped default's change to `[status]` need **no migration**, and the
migration is the part deliberately not built. TODO.md planned a self-detecting one that rewrites
`task_sort` only when the stored value equals the old default. It would have had to guess: a stored
`[status, priority, due]` is indistinguishable from a hierarchy the user assembled by hand to be
identical, and rewriting it would take priority ordering away from the one user who *did* show the
column and wants it sorted by it. The filter fixes both cases with no write at all, and because the
rule is filtered rather than removed, showing the column brings its ordering back.

The rejected alternative for the ordering itself: **temporarily pinning** the new row to the top
until the next navigation. A row that sticks and then jumps explains itself to nobody.

## The server's baseline order is the manual order (2026-08-10, WP-32)

`TASK_ORDER` (`server/src/lib/queries.ts`) ranks by `sort_order` and nothing else, with done rows
sinking. It ranked by priority and due date before, and the client keeps the server's order verbatim
whenever no rule is in effect (`sortTasks` short-circuits) — so those keys were rules nobody could
see in Settings and nobody could switch off, reachable from the same gap WP-32 is about. The
consequence is accepted deliberately: the print sheets, the .xlsx export and the archive page render
in server order and therefore now group by hand order rather than by priority. `priorityValues()`
died with the priority `CASE`; the client still ranks by the configured option order, where the
column is visible. TTU-11's check case was re-aimed at the new invariant, not deleted.

**A created task is stamped server-side** (`leadingSortOrder`, `routes/entities.ts`): the client
knows only its rendered siblings, never sees archived rows and cannot see the trash at all. The
scope is the `(artist_id, project_id)` pair and deliberately *not* `parent_id`, because a promoted
orphan renders in a list a `parent_id` minimum cannot see.

**`POST /tasks/:id/move` stamps it too, as a fourth placement field.** The first cut left
`sort_order` alone, reasoning that every field the endpoint writes is one the caller passes back and
that this symmetry is what makes the same call its own undo. That was wrong on the facts: an ordinal
means nothing outside its own list, so carrying it across dropped the moved task at an arbitrary
spot in the destination — below every open row coming from a hand-dragged list, above a
deliberately-placed first row coming from a composer-only one. The symmetry is kept by *widening*
the contract instead: a move with no `sort_order` lands the task at the head of its destination like
a new one, and the undo passes the captured ordinal back to restore the exact slot.

**Readers that are not the task table ask for `order=due`.** The Archiv page, the .xlsx export and
the print sheets render `listTasks` output verbatim and span several lists at once, where a per-list
ordinal interleaves them and prints a task due tomorrow below one due in six months. They get
`TASK_ORDER_DUE` — the pre-WP-32 ordering minus priority, which is a hidden column and stays out
under the same rule as everywhere else.

**A new and an upgraded season do diverge**, and that is the accepted cost of not migrating: show
the Fällig column in both and the old season's dormant `due` rule wakes up while the new one has no
such rule to wake. Both states are visible and editable in Einstellungen, which is the property that
makes it survivable; a migration that silently rewrote the old season's hierarchy would not be.

## The boot gesture is conditional, and the condition is measured (2026-08-11, PR #35)

The obvious-looking question about `client/index.html` is why the animation does not simply start
when the overlay paints, the way it did when #32 shipped it. Because that is the worst possible
moment: the overlay paints exactly when the renderer begins fetching, parsing and compiling a
1.3 MB bundle and mounting React, so the gesture's frames competed with the app's own startup on
every launch.

**It cannot be composited out of that competition.** This was measured, not assumed — the
`Animation` trace events in `disabled-by-default-devtools.timeline` carry Chromium's own verdict.
`bootMotion` reports `compositeFailed: 8320, unsupportedProperties: ['offset-distance']`, the two
trail strokes report `8224` for `stroke-dashoffset`, the hand's fade reports `128` because its
element carries `offset-path`, and the trail group's stacked opacity pair reports `64`. Five of
twelve animations are drawn by the renderer's main thread, including the hand travelling the path,
which is the gesture. Rewriting them to be compositable is not available: the motion *is* the path
and the trace *is* the dash.

So the gesture waits instead. Phase A holds a still, flat frame until the app reports mounted and
the main thread yields an idle callback; phase B releases the animation onto a thread with nothing
left to do. Three consequences that look like arbitrary choices and are not:

**Phase A shows nothing — not the parked hand, and above all not the wordmark.** The gesture's
entire payload is the wordmark *landing* on the ictus. A wordmark already on screen makes it land
on nothing. An empty coloured rectangle also reads as a window that has not drawn yet rather than
as a stall, which matters because it may be on screen for a while.

**Past 1200 ms the gesture is forfeit.** The deadline looks harsh beside the 2700 ms it guards.
Hold plus gesture plus fade is already ~3.8 s of splash at that deadline; at the 2.5 s that feels
natural it would be ~5.1 s, which is worse than never animating. The gesture is a reward for a fast
boot, never a tax on a slow one. Measured cost when the app is fast: reveal moved from 2630 ms to
~2713 ms, so the hold buys the guarantee for ~85 ms.

Those figures use 2600 ms for the gesture, not 3070. The reveal fade starts at `--ti + 350` =
2230 ms and runs 370 ms, so it overlaps the 2700 ms envelope's tail instead of following it, and
the `animationend` that removes the node lands *before* the choreography's nominal end. Adding the
envelope to the fade was the intuitive reading and it was wrong by 470 ms, in the failsafe, in the
bail's delay and in two documents.

**The frame watchdog is only valid while the gesture is main-thread-bound.** It judges rAF cadence,
which is a fair proxy for what the user sees *because* the frames are drawn by the thread rAF runs
on. If the trail is ever removed and `offset-distance` becomes compositable, this inverts: the
watchdog would abort a perfectly smooth animation whenever something unrelated occupied the main
thread. Re-run the trace check before assuming it still earns its place, and delete it if it does
not.

**It judges the whole gesture, in rolling windows, and it has one deliberate blind spot.** Judging
once and retiring left ~92 % of the animation unmonitored, which is where the late stutters live —
a query retry's backoff, a route effect, a decode, a GC. The blind spot is the price of the fix to
its other half: the „uniformly slow" test used to be a flat 22 ms median, justified as „every panel
this ships to is 60 Hz or faster". That is not true of a 4K panel on HDMI 1.4 at 30 Hz, and not true
of a ProMotion display, which idles its refresh rate down over the still frame of phase A and ramps
back up over exactly the frames the watchdog measures — both aborted smooth gestures, and a fixed
30 Hz panel could never play one. The limit is now the floor *or* an allowance over the fastest
frame that display has actually delivered, whichever is larger. What slips through is sustained
contention so uniform that not one frame in 2.6 s lands on vsync: from inside the page that is
indistinguishable from a genuinely slower panel. Real contention jitters, and `drops` catches
jitter.

The blind spot at the *head* of the gesture is larger than it sounds, and WP-61 made it larger
still. Three quantities there are recorded and never judged: `lead` (release → first callback),
and now both `warm` and `warm2`, the two exempt head frames. In the worst run of the customer log
that is 3.6 + 432.9 + 167 ms — about 600 ms, a fifth of the envelope, with no watchdog on it. That
is the right trade, because those frames are structurally expensive and judging them aborts
healthy runs, but it should not be described as „one extra frame".

**Every boot now files a report, because the first field stutter was unfalsifiable.** The first
launch after a local install visibly hitched once — and left nothing to read: `data-boot` and
`data-abort` die with the overlay node, so there was no way to tell whether the watchdog had
aborted, whether the gesture had played at all, or which frame was late. The overlay now folds
what the watchdog measured into a small JSON report in its single exit path — outcome, the door
the reveal came through, ready/start/end on the deadline's own clock, frame statistics — and
writes it to `localStorage['auftakt-boot-report']` and through the `bootSettled` bridge. Three
recording gaps close with it, and all three stay unjudged: the exempt head frames are kept
(`frames.warm`, and `frames.warm2` since WP-61); the gap between release and the first rAF
callback is kept (`frames.lead` — the
animations' clocks start at style application, so a long first presentation is a jump no delta
ever carried); and the reveal-fade tail is recorded instead of abandoned (`tail`, with a
retrospective verdict). The watchdog's rules are unchanged: recording past `fading` keeps every
property that made stopping the *judging* there correct, because the judge is unreachable from
the tail path. The report is also the next thing stored in localStorage after the emoji list
above — an origin change orphans it, which costs one launch's diagnostics and is accepted.

**A boot that collapsed reveals through a different door.** `signalFailed()` rather than
`signalReady()` from `window.onerror`, from an unhandled rejection, and from `ErrorBoundary`. Both
bring the overlay down — that part was never in question — but the failure paths were previously
indistinguishable from a healthy boot, so the overlay answered a window that had just thrown away
its whole tree with the full three seconds of celebration and *then* showed the blank. The signal
is an attribute set before the event, because the consumer is an inline script that knows nothing
about the bundle.

**The startup backup moved behind an IPC signal but kept an 8 s fallback.** ELP-08 already took it
off the awaited path; that was never the same as taking it off the *thread*. `runStartupBackup`
POSTs to a server imported into the main process, so its `VACUUM INTO` per season is synchronous
there — no input routing, which is why click-to-skip went dead mid-gesture — and `await loadURL`
resolving on `did-finish-load` timed it to land exactly when React had mounted. It now waits for
the overlay's own exit path. The fallback is not optional: a renderer that crashes before the
reveal must not cost the user their backup for that launch.

There are two fallbacks, and the second one is why the first is not enough. The 8 s timer lives in
the process `app.quit()` destroys, so on Windows and Linux a user who closes a wedged window — or
just an impatient one, during the hold — took the whole launch's backup and update check down with
it, silently, which is the exact outcome the fallback exists to prevent. `window-all-closed` now
releases the chores itself and lets them settle before quitting, capped at 5 s so a wedged server
cannot turn „close the window" into „the app will not exit". `ensureBackupDir` declines to prompt
when there is no window left to prompt over: a folder picker on an empty desktop after the user
quit reads as a hang, and leaving the flag unset means the next launch asks properly.

**Reduced motion still removes the overlay outright rather than getting phase A.** A static hold
would arguably suit those users better than the app popping in mid-mount. But
`newContext({ reducedMotion: 'reduce' })` is the documented escape hatch that every driving script
in `docs/VERIFYING.md` relies on, and quietly turning it into „hold, then reveal" would break them
all. Worth revisiting only behind a separate opt-out that Playwright can use first.

## Deleting a record lives inside „✎ Bearbeiten"; deleting a season stays in Einstellungen (2026-08-11, WP-34)

WP-34 gave artists and projects a delete affordance at last — the server had carried `DELETE` and
`/restore` for both since the crud factory existed, and only the button was missing. Where to put
it was the whole decision, and it was taken twice: once for rows, once for seasons.

**Rows: in the edit dialog, behind a second confirm.** The alternative — a 🗑 beside „✎ Bearbeiten"
in the page header — is what the work package originally described, and it was rejected in
planning. This is the only delete in the app that takes a whole page's worth of work out of sight,
and the header of the artist and project pages is the surface the user is on most; a stray click
there is cheap to make and expensive to mean. Inside the dialog it takes two deliberate acts, and
it lands next to a destructive control that is already there — the Profilbild's „Entfernen".

The known cost is findability, and it is the *stated* customer complaint („alles muss loeschbar
sein"). Accepted knowingly: if it is reported as missing, the answer is a hint next to
„✎ Bearbeiten", **not** moving the button back into the header. Nothing else in the app puts a
record delete on the page surface either — see the inventory in `ARCHITECTURE.md`.

**Seasons: unchanged, in Einstellungen — and the reason belongs here rather than only in a code
comment.** The customer asked for „projekte, kuenstler, saisons" to be deletable and seasons
already were, so the report was findability, not function. It stays where it is because a season is
not a row: `deleteSeason` deregisters it from `seasons.json` and unlinks the `.db`, `-wal` and
`-shm` files. There is no `deleted_at`, no Papierkorb, no undo toast, and no restore short of
lifting the file out of a backup folder. Putting that one click from the landing page, where
seasons are routinely created and renamed, would make the only irreversible delete in the app the
easiest one to reach. `SeasonManagementCard` and `SeasonSwitcher` both carry a pointer to this
entry.

---

## The task table renders its own rows; `@tanstack/react-table` is gone (2026-08-11, #47)

Dependabot #46 bumped `@tanstack/react-table` 8.21.3 → 9.1.0 and failed `npm run typecheck` with
24 errors. v9 is an API rewrite — `useTable` for `useReactTable`, opt-in registration through
`tableFeatures()`, and a `TFeatures` generic in front of `ColumnDef`, `Row` and `CellContext` — so
the PR could not merge, and a red PR that reopens weekly is how a Dependabot gets muted.

Taking the bump meant reading what the library was actually doing here, and the answer was: very
little. Two files imported it, and between them they used **two** features — the core row model
and expansion. Sorting already happened in `client/src/lib/taskSort.ts` before the data reached
the table; column visibility and order in `visibleCols`; the `<tbody>` grouping in `groupRows`;
dragging in `useDragReorder`, keyed on task ids. Expansion state was one-way controlled — `state`
was supplied and `onExpandedChange` was not, so the table could never write it, and the truth was
the component's own inverted `collapsed` set. Every column carried `id`, a string `header` and a
component `cell`, and **no accessor at all**, so the table held no cell values; the hierarchy
gutter was not even in the column model. What was left was a depth-first flatten and `flexRender`,
which is `React.createElement`.

**So the migration was rejected in favour of deleting the dependency.** `buildTaskRows` and
`groupRows` in `client/src/lib/taskRows.ts` are the replacement, and moving them there is most of
the point: the flatten is the part of this table that can actually be wrong, and inside the
library it was the part no gate could reach. It now sits where `check:unit` does — the same rule
as `eventTime.ts` (WP-40). Issue #7 is untouched; this piece simply stopped depending on it.

The second reason is narrower and worth stating. v9 is backed by TanStack Store atoms and
`useTable` without a selector subscribes to every registered slice. This component's most
expensive defect class is TTU-12/TTU-38 — a rebuilt `columns` memo handing React new component
*types* and remounting every cell subtree, which once ate an open Titel editor mid-typing. Moving
that onto a one-week-old reactive core was more risk than writing forty lines. v9.0.0 shipped
2026-08-04; 9.1.1 was itself a fix restoring v8's row order in `getSortedRowModel().flatRows`.

It also makes the table consistent with the rest of the app: `ArchivePage`, `PrintArtist` and
`PrintProject` are all plain `<table>` + `.map()` already.

**What would reverse this:** column virtualization, column resizing, or faceted filtering. Each is
real work to do by hand and a solved problem in a table library, and any of them is a good reason
to take one back. Row ordering, visibility and expansion are not — those are already ours, and
they are the ones a library keeps tempting you to hand over twice.

---

## Per-window seasons via request scoping; one file per season stays (2026-08-11)

The customer needs several windows on one PC showing **different seasons at once**. Two designs
were on the table, including the customer's own offer to consolidate „one sqlite file for all
seasons if thats easier". It is not easier, and the offer was declined: file-per-season is
load-bearing across the codebase — per-season `settings` rows are each file's self-description,
`copySeasonData` copies rows *between files* with ids preserved, `runBackup` snapshots per file
via `VACUUM INTO`, import is an atomic file swap, `seasonStats` opens inactive files raw, the
local Notion importer writes season files, and `check:api`'s season-copy assertions encode all of
it. Consolidation means `season_id` in every query and the CRUD factory, a data migration and a
backup/import redesign — for no gain over scoping the *request*: one middleware, one
`Map<seasonId, Database>`, zero changes at the `getDb()` call sites.

What that re-scoped, deliberately:

- **„Aktiv" became „Standard".** `activateSeason()` writes the registry and touches no
  connection; the default is what new windows and headerless callers (Electron main, check
  scripts, seed/demo, the Notion importer) resolve. The check scripts' in-process
  `activateSeason(id) → getDb()` pattern is a hard compatibility constraint — headerless
  resolution re-reads the registry per call, so the default id must never be cached at boot.
- **Season switching is window-local** (`switchSeason()` in `lib/season.ts`): repin + reload this
  window, move the default for future windows best-effort, nudge other windows' season lists via
  the broadcast. The pre-multi-window design — activate globally and reload *the* window — would
  have left every other window rendering the old season while its writes landed in the new
  season's file under colliding row ids.
- **410 is the deleted-season contract.** Row-level misses stay 404; a pinned season that no
  longer exists answers 410, the client drops the pin and restarts on the landing page with a
  relayed toast. The 410 is `no-store` and every `/api` response carries
  `Vary: X-Auftakt-Season` — found the hard way in a two-tab verification run: 410 is cacheable
  by default (RFC 9110), and Chromium replayed the dead pin's cached 410 for the recovered
  window's headerless retry, an infinite reload loop.
- **A second app launch opens a new window** instead of raising the existing one — the
  multi-window convention (Chrome, VS Code). The single-instance lock itself stays; two
  *processes* would race the fixed port and corrupt WAL sidecars on import.

Accepted limitations, narrowed but not fixed: whole-array settings and cross-window undo remain
last-write-wins between windows (the broadcast shrinks the window to ~milliseconds; redesigning
undo was already ruled out once, see the category-reassignment entry); a write in flight at the
exact moment its season is deleted or imported can land oddly (closing that fully means per-write
season tokens — the architecture this entry rejects); Cmd+N inherits the *default* season, not
necessarily the opener window's (**reading** the opener's pin is not the obstacle — `windowSeason()`
in `electron/main.ts` peeks it via `executeJavaScript` and is trusted with the Datei menu's
destructive import; **seeding** the new window is: injecting sessionStorage after `loadURL` races
the renderer's first API call, and the client has no `?season=` adoption path — `pinFromResponse()`
takes the echo or nothing, and the query leg exists for main's own header-less HTTP); zoom is
per-origin in the shared Electron session and leaks across windows; and
one window's heavy synchronous operation (backup `VACUUM INTO`, xlsx export) briefly freezes all
windows, since the server shares the main process — pre-existing, now merely more visible.

---

## Cross-window season races are bounded, not closed (2026-08-12, PR #50 review)

Two findings of that review describe real cross-window behaviour, and both are left as they are.
They share an answer, which is why they share an entry: the **coalesced blanket invalidate**
(`client/src/main.tsx`, 150 ms) is what bounds the first and what pays for the second.

**A fresh window's bootstrap burst can straddle a default-season move (PR50-08 / PR50-16).** A new
window mounts unpinned and fires its dashboard queries in parallel; the `/api` middleware resolves
the registry default per request, so another window's `switchSeason()` landing
`POST /seasons/:id/activate` mid-burst splits them — early responses echo the old default, later
ones the new — and `pinFromResponse()` adopts whichever echo arrives first. The window can render
one page built from two seasons. Accepted: the window is the few milliseconds between a single
burst's first and last response, `switchSeason()` immediately broadcasts, and the receiving
window's blanket invalidate refetches everything under the now-adopted pin — so the mixed render is
transient, not a stuck state. Making it impossible means correlating an unpinned window's requests
server-side, and there is no cheap mechanism for that: the client sends no header until a pin
exists, which is the whole point of echo adoption. **Revisit** on a reproduced, non-transient
failure — a mixed cache that survives the invalidate. Recorded, not merely dropped, because
PR50-16 is the same race with a sharper trigger (the switch happening *during* Cmd+N's burst) and
was the one candidate of that review no verifier ever judged: its verifier died mid-run. It is
filed as decided, not as unread.

**The invalidate broadcast carries no season id (PR50-15).** Every write posts a bare
`{ v: 1, type: 'invalidate' }`, so a window pinned to another season refetches on a write that
cannot have touched its data. Tagging the message with the poster's season looks like a one-field
fix and is not: `['seasons']` is genuinely cross-season state — the default moved — which is
exactly why `switchSeason()` posts this same signal, so filtering by season needs a second,
season-agnostic channel beside the first. Against that, the cost is already bounded: the receiver
coalesces to at most one invalidate per 150 ms no matter how fast a drag reorder posts, the
refetch set is a handful of queries, and the database is a local file. **Revisit with numbers** —
two windows on two seasons, sustained editing in one, the other's request volume and interaction
latency measured. Not with a fresh reading of the same code.

---

## Artist links are their own section; the project page keeps them inside „Kontakte" (2026-08-12, WP-36)

The project page renders contacts and documents side by side inside a single `kontakte` section:
one label key names the section (`project.kontakte`), `project.links` names only the second
heading, and one `nonEmptyKeys` clause ORs the two lists. Links there cannot be hidden, reordered
or half-widthed on their own.

The artist page got `links` as a **section of its own** — its own `SECTION_LABEL_KEYS` entry
(`artist.links`), its own `eingabe` picker group, its own `nonEmptyKeys` clause. WP-36 exists
because an artist with a single project is meant to be usable *without* creating that project, so
the artist page is the whole page for those artists; a document list that can only be removed
together with the contacts is the wrong default there.

The cost is known and accepted: `Arranger` appends a key it has never seen to the **end** of the
list, so every artist that already stores a `layout` finds „Dokumente & Links" at the bottom until
they drag it. Only artists on the template get it in its intended position, next to Kontakte.
Folding it into `kontakte` would have avoided that and was rejected for the reason above.

**The project page is deliberately left as it is.** Splitting its `kontakte` in two would move the
section on every existing project page for a symmetry nobody asked for. So the two pages differ on
purpose — this is not drift to be tidied up.

*The last paragraph was superseded on the same day it was confirmed*: the unified-sections
concept (issue #57) made „every scope hosts the same catalog" the rule, and the user decided the
project page joins it — see „The project page's Kontakte and Links are two sections" (WP-48)
below. The artist-page half of this entry stands.

## One 🗑, one outcome: removing a built-in is a tombstone, and it is undoable (2026-08-12, WP-45, #57)

Issue #57 documented four different outcomes behind the same 🗑 — silent vanish, refusal
(„Bereich ist nicht leer"), Papierkorb, hard delete — and a third section state between present
and removed: `hidden: true`, invisible, with no trace outside „✎ → + Bereich". A customer read
that state as a missing feature („gerade kann ich z.B. keine Kontakte einfügen").

Decided: a section has **two states — on the page, or removed** — and one removal flow. An empty
built-in is removed at once; a filled one gets a confirm that says the truth („Die Inhalte
bleiben erhalten — der Bereich lässt sich jederzeit über „+ Bereich" wieder hinzufügen", a
`primary` button, not `danger`, because nothing is destroyed); custom widgets keep their
Papierkorb confirm, the landing its no-Papierkorb copy. The refusal dialog is gone.

The stored form is unchanged: removal writes a **tombstone** (`hidden: true` stays on the entry).
Dropping the entry instead was considered and rejected — the entry's *absence* is what tells
„a later build added a section this layout has never seen" (auto-appended visible, the #59
distribution path) from „the user took this away", and its presence is what remembers position
and width for the re-add. `defaultHidden` survives with a new reading: „not part of the default
arrangement, available in the picker" — legitimate only now that the picker is always reachable.
„Als Standard speichern" continues to carry tombstones into the template; with a discoverable
picker that is curation, not data loss.

Removal is **the one undoable layout write** — it supersedes the blanket „no layout write has
ever been undoable". Its arms are built on `store.current()` (pure helpers in
`lib/layoutEntries.ts`; `SectionArranger` therefore takes the page's `LayoutStore`, not a bare
write callback). The revert throws when the tombstone is gone from `current()` — „Auf Standard
zurücksetzen", another window — so `UndoProvider` toasts the failure instead of freezing an
arrangement onto a template-following page. Reorder, width, and every `LayoutMenu` action stay
off the undo stack; the picker's re-add too, its inverse being the 🗑 itself.

That throw only covers the case where the *user* left the template. The removal itself is the
other one: on a page still following the standard it has to persist the whole array to have
somewhere to put the tombstone, so „Rückgängig" restoring the array restores the picture and
leaves the page detached — looking identical, saying „rückgängig gemacht", and never inheriting
again, with „Auf Standard zurücksetzen" the only way back and no reason to look for it. Decided:
the revert **hands the template back** (`resetToDefault()`) whenever the store still holds exactly
what the removal wrote, and keeps the layout otherwise — an arrangement made between the removal
and the undo is the user's own and outranks the reset. The same reading of „current" also made
`refresh()` part of `LayoutStore`: `current()`/`owned()` read a query cache with a five-minute
`gcTime`, and an undo pressed after that reads an eviction as an empty store.

## „+ Bereich" lives in the toolbar, outside edit mode (2026-08-12, WP-45, #57)

The picker is the only way back to a removed section, and a route that exists only behind
„✎ Bereiche bearbeiten" is a route users do not find — that is how the contacts report above
happened. So `addAction` renders whenever the toolbar does: `[+ Bereich] [✎ Bereiche bearbeiten]`
in view mode, „⌂ Layout" joining in edit mode. „⌂ Layout" stays gated: its actions replace whole
arrangements, which is edit-mode business. A „N Bereiche ausgeblendet" hint was considered in #57
and rejected — it makes the third state visible instead of removing it.

## One spec per section; the picker modal is shared, its persistence is not (2026-08-12, WP-46)

A page's built-ins are declared as one `SectionSpec[]` (`lib/sectionSpecs.ts`), replacing the
per-page `SECTION_LABEL_KEYS`/`SECTION_GROUPS` tables and the inline flag literals. The spec
type couples „removable" to „has a picker group", so the PGS-28 failure — a key missing from the
groups table silently vanishing from the picker — is unrepresentable rather than merely fixed.

This also supersedes **half** of SHL-29. SHL-29 hoisted `SECTION_TYPES` and `PickerRow` but
declined to share the „Bereich hinzufügen" modal because the two pickers persist differently.
That reasoning's live half stands: `SectionPickerModal` is presentation only (an `onCreate`
callback), and `AddSectionModal` (per-season `custom_sections` rows) and
`AddLandingSectionButton` (registry sections, flat list, own placeholders) keep their own
persistence. What fell was only the duplicated modal markup, which had already drifted.

Two deliberate details. **Computed sections say so**: `StatsSection`/`AttentionSection` and the
dashboard's „Nächste Termine" carry a muted, non-renameable line under the renameable heading
(„Wird automatisch …"), because a removed computed section used to be indistinguishable from a
list the user forgot to fill — and the line becomes load-bearing when an editable twin appears
next to the read-only roll-up (WP-D). And **`defaultWidths` ships dormant**: the arranger can
append a key half-width, no spec sets it yet. Its known edge — `ensureEntry`
(`lib/layoutEntries.ts`) recreating a vanished entry full-width in the removal-undo arm — was
acceptable only while no half-default key existed; WP-48 introduced two and closed it by
threading the spec width through `removalUndoEntry`.

## Season scope parity: 0 parents = season-level (2026-08-12, WP-47, #57)

Contacts, events and links used to demand exactly one parent while tasks and custom sections
allowed zero — which is why the issue-#57 concept („every page is a scope, every scope hosts the
same catalog") could not reach the Übersicht, and why the customer's „Allgemein" season had
nowhere to hold general content. Decided: **full parity.** All three CHECKs read `<= 1`, zero
parents means season-level, and `scope=season` lists those rows (spelled that way because
`?season=` is the window pin — see ARCHITECTURE, CRUD factory).

The boundaries of the decision, so they are not re-litigated per package:

- **Copy groups.** Season contacts and events travel with their own group; parentless links have
  no group and ride `settings`, like the parentless dashboard widgets whose placement also lives
  in `dashboard_layout`. A season link is dashboard furniture, not artist data.
- **The landing page stays registry-backed** (`seasons.json`), participating in the unified UX
  only. Season-level rows live in the season file; the landing's sections are not rows at all.
- **The WP-36 asymmetries stand.** No contacts/links roll-up on the artist page; the dashboard's
  read-only „Nächste Termine" stays separate from the editable season sections WP-D adds.
- **#58 (artist-scoped custom columns) stays deferred** — parity here is about parents, not about
  widening the column system.
- `search.ts`, `cascade.ts`, `export.ts` and `deleted.ts` needed no change; a season row in the
  Papierkorb simply carries no sublabel. Accepted.

## The season sections are opt-in, and the roll-up keeps parentless events (2026-08-12, WP-48, #57)

The Übersicht's `termine`/`kontakte`/`links` specs ship `defaultHidden`: every dashboard —
existing or fresh — keeps its arrangement, and the sections arrive as „+ Bereich" picker entries
via the tombstone auto-append. Shipping them visible was rejected: three new empty lists on every
installation's first screen is the kind of unasked-for rearrangement WP-45 was about preventing.
Their label ids are `dash.*` like every dashboard section, with „Saison-" defaults so the
editable `dash.termine` reads apart from the read-only `dash.events` roll-up beside it — the
WP-46 hint line carries the rest of that distinction.

The roll-up itself **keeps** season-level events. `upcomingEvents` never had a has-a-parent
condition, so they appear the moment they exist; excluding them was rejected because a season
deadline is exactly what „Nächste Termine" is for. What had to change was the row's link, which
interpolated a NULL `resolved_artist_id` into `/artist/null` (the SHL-07 class) — parentless
rows now stay on `/dashboard`, the same fallback GlobalSearch has always used, and the section
hint no longer claims the list draws only from Künstler & Projekten.

## The project page's Kontakte and Links are two sections (2026-08-12, WP-48, #57)

Supersedes the WP-36 paragraph „the project page is deliberately left as it is" — by user
decision (2026-08-12), the two lists welded into one `kontakte` section split into independent
`kontakte` and `links` specs, matching the artist page. What the weld cost — links not hideable,
not reorderable, not half-widthable on their own, one `nonEmptyKeys` clause ORing both lists —
outweighed the cost WP-36 wanted to avoid, and that cost shrank to the known WP-36 arrival:
a stored project layout finds „Dokumente & Links" appended at the bottom until dragged, while
fresh and template pages reproduce the side-by-side look through the pair's `defaultWidth:
'half'` (the first live user of WP-46's dormant mechanism). `project.links` already named the
weld's second heading, so it now names the section and existing renames survive unchanged.

Real, understood, and deliberately not scheduled. Each carries a comment at its own site; none is
worth a backlog entry, because the cost of the fix exceeds what it buys today. Listed so that
finding one does not read as a discovery.

- **Landing ids are reused.** `nextId` is `max(surviving ids) + 1` (`patchLanding`, `db.ts`), so
  deleting the highest-numbered section and adding one hands out the same `lt<id>` again. Every
  holder of the key survives that today — the undo restores the row carrying its own id, `prepend`
  replaces an existing entry rather than adding a second. A monotonic counter in `seasons.json`
  would close it properly. (*Season* ids have exactly that counter since PR50-02 —
  `nextSeasonId` — because a recycled season id reroutes a pinned window's requests; landing
  ids still reuse.)
- **`RecordFormModal` is not generic over its field names.** That is what would close the rest of
  CCL-24's excess-property gap; judged disproportionate against typed payload mappers, which
  already cover the four form paths.
- **The `tasks → columns` closure is one-directional.** Copying „Termine"/„Projekte"/Links *without*
  „Einstellungen" leaves rows whose `type`/`status`/`category` names an option the target's lists
  do not offer — the same class as a task whose status names no Status option. The forward edge
  (tasks force columns) is closed; the inverse is not.
- **The error boundary is app-wide.** `SectionArranger`'s sections are the obvious granularity for
  containing a throw to one widget.
- **The three settings option lists can be emptied.** `requireNonEmpty` guards built-in *columns*,
  but „Termin-Typen" with zero types leaves EventEditor's dropdown empty. The removal dialog
  degrades safely when rows still hold a value; an *unused* list can still be emptied.
- **`first_run_done` is close to redundant.** `ensureBackupDir` returns early whenever `backupDir`
  is set, so the flag now means „a folder was chosen at least once" and only matters if
  `backup_dir` were later cleared. Left as a guard.
- **Moving the app origin to `127.0.0.1` empties the emoji picker's „frequently used" list, once.**
  Chromium buckets web storage per origin, and `http://localhost:4317` and `http://127.0.0.1:4317`
  are two of them. The audit that cleared the change checked our own code, where the only key is
  `auftakt-booted` and it really is sessionStorage — but `emoji-picker-react` keeps `epr_suggested`
  in localStorage, reachable from the notes editor. Upgrading past that build resets it. The old
  bucket is still on disk and unreachable: there is no supported way to read another origin's
  localStorage from the main process, and this does not justify inventing one. Recorded because the
  next thing that lands in localStorage will not be an emoji list.
- **The Übersicht's event blocks are split at fetch time, not at midnight.** `groupUpcomingEvents`
  takes „today" from its default `fromUtcMs`, read once inside a `useMemo` keyed on the list and
  the window, and the query sets `refetchOnWindowFocus: false` — so an Electron window left open
  overnight keeps yesterday's boundary until some write invalidates `['dashboard']`, and an event
  that became „heute" stays under „Danach". Not a regression from WP-33 moving the split off the
  server: that same window did not re-fetch before either, so it showed a stale split then too. A
  rollover timer or a focus refetch would close it; both cost more than one stale heading buys on
  a desktop app that is usually reopened, not left running.

## The dialog layer owns the keyboard: Modal places focus, Enter saves per input (2026-08-13, WP-42)

`Modal` focuses the first tabbable of its *body* when it opens, falling back to the footer and
then the ✕ — never nothing, because focus left behind the backdrop sends the next Enter to the
button that just opened the dialog. Confirm dialogs have no body tabbables and land on the
footer's „Abbrechen": the keystroke that reaches the question answers it, and the safe answer is
the one Enter lands on — which means **Enter cancels a confirm dialog** by design. On close,
focus returns to the opener, but only when closing would otherwise drop it: focus the user
parked elsewhere (a `PillSelect` menu portalled to `document.body`, RTE-11) is never stolen, and
a dead opener is skipped.

The override is the field, not a prop: React commits a child's `autoFocus` before effects run,
so a dialog that wants a different first stop marks that element `autoFocus` and `Modal` stays
out of the way (the event dialog's Titel, the confirm buttons, `SectionPickerModal`'s
late-mounting Name). An `initialFocus` prop was considered and rejected until a dialog exists
whose first tabbable is provably wrong — „Spalten verwalten" opening on the first reorder arrow
was reviewed and accepted (user decision 2026-08-13): reordering is that dialog's headline
function, and Enter on the focused ▼ moves the column — visible, and reversed by ▲. What that
does oblige is `move` putting focus back on the row it moved (the same RTE-14 duty
`OptionsEditor` carries), because the press that lands a column at an end disables the arrow it
was pressed on.

„Enter saves" stays per single-line input via `onEnterKey`, never on the dialog or a grid —
RTE-11 stands, `RichTextEditor` and the pill widgets own their Enter. Every save that Enter can
reach directly carries a ref latch, because a repeat-key burst inside one tick reads the same
stale `busy` (TTU-24, SHL-08); the settings cards go without, their repeated PATCH writes the
same value again. Enter inside an `OptionsEditor` row is deliberately inert (user decision
2026-08-13): a blank row blocks the save, so saving or appending from there would manufacture
the very validation error the user is resolving. And `Btn` defaults to `type="button"` — inert
while the client has no `<form>`, load-bearing the day one appears; that day is also the day to
revisit the default.

## Outside the dialogs the cell owns the keyboard, and a group of buttons is one stop (2026-08-13, WP-43)

Every inline editor in the task table goes through `InlineInput`, so Enter and Escape mean the
same thing in all of them; the display shells stay separate, as they always were. That is what
makes the picker rule expressible in one place: **a half-typed date commits nothing.** An
incomplete `type="date"` reports `value === ''`, and Enter or blur on that state would write „kein
Datum" over a stored one — the WP-40 hazard. `onEnterKey` answers it by refusing Enter for every
picker type (`NO_ENTER_TYPES`) and that stays: a dialog-wide Enter cannot know which of five
fields is mid-thought. A single-field editor can ask, so `InlineInput` reads
`validity.badInput` — Enter stays in the cell, blur cancels rather than clears, and the last
reading is kept in a ref for the unmount arm, which has no element left to ask.

**`AddTaskRow` does not autofocus** (user decision 2026-08-13). It is permanently visible, so
focusing it on mount would take the caret on every artist and project page opened to read, scroll
it into view and swallow the next ⌘Z. Escape therefore *clears the draft* rather than closing
anything — there is nothing to close. `SubtaskAddRow` is the opposite case and keeps its
autofocus: it is opened on purpose and Escape closes it.

**A group of equivalent buttons is one tab stop** (`lib/rovingFocus.ts`): the link category pills,
`IconPicker`'s presets, the „Bereich hinzufügen" rows and the colour swatches. The tabbable item
is the *selected* one, not the last focused — no state to keep, and Tab back into the group lands
on the current value. Arrows move focus only; picking stays with the button's own activation, so
an arrow can never write a value in passing. The rich-text toolbar's blanket `tabIndex={-1}`
remains the right answer for *it* — its buttons have another keyboard route — and both drop out of
`Modal`'s Tab cycle by the same `tabbables()` filter. The ▲▼ pair takes the same „one control, one
stop" reading with ↑/↓ *performing* the move, and ignores auto-repeat: „Spalten verwalten" moves
through the server, so a held key would compute its next move from a list that has already
changed.

**`PillSelect` still closes on Tab without picking** (RTE-11, re-examined here). A native
`<select>` commits the highlighted option on Tab; this one must not, because the menu portals to
`document.body` and Tab is the ordinary way out of a field — committing there would write a value
the user only arrowed past. `ColorSwatchPicker` is the deliberate exception to the *other* half of
RTE-11: it now places focus in its menu on open, like `PillSelect`, but leaves Tab alone, because
its menu has „eigene" and „Keine" below the grid and Tab is how they are reached.

**⌘F and ⌘K both focus the global search** (user decision 2026-08-13). ⌘F is the mnemonic and is
free in the packaged app — Electron has no find-in-page and `electron/menu.ts` declares no
accelerator besides ⌘N; ⌘K is the convention. On the dev server ⌘F takes Chromium's find bar with
it, which is the price. Unlike ⌘Z the shortcut fires *inside* text fields — moving to search is
what a user in the middle of typing means by it — and unlike ⌘Z it stops at an open dialog:
`anyModalOpen()` reads `Modal`'s own depth map, because a shortcut that moved focus through a
backdrop would strand it there. Search hits are `tabIndex={-1}`: with ↑/↓ and Enter on the field
they no longer need to be a wall of tab stops, and `aria-activedescendant` is what announces the
marked row while focus stays where the typing goes.

## Auftakt-Text kennt keinen Code: the dialect drops it on all three surfaces (2026-08-13, WP-49)

Users asked why their text sometimes turned grey and started showing HTML tags. One cause: the
editable area is `white-space: pre-wrap`, so leading spaces are typeable, and nothing escapes them
on the way out — four of them at the start of a paragraph mean „indented code block" to both
parsers. What came back was a grey box with the app's own `<u>` printed literally, because code
does not parse HTML. Nothing in the app authors code; the toolbar has no button for it. So code is
gone from the dialect entirely rather than fenced off: `code`/`codeBlock` off in the editor,
`codeIndented`/`codeText` disabled in micromark, `code`/`pre` out of the sanitize schema, and the
`.prose-md code`/`pre` rules deleted. This reverses the comment `richtext.ts` used to carry — that
`codeBlock` stays enabled „so any such content in existing notes round-trips".

Switching the extensions off is the version of this fix that **eats text**: a `code` or `codespan`
token with no handler returns `null` from `parseFallbackToken`, and the paragraph is gone the next
time the note is opened. The tokenizer has to stop producing those tokens, which is why the module
owns a `Marked` instance — `markedOptions` configures the global singleton and has no disable
switch. Returning `undefined` from a tokenizer means „no match"; returning `false` hands back to
marked's own implementation, which is the trap.

**A stored fence degrades to prose, and its markers go with it.** The bug did not only render
wrong, it wrote: an indented paragraph came back out of the editor as a ``` fence, so real
databases hold fences the app manufactured from ordinary prose. Turning three backticks into
visible characters would be the honest-but-ugly reading; instead the one code tokenizer left alive
is the fence, and both sides map its output to a paragraph (`LegacyFence`, `remarkFenceToParagraph`
— the two must change together). The text inside is *not* re-parsed: it was code, so a `*` in it
stays a `*`. Round-trip fidelity is what makes this safe to assert rather than hope for, and the
corpus in `check-markdown.ts` gained a fourth assertion for it — no case may render a `<pre>` or a
`<code>`. Render-equality alone cannot see that: it compares two runs of the same renderer, so a
construct both sides agree to draw as code passes it happily.

**Tab indents with U+00A0, because a Markdown paragraph cannot carry leading spaces** (user
decision 2026-08-13). The other half of the report was that Tab jumped focus out of the note.
Making it insert spaces instead would have re-created the bug in a quieter form — the editor would
show an indent that the reading view strips, since both parsers drop leading whitespace from a
paragraph. Non-breaking spaces are not whitespace to either, so they survive the round-trip and
both surfaces show the same thing. Lists and tables keep the Tab they already have (`sinkListItem`,
`goToNextCell`); the `Indent` extension sits below them at `priority: 50` and takes what they left.
It consumes the key either way — „nothing to indent here" must not fall through to the browser, or
the reported bug is back in one branch. „Einrücken"/„Ausrücken" call the same pair, which is what
makes WP-43's reading of the toolbar's blanket `tabIndex={-1}` true: those buttons now really do
have another keyboard route.

**⌘↵ saves from inside the editor.** Tab was the only keyboard way from a notes field to
„Speichern", and it no longer leaves. ⌘F/⌘K are inert while a dialog is open (WP-43), so without
this a dialog's notes field would have no keyboard exit at all. The editor owns the key rather than
each caller: it blurs first — which is what the commit-on-blur callers already listen for, so
`InlineNotes` and `CommentCell` handed their hand-rolled copies back — and then calls `onSubmit`,
which only the two dialogs pass. Both `submit` functions guard themselves, so ⌘↵ marks the missing
fields exactly like Enter from a single-line input rather than saving past them.

The cost is accepted: a note that deliberately held code loses its formatting. Backticks read as
the characters they are, fences read as the prose they contain. Nothing is deleted, and the
customer reports never having used fences — „(i dont think users encountered code fences) its
exclusively indentation". Revisit only if someone stores code in a festival note on purpose.

## App symbols are drawn, user symbols are typed (2026-08-13, WP-38)

The report was „Musik-Emoji fehlen" and „allgemein es sind bissi random Emojis". The first half
was a bug with a one-line cause and is in the commit log (`emojiData`). The second half was true
of thirty-one characters and needed a rule, because they had never been decided at all — they had
accumulated.

**The rule: a symbol that is the sole content of a control is an icon from `icons.tsx`. A symbol
that sits beside a word stays a character. Emoji remain for what the user chooses.**

The reason is not taste. A character in JSX is drawn by whatever font the operating system picks
for it, so `✎ ✕ ▲ ▼` came out one way on macOS and another on Windows, and monochrome line
symbols ended up in the same row as full-colour emoji (`🔗 🙂 📍`). Nobody chose that mixture and
nobody could correct it, because the choice was never ours. Where the symbol *is* the button, that
is the whole face of the control and it has to be ours. Where it precedes a word — „⚙ Spalten",
„🖨 Ein-Pager (PDF)", „⬇ Excel", „📍 {Ort}", „⚠ überfällig", „👁 sichtbar" — the word carries the
meaning and the symbol only tints it, so the font's wobble costs nothing and eleven more icons
would buy nothing.

Three of the thirty-one needed no new drawing at all: `🔗` was rendered in `DocumentRow` while
`LinkIcon` was already used in the rich-text toolbar, `⌂` sat in `SectionArranger` while
`HomeIcon` was in `Breadcrumbs`, and `▲ ▼ ▾` had `ChevronRightIcon` a rotation away. The same
concept existed twice, once drawn and once typed. That is the evidence that these were never
decisions — nobody would pick both.

Deliberately **not** converted, beyond the beside-a-word rule:

- **The sort indicator** (`▲`/`▼` beside a task-table column name). It reads a *state*; it is not
  the face of a control. The `<th>` is the click target and its own text is the label.
- **`☐` in the print sheets.** That belongs to the paper, and the print stylesheet is a separate
  surface with its own constraints.
- **`🎭` as the photo placeholder** and **`–` in the symbol picker.** Both are stand-ins for a
  missing user choice, sitting where the user's own emoji will go. An icon there would look like
  a decision the app had made.
- **`⠿`, the drag handle.** It is `aria-hidden` and Braille-derived, which is why it reads as
  texture rather than as a symbol — and every reorderable list in the app is trained on that exact
  shape (WP-35).

The font chain is the other half. `--font-sans` named six text faces and no emoji face, so the
emoji that remain — and every emoji a user picks or types — were drawn by the browser's
last-resort choice. The three platform emoji faces now sit at the end of the chain, after
`sans-serif`: unreachable for anything a text font can draw, so nothing else moves.

Accessible names were normalised in passing, because with the glyph gone `title` is the only name
some of these buttons have: `ReorderArrows` had `title` and no `aria-label`, `SectionArranger`'s
pair had `aria-label` and no `title`, lowercased. Both strings are identical, so no accessible
name actually changed.

What this does not settle: whether „✎ Bearbeiten" and the row pencil should look alike. After this
pass they do not — one is a glyph beside a word, the other an icon — and that is visible on the
project page. The beside-a-word rule is what keeps the change bounded; the alternative is a second
pass that converts them too and leaves the word.

## Der Saisonname steht im Manifest, nicht im Dateinamen (2026-08-13, WP-41)

The customer asked for the season name to be "part of the backup". It is — in `MANIFEST.txt`
inside each restore point, not in the `.db` file names, and that is deliberate.

Restoring is a **hand copy**: quit Auftakt, copy a restore point's contents over the data
directory, launch. That works only while the files carry exactly the `file` values from
`seasons.json` and sit flat in the folder. `Festival 2026.db` would be a file the app never
looks for — a backup that reads beautifully and cannot be restored. Two more constraints point
the same way: the prune regex matches `^<prefix>-<stamp>$` and never cleans up what it does not
match, and the folders sort lexicographically by name, so nothing may precede the stamp either.

The only path that would free the file names is a **restore dialog inside the app**, which could
map labels back to files itself. Deliberately not in this package — noted here so a later reader
does not mistake the missing name for an oversight.

Where the labels do land: `MANIFEST.txt` (`auftakt.db = Festival 2026`, plus timestamp and app
version) and the `README.txt` at the root of the backup folder, which carries the restore steps
in German. Both are CRLF + UTF-8 BOM because they are read in Notepad, out of Google Drive, on
Windows — without either, the customer sees one line of mojibake and the files are worse than
nothing.

Existing installations get their top-level dated folders **moved** into `backups/` and
`pre-import/` on the next backup run (best-effort, self-detecting, retried each run). Leaving
them was the smaller promise, but nothing writes at that level any more, so pruning could never
bring the pile below its cap and the untidiness would have been fixed only for fresh installs.
Flat `auftakt-<stamp>.db` files from before the folders are still left alone: they are real
backups, the README explains them, and a path a customer may have written down keeps working.

## Spalten je Kontext: jede Seite ist ein Bereich (2026-08-13, WP-51, #58)

The customer asked why columns can only be managed for project tasks — „der kuenstler hat evtl
andere spalten als ein projekt". WP-47 had deferred exactly this („parity here is about parents,
not about widening the column system"), so this is that deferral being lifted on request, not a
decision reversed by accident.

**One scope model, widened once.** `custom_columns.scope` is now `global | artist | project`, with
an `artist_id` FK parallel to the existing `project_id` — not a generic `parent_type`/`parent_id`,
which appears nowhere else in this schema: `tasks`, `events`, `contacts`, `links` and
`custom_sections` all name their parents as nullable FKs with a CHECK. A generic parent would have
been a second idiom for one table's benefit.

**No inheritance: a scope's columns stay on its own page.** An artist column appears in the artist
page's own task table and nowhere else; a project page keeps showing global + its own. The
alternative — artist columns raining down on that artist's projects — was rejected because it
answers a question nobody asked and creates several: `compareColumns` would order three groups at
once, the project export would have to join through `projects.artist_id`, and the move dialog would
need a second „values stay but go invisible" case. The artist page's editable table renders only
project-less tasks, so the question #58 called hard („what does a task under artist A's project B
show?") does not arise.

**The Übersicht needs no fourth value.** The „Festival" todos *are* the global scope — the season's
own list. „Überall individuell veränderbar" is satisfied there by the global set.

**The pairing is enforced twice, and legacy rows are normalised rather than dropped.** `scope` never
had a CHECK and the route never paired it with a parent, so both halves were separately writable and
two mismatched shapes are legal in any database this build has not opened yet: a *straggler*
(`scope = 'project'`, no project_id), invisible in every list because each one binds the scope and
the parent id together, and a *mirror* row (`scope = 'global'` carrying a project_id), which lists
as a global column and is on screen. Both are normalised before the rebuild installs the CHECK —
failing the rebuild would fail the whole database open — under one rule: **the scope is
authoritative, a parent it does not own is dropped, and only a scope that names a parent it does not
carry falls back to `global`.** Deriving the scope from the FK instead satisfies the CHECK just as
well and was the first cut, but it answers the mirror row by moving a column the user can see out of
the Übersicht and every artist page into one project, silently and with no way back except the API.
The direction is chosen so that nothing visible moves.

The rule is spelled twice because it has two audiences: the migration, for the active database, and
`copySeasonData`, which opens source seasons raw and would otherwise insert a mismatched row
straight into a target that *does* carry the CHECK — aborting the copy between groups, with no outer
transaction to undo the ones already written and a half-populated season left behind.

**No UI to change a column's scope.** (Still true after WP-59, which is where the follow-up is
answered: per-page *visibility* is not a scope change, and it removes most of the reason to want
one.) A column created in the wrong place is deleted and created
again. Its values live in `custom_values` keyed by column id, so nothing is lost that moving it
would have preserved, and a move needs its own warning (values appear and disappear elsewhere) plus
a re-stamped `sort_order` in the target group. Named here because #58 lists it as a gap: it is a
known limit, not an oversight.

**A copy without the parent keeps the values but not the column.** If tasks are copied into a new
season without the artists or projects they hang off, their scoped values stay in `custom_values`
with no column to display them — the behaviour project columns have always had. Forcing the parent
groups along would make „nur Aufgaben kopieren" quietly copy the whole season.

## Bilder liegen in der Datenbank, referenziert über ein Inhalts-Token (2026-08-13, WP-37)

The customer asked for images in flowing text — a hall plan pinned into the project description
that discusses it — and explicitly invited a counter-proposal. Three shapes were on the table: a
`data:` URL inline in the text column, a sidecar folder next to the `.db`, and no inline images at
all (link to the plan from „Dokumente & Links"). None of them won; the bytes go into an `images`
table **inside the season `.db`**, and the Markdown references them by content token:

```
![Saalplan](/api/images/9f2a41c7b8e05d3a6c1f4b90e7d28a35)
```

**The sanitizer needed no change, and that is what decided it.** `hast-util-sanitize`'s
`safeProtocol` returns true for a value with no colon before the first `/`, `?` or `#`, and `img` is
already in the GitHub default `tagNames` — so a root-relative reference renders through the
*unmodified* schema. `protocols.src` stays `http`/`https`, and the `rehypeRaw → rehypeSanitize`
order WP-49 documented as load-bearing is untouched. The `data:` option is the only one that would
have required widening that schema, i.e. taking a security decision for convenience.

The second reason is one this codebase already paid once. `crud.ts`'s `defaultList` is `SELECT *`
and `useInvalidateAll` blanket-invalidates after every write, so bytes in `projects.description`
would be refetched on every list refresh whether or not anything drew them — the defect WP-33 fixed
by dropping `notes` from `upcomingEvents`. `RichTextEditor.onUpdate` also calls `getMarkdown()` on
every keystroke, which with the bytes in the string means serializing a megabyte-scale document per
character.

**The sidecar folder was rejected on a printed contract.** `README.txt` in every restore point
already tells the user, in German, in Notepad, to copy „alle .db-Dateien und seasons.json". Those
files are sitting in the customer's Google Drive now. A sidecar folder would make that instruction
incomplete, and it would only be discovered during a restore — the one moment nothing else is left.
It also breaks the single-file export/import contract, and `VACUUM INTO` gives an atomic image of
the database that a folder copied beside it is not atomic with.

**The reference is `sha256(bytes)`, not the row id.** Ids do not actually collide today —
`copySeasonData` only ever writes into a season `createSeason()` just made — but resting on that
invariant has no gate, and the alternative is unpleasant: a remap would have to rewrite every
stored string that can hold a reference, and that set is not closable (eight text columns, every
text-typed custom column inside the `tasks.custom_values` JSON, and the landing notes in
`seasons.json`, which is not even in the file being copied). Content addressing removes the class
instead of handling it, and buys three things an autoincrement id cannot:

- **Hand-copied prose stays honest.** Paste a paragraph from one season into another and the URL
  goes with it. An integer would name a *different picture* in the target; a content token names
  either the same picture or nothing. Showing the wrong picture is strictly worse than showing none.
- **`Cache-Control: immutable` is truthful** — the same URL can never mean different bytes, not even
  after restoring an older backup — and identical bytes collapse to one row.
- **Nothing is left to enumerate.** A hostile page in the user's browser can point an `<img>` at the
  route, because `<img>` carries no `Origin` and therefore lands in the same trusted-local arm every
  same-origin GET uses. It cannot read the pixels (canvas taint); with a sequential id it would have
  had a working existence-and-dimensions oracle via `naturalWidth`.

**The season pin is added when the image is drawn, never stored.** A browser fetching an `<img src>`
sends no headers, so `X-Auftakt-Season` cannot reach the server and the request would resolve the
registry default — in a window pinned to another season, the wrong picture or none, with a DOM that
looks perfectly correct either way. `server/src/index.ts` already documents the `?season=` leg for
„plain `<a href>` downloads, which cannot carry headers"; this is the same class of request. So
`Markdown.tsx` and the editor's `resolveSrc` append it and the node's `parseHTML` strips it back
off, which is what keeps it out of storage — the `LinkHoverTitle` lesson (a rendered attribute read
back into the document) applied to a URL that outlives the window.

**Images travel on a season copy whatever groups were ticked.** Gating them on the group that
carried the text would surface as a broken picture at the customer, and no gate here could see it,
because the reference is a substring of a string. Copying a few unreferenced megabytes is the
cheaper and the visible mistake.

**Nothing is garbage-collected, and the table is deliberately outside the cascade.** `CHILD_EDGES`,
`DELETE_ORDER` and `TABLE_TYPE` are generated from the foreign-key graph; an image reference lives
in a TEXT column no foreign key describes, so `purgeExpired` — which walks `DELETE_ORDER` — can
never reach a row. Adding `images` there would read as a tidy-up and behave as data loss. Removing
an image from a note therefore leaves the row, for four reasons in order of force: the reference
inventory above is unclosable, so a sweep that misses one column deletes a live hall plan
undetectably; `useUndoablePatch` restores the pre-edit Markdown, so a hard delete would make
„Rückgängig" restore text pointing at nothing (same for a trashed task, whose comment lives 30
days); content addressing makes „orphan" ambiguous, since one row can back N references; and the
cost is bounded and visible. The honest counterweight is **visibility, not collection** — a future
Einstellungen card, and behind it a counted „Ungenutzte Bilder entfernen" that reports before it
deletes. That is a shape the user can refuse; a background sweep is not.

**Sizes, measured rather than estimated.** The client resizes to 1200 px longest side at JPEG q0.82
(~254 dpi across a 120 mm print column, and a 2× display at ~600 CSS px). A line-art hall plan at
that cap is **107 KB**; the server ceiling is 1.5 MB decoded, which leaves `express.json`'s 4 MB
limit biting at roughly 2× the intended maximum rather than becoming a working limit. Ten plans in
one season make a `VACUUM INTO` restore point **1.20 MB** — only 1.8 % over the raw bytes, so the
BLOB column costs essentially nothing beyond the pictures themselves. The number the customer feels
is the retention: with `BACKUP_KEEP = 30`, three seasons holding ten plans each take the backup
folder — which sits in their Google Drive — from **~10 MB to ~106 MB**. That is the argument for the
1200 px cap, and the reason a photographic image (roughly 3× a line-art plan) would be worth
watching.

**The editor bug was older than the feature.** With no `image` node registered, marked's token fell
through `MarkdownManager`'s `default:` branch, which returns `parseTokens(token.tokens)` when the
token has children — and an Image token's children are its alt text. So `![Saalplan](…)` in a stored
note came back out of the editor as the bare word „Saalplan", URL gone, no warning, while the
renderer displayed the same note's image perfectly. Same shape as the `code` loss WP-49 fixed, one
degradation quieter: there text turned grey, here a picture became a word. The node closes it for
every destination, including `https://` images from imported notes and `data:` URLs the sanitizer
still declines to draw — round-tripping a source the reader will not render is deliberate, because
the editor's job is to give back what it was given. `inline: true` is load-bearing:
`mdast-util-to-hast` puts an image inside its paragraph, so a block node would split
`Davor ![x](u) danach.` and disagree with the reader on every case at once. Raw `<img>` needed the
other half — `rehypeRaw` leaves a root-level tag outside any paragraph while the editor reads it
into one, hence `rehypeImgToParagraph`, next to the `<pre>` sibling WP-49 added for the same reason.

**The button is narrower than the dialect, on purpose.** Images round-trip in *every* editor, so a
note that already holds one is safe anywhere; „Bild einfügen" appears only on project descriptions
and artist notes. It defaults to off because `LandingCards` is the counter-example — its text lives
in `seasons.json`, shared across seasons, so an image inserted there would be written to whichever
season happened to be pinned and read as broken from every other one. Forgetting the flag costs a
missing button, which is visible and harmless; defaulting it on would cost that. Paste and
drag-and-drop are deliberately not wired: the editor has neither handler today, and an accidentally
pasted screenshot would land in the database.

**…and „not wired" had to be *made* true.** The first cut registered the node with
`parseHTML: [{ tag: 'img[src]' }]`, and ProseMirror runs those rules over clipboard HTML as well —
so pasting from a web page, a Word document or an Outlook mail did admit an image, with its `src`
verbatim and none of the resize → JPEG → 1.5 MB path the paragraph above describes as the only way
in. Each protocol failed differently: `data:` wrote hundreds of kilobytes of base64 into a text
column that `SELECT *` carries on every list refresh (and the sanitizer then stripped the src, so
the bloat landed and the picture did not), `https:` stored a reference no season copy or backup can
carry, `file:` showed until the note was saved. The rule now matches our own references only — a
`getAttrs` returning `false` for anything else, which drops the tag exactly as it was dropped before
the node existed. The Markdown side stays wide open, because a *stored* foreign source must still
round-trip; only the clipboard is narrowed, and `check-markdown.ts` asserts both halves.

**A link around an image needs both parsers taught, and marks around an atom are hand-written.**
`[![Saalplan](…)](https://…)` — no toolbar authors it, an import carries it — lost its destination
on the first save. Two independent causes: the Markdown manager's `applyMarkToContent` sets marks on
*text* nodes and otherwise recurses into `content`, so an atom with no content received nothing; and
the serializer opens marks only around text, so even a marked node would have been written bare.
Hence `MdLinkedImage`, standing in for the built-in `link` handler at a higher priority because that
is the only place both tokens are visible at once, and `wrapImageMarks` on the write side.
`**…**`/`*…*` are written but not read back: bold on an image has no rendered effect, so the
asymmetry costs nothing observable and the read side stays the library's.

**The alt text escapes brackets and not the backslash**, which looks wrong and is forced. micromark
(the reader) unescapes `\\` to `\`; marked (the editor's parser) leaves it alone inside an alt. So
escaping every backslash grew one per save — `a\b` → `a\\b` → `a\\\\b` — while the reader kept
drawing the original: a stored string that changed every time a note was opened, and one that only
the round-trip gate's *idempotence* assertion can catch, since the first pass still rendered equal.
Bare is a fixed point on both sides. The mechanism still survives a backslash before a bracket
(`a\[b` → `a\\[b`, which the two parse differently and agree on the result); a doubled backslash is
where they part, and no file name from the picker has one.

**A display width is spelled `?w=384` on the reference, and it is pixels via the `width`
attribute on purpose.** Both parsers treat a URL as an opaque string, so the spelling rides through
marked, micromark and the linked-image machinery untouched, keeps the alt's escaping story closed,
and keeps one stored dialect — the raw-HTML alternative (`<img src width>`, which the reader
already honoured, IMG-08) would have serialized sized images as HTML and plain ones as Markdown,
handing the alt a second escaping regime: the IMG-06 bug class, reopened. Pandoc's `{width=…}` is
parsed by neither half and renders as literal braces. Pixels because the `width` DOM attribute
takes nothing else and `style` is not in the sanitizer's allowlist — the width *attribute* is, on
`'*'`, in the unmodified GitHub schema — so px-via-attribute is the only size the untouched
sanitizer admits, the same argument that decided the storage above. `splitImageSrc` /
`composeImageSrc` (`lib/imageRef.ts`) are the one definition of the spelling, exact inverses, and
deliberately all-or-nothing: anything but exactly `w=<int>` on our own path passes through
verbatim, so unrecognized input round-trips byte-identically by construction. The two query legs
never meet — **a stored reference carries only `w`, a rendered `src` carries only `season`** —
which is what lets `canonicalImageSrc` keep truncating at the first `?`.

**The reader's half of the lift lives in the pipeline, not the React component.** The gate renders
through `markdownPipeline.ts` and ends in `rehype-stringify`, never in React — so `rehypeImgQuery`
sitting in the shared plugin list is what lets the corpus assert the width semantics at string
level (a raw `<img … width="120">` and its round-trip as `![…](…?w=120)` must emit the same HTML).
Done in `MdImage` instead, the gate could never hold such a case. The corpus alone still cannot
see an editor that merely *carries* the query — verbatim pass-through round-trips every string
perfectly while drawing the wrong size — hence the gate's node-level assertion that `?w=384`
actually lands in the parsed node's `width` attribute and the editor's own rendered `<img>`.

**Sizing is four presets, not drag handles.** Klein 192 / Mittel 384 / Groß 768 / Original (width
removed), on a selection-driven bar in `TableBar`'s pattern. Drag needs a NodeView with pointer
machinery the jsdom gate cannot exercise and produces arbitrary values; presets are enumerable
corpus cases, one ⌘Z each, and the toolbar idiom the app already has. A fresh insert lands at
Mittel — a third of a header note's column, ~10 cm on the print sheet, >3× the 1200 px capture cap
in reserve for a 2× display — unless the image is naturally smaller, because a `width` attribute
*upscales* and a 200 px logo should keep its own size. The bar is not gated on the `images` prop:
inserting stays limited to the season-safe fields, but an image round-trips through every editor,
so wherever one can legitimately sit it can also be re-sized. A side effect worth naming: a raw
`<img … width="120">` from an import now *survives* an edit, re-spelled as `?w=120` — before the
schema had a `width` attribute, the first keystroke silently dropped it.

**Alignment rides the same rails as the width, and `left`/`right` mean float on purpose.** The
grammar grows to `?w=384&a=right` (canonical order, still all-or-nothing — `?a=right&w=384` and
`?a=middle` pass verbatim), the carrier is the legacy `align` attribute (in the untouched
sanitizer's `'*'` allowlist, like `width`), and `rehypeImgQuery` lifts both legs. For `left` and
`right` the attribute already *means* the right thing in every browser — a float the text wraps
around, which is exactly how the Notion-imported `<img align="right">` notes have rendered since
IMG-08 — so committing to float semantics makes our spelling and imported raw tags render
identically under one set of CSS rules, and never re-means a stored string later. `center` has no
legacy meaning on an `<img>` and is a block on auto margins. All three are pinned in `index.css`
(`.prose-md img[align=…]`), a clearfix on `.prose-md` keeps a trailing float inside the note card
and on the print sheet, and the lone-image paragraph rule excludes aligned images so its higher
specificity cannot silently win the margin fight. In the bar, alignment *toggles* like the
toolbar's marks — clicking the active one returns to text flow — because unlike the width there
is no fourth value worth a button.

**Floats broke click-to-select, and the fix is `posAtDOM`, not coordinates.** ProseMirror maps a
click through the browser's caret-from-point, and next to a float Chromium resolves a point that
is visibly *on* one image to the start of the line beside it — the old NodeSelection stood, and
the size bar edited the wrong picture. The image node now handles its own `mousedown`: an event
whose target is an `<img>` that maps to an image node becomes a NodeSelection via `posAtDOM`,
which asks the DOM tree instead of the layout. This was the predicted cost of float semantics
(the editor-UX tail), found by the headless verification run on the first try.

---

## Landing-Schreibzugriffe: eine Generation pro Blob, Konflikt statt stillem Verlust (2026-08-14, WP-53)

Cross-window season races were left *bounded* (PR #50 review, above). This one is closed, because
the cost is not a transient mixed render but destroyed customer data with nothing behind it.

**Der Befund.** A landing `PATCH` replaces whole arrays, so every mutation computes one from a
read — and `useLanding().refresh()` was `ensureQueryData`, which returns the cache whenever an
entry exists. Two windows computing from the same read each stored their own array, and the other
window's document, Bereich or note ceased to exist: no message, no `deleted_at`, no Archiv, and no
Papierkorb behind `seasons.json`. Reachable in normal operation since multi-window seasons — the
landing content is cross-season, so it is on `#/` in every window, and Cmd+N adopts the registry
default, which makes *two windows on the same season* the ordinary case rather than the odd one.

**Konflikt erkennen schlägt frisch lesen.** Reading honestly before every write (which we now also
do) only shrinks the window to one round trip and leaves the loss inside it silent. `patchLanding`
therefore stamps a `rev`, the route refuses a patch built on a superseded one with 409, and
`useLanding().update(fn)` takes a *function*: on refusal it re-applies `fn` to the content the 409
carried and writes again, up to `MAX_CONFLICT_ATTEMPTS`. So a concurrent write is merged, and an
exhausted budget is reported through the caller's existing catch → German toast. Taking an array
instead of a function would defeat the whole thing — a retry can only re-apply an *intent*, and
every mutation on that page was already written as one (`now.filter(…)`, `[...now, added]`,
`arrayMoveTo(now, …)`).

**Eine Generation für den ganzen Blob, nicht eine je Schlüssel.** The server still merges per
top-level key, so the counter is coarser than the storage: a notes edit is refused over a
concurrent document add that could never have collided with it. Deliberate — the client answers
that with one extra round trip against a local Express process, and the user cannot tell. Per-key
generations would buy nothing anybody can perceive and would put a second bookkeeping scheme into
the registry.

**Nichts zu migrieren, in beide Richtungen.** A registry written before this has no `rev` and
reads as 0. An *older* build rebuilds `reg.landing` from its four named keys and so drops the
counter, which the next new build also reads as 0 — one refused write, then self-healed. An
omitted `rev` still writes unconditionally, because `demo.ts` and the seeders call `patchLanding`
in-process and have no generation to name; the conditional half is the client's contract.

**`useSettingsArray` bleibt bei der halben Lösung, mit Absicht.** It has the identical shape and
its `refresh()` got the same honest refetch, but `write` still posts a snapshot, so two windows on
one season can still replace each other's `dashboard_layout` or `labels`. Those are configuration
arrays: a lost edit is on screen and one gesture from being redone, where a lost document is gone.
Giving them the same guarantee means a generation column on the key/value `settings` table and a
response-shape change, in the same migration chain WP-R5 is about to rework. **Revisit** if a
customer reports a lost setting, or once WP-R5 has landed and the chain is being touched anyway.

*Nachgeholt in WP-R5 (2026-08-16) — the column is there and `update(fn)` uses it; `write` keeps
the snapshot semantics described here, and the entry at the end of this file says which callers
are on which and why.*

**Der Broadcast ist die erste Verteidigungslinie und funktioniert** — which the verification found
the hard way. Holding a window's `GET /api/landing` back to force a stale read produces no
conflict at all: the other window's write broadcasts an invalidate, the held window's active query
refetches, and that second GET supersedes the held one inside react-query. The lost update is a
write *arriving* after a newer generation landed, not a stale read, and no amount of invalidation
can prevent it. That is why the guard is on the write and not merely on the read.

---

## The gesture's first raster is paid one frame later than the watchdog thought (2026-08-14, WP-61)

A customer's boot log — the one WP-54 built the path to — closed WP-61's three-way triage in a
single field. Fourteen cold boots on a Windows 11 laptop (Intel UHD via ANGLE D3D11, Electron 43):
twelve `abort:hitch`, one `click`, one `done`. Not `deadline` (`readyMs` was 187–996 ms, always
inside the 1200), not `reduced-motion` (the gesture started every time), and not the shelved
plan's favourite either — a first-launch-ever skip would have fixed launch one and left eleven,
because this fired across eight hours and two app versions, not on the debut.

**The exemption was one frame short, and the frame it missed is the one that matters.**
`start()` adds `.boot-play`, which makes the svg visible and unpauses all twelve animations at
once, so the svg's first raster is paid inside the gesture and never before it. rAF callbacks run
*before* paint and raster is asynchronous: the first callback only records the frame, the delta it
opened closes on schedule, and the wait for the compositor to present that first raster lands in
the **next** delta — the first one the judge ever sees. The single exempt slot was therefore spent
on the frame that *schedules* the raster, and the frame that *pays* for it was judged and aborted.
Ten of the twelve show it exactly: a textbook 16.4–17.4 ms in the exempt slot, then `n: 1` with a
single judged frame of 99.6–316.5 ms.

The strongest evidence that this is an accounting error rather than a slow machine is in the same
file. Two runs happened to land the expensive frame *in* the exempt slot (`warm` 116.5 and 99.9);
one of them went on to render 126 frames at a 16.7 ms median, p95 16.9, one drop. The tail median
is 16.6–16.8 ms in all fourteen runs. The machine plays the gesture perfectly — the watchdog was
killing it on frame two.

**The fix is two exempt head frames, and two is the length of the pipeline, not a tolerance.**
`onReady` already waits two rAFs before `start()` for precisely this reason, commented „two frames,
because the first only schedules the paint" — the correct model was in the file 120 lines above the
bug, applied to `#root`'s paint and missed for the svg's. A time box was rejected: covering the
worst observed head (603 ms) would blind the judge for a quarter of the gesture, including the
anticipation flick, where two frames costs ~33 ms on a healthy machine. Three was rejected because
in fourteen runs the cost never reached the third delta.

**`HITCH_MS` moved 50 → 58 because 50 sat on a quantization step.** Deltas quantize to the
display's interval — 16.7 / 33.3 / 50.1 / 66.8 at 60 Hz — so `d >= 50` could only ever fire at
50.1, which is the smallest gap the constant's own comment calls tolerable, and 50.0 is not a value
the panel can produce. Three of the fourteen runs carry a 50.1 ms frame on an otherwise 16.7 ms
machine: background noise, not a stutter. At the midpoint of the two steps the test tolerates three
intervals at 60 Hz and six at 120 and catches the next one up at either rate — which is what „three
frames at 60 Hz, six at 120" always meant. `drops` still counts every 50.1 ms gap as two lost
frames at the window's end, and that is what makes raising the absolute safe.

**Softening the hitch bound with `quick` was tried against the data and rejected.** TODO.md had
pre-registered it as the likely fix, by analogy with `SLOW_MS`. On this machine `quick` is
16.5–16.6, so `max(HITCH_MS, quick * k)` is inert for every sensible `k` — at `k = 3` it evaluates
to 49.8, *lower* than the constant it was meant to soften — and it fixes none of the twelve. Worse,
at the moment the first judged delta arrives `quick` does not exist yet: it is computed only at a
window boundary, and no window has closed. The analogy does not transfer. `quick` normalizes
`SLOW_MS` for **refresh rate**, because a 30 Hz panel's honest median is 33 ms; a hitch is a
**discontinuity**, and how visible a discontinuity is depends on human vision, not on the panel.
Scaling it by the display would make the test strictest on the fastest hardware, which is backwards.

**The report is `v: 2`.** Two head frames are exempt instead of one, so `frames.n` counts one delta
fewer, `warm2` joins `warm`, and `why` and `tail.verdict` were decided under a different
`HITCH_MS`. Nothing branches on `v` and a `v: 1` line stays readable field for field, but the two
generations will share one file — the log keeps 100 lines — and must not be compared across the
boundary. `warm2` stays out of the German summary for the same reason `warm` and `quick` do: that
digest is for triage, not analysis.

### The raster pre-warm was declined, and the reason is not the obvious one

Paying the svg's first raster during phase A would fix the cause rather than the accounting. Three
findings killed the version that suggests itself, and they are recorded because the idea is easy to
re-derive:

- **It would not be invisible.** `.mover` carries `bootActorFade … both` with a 2410 ms delay, and
  that keyframe's `from` is `opacity: 1`. A paused animation sitting inside its delay with a
  backwards fill is in effect, so the hand's computed opacity during the hold is **1** — the base
  `opacity: 0` never applies. `visibility: hidden` is the only thing hiding the parked baton, and
  making the svg visible in phase A would park it on screen for the whole hold, which the rule's own
  comment forbids by name. (The other three are genuinely invisible: `.lt`, `.ripple` and `.trailg`
  all fill backwards at zero.)
- **The cost is per-launch, not a cold-cache artifact.** It recurs across three sessions eight hours
  apart at 99.6–316.5 ms. A pre-warm therefore moves 100–300 ms into the hold on *every* launch —
  the window `readyMs` is measured in, on a machine already observed at 996.5 ms of a 1200 ms
  deadline. That trades `abort:hitch` for `deadline`.
- **What the exemption does not fix, and a pre-warm would.** The animations' clocks start at style
  application, so the stall means the gesture begins already jumped forward — ~100 ms typically,
  ~600 ms in the worst logged run, where the baton would materialize about a fifth of the way along
  its stroke. That is the artefact the attacca choreography was reworked to avoid.

**The variant worth keeping** is a `.boot-show` class — svg visible, animations still paused —
applied two frames before `.boot-play` inside `start()`. It pays the raster before the clocks
start, and it confines the parked hand to the head of phase B instead of the whole hold. **Gate it
on** a second customer log *and* on a measurement that pre-rastering actually makes the following
frames cheap, which is not obvious: every animated frame re-rasters anyway, so only tile
allocation, the GPU upload and the program cache are pre-payable.

### What the second log has to answer

The local repro proves the accounting — inject the same 150 ms block one frame apart and the
outcomes invert — but it runs on a Mac with a synchronous main-thread stall, while the customer's
is compositor back-pressure. Same delta *sequence*, which is the watchdog's entire input, different
mechanism. It cannot prove their raster now fits under the new rules. Two predictions to check
against the next log:

- **One run may trade `abort:hitch` for `abort:drops`.** The run at 10:08:26 delivered a 33.3 and a
  50.2 inside its first window — three lost frame-slots. Post-fix it reaches the window boundary
  instead of aborting at frame nine, and `drops >= 0.2 * (deltas.length + drops)` aborts on any
  window holding twelve or fewer judged deltas; a 200 ms window at 16.7 ms holds about twelve. If
  that is what the log shows, the coherent follow-up is that a 50.1 ms gap cannot be noise for the
  hitch test and two lost frames for `drops` — but that is a second decision, and one data point is
  not enough to take it.
- **How far into its swing the gesture starts.** `warm` + `warm2` + `lead` is that number, and it
  is what decides `.boot-show`.

---

## Die Schema-Version weigert sich nur abwärts, und die Generation zählt pro Blob (2026-08-16, WP-R5, #8)

`initDb` is a detect-and-repair chain with no memory: every step asks the data whether it has run
and does nothing when it has. That is what makes it safe to run on every open — and it is also why
a file a *newer* build had already migrated opened in an older one without a word. Nothing in the
file said which build last touched it, several steps are lossy in the direction they run
(`migrateFlattenDeepSubtasks` reparents a third level onto the root, `migrateProjectsMergeNotes`
folds a column into another), and the queries above them then read a shape they were not written
for. Multi-window seasons raised the stakes rather than creating the hole: season files of
different ages now sit side by side, and the import path accepts any `.db` the user picks.

**`PRAGMA user_version`, not a settings row.** The marker has to be readable *before* the chain
runs and on a file this build may refuse to touch at all; a row in `settings` would mean opening
the database as an Auftakt database first, which is the thing in question. `user_version` is also
preserved by `VACUUM INTO`, so exports, backups and pre-import snapshots carry the stamp without a
single line about it — verified, not assumed, since the whole import story rests on it.

**The refusal is one-sided, and that is the part a later tidy-up will get wrong.** `>` and never
`>=` or `!==`: an unstamped file reads 0, which is every database in existence at the moment this
ships, and the build that introduces the stamp must open all of them. The stamp is written at the
*end* of the chain for the same reason — writing it first would promise a repair that a throw
halfway down never delivered.

**Refusing is per season, not per app.** With several seasons open at once, one file from a newer
build must not keep the app from starting: `getDb()` closes the handle it opened and throws, the
boot warm catches, and `seasonStats` already reports `null` for a season it cannot read. So the
window pinned to that season shows the German sentence where its data would be, and the season
switcher next to it still works — which is the only thing the user can usefully do about it.

The sharpest edge of that rule is not on screen at all, and the review found it: **a refused
season must not stop the backups.** Main reads `/api/backup/status` headerless, i.e. against the
*default* season, and one caller up a failed read is indistinguishable from „no backup folder
configured" — so a 500 there skipped the startup backup for *every* season, silently, because
nothing threw and `reportBackupProblem` never fired. Exactly WP-39's „backups stopped without a
word", reintroduced by a refusal meant to protect data. `hasData()` therefore answers `true` for
a season it cannot open — an unreadable file is not evidence that there is nothing to protect,
and it is the state in which a backup matters most — and `ensureBackupDir` turns any non-OK
status into a reported problem rather than an empty folder path. Nothing else was in the way:
`runBackup` snapshots each season file raw, so the refused season is backed up like the rest.

**Not a version *negotiation*.** No compatibility range, no „read-only mode" for a newer file, no
downgrade path. Auftakt is a single-user local app whose answer is „update Auftakt", and every
alternative buys a permanent second code path for a case that resolves itself in one download.

### Die Generationsspalte auf `settings`: eine je Blob, und nur `update` benutzt sie

WP-53 left this open deliberately and named the price: giving `useSettingsArray` the landing's
guarantee needs a generation column, and the place to add one is the migration chain — which
WP-R5 has open anyway. It is here now, on the same shape as `seasons.json`'s `rev`: the server
answers `GET /api/settings` with the generation the values were read at, a PATCH carrying it back
is refused with 409 (the current settings ride along, so the client needs no second GET), and a
PATCH omitting it writes unconditionally, exactly as `patchLanding` does for the seeders.

**Eine Generation für den ganzen Blob.** The column is per row — `MAX(rev)` is the table's
generation, and every write stamps the rows it touches with `MAX + 1` — but the *comparison* is
one number for the whole table, so a `labels` write is refused over a concurrent `task_stats`
write that could never have collided with it. Deliberate, and the same trade the landing takes:
the client answers a false conflict with one extra round trip against a local Express process, and
per-key generations would be a second bookkeeping scheme for something nobody can perceive. Storing
the counter per row rather than in a row of its own is what leaves the finer comparison available
later without another migration.

**Only `update(fn)` sends it, and only one caller is on `update` today.** The guarantee is not the
column, it is that a refused write can be *re-applied*: `update` takes an intent over the stored
array, so a 409 re-runs it against what actually landed. `write(next)` cannot do that — its next
array was assembled by a controlled editor from the array *it* rendered — so sending a generation
from there would turn a silent lost update into a refused save, which is worse, not better. The
callers that are already intents move over; the ones that are not stay on `write` and stay
last-writer-wins:

| caller | array | write |
|---|---|---|
| `useRenameLabel` | `labels` | `update` — „this key, that text, the rest as it stands" |
| `SectionArranger` (`Arranger`) | `dashboard_layout`, `*_layout*` | `write` — every mutation is computed from `full`, the *rendered* merge of the stored array with the section catalog, and `move`/drag measure their target against the on-screen order. Re-deriving that inside a retry would change what „move past the next visible section" means, and the removal undo hangs off the same call's boolean |
| `TaskSortEditor` (`useTaskSort`) | `task_sort` | `write` — the editor is fully controlled and hands over a finished array in `onChange` |
| `SettingsPage` scalars | `saison`, the two windows | unconditional `patchSettings` — one field, one control, no array to lose |

The server half is complete either way, so moving a caller over later is a client-only change. The
line to hold is the one above: **an intent may be retried, a snapshot may not**, and a caller that
cannot express its change as a function of the stored array has not earned the guarantee by
sending a `rev`.

---

## Eine Leerzeile ist ein `&nbsp;`-Absatz — in beiden Richtungen, und nur oben (2026-08-16, WP-57)

Report: „nach einer liste etc. im texteditor mit ZWEI leeren zeilen, wird immernoch nur eine leere
zeile angezeigt. bzw bei einer leerzeile zwischen zwei listen wird KEINE angezeigt. das ist ‚raw
markdown' behaviour das unintuitiv ist und nicht den user erreichen sollte."

The cause was the vendored serializer, not the app. `@tiptap/extension-paragraph` writes the
empty-paragraph marker only from the **second** consecutive empty paragraph on
(`previousNodeIsEmptyParagraph`), and blocks are joined by a blank line — so an unmarked empty
paragraph is indistinguishable from the separator that was already there and simply evaporates.
The list case is the same fault with a worse outcome: a run of blank lines does not end a list in
marked or in micromark, so what the editor stored for „Liste, Leerzeile, Liste" was
`- a\n- b\n\n\n\n- c\n- d`, i.e. **one** list of four items. The user's structure was gone from
storage, not merely drawn wrong. It took one typo fix to lose it — `InlineNotes` only writes when
the draft differs, so the note was intact until the day somebody edited it.

The marker is now the only spelling of an empty paragraph, in both directions: `MdParagraph`
writes `&nbsp;` for every empty paragraph, and `DialectLexer` stops the manager inventing paragraphs
out of blank lines (`createImplicitEmptyParagraphsFromSpace` built `separatorCount - 1` of them —
the mirror image of the swallowed marker). One `&nbsp;` paragraph ⇔ one empty paragraph, and a run
of blank lines means to the editor exactly what it means to CommonMark: nothing. That last half is
not optional. Without it, every note the old serializer wrote a `\n\n\n\n` into — which is what it
wrote for two typed blank lines — would gain a blank line nobody typed on the next save.

Three limits, each of them a decision rather than an implementation detail:

- **Top level only** (`ctx.parentType === 'doc'`). Inside a table cell an empty paragraph is an
  *empty cell*; writing the marker there put a visible `&nbsp;` in it and escaped it to
  `&amp;nbsp;` on the save after that, since cell text is serialized verbatim. „Eine Leerzeile" is
  a statement about the blocks of a note, nothing else.
- **The trailing run is not stored** (`MdDocument`). `TrailingNode` appends an empty paragraph
  whenever the last block is not one, so a note ending in a list, a heading or a table has
  somewhere to click — it is an affordance of the editing surface and is there whether or not
  anyone typed it. Storing it would have added a blank line to *every* such note on its first save.
  The whole trailing run is dropped, not one per save, or a note holding two would shrink by one
  every time it was opened. The cost is that a blank line at the very end cannot be stored, and at
  the end there is nothing under it to push down.
- **A stored blank line still ends up as a marker.** Legacy `\n\n\n\n` runs migrate to the
  canonical spelling on the first save and render identically before and after, which is what
  `blankLinesLegacy*` in the corpus asserts.

Reaching the read half needed a lever the extension does not offer: the method is private and there
is no option. The manager builds its lexer as `new markedInstance.Lexer(markedInstance.defaults)`,
so replacing `Lexer` on the `Marked` instance this module already owns replaces the lexer the
manager uses, and `raw` is the only thing a run of blank lines is read out of. Only the top-level
`lex()` is touched; `blockTokens`/`inlineTokens`, which custom tokenizers reach through, keep
marked's own behaviour.

**Spacing parity was measured, not assumed.** `.prose-md--roomy > p` is `margin: 1em 0` against the
compact `0.35em`, and the worry was that a surviving `&nbsp;` paragraph would draw taller in the
reading view than in the editor. It does not: both surfaces carry the same `prose-md--roomy` class,
the empty paragraph is a direct child of both, and `<p>&nbsp;</p>` and ProseMirror's
`<p><br></p>` are both exactly one line box. Driving the demo's project 5 gives identical block
sequences, identical margins per block and identical blank-line heights on both surfaces; the only
difference is the +4 px a `<ul>` has in the editor, which is TipTap's `li > p` wrapper and predates
this package. No CSS change was needed, and the measurement is the reason none was made.

---

## Das Update bleibt stumm — der Hinweis kommt davor, nicht der Installer (2026-08-16, WP-60)

Report: „bei einem automatischen update in windows gibt es keine progress bar oder nichts was den
user vorbereitet was passiert. da auf den laptops oft ein antivirus programm ist, was die .exe und
das programm erst scanned, kann es manchmal recht lange dauern bevor sich irgendetwas oeffnet."

Das sind zwei Beschwerden, und nur die erste ist eine Fortschrittsanzeige. `updater.ts` hat
`downloadUpdate()` ohne ein einziges abonniertes Event abgewartet — `download-progress`,
`update-downloaded` und `error` lagen alle brach —, also gab es buchstäblich nichts zu zeigen. Das
ist der Teil, den ein Balken löst: `download-progress` in die Karte, derselbe Wert an
`setProgressBar()` in die Taskleiste.

Die zweite Beschwerde ist **von keinem Balken erreichbar**, und das ist die eigentliche
Entscheidung. `quitAndInstall(true, true)` startet NSIS stumm; ab diesem Aufruf gibt es kein
Fenster, kein Taskleisten-Symbol und keinen Renderer mehr, während der Virenscanner die frische
`.exe` prüft. Die naheliegende Antwort wäre `isSilent = false` — dann zeigt NSIS sein eigenes
Fortschrittsfenster. Sie ist **abgelehnt**: sie erkauft den Balken mit zusätzlichen Klicks in einem
Installer-Dialog, den niemand lesen will, und mit einem zweiten, fremd aussehenden Fenster auf
genau den Geräten, deren Benutzer ohnehin schon unsicher sind, was gerade passiert. Erreichbar ist
nur der Moment **davor** — der Neustart-Dialog, den es schon gab. Er nennt jetzt die drei Schritte
und sagt, dass der Scan eine Minute oder mehr dazulegen kann. Eine erwartete Wartezeit ist nicht
dasselbe Ereignis wie eine unerklärte: dieselbe Minute, ein anderer Vorfall.

Zwei Nebenentscheidungen, die daran hängen:

- **Der Kanal geht an *ein* Fenster, nicht an alle.** `update-download-progress` ist der zweite
  `webContents.send` der App überhaupt und der erste, der einen *Wert* trägt — beides Abweichungen
  von `backup-config-changed`, das an alle geht und ein reines Signal ist. Beide sind hier richtig:
  den Fortschritt kennt nur der Main-Prozess (es gibt nichts zum Nachladen), und in der
  Download-Ansicht steht nur das Fenster, in dem geklickt wurde. `docs/ARCHITECTURE.md` führt die
  beiden Kanäle jetzt als Paar.
- **`error` wird abonniert, `downloadUpdate()` allein reicht nicht.** electron-updater meldet einen
  Teil der Fehler nur über das Event und lässt das Promise hängen; ohne Timeout blieb die Karte
  dann für immer auf „Update wird heruntergeladen…" stehen, mit verschwundenem Knopf. Der Download
  läuft jetzt gegen `error` und `update-downloaded` als Rennen — ein Fehlschlag landet im selben
  deutschen Dialog wie eine fehlgeschlagene Prüfung.
- **Während eines Downloads fasst kein zweites Fenster den Updater an** (Review zu PR #100).
  `autoUpdater` ist prozessweit, Fenster sind es nicht: `checkForUpdates()` feuert `error` auf
  demselben Emitter, an dem der laufende Download hängt — ein Klick auf „Nach Updates suchen" im
  zweiten Fenster ohne Netz hätte den Download im ersten mit „Update fehlgeschlagen" abgebrochen,
  obwohl er weiterläuft und beim Beenden installiert. Nach dem Event zu filtern geht nicht, beide
  Pfade übergeben eine Meldung und nur der englische Wortlaut unterscheidet sie. Also antwortet
  eine Prüfung währenddessen **aus dem Cache** — neu sein kann sie ohnehin nicht, die
  heruntergeladene Version *ist* die neueste bekannte — und ein zweiter Installationsklick bekommt
  „Das Update wird bereits heruntergeladen." Der bewusst offene Rest: hängt `downloadUpdate()`
  wirklich für immer, bleibt die Sperre die Sitzung über stehen. Ein Timeout wäre eine Frist, die
  niemand gemessen hat; sie steht stattdessen auf der Windows-Liste zur Beobachtung.

## `hasVisibleWindows` lügt, wenn alles minimiert ist — der Dock-Klick liest die Fensterliste (2026-08-18, WP-67b)

WP-67 (PR #119) hat den Zweig gebaut, der beim Dock-Klick **alle** minimierten Fenster zurückholt,
und ihn dann nie erreicht. Der macOS-Durchgang am Tag nach dem Merge fand denselben Fehler
unverändert vor: zwei minimierte Fenster, es kommt eines zurück.

Die Ursache ist gemessen, nicht geschlossen. Eine nackte Electron-Sonde — zwei Fenster, kein
eigenes `restore()`, Electron 43.3.0 auf macOS 15.6 (Darwin 24.6.0) — protokolliert beim Klick auf
das Dock-Icon mit **beiden** Fenstern im Dock:

```
ACTIVATE  hasVisibleWindows = true
  state at event: #0 min=true vis=false | #1 min=true vis=false
  state +400ms:   #0 min=true vis=false | #1 min=false vis=true
```

AppKit meldet also **`true`**, während jedes einzelne Fenster minimiert ist. Das Flag kommt aus
`applicationShouldHandleReopen:hasVisibleWindows:` und Electron reicht es unverändert an das
`activate`-Ereignis weiter; `activatePlan` las es als „etwas ist auf dem Schirm → nichts tun" und
nahm damit genau den Zweig nie, für den das Paket geschrieben war. Der Kommentar dort („macOS'
eigene Antwort") war eine Annahme, die niemand nachgemessen hatte.

**Die Liste ist im selben Moment richtig.** Beide Fenster antworten auf `isMinimized()` mit `true`,
und zwar *zum Ereigniszeitpunkt*; das Fenster, das macOS selbst zurückholt, taucht erst in der
nächsten Stichprobe auf. **Deren Beschriftung im Protokoll oben ist irreführend**: der mit
`+400ms` bezeichnete `setTimeout` feuerte tatsächlich 657 ms nach dem Ereignis (17:20:02.142 →
17:20:02.799). Gemessen ist damit die **Reihenfolge**, nicht ein Abstand — wann genau macOS
innerhalb dieser 657 ms zugreift, weiß niemand, und keine Entscheidung hier hängt daran. Also
kommt der Zustand aus der Liste: „auf dem Schirm" ist `live.some(w => !w.isMinimized())`, das
zweite Argument der Funktion entfällt ersatzlos, und der Handler nimmt es gar nicht mehr entgegen.

**`isMinimized()`, nicht `isVisible()`** — das entscheidet einen weiteren Fall mit. Ein Fenster,
das ausgeblendet ist, ohne minimiert zu sein (die App hinter Cmd+H; ein Fenster, das noch startet
und mit `show: false` erzeugt wurde), zählt damit als „auf dem Schirm". Cmd+H mit einem minimierten
Fenster beantwortet den nächsten Dock-Klick deshalb nur mit dem Fenster, das oben war — Finders
Antwort, und die, die der Durchgang vom 2026-08-18 als offene Frage notiert und beantwortet hatte.
Die Sonde zeigt, dass es ohnehin so ausgeht: macOS blendet **vor** dem Ereignis wieder ein, der
Handler liest das Fenster also bereits als nicht-minimiert.

**Die Reihenfolge ist die eine Annahme, die bleibt.** Der Plan entsteht auf dem Zustand beim Klick.
Käme macOS' eigenes Zurückholen einmal *vorher*, sähe der Handler „eines ist oben" und täte nichts
— dasselbe, was der zweite Klick tut, und was der Durchgang ausdrücklich als richtig eingestuft
hat. In zwölf protokollierten Klicks — fünf davon mit ausschließlich minimierten Fenstern, zwei
davon direkt hintereinander — kam die andere Reihenfolge kein einziges Mal vor.

Nebenbefund, der die Diagnose stützt: **ohne jedes Fenster** meldet dasselbe Flag korrekt `false`.
Es lügt genau in dem Zustand, für den es hier gebraucht würde.

**Nicht erneut vorschlagen**, das Flag „nur als Hinweis" wieder mitzulesen: es trägt in diesem
Zustand keine Information, und die einzige Stelle, an der es je gelesen wurde, hat den Fehler
verursacht, den sie beheben sollte. Die Sonde selbst ist der Weg, solche Fragen an den
Main-Prozess zu beantworten — das Rezept steht in `docs/VERIFYING.md`.

## Die README im Backup-Ordner ist für einen Rechner geschrieben (2026-08-18, WP-68)

Der macOS-Durchgang las die zwei Dateien kalt und befand sie als „zu kompliziert": „Eine Sicherung
zurückspielen" ist kein Deutsch, das jemand spricht, „als Ordner mit Datum und Uhrzeit im Namen"
meint ein Format und sagt es nicht, „sonst schreibt sie über das Zurückgespielte hinweg" ist
unverständlich. Das ist keine Geschmacksfrage: `docs/BACKUP-TESTING.md` Fall 7 verlangt,
beim Wiederherstellen **der README zu folgen statt der Checkliste**, weil das die Schritte sind,
die der Kunde bekommt.

**Eine Plattform, nicht beide nebeneinander.** Die Wiederherstellung passiert an *einer* Tastatur,
und der erste Schritt unterscheidet sich dort wirklich: `window-all-closed` beendet die App auf
Windows und kehrt auf darwin früh zurück (`electron/main.ts`), „Fenster schließen reicht nicht"
ist also auf dem Mac wahr und auf Windows falsch. Ein Text mit beiden Zweigen zwingt den Leser,
vor Schritt 1 eine Auswahl zu treffen — genau das, was ein Text für den Ernstfall nicht tun darf.
`process.platform` entscheidet beim Schreiben; die zwei Unterschiede der anderen Plattform stehen
als eigener Abschnitt am Ende, damit ein Wechsel auf einen neuen Rechner nicht in eine Sackgasse
läuft. Der Preis, benannt: zwei Installationen, die in **denselben** Cloud-Ordner sichern,
schreiben die Datei bei jedem Start gegenseitig um (`writeDoc` vergleicht Bytes). Für eine
Installation je Ordner — der Fall, für den der Ordner gedacht ist — kostet es nichts.

Der Nebenbefund des Durchgangs erledigt sich damit ohne Sonderregel: die Ordner heißen im Text
schlicht `backups` und `pre-import` statt `backups\`, und nur *Pfade* tragen den Trenner der
Plattform, für die der Text geschrieben ist.

**Schritt 5 nennt den Pfad, statt ihn zu beschreiben.** Auftakt kennt sein Datenverzeichnis beim
Schreiben (`dataDir()`), also steht es ausgeschrieben da; die portable Schreibweise
(`%APPDATA%\auftakt`, `~/Library/Application Support/auftakt`) bleibt in der Zeile darunter, weil
sie auf einem neuen Rechner die einzige ist, die noch stimmt — und weil `check:backup` seit WP-41
auf `%APPDATA%` prüft.

**Die Dateien benutzen das Wort des Kunden.** Wer die Saison in den Einstellungen umbenannt hat,
soll sie nicht ausgerechnet in den zwei Dateien wiederfinden, die er liest, wenn nichts mehr da
ist; `seasonTerms()` in `db.ts` ist die Leseseite von `setSeasonTerms` und wendet dieselben zwei
Vorgaben an wie `useSeasonTerm` auf dem Client. **Damit fällt eine Falle an:** das Wort hat ein
unbekanntes Geschlecht, ihm darf also nie ein Artikel oder ein flektiertes Determinativ vorangehen
— „ein Backup einer einzelnen Festival" ist das Ergebnis. Der Text ist um das Wort herum
formuliert (`je <Singular>`, `aller <Plural>`, `Diese <Plural>`), genau wie die Strings des
Clients, und ein Test hält es fest.

**Geprüft wird das Windows-Rendering im Unit-Test, nicht im Gate.** `npm run check:backup` fährt
den echten Lauf und sieht deshalb immer nur die Fassung *dieser* Maschine — auf dem Entwicklungs-
Mac und im Linux-CI also nie die, die der Kunde bekommt. `client/src/lib/backupDocs.test.ts`
rendert beide (der gleiche Griff über die Paketgrenze, den `backupDir.test.ts` nach `electron/`
macht); dafür importiert `backupDocs.ts` jetzt **nichts** außer `node:fs` und bekommt Ordnernamen,
Aufbewahrungszahl und Saisonbegriff als Optionen. Was auch das nicht prüfen kann, ist
Verständlichkeit — die bleibt bei Fall 3c und Fall 7, von Hand, kalt gelesen.

---

## Ein pre-import-Ordner trägt, was ein Wiederherstellungspunkt trägt (2026-08-21, WP-68-Review)

Aus dem unabhängigen Review von PR #123. Die README beschreibt beide Vorräte unter *einem*
„Was hier liegt", und der pre-import-Absatz sagte „Dasselbe" — womit er die Aufzählung darüber
erbte: eine `.db` je Saison, `seasons.json`, `MANIFEST.txt`. Im Ordner lag aber die eine `.db`
und sonst nichts: `preImportBackupPath` schreibt genau eine Datei, ohne Registry und ohne
Manifest. Schritt 3 („Öffne die Datei MANIFEST.txt") und Schritt 4 („ALLE .db-Dateien **und die
Datei seasons.json**") schickten den Leser also in zwei Dateien, die es nicht gab — und zwar
genau den Kunden, dem ein Import gerade die Daten zerlegt hat, also den einzigen Fall, für den
dieser Vorrat überhaupt existiert. Das ist die Sackgasse, die WP-68 beseitigen sollte.

**Entschieden wurde die teurere Richtung: nicht den Text ehrlich machen, sondern den Ordner
vollständig.** Der Text hätte gereicht („hier liegt nur die eine .db") und wäre eine Zeile
gewesen. Dagegen steht, dass der Kunde dann *zwei* Wiederherstellungswege im Kopf behalten muss,
je nachdem, aus welchem Ordner er kommt — in einem Dokument, dessen einziger Fehler bisher war,
zu kompliziert zu sein. `writePreImportDocs` (`db.ts`) legt jetzt die Registry-Kopie und ein
`MANIFEST.txt` daneben, das die eine Datei mit ihrer Bezeichnung nennt. Ein Handgriff, beide
Vorräte, dieselben Schritte.

**Was ausdrücklich nicht mitgewandert ist:** es bleibt bei *einer* Datenbank je pre-import-Ordner.
Ein Import ersetzt genau eine, und alle Saisons zu sichern wäre ein zweiter vollständiger Backup-
Lauf vor jedem Import. Die README sagt den Unterschied jetzt hin („nur liegt hier immer genau eine
.db-Datei, weil ein Import immer nur eine Datenbank ersetzt"), statt ihn hinter „Dasselbe" zu
verstecken.

**Nur für den Backup-Ordner.** Ohne konfigurierten Ordner ist die Sicherheitskopie eine nackte
`.bak`-Datei neben der Datenbank (WP-65) — dort gibt es keinen Ordner für Dokumente, und die
README beschreibt den Backup-Ordner, nicht das Datenverzeichnis. `writeDoc`s Schluck-bei-Fehler
gilt weiter: die `.db` ist die Zusage, die Prosa nicht, und ein gescheiterter Dateischreibvorgang
darf aus einer guten Sicherheitskopie keinen gescheiterten Import machen.

**Der zweite Fund derselben Runde, gleicher Absatz:** der ausgerichtete Block rechnet seine
Spaltenbreite zur Laufzeit aus dem Kundenwort und sprengte damit den 76-Spalten-Umbruch, an den
der Rest der Datei von Hand gehalten ist — mit „Veranstaltungsreihe" 86 Spalten, also seitliches
Scrollen in Notepad, dessen Zeilenumbruch standardmäßig aus ist. Die Breite ist jetzt an der
längsten *rechten* Seite gedeckelt; greift der Deckel, bleibt die längste linke Seite ungepolstert
und ihr Pfeil rückt eine Stufe heraus. **Das ist keine absolute Zusage** — die Länge des Begriffs
ist nirgends begrenzt, und „die Liste aller <Plural>" überschreitet 76 irgendwann von allein.
Behoben ist, dass die *Polsterung* den Überlauf erzeugt.

---

## Der Hauptprozess liest den Saisonbegriff selbst — die dritte Kopie der Vorgaben (2026-08-21, WP-68-Nachzug)

Ebenfalls aus dem Review von PR #123, aber außerhalb seines Diffs: WP-68 hat README, Manifest und
die Einstellungskarte auf „Backup" und das Kundenwort umgestellt und `electron/main.ts` übersehen.
Dort standen „Sicherung"/„Sicherungen" fest verdrahtet — und schlimmer, der Verweis
„Einstellungen → „Saison & Daten"" auf einen Reiter, der auf dem Gerät des Kunden „Festival &
Daten" heißt. Drei Dialoge: die Erstsart-Aufforderung und die zwei Backup-Fehler, also genau die
Texte, die er liest, weil etwas nicht funktioniert.

**Nicht per Import und nicht per HTTP geholt.** `seasonTerms()` liegt in `server/src/db.ts`, und
das Modul öffnet SQLite — ein Import zöge `better-sqlite3` als natives Modul in das
esbuild-Bundle des Hauptprozesses. Ein `fetch` gegen den eigenen Server verbietet sich für einen
Dialog, der gemeldet wird, *weil* serverseitig gerade etwas schiefging, und `reportBackupProblem`
läuft auch auf dem Beendigungsweg, auf dem der Server schon weg sein kann. Die Registry ist
schlichtes JSON; `electron/seasonTerms.ts` liest sie mit `node:fs` und importiert nichts aus
`electron` und nichts aus `server/` — dieselbe Regel wie `backup.ts`, `bootLog.ts`, `cascade.ts`
und `windowBounds.ts`, und aus demselben Grund: nur so erreicht `check:unit` sie.

**Der bewusst getragene Preis: die Vorgaben `Saison`/`Saisons` stehen jetzt an drei Stellen** —
`seasonTerms()` (Server), `useSeasonTerm()` (Client) und hier. Eine gemeinsame Quelle hätte ein
viertes Paket über die Bundle-Grenze bedeutet, für zwei Zeichenketten. Wer eine ändert, ändert
alle drei; das steht in allen dreien.

**Nie zwischengespeichert**, obwohl die Datei bei jedem Dialog neu gelesen wird: ein Cache
antwortete den Rest der Sitzung mit dem alten Wort — und das ist genau die Sitzung, in der der
Kunde es gerade umbenannt hat. Und `readSeasonTerms` wirft für **keine** Eingabe: fehlende,
halb geschriebene oder von Hand zerlegte `seasons.json` fallen auf die Vorgaben zurück, beide
Begriffe unabhängig voneinander. Ein Dialog, der beim Melden eines gescheiterten Backups selbst
abstürzt, ist schlimmer als das gescheiterte Backup.

**Was nicht mitgemacht wurde:** die verbliebenen „Saison"-Zeichenketten im Client
(`lib/labels.ts`, `CustomColumnManager.tsx`, `ui.tsx`, `Dashboard.tsx`, `LandingPage.tsx`) und in
Server-Fehlermeldungen (`index.ts`, `db.ts`). Mehrere davon brauchen eine Umformulierung, nicht
eine Ersetzung, weil sie einen flektierten Artikel vor dem Wort tragen („Die Saison „…""). Eigenes
Paket, nicht dieses.

## The three CodeQL alerts are dismissed, not fixed (2026-08-22, Issue #121)

Three code scanning alerts stood open against `main`. All three were triaged from their SARIF data
flows rather than from the alert titles, and all three are dismissed on GitHub as *false positive*.
No code changed. The reasoning is here because a dismissal on GitHub is a sentence in a text box
that nobody reads back, and the next person to see these rules fire deserves the argument.

| # | Severity | Rule | Location |
|---|---|---|---|
| 20, 21 | high | `js/file-system-race` | `electron/bootLog.ts:66` |
| 19 | medium | `js/http-to-file-access` | `server/src/db.ts:235` |

**`js/file-system-race` — there is only ever one writer, and it does not yield.** The flagged
sequence is the rotation in `writeBootReport`: `appendFileSync` → `statSync` (line 65) →
`readFileSync`/`writeFileSync` (line 66). Two alerts for one line, because both calls on it race
the same `statSync`; CodeQL points at columns 7 and 39.

The TOCTOU it describes cannot occur. `writeBootReport` is called from three places, all in
`electron/main.ts` (the `boot-settled` handler, the 8 s fallback, `writeAbandonedBootLine` on
`before-quit`) — so the only writer is the Electron main process, and there is exactly one of
those: `app.requestSingleInstanceLock()` (`main.ts:918`) sends a second launch to `app.exit(0)`,
which by contract emits neither `before-quit` nor `will-quit`, so a losing instance never reaches
a write at all. Within the one process the three calls are *synchronous* on one thread with no
`await` between them: nothing else in this program can run in that gap.

Nor is there a boundary to cross even in the counterfactual. The target is `boot-log.jsonl` in the
app's own `userData`, a diagnostic ring buffer that discards its oldest lines by design, and the
whole block sits in a `catch {}` that exists precisely so a diagnostic cannot break the boot it
diagnoses. A hypothetical interleaving costs a few lines of a file whose contract is already to
throw lines away. Making it atomic would mean a lock file or an `O_EXCL` dance on the startup
path — new failure modes on the one code path that must never acquire any, in exchange for
nothing.

**`js/http-to-file-access` — request data becomes a JSON *value*, never a path and never bytes.**
The sink is `writeFileSync(tmp, JSON.stringify(reg, null, 2))` in `saveRegistry`. The rule's
threat model is arbitrary file upload or a backdoor, which needs the caller to control the
destination or the payload. Neither is available:

- **The path is fixed.** `tmp` is `` `${registryPath()}.tmp` ``, and `registryPath()` takes no
  argument. The season filenames that registry *holds* are `season-<id>.db` from the monotonic
  `nextSeasonId` counter — never a label, so there is no traversal through the data either.
- **The payload is a serialisation, not a stream.** `JSON.stringify` of a typed `Registry`. The
  four flows CodeQL traced carry a string into a named field of that object: the announcement
  version (`routes/announcements.ts:72`), the backup folder (`routes/backup.ts:259`), the landing
  notes (`routes/landing.ts:33`) and a season term (`routes/seasons.ts:91`). Writing exactly those
  values into the registry is what the endpoints are *for*.
- **Two guards sit in front of it anyway.** `server/src/index.ts` binds `127.0.0.1` and the X-01
  middleware 403s any off-loopback `Host` or off-allowlist `Origin`; `express.json({limit:'4mb'})`
  bounds the body. The one flow that carries something genuinely privileged — a host path, in
  `POST /backup/dir` — is additionally refused for *any* request carrying an `Origin` header at
  all, so a renderer, including an XSS, cannot reach it.

**The triage was the point, not the outcome.** Issue #121 sat before the v1.0 freeze rather than
after it on the standing rule that a finding which turns out to be real becomes a fix. None did.
Same treatment as the exceljs/uuid moderates above, and the same asymmetry with
`js/missing-rate-limiting`: that one is *excluded in `codeql-config.yml`*, because it re-reports
per handler on every PR that edits one. These three are dismissed individually instead — they are
two real code sites, they will not re-fire on unrelated changes, and a config exclusion would also
hide the next `writeFileSync` that genuinely does take a caller's path.

**Revisit when** either site stops being what it is: if `writeBootReport` ever gains a second
writer (a helper process, a worker), or if `saveRegistry` ever derives its path from anything a
request carries. Both are the kind of change that should reopen the alert on its own.

---

## A tolerated gap must not count twice, and the raster is paid before the clocks start (2026-08-24, WP-61b)

The second customer log arrived (diagnostics bundle AF-2608240821, one v0.10.0 boot), and it
answers both questions the WP-61 entry above pre-registered, in one line:

```
outcome cross · why abort:drops · lead 15.9 · warm 16.7 · warm2 100.1
n:10 · med 16.8 · p95 50 · worst 50 · drops 3 · tail: 12 deltas, med 16.6, verdict ok
```

The v0.9.2 exemption works — the ~100 ms first raster sits in `warm2`, judged by nobody — and
the run then died to precisely the predicted trade: a clean 16.8 ms median window holding one
33.3 and one 50 scored `drops = 1 + 2 = 3 ≥ 0.2 · (10 + 3) = 2.6` at the first window
boundary, ~370 ms into a 2.6 s gesture. „Start der Animation war immernoch nur kurz zu sehen."
The coherent follow-up the entry above deferred — a 50.1 ms gap cannot be noise for the hitch
test and two lost frames for `drops` — is now taken. One data point would not have carried it;
one data point plus a second customer complaint about the same symptom does, because the
alternative is a third customer visit to learn nothing new.

**The decision: each judged delta contributes at most one lost slot to `drops`.** Every judged
delta is below `HITCH_MS` by construction (larger ones abort as `hitch` before any window
verdict), so the cap turns the test into: abort when a quarter of the window's frames are late
— `drops >= 0.2 · (n + drops)` rearranges to `drops >= n / 4` on both sides of the change. The
cap only ever lowers the sum and the test is monotone in it, so **no window that passed before
can abort now**; the change is pass-ward only. Checked against the log's machine: the aborted
window survives at 2 < 2.4, and the sustained-stutter net holds — alternating 16.7/50 aborts
in every window alignment (through `drops` where the median stays 16.7, through `slow` where
it flips to 50), every-third-frame-50 aborts at exactly threshold.

The cap also repairs a false abort nobody had hit yet: at 120 Hz a *lone* 50 ms gap scored
`round(50/8.3) − 1 = 5` drops against a threshold of `0.2 · (20 + 5) = 5` — an abort on
exactly the "~50 ms of wall clock at either rate" that `HITCH_MS`'s midpoint placement
declares tolerable. ProMotion ramp frames (41.7/33.3/25 against a later 8.3 median) stop
over-counting the same way. The known price, taken deliberately: a sustained cadence of one
tolerated gap every ~117 ms at 60 Hz — every fifth frame, ~8.5 visible skips per second — now
plays to completion where it used to abort ({16.7×8, 50×2} scores 2 < 2.5). No shape avoids
this while fixing the customer: cap-at-two still aborts him (3 ≥ 2.6), threshold 0.25 keeps
the double-count and saves him at 90 % of threshold, and a two-consecutive-windows rule buys
its tolerance with 200 ms of judged stutter on screen. The `quick`-based surcharge stays
rejected for the reasons in the WP-61 entry.

**`.boot-show` is built, as the variant the WP-61 entry kept.** The deciding number was the
second prediction's: `lead + warm + warm2 = 132.7 ms` — the clocks start at `.boot-play`'s
style application, so the customer's gesture began that far into its swing on every cold
boot. `start()` now applies `.boot-show` (svg visible, every animation still paused at zero)
after its deadline check, waits two rAFs — the same pipeline length `onReady` waits, for the
same reason — and only then latches `playing` and adds `.boot-play`. What the show frames buy
is unconditional for the jump-ahead: the clocks now start at zero regardless of what the
raster costs, and the cost itself moves to the new `showMs → startMs` span in the report.
Whether pre-rastering *also* cheapens the following frames (only tiles, the GPU upload and
the program cache are pre-payable; every animated frame re-rasters) is the half of the old
gate still unmeasured — the packaged-build trace pair is the remaining evidence step, and the
next customer log is the answer that counts either way.

Three consequences that are part of the design, not incidental:

- **The deadline is not re-checked after the show frames.** On the machine this exists for
  they cost the very ~100 ms a re-check would convert into `why: deadline` — the exact trade
  that killed the phase-A pre-warm above. The hold-max failsafe spans the wait, and the
  continuation re-checks `gone/crossing/fading/playing` — `playing` because moving the latch
  two frames later un-latches the synchronous double-start guard, `fading` against bootBail's
  `animationstart` interleaving.
- **`crossFade()` removes `.boot-show` when the gesture never started** (the `else` of the
  `.boot-froze` branch): a cross landing inside the show frames must show the flat rectangle,
  not two rastered-but-parked frames of hand riding the fade — the phase-A invariant.
- **bootBail's delay moved 6000 → 7000 ms.** Its 6000 was derived from "1200 deadline + 2600
  gesture + 400 failsafe"; the show frames run *after* the deadline check, bounded only by the
  3500 ms hold-max racing the continuation (an overdue timer can lose to the rendering step
  that then re-arms it), so the slowest live reveal is now ~6500 ms — inside the old delay,
  where the bail's `from { opacity: 1 }` wins the overlay's animation list and pops a
  half-faded reveal back to opaque before re-fading.

**The report is `v: 3`** — `drops` capped (judge and report field agree again), `showMs`
added (t0-relative, like `readyMs`/`startMs`; set with `startMs: null` it is the signature of
a show-phase cross). Nothing in `electron/` branches on `v` or reads the changed fields;
`showMs` stays out of the German digest with `warm` and `quick`.

**What the third log has to show:** `showMs → startMs` ≈ 100–130 ms carrying the raster,
`warm2` collapsed to ~16.7, the first window surviving its 33/50 noise, outcome `play/done`.
And the residual the cap deliberately leaves: two tightly packed 50.1 ms gaps with six or
fewer clean frames between them in one window still cross ({16.7×6, 50.1×2} aborts at exactly
2 ≥ 2). If his machine produces that shape, the next decision is about *that* window, with
this entry as its baseline.

---

## The boot gate asserts accounting, never a timing (2026-08-24, WP-61c, #7/#115)

The gesture was the last thing in issue #7 with no automated check at all, and three properties
kept it out of `check:browser` rather than being a handful of cases there. The overlay exists only
in a built bundle (`'%PROD%' !== 'true'`), so the dev server that gate drives removes the node
before React mounts. Its outcome is *measured* — the frame watchdog decides per launch, so an
outcome is not a property of the build. And `reducedMotion: 'reduce'`, the escape hatch every
other driving script uses to get past the overlay, removes it outright: a gate for the gesture
cannot use the setting the rest of the suite depends on.

**The answer to the second one is the design.** `npm run check:boot` asserts in three tiers.
*Invariants*, on every boot: the legal outcome/`why` sets, `v: 3`, the clocks in order and inside
`endMs`, `frames` present exactly when the gesture started, `abort:hitch` **iff** a judged delta
reached `HITCH_MS`, `drops <= n` (WP-61b's cap, as arithmetic rather than as an outcome), the
reveal beating bootBail, the report fitting the cap `electron/bootLog.ts` applies to it, and both
channels — `localStorage` and the `bootSettled` bridge — carrying the same object. *State*:
`.boot-show` observed as „svg visible while eleven of twelve animations are still paused and only
`bootBail` runs", which is the only assertion that survives the class simply not being added —
`showMs` is stamped either way, so a report field cannot catch it. And *caused outcomes only*: an
outcome is asserted where, and only where, the gate injected the cause. No bound on `readyMs`,
`med` or `p95` exists anywhere in it. **A red therefore means the accounting changed, never that
the runner was busy** — which is the property that makes it safe on a CI runner slow enough to
have produced ambiguous reds twice in this arc already (PR #138).

Four bounds do read a clock, and the file's header names them, because a bound nobody declared is
how that property rots. Three read the **CSS** clock, which is wall time the machine does not move
— 20× CPU throttling shifts a gesture's length by 14 ms — namely a played gesture's
`endMs − startMs` inside a 300 ms band, the same quantity under 2500 ms for a run that aborted,
and `endMs < 7000`, which says a live reveal beats bootBail. The fourth is a floor of twenty
judged frames on a played gesture, which a 2.6 s animation misses only below about eight frames a
second. Everything cadence-dependent is *derived from the median the run itself reports*, with a
margin against that reading's own rounding: the review round found the last hardcoded injection
(30 ms, which inverts case F's outcome below ~34 Hz) and a ceiling that scaled with the cadence,
and CI had already found a bound built by multiplying the rounded median, red at 33.3 against 33.4.

Standing down is a measurement too, and it is bounded. A case may decline on evidence — a cadence
whose tolerated band holds fewer than two frame intervals, or an injected gap that overshot
`HITCH_MS` — but if **all three** drops cases decline, the run has said nothing about WP-61b and
fails saying so. The one assertion whose subject the runner also contributes to, the `drops`
ceiling, is re-measured once when it is exceeded, on its own line: an uncapped sum is over it every
time, six frames of machine noise almost never twice running. That rescues a noisy run and cannot
rescue a defect — verified against the revert, which still reds.

**Three things the issue assumed turned out to be false**, and each changed the design.
`ALLOWED_ORIGINS` never enters it: with `AUFTAKT_CLIENT_DIST` set the server serves `client/dist`
at *its own* origin, exactly as the packaged app does, so the gate lives on **:4327** alone — no
`:5317`, no `.demo`, and therefore no collision with a running `npm run demo` or with
`check:browser`. „Not reproducible" is only half true: headless Chromium's cadence is remarkably
stable (`med 8.3 · worst ≤ 10.4 · drops 0`, unchanged by `--disable-gpu`, swiftshader and 20× CPU
throttling), and what a slow machine actually moves is `readyMs` against the 1200 ms deadline —
where the *cache*, not the machine, decides (83 ms warm against 1574 ms cold-and-throttled). And
the reduced-motion hatch is the script's `matchMedia`, not the `@media` rule: deleting the rule
changes nothing observable, which is worth knowing before anyone tidies it away.

**Not in `npm run check`**, for the same two reasons as `check:browser`: a browser binary and a
free port, neither of which `check` may ever require — plus a build, which it also may not. Its
own CI job rather than two more steps on `browser`, and that is wall clock rather than minutes:
`checks` runs 54 s, `browser` 246 s, CodeQL 86 s, and appending ~50 s to the longest job would
push pull-request feedback from ~4.1 to ~5.3 minutes, while a parallel job leaves it where it is
and costs only Actions minutes, which a public repository does not pay.

**What it deliberately does not assert**: aesthetics, exact durations (only that a played gesture's
`endMs − startMs` sits in a 300 ms band, which says the reveal came from `bootOut` and not from a
failsafe), which door a degraded run left by where two are legitimate, and anything needing the
packaged app — the `boot-log.jsonl` writer and its fallback lines stay `check:unit`'s. In
particular it does **not** touch WP-61b's open question of whether pre-rastering also makes the
following frames cheap: that is a trace pair on real hardware. This gate asserts the mechanism,
never the benefit.

`check`, `busy`, `requireFreePort` and the process-group spawn/kill pair are minimal copies of
`check-browser.mjs`'s and `check-backup.mjs`'s, left as copies on purpose and named at the foot of
the file: a `scripts/lib/` extraction should move all four gates at once, and one gate importing
another's internals would make this one fail for reasons that have nothing to do with the gesture.

---

## No linter — the standing half of the original decision, with its two gaps named (recorded 2026-08-24, #135)

`CONTRIBUTING.md` has said „There is no linter. That is a decision, not an oversight — see
`docs/DECISIONS.md`" since before this file existed, and pointed at an entry nobody ever wrote.
„No test framework — REVERSED" above reconstructed and then reversed the *other* half of that
sentence and closed by noting that „the no-linter half of the original decision also stands — it
was always a separate question". This is that half, written down at last, so that a decision
nobody recorded stops being a decision nobody can weigh.

**The standing rationale.** `npm run typecheck` is four projects, and three of them —
`server/tsconfig.json`, `client/tsconfig.json`, `electron/tsconfig.json` — run `strict: true`
with `noUnusedLocals` and `noUnusedParameters`, and the first two add `noUncheckedIndexedAccess`
on top. That is most of what a linter is bought for: an unused import, a shadowed binding, an
array index used as if it could not be `undefined`, a `switch` that falls through, a branch that
forgets its return. It is enforced on every push and every pull request, in the `checks` job,
before the gates run.

What is left over from a linter's usual value is style, and style is arbitration between people.
This is a single-developer repository that accepts no outside pull requests — the licence says so
— so there is nobody to arbitrate with, no diff noise from two contributors' brace habits, and no
review thread where a formatting argument displaces a correctness one. Adding a config file, a
plugin set and a CI step to settle a dispute that cannot arise is a cost with no matching benefit.

**Its two gaps, named rather than glossed.** Both are *bug* classes, and neither strict tsc nor
any gate in the stack can see them except by accident:

1. **Unawaited promises.** A dropped `await` is invisible to the type checker. The server is
   async Express and the main process is async Electron, so the class is live in two tiers at
   once; `@typescript-eslint`'s `no-floating-promises` and `no-misused-promises` are the only
   things that catch it.
2. **Stale React hook dependencies.** `react-hooks/exhaustive-deps` is the only detector for a
   stale-closure bug, over ~15k lines of `client/src` that `check:browser` samples case by case
   and cannot exhaust.

Naming them is the point of writing this down. „There is no linter" read as a blanket claim that
nothing is missed; it is not, and the two things that are missed are worth knowing about when a
defect in either class is being hunted.

**Reopening is tracked, and is not this entry's business.** Issue #135 proposes the narrow
reversal these two gaps argue for: `typescript-eslint` with type-aware **bug rules only**, no
style or formatting rules at all, wired into the `checks` job, with every initial finding either
fixed or disabled inline with a reason. The new information it offers is the same one that
reversed the test-framework half — the product is commercial, and the feedback path for an
invisible defect is now a customer's support request. It is deliberately its own session: the
`exhaustive-deps` triage is all behaviour judgements, and would make any pull request it shared
unreviewable.

So this entry is not „a linter was considered and refused". It is: the no-style half stands on its
own reasoning and is not up for revisiting, the bug-rule half has a live proposal in #135, and
until that lands the two gaps above are open by choice rather than by oversight.

---

## Die sechs Gates teilen sich eine Harness, und das Browser-Gate ist fünfzehn Dateien (2026-08-24)

Six `check:*` scripts, each booting something real and asserting against it, had each grown its
own copy of the same four mechanisms — and `scripts/check-browser.mjs` had reached 8,606 lines in
one file. Neither is a defect, and that is exactly why it is worth recording what was done and,
more importantly, what was *not*.

**What the copies had cost.** The port guard existed under three names — `requireFreePort` twice,
`assertPortFree` once, `requireFreePorts` once — with two different detection techniques: four
gates bound a probe socket, `check-dates` opened a connection instead. `check()` was five lines in
six files, and two of them counted their assertions while the other four did not, so
„(627 Prüfungen)" was a property of some gates and not others for no reason anybody had chosen.
The child-log buffers were capped at 8 KB in two files and unbounded in two others. `check-boot.mjs`
shipped on 2026-08-24 with a note at its foot naming the four helpers it had copied and asking for
this extraction by name; that note is the entry point to this one.

`scripts/lib/` now holds one of each — `check.mjs`, `ports.mjs`, `server.mjs` (the detached process
group of DBW-10/DBW-11, and the log tail), `wait.mjs`, `http.mjs` — and all six gates import it.

**What stayed with the gates, deliberately.** The refusal *messages*. Each one says what that
particular run would have done to the stranger's server it found: measure a bundle nobody built
here, rebuild a database somebody is looking at, or fail with „no such table" against a deleted
data dir. A shared message would have said none of it, and the message is the whole value of the
guard. So `requireFreePorts` takes the sentence as an argument. The same applies to the two printed
markers: `check-api`, `check-dates` and `check-package` right-align FAIL in a four-character field
where the other three pad it, and both shapes are preserved rather than unified, because changing
the shape of half the gates' output is not what an extraction is for.

**The browser gate is now a runner and fifteen scenario files**, split along the section markers it
already had. `scripts/check-browser.mjs` keeps the port refusal, the stack, the fixture seasons and
the ordered list; `scripts/check-browser/` holds `config`, `report`, `stack`, `browser`, `bridge`,
`probes`, `pdf` and `cases/*.mjs`, one file per area, A–AX. The npm script, the ports, the `.demo`
rebuild, the refusal to start beside `npm run demo` and the order of the run are all unchanged.

Two things made the split safe rather than hopeful.

The first is that **the case bodies did not move a character**. Every case sat at two-space indent
inside one `try`, and inside `export async function runX(fixtures) {` it sits at two-space indent
too — so the diff is a wrapper, an import block and a destructure, and 7,398 lines that are
byte-identical to their slice of the file they came from. That is asserted mechanically, not
eyeballed.

The second is the oracle for what crosses a file boundary. TypeScript 7 has no JavaScript API, so
there was no parser to compute free variables with; instead the whole tree was typechecked a second
time under a **`lib` with `DOM` removed**. Under that config every unbound identifier is an error,
including the ones that would otherwise resolve silently to a DOM global — and this is not
hypothetical: case F declares `const status` and case AH `const title`, both names `window` also
carries, so a missed hand-over would have compiled clean and read `''` at runtime. The DOM globals
the cases legitimately use inside `page.evaluate` were baselined from the original file first, and
everything above that baseline is a missing binding. Two silent shadowings were found this way and
would not have been found any other way: `toolbox` and `columns`, the fixture season and case F's
column list, each colliding with the name of the exported function of the file that used it. The
area functions are called `runToolbox`, `runColumns` and so on for exactly that reason.

What the oracle cannot see is a *runtime* hand-over that nobody performs, and the run found the one
that mattered: `root` is `resolve(dirname(import.meta.url), '..')`, which stopped being the
repository once the constant moved a directory deeper, and the stack died on
`scripts/scripts/demo.mjs`. That is the argument for the third net — the gate itself, run green
before and after, with its assertion names compared.

**The equivalence bar, and why it was set there.** No assertion added, removed, reworded or
reordered, in any of the six gates. 1,316 assertion names captured from a green run before and
after and diffed with the run-specific parts masked; every diff empty. For `check-api`,
`check-backup`, `check-dates` and `check-package` the whole masked stdout is identical byte for
byte. A gate is only worth what its history is worth: a restructure that quietly dropped four
assertions would leave nothing to notice it, so the proof has to be mechanical or it is not a
proof.

**What was considered and not done.**

- **Porting any of this into Vitest.** „No test framework — REVERSED" already settled it: these
  scripts stay as they are, and the reversal's own words are that Vitest covers what they
  structurally cannot reach and does not re-cover what they hold. The three headers that still
  claimed „there is no test framework in this repo" were rewritten to say so.
- **Importing from `~/.claude/tools/playwright`.** Still banned, for the reason the WP-R6 entry
  gives: the repository may not depend on one developer's home directory. What that entry records
  as „`scripts/check-browser.mjs` re-implements ~60 lines of that shared library" is now
  `scripts/check-browser/browser.mjs`; the duplication is the same and is still deliberate.
- **Moving the cross-area helpers into the harness.** `textOf`, `boxOf`, `pad2` and five others are
  built by one area and reused by a later one. They ride on the `fixtures` object with the seasons
  rather than being promoted to `browser.mjs`, because promoting them would have been a second
  change with no proof behind it. `fixtures.mjs` types the object, so the coupling is now visible
  and typechecked instead of being invisible in a shared scope.
- **Folding `check:markdown` in.** `client/scripts/check-markdown.ts` shares the *shape* — a
  counter, a name, a detail — and nothing else. It boots no server, holds no port, spawns no
  child and speaks no HTTP; it builds a jsdom and a TipTap editor and asserts a round trip. The
  only thing `scripts/lib/` could give it is `check.mjs`, across a package boundary (it lives in
  `client/` and runs under that package's `tsx`), for five lines. Left where it is.
- **Full `strict` on `tsconfig.scripts.json`.** Measured flag by flag rather than assumed, because
  the file's own note carried a number from when it covered four smaller scripts. `noImplicitAny`
  is **875** errors, nearly all annotations on callback parameters — declined for the same reason
  as before. `strictNullChecks` is **73**, and those are real missing guards rather than missing
  annotations; that is the one worth revisiting, and it is not taken here because this pass was a
  pure move. Four flags turned out to cost *nothing* and are now on: `noUnusedParameters`,
  `noImplicitThis`, `strictFunctionTypes`, `strictBindCallApply`.

  `noUnusedLocals` is the one decline worth writing down, because it looks free and is not. It
  reports three errors, all the same TypeScript quirk: the local `require` from `createRequire`
  reads as unused, since tsc treats `require(...)` as a module reference rather than as a call to
  that binding. Renaming it silences the diagnostic and **loses** the type resolution the `paths`
  entry exists for — verified with a probe: under a differently-named binding,
  `new ExcelJS.Workbook().nonsense()` stops being an error. The types are worth more than the flag.
  It did earn its keep on the way past, finding a `const server` in `check-backup` that nothing had
  read since the process group moved into `lib/`.

  The split bought some of the same value for free in any case: the fifteen scenario files are now
  checked against a declared `Fixtures` type, where a mistyped key used to be an `undefined` twenty
  assertions later.

## The first window shows before the renderer exists — cream is the honest first frame (2026-08-25)

**The evidence that forced this.** The first screen recording from a customer device
(Windows 11, 7.7 GB RAM with 1.0 GB free, Intel UHD, 1536×864 @1.25×) showed what every cold
start there looked like: at ~0.45 s the main window flashed up as an unpainted ghost for
~250 ms and vanished; then ~2.7 s of bare desktop; at ~3.45 s a solid blank window; content
~0.15 s later. The customer's words: „du klickst auf die App, irgendwas ploppt auf und
verschwindet wieder. Dann passiert nichts, und dann geht die App auf." Every phase mapped to a
line of `electron/main.ts`, and none of them was the gesture's fault:

- The ghost was `win.maximize(); win.hide()` on the hidden window — a pair whose comment
  asserted that two calls in one synchronous tick present no frame. On a loaded Windows
  machine DWM presents it anyway. The assumption was plausible, undocumented by Electron
  either way, and wrong; only a recording could have shown it.
- The dark gap was the launch order: the 3.4 MB server bundle was imported and health-polled
  *before* `createWindow()`, and the window then sat hidden waiting for `ready-to-show` —
  which on this hardware fires only after the *whole app* has rasterized, because `onReady`
  reveals `#root` before the overlay's cheap frame is ever presented, and a hidden renderer
  is deprioritized on top.
- The blank pop was the `showAnyway` failsafe (3000 ms), designed never to fire, firing on
  every start — window created at ~0.45 s, timer at 3.45 s, first real frame just after.

**The decision.** The first window is constructed, maximized if it was maximized, and shown in
one tick at the top of `whenReady` — before the server import, before any renderer exists. The
premise this reverses is the old `show: false` rationale, „window and boot screen appear
together": correct on fast hardware, and on slow hardware it degraded to nothing at all,
because „together" was implemented as „both late". What makes the reversal safe is a fact the
2026-08-11 boot entry already recorded in the other direction: phase A of the boot overlay is
deliberately a flat `#f6f6f4` rectangle, and the window's `backgroundColor` is the same value —
„an empty coloured rectangle reads as a window that has not drawn yet rather than as a stall".
A window shown before its renderer exists is therefore pixel-identical to the designed boot
screen. Desktop → window → overlay → app is now one continuous surface, and the slow path
finally looks like what it always was on paper: cream, then the 200 ms cross-fade.

**Consequences.**

- `maximize()` runs before `show()`, never after — maximize on a never-shown window shows it
  already at maximized geometry, so the first presented frame is the final one; the reverse
  order would present the restored rectangle and play the restored→maximized zoom on every
  launch. `getNormalBounds()` still saves the user's chosen rectangle.
- No window in the app is ever hidden after creation, which made `ready-to-show` gating and
  the `showAnyway` failsafe deletable — the failure class they defended (a load failure
  leaving a permanently hidden window that `activate` still counts) is structurally gone, for
  secondary windows too.
- The menu is set *before* the first show, and that order is load-bearing: on Windows a
  window presented before `setApplicationMenu` wears Electron's default English menu for the
  whole server start. In exchange its handlers are gated on `startupDone` — armed but
  waiting, like `second-instance` — because every entry needs the server, and a Cmd/Strg+N
  during the hold must be a no-op rather than a „hilft eine Neuinstallation" dialog about a
  server that is two seconds from existing (found by review, PR144-01).
- The server-start failure dialog is parented to the visible window (`messageBox` falls back
  to unparented if the user closed it during a hung start).
- `AUFTAKT_BOOT_TRACE` now also records the window's first present.

**The follow-up family the reversal created.** A closable window now exists for the whole
server start, and the second review round (Opus · medium, on the PR) found three handlers
still assuming it cannot — all one root cause: closing the cream window during the start
released the chores against a server that was not listening, so the launch's backup silently
died on ECONNREFUSED (fixed by gating the chores on the shared `serverReady` promise, still
bounded by `QUIT_CHORES_MS` — PR144-04); a relaunch landing in the armed-quit gap was
swallowed while the quit killed the instance, and clearing `quitting` alone would only have
traded that for a headless survivor, so window requests arriving during startup are *queued*
and answered right after `startupDone` (PR144-02); and the `activate` handler was registered
only at the end of whenReady, leaving a macOS user who closed the cream window with dead Dock
clicks — it now registers before the first window, restore-branch live throughout,
create-branch queueing like second-instance (PR144-03). The lesson generalises: showing the
window earlier moved the start of "a user can act" back by seconds, and every startup-phase
handler had to be re-read against that.

**What deliberately did not change.** `GESTURE_DEADLINE` stays 1200 ms — the boot log from the
same device (149 entries over twelve days: 37 cold boots, 4 completed gestures, 2 of 31 on the
internal display) says the gesture rarely plays there, and the standing answer stands: the
gesture is a reward for a fast start, never a tax on a slow one. Phase A stays blank — decided
again, for the new situation of a hold that can now be *watched* for ~2–3 s on slow hardware:
judged shippable as designed, to be re-opened only if it feels naked on the real device. The
boot script, the report schema and the phase-A invariant (a cross shows the flat rectangle)
are untouched; `check:boot`'s 210 assertions pass unchanged.

---

## One log file, and a crash writes its own bundle (2026-08-25, WP-69a/b)

Until this package the only evidence that ever left a customer machine was `boot-log.jsonl` —
frame timings for the boot animation — plus whatever the person typed into „Fehler". Everything
else died in a console that does not exist: the Express server runs **in-process** in Electron
main, and a Finder- or NSIS-launched app has no stdio, so the server's 500 handler, the updater,
`ErrorBoundary` and every unhandled rejection wrote into nothing. There were **zero** process-level
handlers. A customer whose app vanished mid-session sent a hundred lines of frame timings and no
trace of the crash. That is the gap; the shape of the fix is the part worth recording.

**One file, not two.** `boot-log.jsonl` becomes `app-log.jsonl` and carries both kinds of line.
The alternative — a second `error-log.jsonl` beside it — was rejected on three counts that are
all the same count: two files mean two rotations to reason about, two readers to keep in step, and
two artefacts a customer has to be told about. (The bundle grew two *sections* anyway in WP-69f —
every boot line under „Startprotokoll", the runtime tail under „Laufzeitprotokoll". Printed from
the one file at the moment it is written, which is not the same thing as two files to keep in
step: nothing can fall between them, and the split is a `'src' in line` test rather than a second
rotation.) And the interleaving is itself the diagnostic: „the boot reported `play`, then eleven seconds later a 500" is one story in
one file and a correlation exercise in two.

**Boot lines keep their exact shape; `src` is the discriminator.** A boot report is still
`{v, …report, at, app}` and carries no `src`, because `scripts/check-boot.mjs` and the WP-61b/c
cross-version comparison read those lines field by field. Runtime lines are `{v:1, …entry, at,
app, src}` and *always* carry `src` (`main` | `renderer` — the in-process server's lines arrive
through the tee as `main`), so every reader separates
the two with one `'src' in line` test — `summarizeBootLog` filters before it counts, and the gate
filters before every field-discipline assertion. Adding an `src` to boot reports would have been
the tidier symmetry and would have silently reclassified every line ever written; the builder
therefore does not take one.

**The migration is a rename, not a merge.** `migrateBootLog` renames the legacy file onto the new
name iff the new one does not exist, and swallows failure. The old file holds boot lines only,
which is exactly what the new one starts as, so history survives the update — and that history is
what a cross-version timing comparison is made of. It runs at module scope in `main.ts`, below the
single-instance guard and above everything that reads or writes the log.

**What is logged, and what never is.** Log lines carry: an event token, a message, a stack, and
the wrapper fields. Nothing else, and specifically **no request bodies, no record titles, no
names, no notes** — the bundle's header promises the customer „Sie enthält keine Termine,
Künstler, Kontakte oder Notizen", that sentence stays verbatim, and it has to stay true. The
server's error middleware logs `method + path` with numeric ids (WP-69d), never `req.body`. Field
caps (`event ≤ 64`, `msg ≤ 500`, `stack ≤ 3000`, whole line ≤ 4096) bound the one uncontrolled
string that remains, an `err.message`, and `redactHome` runs over the finished bundle.

**No minidumps, no `crashReporter`.** Ruled out and not to be revisited without a new argument: a
memory dump of this process contains whatever the in-process SQLite server last touched, i.e.
artist names, e-mail addresses and notes about identifiable people. There is also nowhere to send
one — no endpoint, no telemetry, by the standing decision above. A JSONL line the customer can
read before they attach it is the whole delivery model, and a binary they cannot read is not it.

**A console tee, not a logger module in the server.** `console.error`/`console.warn` are wrapped
in packaged main before `startServer()`'s dynamic import. That one choke point captures all nine
of the server's `console.*` calls, electron-updater's logger and this file's own warnings, with
**no server-side change at all** — because the server is imported into this process. A proper
`logger.ts` in `server/src` would have been the conventional answer and would have bought nothing
here while costing every call site an import and the tier boundary a new shared module.
`console.log` is deliberately not teed: the listen banner and the trace path are the bulk of it,
and a log that fills with routine notices is a log whose rotation throws the errors away.
**Revisit if the server ever leaves this process** — a child process or a service has its own
stdio, and then the tee captures nothing and a real logger is the answer.

**`uncaughtException` exits; it does not linger.** The handler writes its line, writes a
diagnostics bundle to the desktop, shows a German dialog and calls `app.exit(1)` — the exit
outside every `try`, so whatever else failed, the app still goes away. Lingering was the
alternative and is wrong here specifically: a main process that has thrown owns the in-process
SQLite server, so a window left standing keeps writing through a runtime whose invariants are
already gone. WAL makes an immediate exit safe; a zombie holding the single-instance lock is not
safe and cannot even be relaunched over. The handler is once-latched — a storm of exceptions
gets lines and nothing else, because the first one's dialog is already on screen.

Two Electron behaviours are deliberately displaced by this. Electron's own „A JavaScript error
occurred in the main process" box is suppressed the moment a second `uncaughtException` listener
exists (its default handler checks the listener count), which is the point: that dialog is
English, names a stack, and offers a customer nothing. And **any** `unhandledRejection` listener
suppresses Node's default of re-throwing, which is why rejections are log-only — a rejected
background fetch is not a reason to close a festival's schedule. Both handlers are registered
only in a packaged run: a developer wants the default dialog and has a terminal.

**The crash bundle is the feedback bundle, written by nobody.** It reuses `buildDiagnosticsBundle`
and `uniqueBundleName` unchanged, lands on the desktop under the same `Auftakt-Diagnose-AF-…txt`
name, and carries an auto-generated „Meldung" saying in German that nobody wrote it. The dialog
names the file and the address; **nothing opens** — no Finder, no mail client, no „Feedback
senden" button — which is the WP-66 rule applied to the one path that could most plausibly have
argued its way out of it. The facts are collected synchronously (`machineFacts`), because a
`.then()` on a dying process is a bundle that is never written; the GPU query is the one fact
dropped, and a crash is not read from `gpu_compositing` anyway.

**The CodeQL dismissal moves with the code.** Alerts 20/21 (`js/file-system-race`, high) were
dismissed as false positives against `electron/bootLog.ts:66`; that append → stat → rewrite is now
`appendAndRotate` in `electron/appLog.ts` and serves two writers instead of one. The argument is
unchanged and still holds: the only writer is the single Electron main process (the instance that
loses `requestSingleInstanceLock` exits before it reaches any write, and the migration and the
capture installs both sit below that guard), the three calls are synchronous with no `await`
between them so nothing else in this program can run in the gap, and the whole block sits in a
`catch {}` around a ring buffer that discards its oldest lines by design. If the alert re-fires
at the new location it is to be dismissed again, with this paragraph as the reason. **Revisit if
`appendAndRotate` ever gains a writer outside this process** — a helper process, a worker, or a
server that has left main — which is the same condition the original entry named.

## The Notion importer is retired (2026-08-26)

The importer under `server/src/notion/` — gitignored from the start because it documented a third
party's internal template — was a one-off onboarding tool: it built the season databases for the
one migration that needed it, and that migration is done. It is retired outright rather than kept
"just in case", for a reason a repo-wide convention audit put its finger on: it was the only code
allowed to bypass the API transforms (raw SQL — `migrateFlattenDeepSubtasks` exists to repair its
output), and it coupled silently to three `db.ts` exports (`getDb`, `setSetting`,
`setActiveSeasonLabel`) via a dynamic `await import('../db')` with nothing but one machine's
local typecheck guarding the seam — a dependency no fresh clone and no CI could even see, since
the file sits inside `server/tsconfig.json`'s `include` but not in the repository. Untracked code
with a hard dependency on tracked internals either becomes tracked or goes; it goes.

The code and its skill move to the `auftakt-private` archive before local deletion — the same
mirror-first rule that repo's own near-deletion taught (2026-08-09). The ignore rules stay, in
past tense, so a copy restored from a backup can never be committed: the `/review/` reasoning.
Comments that named the importer as a live headerless caller (`db.ts`, `index.ts`,
`seasonContext.ts`, `crud.ts`, ARCHITECTURE.md) now list only seed/demo and the check scripts —
and `setActiveSeasonLabel`'s name is no longer frozen by an importer that cannot be refactored
against. References to the *data shapes* a Notion export left behind stay where they are: that
text is in customer databases and the sanitizer still has to expect it.

## A slow server start is waited out and named, never abandoned at ten seconds (2026-08-26, WP-72)

Decided by Andre after the 2026-08-25 update on the customer device: the app's own update
dialog warns that virus scanners may take „eine Minute oder mehr" over the fresh binary, while
`waitForServer` granted ten seconds and then quit through a dialog whose advice — reinstall —
was exactly wrong for a scan. The shape that replaces it is the **honest waiting state**: after
10 s the already-visible cream window (see „cream is the honest first frame") gains a static
status text naming the scanner in the update dialog's own words; patience is 90 s per round;
then a dialog offers „Weiter warten" (a full fresh round) and „Beenden". Reinstall is mentioned
only from the third question (~4½ minutes), led by restarting the machine, and with the true
promise „deine Daten bleiben dabei erhalten" (`deleteAppDataOnUninstall` is not set). Every
slow start writes `server-slow*` lines into the WP-69 app log; a fast start writes and shows
nothing — the fast path is pixel-identical to the #144 choreography.

The status is a fully self-contained `data:` URL loaded into the *same* window — no script, no
fetchable reference (the server it would fetch from is the thing being waited for), the same
`#f6f6f4`, a proper `<title>`. Not a new window and not a spinner, deliberately: the original
complaint was „irgendwas ploppt auf", and calm text beats theatrics on a machine that is busy.
Do not re-propose shrinking the patience, re-adding reinstall advice to the first failure, or a
loading animation here. One named residual is accepted: on a machine slow enough that the
status page's own first paint takes >3 s, the app's later load can surface a spurious
„Die Oberfläche konnte nicht geladen werden" over a working app (electron#17526) — bounded,
non-fatal, and recognisable in a report by `server-slow` lines preceding it.

## The app keeps its lowercase name; the dialogs carry the capitalised one (2026-08-26, WP-73)

Windows captions a native message box with `app.getName()` when the call names no title, and
that is `package.json`'s `name` — `auftakt`. So every dialog on a customer machine wore the
package name while the exe, installer, registry and shortcuts all said „Auftakt". The
obvious-looking repair — `app.setName('Auftakt')`, or a top-level `productName` in
`package.json` — is the one that must never be made: both re-derive `app.getPath('userData')`.
On Windows that is coincidentally harmless (case-insensitive paths); on macOS it derives a
**new, empty** `~/Library/Application Support/Auftakt/` and every existing installation loses
sight of its database. That is a change to what customers already have, and it is off the
table (`docs/BACKUP-TESTING.md`, „Notes").

The fix is a default `title: 'Auftakt'` applied centrally in `electron/dialogs.ts`'s helpers
(an explicit per-call title wins), with the three raw `dialog.*` call sites folded into the
helpers so the default is enforceable by a single invariant: **`dialogs.ts` is the only file
that calls `dialog.*`** — the one deliberate exception being the pre-ready
`dialog.showErrorBox`, whose first argument already is a title. macOS ignores message-box
titles, so the default is inert there. Do not re-propose renaming the app or the data
directory to fix casing anywhere; a wrongly-cased surface gets its own label, never a rename.

## Der Ein-Pager wird gespeichert, nicht gedruckt (2026-08-26, WP-71)

Decided by Andre after the 2026-08-25 customer visit: the print sheet's one button is
**„Als PDF speichern"**, backed by `webContents.printToPDF()` plus the native save dialog
(`savePdf` on the bridge), and **no button in Auftakt calls `window.print()` under Electron any
more**. The customer's report was exact: the old „Als PDF speichern / Drucken" opened the
Windows *printer* list, where the one thing the label promised — saving a PDF — was at best a
pseudo-printer among real ones. A button that names an outcome has to deliver it on the
platform that matters most.

Printing on paper went with it deliberately, not incidentally. The saved PDF is what a printer
prints; one honest button beats two that share a dialog, and the platform-split alternative
(keep the system dialog on macOS, where „PDF ▾" is honest) was considered and rejected in the
same decision — one behavior, both platforms. **Do not re-propose a „Drucken" button** or a
print menu role; a future „customers want to print directly" wish reopens this entry, it does
not route around it.

The plain browser (dev, `check:browser`) keeps `window.print()` as the optional-chained
fallback: a page cannot write a file, the browser has its own preview whose default destination
is „Als PDF speichern", and — unlike the packaged app — it also has its own back button. The
gate asserts the Electron shape through the recording bridge (`__pdfs`, area N4) and pins that
no print dialog opens; what no headless run reaches is the real save dialog and the written
file, which ride the packaged-build pass (`docs/VERIFYING.md`).

---

## Log lines are UTC; everything else on disk is naive-local (2026-08-26, WP-70)

`docs/ARCHITECTURE.md` opens its timestamp section with „Everything stored is naive local time — no
UTC anywhere, no `Z` suffix, no offsets", and follows it with „Never build a stamp from
`toISOString()`". Read as written, `app-log.jsonl` breaks both rules: every line's `at` is
`new Date().toISOString()`, a `Z`-suffixed UTC instant, written to disk by shipped code. That is
the one exception, it is deliberate, and until this entry (and the sentence the same change adds
to ARCHITECTURE's section head) it was written down nowhere — which is
how it becomes either a tidy-up that renames the format under every log ever written, or a support
answer that reads a customer's crash as having happened two hours before it did.

**The exception is exactly two call sites and nothing else.** `writeBootReport` and `writeAppLog`
in `electron/appLog.ts` each take the clock themselves — it belongs to main, not to whoever
produced the entry — and that module imports nothing from `shared/time.ts`, which is where every
other stamp in the product comes from. A sweep for `toISOString()` across shipped code finds those
two and one more, `/api/health`'s `ts`, which is an HTTP response and never reaches a file. One
file on disk carries UTC, and it is the log.

**Everything else is naive-local, including artifacts that sit beside the log or inside the same
document**: `seasons.json`'s `createdAt` (`localStamp()`), the restore-point folder names and
`boot-trace-*.json` (`fileStamp()`), the backup manifest's „Backup vom 25.08.2026, 20:09 Uhr"
(`germanStamp` in `lib/backupDocs.ts`, assembled by hand from `getDate()`/`getHours()` for the
reason `shared/time.ts` gives), the `AF-YYMMDDHHMM` reference a customer reads out on the phone
(built the same way in `client/src/lib/feedbackMail.ts` and again in `electron/main.ts`), the
diagnostics bundle's own `Erstellt:` header (`localStamp()` at the call site in main), and every
row stamp in every season database.

The diagnostics bundle is where the boundary has an edge, because both conventions meet inside one
customer-facing file. `Auftakt-Diagnose-AF-….txt` prints a local `Erstellt:` header and then, under
„Startprotokoll" and „Laufzeitprotokoll", the raw log lines with their UTC `at` — and says so
nowhere. The digest that travels in the *mail body* does say so: `summarizeBootLog` heads it
„Startdiagnose — N Einträge (Zeit in UTC):" and does its date formatting as string surgery rather
than through a `Date`, precisely so no machine's timezone can get into it. The attachment carries no
such header. Anyone reading a bundle reads two clocks.

**Why the log keeps UTC instead of joining the convention.** The naive-local rule exists so that a
machine stamp and a date a person typed are the same kind of string and the client needs one parser
— none of which applies to a file nobody types into and no page renders. What does apply is the
opposite property: a log is read off a machine whose timezone the reader does not know, cannot ask
about, and may be reading months later or against a second machine's log; a naive-local line is
unorderable against anything but itself. And the specific hazard `shared/time.ts` bans
`toISOString()` for — slicing the first ten characters yields the previous calendar day near
midnight — belongs to stamps that become calendar days, which a log line never does.

**The audit is the evidence the boundary is load-bearing, in both directions.** Pinning the
customer's clock at UTC+2 was possible *only* because the two conventions sit side by side on one
disk: a boot line at `2026-08-25T18:09:24.552Z` next to the restore point that same launch wrote,
`auftakt-2026-08-25-20-09-24-601`. Neither artifact alone says anything about the machine's
timezone; the pair says it to the millisecond, and that is what made 30 of 31 expected launches
matchable to their folders within +18…+107 ms — which is in turn what let the one launch with no
restore point be identified as a real backup failure rather than as pruning. The boundary is
equally load-bearing in the direction nobody notices: a `Z` line read as a wall-clock time puts a
customer's crash two hours from where it happened, and no other field in the file contradicts it.

**Consequences.** Never read a log `at` as wall-clock time without applying the offset, and never
derive a calendar day from one. Anything new that lands in `app-log.jsonl` takes the log's
convention; anything new that lands anywhere else takes `shared/time.ts`. A reader that prints both
kinds has to label them — the mail digest does, the bundle does not, and that asymmetry is a known
wart rather than an oversight. **Revisit if a log timestamp is ever shown to a user as a time**:
the moment one is rendered rather than transcribed, it needs converting, and the place to do that
is the renderer, not the writer.

---

## The `images` table has no garbage collector, on purpose — and here is the field cost (2026-08-26, WP-70)

The decision and its four reasons are above, under „Bilder liegen in der Datenbank, referenziert
über ein Inhalts-Token". That entry could only estimate the cost, and it estimated the wrong
occasion: ten hall plans in a season, ~1.2 MB per restore point, a backup folder going from ~10 MB
to ~106 MB. On a real installation after five weeks of daily use nobody had stored ten plans. One
image had been inserted and taken out again.

**The measurement (2026-08-26, one customer installation).** The season the customer works in daily
holds exactly one `images` row: **67,830 bytes**, 623×505, `image/jpeg`, created 2026-08-14.
Nothing references it — not a token, not an `/api/images/` path, not any Markdown image syntax, in
any prose column of any table, and there is no inline `data:` image anywhere in the dataset either.
So it is an image that was added to a note and removed again twelve days before the snapshot. It is
**24 % of that season's 278,528-byte file**, it is in all 30 restore points because `BACKUP_KEEP` is
30, and that is **~2.0 MB — about a ninth of the entire 18.0 MB backup folder**, which sits in the
customer's own cloud-synced Documents.

**The multiplier the earlier entry predicted is exactly the one the field shows**; only the
denominator was wrong. Ten plans were the pessimistic case and one removed picture is the ordinary
one, and the ordinary one still costs thirty copies, because retention is what turns a deleted
image into a permanent one.

**What makes it permanent is the shape of the delete paths, not merely the absence of a sweep.**
Every hard delete of a data row walks `DELETE_ORDER` from `server/src/lib/cascade.ts`
(`dropUnusedSettings` deletes settings keys, which cannot reach an image):
`purgeExpired`, the Papierkorb's „Endgültig löschen" in `routes/deleted.ts`, and `clearTables` in
`seed.ts`. `images` is deliberately not in that list, so it is unreachable from all three — a full
`npm run seed` empties all eight soft-deletable tables and leaves the image row standing. There is
no list endpoint either, so nothing in the app can even enumerate what is there.

**The number is the whole point of recording this.** „Acceptable" was a judgement made against an
estimate; it is now a judgement made against a measurement, and it stands: 2 MB is nothing, and the
alarming-looking 24 % is a ratio against a small file rather than a quantity anyone feels. The
counterweight named in the original entry — **visibility, not collection**, a counted „Ungenutzte
Bilder entfernen" that reports before it deletes — is unchanged, and this is the first real number
such a card would have had to show. Re-open the question on a *quantity*, not on a ratio:
photographic images (roughly 3× a line-art plan) or a habit of inserting and removing them. Measure
again before revisiting.

---

## A season migrates only when a window pins it (2026-08-26, WP-70)

`initDb` is the single initialisation path and `getDb()`/`createSeason()` are its only callers, so
a season file is detected-and-repaired exactly when something opens it and at no other moment. That
much has always been true and is documented function by function. What a real multi-season
installation adds is that its two consequences are larger than they look, and that both are
properties tooling has to respect rather than defects to design away.

**(a) One installation legitimately holds several schema generations.** The audited machine has
three seasons at two generations: two stamped `user_version = 1`, one still at `0` and missing
`artists.task_columns`, `projects.task_columns` and `settings.rev` — all v0.10.0 additions — for no
reason other than that no window had pinned that season since the update reached the machine.
Nothing is wrong with it. `assertSchemaSupported` refuses only a *newer* file (`>` and nothing
else), the chain is idempotent, and the season comes out current on its next open, stamped at the
end. The same file is one generation behind in three columns and *ahead* in a declared default,
because `ALTER TABLE` never rewrites one: seasons that predate a rename keep the old default text
while the file created from a newer `SCHEMA` carries the new one. Stored values are identical
everywhere; only the declarations differ.

The rule that follows is for tools, not for the app: **any script, assertion or query that assumes
the seasons in one data directory share a schema is wrong on real data.** The two places in the
product that read a season they have not opened already assume the opposite, and are the pattern to
copy. `seasonStats` and `adoptLegacyBackupConfig` both open a non-current season raw
(`new Database(path)`, read-write — a read-only handle cannot create the WAL shared-memory file),
wrap every read in `try/catch`, and degrade that one season to `null` or skip it instead of failing
the whole response; both say why in a comment, the second pointing at the first. `seasonStats` goes
a step further and writes its SQL to survive the difference — its open-task count excludes the legacy
`'erledigt'` status alongside the current one, because a file nobody has opened never ran
`migrateTaskStatus`. This installation is the field evidence that the precaution earns its keep.

**(b) Retention is measured in opens, not in elapsed days.** `purgeExpired` runs in exactly two
places: once at boot for the registry default season (`server/src/index.ts`), and inside `getDb()`
on a season's first request-context pool-miss open in this process. Both were deliberate — without
the second, a season only ever worked in from a pinned window would never purge at all (PR50-07) —
and together they mean the Papierkorb's promise is kept only for seasons somebody uses. That
promise is not vague prose: `routes/deleted.ts` computes `deleted_at + PURGE_AFTER_DAYS` per row and
the Archiv page renders it as „wird in N Tagen endgültig entfernt". **So „30 Tage" is thirty days
of *use*, per season.** The field instance is a tombstone 33 days old sitting in a season last
opened when it was 25 days old; it will go the moment that season is pinned again.

One rider belongs in the same place, because it is the same bound seen from the other side: the
sweep is limited not only to seasons that get opened but to the *first* such open, the pool entry
being the once-per-process guard. On that first open the customer sees nothing wrong — listing the
Papierkorb is itself a request that opens the season, so the sweep has run by the time the page draws
and `purgeHint`'s `Math.max(0, d)` covers whatever is left. After it, a row that crosses the cutoff
while the process is still alive is *not* swept again, and the Archiv page will count it down to „in
0 Tagen" and keep listing it. A desktop app restarted most days hides that; a machine left on for a
fortnight does not. What outlives the promise in both cases is the **disk**: the row sits in the
file, and in every restore point taken meanwhile, past the date the app named for it.

**Neither consequence is to be fixed by migrating eagerly at boot.** Opening every season file at
startup to bring it forward would pay the whole chain for seasons nobody is going to look at, and —
the sharper reason — it would turn WP-R5's refusal of a single newer season file into a startup
failure. `server/src/index.ts` already routes around exactly that: the default season's open is
wrapped so the process survives it, precisely so that a user with one season from a newer build can
still reach the others and be told which one is the problem. A boot-time mass migration would
reintroduce the failure mode that guard exists for. Named here so it is not proposed again.

---

## Backups are `VACUUM INTO` snapshots, not byte copies (2026-08-26, WP-70)

`snapshotDb` writes every season file through `VACUUM INTO`, because copying a live SQLite file
with the filesystem is not safe under WAL — committed rows sit in the `-wal` until a checkpoint, and
a plain copy of the `.db` can and in practice does yield an empty database. That is old and
documented at the function. The consequence is what needed writing down, because it looks exactly
like a defect: **a restore point's `.db` never hashes equal to the live file it came from, and its
size differs too.** A snapshot is a freshly written, compacted image, so the page counts move (the
audit measured 68 live against 63 backed up for one season, 34 against 32 for another) and the
journal mode differs — `VACUUM INTO` output is `journal_mode = delete`, the live file is `wal`.

**The rule, for verification, for support and for every future audit: compare rows, never bytes.**
The WP-70 pass came within one step of filing „the backups are stale" off a hash comparison; what
settled it was counting ten tables across three seasons, live against the newest restore point, and
finding them equal table for table.

**One entry in a restore point is a genuine byte copy, and that is the trap inside the trap.**
`runBackup` copies `seasons.json` with `copyFileSync`, so the registry *is* hash-identical to the
live one as it stood when the point was written — the audit confirmed a match by sha256, 922 B on
both sides — while the season `.db` files beside it are not, and `MANIFEST.txt` is generated fresh
and has no live counterpart at all. Three kinds of entry in one folder, three comparison rules. A
method inferred from whichever file happened to be checked first is wrong about the other two.

**Two further properties fall out of the same mechanism.** A snapshot is compacted, so a restore
point can be *smaller* than its source while holding strictly the same rows — size is not evidence
of loss in either direction. And a snapshot carries no `-wal`/`-shm`, which is why reading ninety
restore-point databases in the audit produced no sidecar artifacts while reading the live files did
(see „Auditing a customer's data directory" in `docs/VERIFYING.md`). It is also what
`validateImportCandidate` leans on when it rejects a candidate whose `-wal` is non-empty: an
app-produced backup never has one, so a file that does is a hand-copied live database with rows the
import would silently drop.

---

## `check:boot` never causes `warm` — the field's most common outcome is an accepted gap (2026-08-26, WP-70)

The customer's real `boot-log.jsonl` (149 lines over eleven days) is dominated by an outcome the
boot gate never produces: `skip/warm` — a same-process renderer reload that finds its session
state already stamped, reuses the memoised startup and skips the gesture — accounts for 106
lines, 71.1 %. Season switches and in-app reloads simply outnumber cold starts in the field,
about three warm reloads for every launch. The gate, meanwhile, causes and asserts six of the
seven outcomes this log contains — `done`, `secondary`, `abort:hitch`, `abort:drops`, `click`
and `deadline` — and more besides that the log happens not to show (`hold-max`, `app-failed`,
`reduced-motion`); the one it cannot cause is `warm`, because that requires reloading the
*same* window with its `sessionStorage` intact, and the harness only ever cold-starts the app. That is its design, not an oversight (see „The boot gate
asserts accounting, never a timing").

Decided by Andre, 2026-08-26: **this is an accepted, named gap, not a hole to close.** The
gate's rule is that it asserts only outcomes it caused; a `warm` line that shows up in a run's
log is someone else's work, and counting it would assert an accident. Do not „fix" this by
loosening the accounting to tolerate or expect uncaused `warm` lines. If `warm` coverage is
ever genuinely wanted, it is a deliberate build — a new case that itself performs the
same-window reload and moves the pinned 210 — and it should first answer why: `warm` is the
cheapest path through boot (the gesture is skipped by design), and eleven days of field data
show it doing exactly that. One practical rider from the same numbers: the renderer is reloaded
warm about three times as often as the app starts cold, so any per-renderer-load „first frame"
work is paid on every one of those reloads — weigh that before adding any.

## „Künstler" is one id, renamed on the Übersicht (2026-08-27, WP-84)

`dash.artists` (the Übersicht's section box) and `artist.kicker` (the line above an artist's H1)
both shipped with the default „Künstler" and were stored as independent rows in the per-season
`labels` array. Two pencils, one word, no link: renaming the kicker changed every artist page but
never the Übersicht, and renaming the Übersicht never reached the artist pages. From the outside
this reads as a sync bug rather than as two settings, which is how it was reported — the customer's
description was that the rename „does not get mirrored".

`artist.kicker` is retired into `dash.artists`. The kicker renders it as **plain text with no ✎**,
and the two other artist-page consumers — the „Layout · Künstler" menu heading and
`EditArtistButton`'s modal/undo/delete wording — follow the same id. One heading, one place to
rename it, on the section it names.

**Not two ids with an inherit-and-pin fallback.** That was the alternative: keep `artist.kicker`,
resolve it to `dash.artists` when it has no override of its own, and let a festival pin a separate
singular („Act" over one, „Acts" over the grid). Rejected by user decision — the pin is silent, so
a user who once edited the kicker would find the Übersicht rename mysteriously not working again,
which is the reported bug wearing a hat. The cost is real and accepted: **one word serves singular
and plural everywhere**, so a rename to „Act" reads „3 Act" in the cascade sentence. German's
„Künstler" is the same word either way, so the default never showed this.

**A read-side alias, not a migration.** `LEGACY_LABEL_KEYS` in `lib/labels.ts` maps the retired id
onto the surviving one, and `resolveLabels` applies aliases *before* own overrides so the survivor
wins regardless of row order. A stored `artist.kicker` therefore still renders — a customer's rename
is not silently reverted — while `labels` is a per-season array in a per-season database, so a write
migration would mean rewriting every season's settings to save one map lookup on read.
`parseLabelOverrides` already keeps rows whose key this build does not know (it was written to let a
newer version's rename survive an older build's write), so the legacy row is preserved for free.
Nothing writes a legacy key: `useRenameLabel` always writes the target.

**Where the rename now reaches, and where it deliberately does not.** The sweep took the in-app
strings that had hardcoded „Künstler": the global search group and placeholder, the archive's type
pill and its filter, the delete cascade sentence (`typeLabels()` injects the noun, keeping
`lib/deletedTypes.ts` React-free for `check:unit`), the move-task dialog, the season-copy checkbox,
„Künstler-Spalten", and the not-found/failed states on the artist page and its one-pager. Three
strings were *reworded* rather than substituted, because German case and gender cannot be derived
from a noun the app has never seen: the copy dialog's hints became „gehören zu: X & Projekte"
(„hängen an Musiker" is wrong where „hängen an Künstlern" was right), and the artist page's „Keine
Termine für diesen Künstler." dropped to `EventList`'s own „Keine Termine." default rather than
guess an article. Still hardcoded, on purpose: the Excel export header (the server has no label
resolver) and the landing page's season-card stat (cross-season, while `labels` is per season).
`artist.kontakte` („Künstler-Kontakte") keeps its own ✎ and does not follow — it is a section
heading with its own edit surface, not a stray literal.

`project.kicker` („Projekt") and `artist.projekte` („Projekte") are the same structural split and
were **left alone**: the two German words genuinely differ, so there is no shared word to join.

---

## Ein Zeilenanfang ist kein Befehl (2026-08-27, WP-85)

Reported by Andre: „when you type a `+` at the beginning of a list it gets turned into a list item
and doesn't stay a plus … when being rendered, drops the plus and turns it into a box of some kind."
The box is a second-level bullet — the plus had made a *nested* list inside the item above it.

**Two independent mechanisms, and the reported one is the smaller.** `bulletListInputRegex` in
`@tiptap/extension-list` is `/^\s*([-+*])\s$/`: three characters start a list, so `+` and a space
converted the block on the spot. Underneath it sat the quieter fault — `escapeMarkdownSyntax`
escapes a backslash, a backtick, `*`, `_`, `[`, `]` and `~`, which is a statement about *inline*
syntax and knows nothing about where a character sits. Every CommonMark **block** construct is
decided by what stands at the start of a line, so a paragraph whose text merely *began* `+ Punkt A`
was stored verbatim and read back as a list — by the editor and by `Markdown.tsx` alike. `-`, `#`,
`2026.`, `1)` and `---` had the identical fault; `*` and `>` were safe only by luck, one through the
inline escape and one through the entity encoding. This is the WP-49 and WP-57 shape: the user's
structure was gone from storage, not merely drawn wrong.

Fixing only the input rule would have left every other way in — paste, CSV import, restored backup,
a legacy WP-49 fence, and `Cmd-Z` on an input rule, which hands back exactly the literal text the
serializer then destroyed. **`1)` was reachable by typing alone**: no input rule claims a closing
parenthesis, so it went to the database raw and came back a list on the next open.

**The escape is a rule about lines, not about characters, and it runs on the serialized paragraph.**
`escapeBlockStarts` (`lib/blockEscape.ts`) is called from one place, `MdParagraph.renderMarkdown` —
the only point where a paragraph's finished text still starts at column 0. The list renderer
prefixes `- ` and the indent *afterwards* and the blockquote its `> `, so one paragraph override
covers list items and quotes too. Pushing it down to the text nodes was the obvious alternative and
is wrong twice: a text node does not know it is at a line start, and a whole-paragraph colour
serializes to `<span class="tc-rot">+ Punkt</span>`, where the plus is at column 21 and harmless —
escaping it there would put a backslash inside the span, in every backup and every `.xlsx` export,
for nothing. Both are pinned as corpus guards that pass before *and* after the fix.

**At most one backslash per line, and never on a line that already has one.** Every rule tests the
same position — the first non-space character, or for the ordered list the punctuation right after
the digits — and after a rule fires that position holds a backslash, which is in no rule's character
class. That is the whole idempotence argument, and it is the argument WP-62 did not have: an escape
that can fire on its own output grows one backslash per save without limit, and the *first* save is
always right, so only idempotence catches it.

**Constructs deliberately given no rule**, each because it cannot reach a line start: `>` and `<`
are entity-encoded before the escape runs (that is semantics the whole dialect rests on — the reader
whitelists `<u>` and the colour span precisely because everything else is encoded), and a backtick,
`~` and `_` are already dead through the serializer's inline escape. The second group is an
implementation detail rather than semantics, so it is held by four serialize cases instead of a
rule: an upgrade of `@tiptap/markdown` that narrows `escapeMarkdownSyntax` fails loudly rather than
silently. A bare leading pipe gets no rule either — a header row alone is not a table, only the
delimiter row under it makes one, and escaping both would be churn in every hand-drawn ASCII table.

**The indent is unbounded, not CommonMark's three spaces.** WP-49 disabled `codeIndented` on both
halves, which took the four-space ceiling with it: `    - vier` is a list to the reader now. A
`{0,3}` bound would have left exactly the paragraphs WP-49 exists for unprotected.

**Only `-` still starts a list when typed** (user decision). Nothing in the app ever *writes* `+` or
`*` — the serializer spells every bullet `- ` and the toolbar has a button — so those two characters
had no effect but to surprise someone who meant „+ 2 Helfer" or „*siehe unten". Keeping them would
also have made the two halves disagree about one keystroke, because an input rule fires only at the
start of a text block: `+ Punkt` after Shift+Enter would have stayed a plus while the same two keys
at the start of the paragraph made a list. **The ordered rule was left alone.** `2026. ` still
becomes `<ol start="2026">`, which is the same class of surprise, but narrowing it is a judgement
about how you start a list at 3 rather than a bug fix, and it has a mitigation the plus did not:
Backspace runs `undoInputRule()` first, so one keystroke gives the text back — and the serializer
half now protects that shape everywhere it is *not* typed.

**Neither reader was touched.** `+` and `*` are still accepted as list markers on the way in, which
legacy notes and every import depend on, and `\+` is an ordinary CommonMark character escape that
marked and micromark both consume. So nothing already stored moves: a note that holds `+ x` today
already *is* a list and stays one, and the escape never sees a node.

**Two consequences, stated so they are not reported as bugs later.** The `.xlsx` export writes
stored Markdown verbatim into the `comment` column, by the decision recorded under WP-62 above, so
`\+ Punkt A` now lands in a cell beside the `**fett**` and `<span class="tc-…">` that have always
been there. That is the strongest argument for keeping the rule table minimal and is why `>` and the
table header row have no rule. And **one existing note shape changes what it draws**: a paragraph
line with leading spaces and a marker (`    - vier`) is prose to the editor and a bullet to the
card *today* — the two halves already disagree — and after the first save of such a note both show
prose. It needs an import or a pre-WP-49 note to exist at all, and the direction is the honest one,
since the editor is what the author was looking at while typing.

**Why 110 corpus cases never found it.** Render-equality is structurally blind here: stored
`+ Punkt A` renders as a list, the round-trip writes `- Punkt A`, which renders identically, and
idempotence holds too. Only a case written in the *escaped* spelling bites — `render('\- x')` is a
paragraph, and the unfixed round-trip drew a list — or one seeded from ProseMirror JSON, which is
the only way to say „the text of this paragraph *is* `+ Punkt A`". Fourteen of the seventeen new
corpus entries fail on the unfixed code; the three that pass are the two deliberate guards and the
`*` case that was safe by luck. `check-markdown.ts` also gained its first coverage of **typing**:
`handleTextInput` is reachable in jsdom, so the input rule is asserted there rather than in
`check:browser`, whose pinned total does not move.
