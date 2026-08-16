# Decisions

Things that were considered and **deliberately not done**, with the reasoning that made them
decisions rather than oversights. Most came out of the 2026-07 full-codebase review, where several
were raised more than once by different passes — which is exactly why they are written down.

If you are about to re-raise one of these, the bar is new information, not a fresh opinion.

---

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
sent, so the toast says „bitte dort noch abschicken" rather than „gesendet".

**„Text kopieren" was removed on 2026-08-14**, and with it the reasoning that a machine with no
mail client needs a second button. It was a hedge: two buttons of equal weight, and the customer
deciding which situation they are in before they know they are in one. The path that matters is the
one that works, and the fallback survives as a sentence — the address in plain text under „Was wird
mitgeschickt?", where somebody actually stuck will look. One button, no branch to choose.

That sentence is **unconditional**, which it was not when it shipped: it sat in the `else` of the
attachment note, so the packaged app reporting a *Fehler* — the main path — showed it to nobody. The
branch that hides it is exactly the branch that needs it. A machine with no mail handler clicks
„E-Mail öffnen", nothing opens, and the app then holds no address anywhere.

## „Diagnoseordner öffnen" was removed once the file was written for them (2026-08-14, WP-54)

It shipped as the route to `boot-log.jsonl`, and the diagnostics bundle replaced it the same week:
a button that opens a folder full of Chromium caches is not a better answer than a named file
already lying on the desktop. Two routes to the same evidence is one route more than the feature
needs, and the one being kept is the one that ends with the file attached.

The `reveal-diagnostics` channel went with it rather than staying behind as an unused handler.
`shell.showItemInFolder` itself stays, in `save-diagnostics` and nowhere else (`electron/main.ts`):
it reveals the bundle it has just written, on a path the renderer cannot aim — the removed thing is
the standalone button and the channel that let a renderer ask for a folder, not the reveal. If a
bundle cannot be written, the mail carries the five-line summary instead; nothing routes the
customer into `userData` again.

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
`Auftakt-Diagnose-<ref>.txt` and reveals it selected, and the mail names that filename.

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

What it costs is one manual step — the drag — and that is the floor, not a shortfall. „E-Mail
öffnen" reveals the file first and opens the client second, so the compose window is what ends up
in front.

Because that step is the floor, it is where the words go, and **the words are a dialog rather than
a card (2026-08-14).** The steps were first written as a numbered card above the send button, which
put the one thing the customer has to do at the bottom of a scrolling form under three text boxes —
the easiest place in the feature to skip. „Weiter" now opens a second dialog carrying those steps
and nothing else, and only its „E-Mail öffnen" writes the file and opens the client. A card is
scrolled past; a dialog is answered. It also settles what the button may claim: „E-Mail schreiben"
promised a mail this click does not write, and „verschicken" would have promised a send that is not
this app's to make.

The draft then opens on the instruction to attach the file, on the first line, because a mail
client shows the first line and not the signature. Kind, area and reference used to sit above it
and now sit in the technical block: they are what the report is filed under, the subject carries
all three, and nothing about them is for the reader to act on. The instruction is addressed to the
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

**The dialog's `maxLength` cannot be that guarantee (2026-08-14, WP-54).** It was written as one —
300 characters per field, „sized so three full fields of ordinary German prose still fit" — and the
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

A wish carries no summary at all. Startup timings say nothing about a feature request, and the
budget they would spend is better spent on what was actually asked for.

`why` is read back out under the same distrust it was written with. `bootLogLine` caps the payload
as a whole and never inspects the fields inside it, so a literal newline in `why` would forge an
extra report line in a support mail and a long one would eat the mailto budget. Every string
lifted out of the log is flattened and sliced.

## The kind is asked first, and it rewrites the questions (2026-08-14, WP-54)

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

**No UI to change a column's scope.** A column created in the wrong place is deleted and created
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

**Not a version *negotiation*.** No compatibility range, no „read-only mode" for a newer file, no
downgrade path. Auftakt is a single-user local app whose answer is „update Auftakt", and every
alternative buys a permanent second code path for a case that resolves itself in one download.
