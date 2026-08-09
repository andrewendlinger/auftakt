# Decisions

Things that were considered and **deliberately not done**, with the reasoning that made them
decisions rather than oversights. Most came out of the 2026-07 full-codebase review, where several
were raised more than once by different passes — which is exactly why they are written down.

If you are about to re-raise one of these, the bar is new information, not a fresh opinion.

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

## react-router GHSA-qwww-vcr4-c8h2 — not applicable, not upgradable (2026-08-06)

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

So: `react-router` is ignored for `/client` in `.github/dependabot.yml`, which stops the failing
security update from re-running. `npm audit` is unaffected and still reports it — that is
deliberate, and harmless, because the audit step in `.github/workflows/build.yml` is
`continue-on-error: true` and reports without gating the build.

**Remove the ignore when** `react-router-dom` ships a release that depends on a patched
`react-router`. At that point this becomes an ordinary bump.

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
empty on purpose.

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

## Known sharp edges with no owner

Real, understood, and deliberately not scheduled. Each carries a comment at its own site; none is
worth a backlog entry, because the cost of the fix exceeds what it buys today. Listed so that
finding one does not read as a discovery.

- **Landing ids are reused.** `nextId` is `max(surviving ids) + 1` (`patchLanding`, `db.ts`), so
  deleting the highest-numbered section and adding one hands out the same `lt<id>` again. Every
  holder of the key survives that today — the undo restores the row carrying its own id, `prepend`
  replaces an existing entry rather than adding a second. A monotonic counter in `seasons.json`
  would close it properly.
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
